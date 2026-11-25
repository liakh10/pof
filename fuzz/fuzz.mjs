// POF program fuzzer: seeded, deterministic in its inputs, against the fuzz chain (zsh fuzz/chain.sh) running the snapshot build.
//   SEED=1 node fuzz/fuzz.mjs [suite ...]      (default: every suite, in order)
// Each case states what must happen (succeed, or fail with a named error, or fail for any reason) and every outcome that differs is
// listed under "unexpected" in results/run-<seed>.json, with the error-branch coverage (which error each instruction returned, and
// which error variants of the programs were never reached), compute units and transaction sizes.
import fs from 'node:fs';
import path from 'node:path';
import { FUZZ, PublicKey } from './lib/core.mjs';
import { world } from './lib/world.mjs';
import { attest } from './suites/attest.mjs';
import { ed25519 } from './suites/ed25519.mjs';
import { revoke } from './suites/revoke.mjs';
import { readyState, canonicals } from './suites/state.mjs';
import { accounts, data } from './suites/accounts.mjs';
import { orderings, donations } from './suites/lifecycle.mjs';
import { gate } from './suites/gate.mjs';
import { rotation } from './suites/rotation.mjs';
import { machine } from './suites/machine.mjs';
import { cu, cuHolder } from './suites/cu.mjs';
import { revsig } from './suites/revsig.mjs';
import { staged } from './suites/staged.mjs';
import { voidkey } from './suites/voidkey.mjs';

const seed = BigInt(process.env.SEED || 1);
const only = process.argv.slice(2);
const want = s => !only.length || only.includes(s);
const scale = Number(process.env.SCALE || 1);
const t0 = Date.now();
const W = await world(seed);
console.log(`POF fuzz · seed ${seed} · scale ${scale} · verifier ${W.V.publicKey.toBase58().slice(0, 8)}…`);
W.suite('setup');
await W.setup({ fee_lamports: 10_000_000n, holder_min: 1_000_000n * 1_000_000n, validity_slots: 600n, max_attest_age: 150n, max_root_lag: 9_000n, rotation_delay: 40n });
W.asset2 = (await W.config()).assets[2].enabled || (await W.h.send([W.P.ix('set_asset', { asset: 2, tiers: { enabled: true, mint: W.kp().publicKey, decimals: 6, mins: [10n, 20n, 30n, 0n, 0n] } }, { admin: W.admin.publicKey })], [W.admin])).ok;
const S = n => Math.max(1, Math.round(n * scale));
const run = async (name, f) => { if (!want(name)) return; const t = Date.now(); console.log(`— ${name}`); try { await f(); } catch (e) { console.log(`  SUITE ERROR ${name}: ${e.stack}`); W.results.unexpected.push({ suite: name, case: 'suite error', got: String(e.message).slice(0, 500) }); } console.log(`  ${name}: ${W.results.suites[name]?.cases ?? 0} cases, ${W.results.suites[name]?.unexpected ?? 0} unexpected, ${((Date.now() - t) / 1000).toFixed(0)} s`); };

await run('attest', () => attest(W, { a1PerOffset: 3, a2PerField: S(8), a3: S(1500) }));
await run('ed25519', () => ed25519(W, { header: S(400) }));
await run('revoke', () => revoke(W));
await run('revsig', () => revsig(W));
let S0, C;
if (want('accounts') || want('data')) { W.suite('accounts'); S0 = await readyState(W); C = await canonicals(W, S0); }
await run('accounts', () => accounts(W, C, S0));
await run('data', () => data(W, C));
await run('orderings', () => orderings(W, { races: S(4) }));
await run('donations', () => donations(W));
await run('gate', () => gate(W));
await run('admin', async () => {
  const { h, P, admin, users, expect } = W;
  W.suite('admin');
  const x = W.kp(); await h.fund([x], 3);
  const a = await W.att({ kind: 2, ctlKp: x }); await W.certify(x, a);
  expect('set_paused by a stranger', 'set_paused', await h.send([P.ix('set_paused', { paused: true }, { admin: users[0].publicKey })], [users[0]]), 'NotAdmin');
  await h.send([P.ix('set_paused', { paused: true }, { admin: admin.publicKey })], [admin]);
  expect('certify while paused', 'certify', await W.simCertify(users[0], await W.att({ kind: 0, ctlKp: users[0] })), 'Paused');
  expect('renew while paused', 'renew', await W.simCertify(x, await W.att({ kind: 2, ctlKp: x, null_hashes: a.null_hashes }), { name: 'renew' }), 'Paused');
  expect('revoke_by_holder while paused', 'revoke_by_holder', await h.sim([W.revokeHolderIx(x, a.subject_hash)], [x]), null);
  expect('anchor_log while paused (not paused by design?)', 'anchor_log', await h.sim(W.anchorIxs(W.V, (await W.treasury()).log_size + 1n, W.R.bytes(32), users[0]), [users[0]]), null);
  await h.send([P.ix('set_paused', { paused: false }, { admin: admin.publicKey })], [admin]);
  // the anchored log only grows: a signed head of size 2^64-1 ends anchoring for good
  const t = await W.treasury();
  expect('anchor_log of a smaller size', 'anchor_log', await h.sim(W.anchorIxs(W.V, t.log_size, W.R.bytes(32), users[0]), [users[0]]), 'LogNotGrowing');
  expect('anchor_log signed by a stranger', 'anchor_log', await h.sim(W.anchorIxs(W.kp(), t.log_size + 1n, W.R.bytes(32), users[0]), [users[0]]), 'WrongVerifier');
  for (const [p, why] of [[{ fee_lamports: 250_000_001n }, 'FeeAboveCap'], [{ validity_slots: 9n }, 'BadParams'], [{ validity_slots: 13_000_001n }, 'BadParams'], [{ max_attest_age: 4n }, 'BadParams'], [{ max_attest_age: 9001n }, 'BadParams'], [{ max_root_lag: 0n }, 'BadParams'], [{ rotation_delay: 4n }, 'BadParams'], [{ rotation_delay: 1_296_001n }, 'BadParams'], [{ holder_min: 0n }, 'BadParams']]) {
    const params = { ...(await W.config()).params, ...p };
    expect(`set_params ${JSON.stringify(p, (k, v) => typeof v === 'bigint' ? String(v) : v)}`, 'set_params', await h.sim([P.ix('set_params', { params }, { admin: admin.publicKey })], [admin]), why);
  }
  expect('withdraw_fees above the free balance', 'withdraw_fees', await h.sim([P.ix('withdraw_fees', { lamports: 10n ** 15n }, { admin: admin.publicKey, dev: W.dev.publicKey })], [admin]), 'TreasuryShort');
  expect('withdraw_fees to another address', 'withdraw_fees', await h.sim([P.ix('withdraw_fees', { lamports: 1n }, { admin: admin.publicKey, dev: users[0].publicKey })], [admin]), 'NotAdmin');
  expect('init_config a second time', 'init_config', await h.sim([P.ix('init_config', { verifier: W.V.publicKey, relayer: W.relayer.publicKey, dev: W.dev.publicKey }, { admin: admin.publicKey, program_data: W.K.programData })], [admin]), '*');
  expect('close_config while open', 'close_config', await h.sim([P.ix('close_config', {}, { admin: admin.publicKey })], [admin]), 'NotClosing');
});
await run('rotation', () => rotation(W, { steps: S(40) }));
await run('machine', () => machine(W, { steps: S(300) }));
await run('staged', () => staged(W));
await run('void', () => voidkey(W));
await run('cu', () => cu(W));
await run('holder', () => cuHolder(W));
await run('winddown', async () => {
  const { h, P, G, admin, users, expect } = W;
  W.suite('winddown');
  // a signed head of size 2^64-1 (one bad or leaked signature) ends on-chain anchoring for good, across key rotations
  const MAXU = (1n << 64n) - 1n;
  const bounded = 'revoke_spent_staged' in P.ixs;   // 187914b bounds each anchor step (fuzz finding FZ-02)
  expect('anchor_log of size 2^64-1', 'anchor_log', await h.send(W.anchorIxs(W.V, MAXU, W.R.bytes(32), users[0]), [users[0]]), bounded ? 'LogNotGrowing' : null);
  if (bounded) { const t = await W.treasury(); expect('anchor_log one step past the bound', 'anchor_log', await h.sim(W.anchorIxs(W.V, t.log_size + 10_000_001n, W.R.bytes(32), users[0]), [users[0]]), 'LogNotGrowing'); expect('anchor_log exactly at the bound', 'anchor_log', await h.sim(W.anchorIxs(W.V, t.log_size + 10_000_000n, W.R.bytes(32), users[0]), [users[0]]), null); }
  expect('  then any honest head is refused', 'anchor_log', await h.sim(W.anchorIxs(W.V, 12_345_678n, W.R.bytes(32), users[0]), [users[0]]), bounded ? '*' : 'LogNotGrowing');
  {
    const nk = W.kp();
    const pr = await h.send([P.ix('set_verifier', { next: nk.publicKey }, { admin: admin.publicKey })], [admin]);
    const c = await W.config();
    await h.waitSlot(BigInt(c.next_verifier_slot) + 1n);
    expect('  and after a key rotation too (no reset exists)', 'anchor_log', await h.sim(W.anchorIxs(nk, 12_345_679n, W.R.bytes(32), users[0]), [users[0]]), bounded ? '*' : 'LogNotGrowing');
    W.V = nk;
  }
  const buf = W.openBuffer ? await W.openBuffer() : null;
  await h.send([P.ix('close_begin', {}, { admin: admin.publicKey })], [admin]);
  expect('certify while closing', 'certify', await W.simCertify(users[0], await W.att({ kind: 0, ctlKp: users[0] })), 'Closing');
  const inv = await W.invariants('closing');
  expect('close_config with certificates left', 'close_config', await h.sim([P.ix('close_config', {}, { admin: admin.publicKey })], [admin]), 'NotExpired');
  for (const c of inv.certs) { const r = await h.send([W.expireIx(users[1], c.c.subject_hash, c.c.asset, new PublicKey(c.c.payer))], [users[1]]); expect('expire during the wind-down', 'expire', r, null); }
  for (const m of inv.members) { const r = await h.send([W.evictIx(users[1], new PublicKey(m.m.room), m.m.subject_hash, m.m)], [users[1]]); expect('evict during the wind-down', 'evict', r, null); }
  const inv2 = await W.invariants('all expired');
  const cc = await h.send([P.ix('close_config', {}, { admin: admin.publicKey })], [admin]);
  if (buf?.ok) {
    expect('close_config while a staged path buffer is still open (must refuse, or the buffer is orphaned)', 'close_config', cc, '*');
    if (cc.ok) {
      const cp = await h.send([buf.close()], [buf.rev]);
      expect('  close_path after close_config (its config account is gone)', 'close_path', cp, null);
      W.note(`after close_config a staged buffer cannot be closed (close_path needs the config): ${cp.ok ? 'closed' : cp.why}; the revoker's rent and a POF-owned account stay forever`);
    }
  } else expect('close_config', 'close_config', cc, null);
  for (const r of inv2.rooms) expect('release_room after close_config', 'release_room', await h.send([G.ix('release_room', {}, { caller: users[1].publicKey, room: r.address, creator: new PublicKey(r.r.creator), pof_config: W.K.config })], [users[1]]), null);
  const left = [...await h.conn.getProgramAccounts(P.programId), ...await h.conn.getProgramAccounts(G.programId)];
  expect('nothing left owned by POF or pof_gate', 'close_config', { ok: left.length === 0, why: `${left.length} accounts left` }, null);
});

/* coverage of the programs' error variants */
const reached = new Set(Object.values(W.results.coverage).flatMap(c => Object.keys(c)));
const variants = { pof: Object.values(W.P.errors), pof_gate: Object.values(W.G.errors) };
W.results.errorCoverage = Object.fromEntries(Object.entries(variants).map(([p, list]) => [p, { reached: list.filter(e => reached.has(e)), never: list.filter(e => !reached.has(e)) }]));
W.results.instructions = { pof: W.P.ixs ? Object.keys(W.P.ixs) : [], pof_gate: Object.keys(W.G.ixs) };
W.results.instructionsCovered = Object.keys(W.results.coverage);
W.results.seconds = Math.round((Date.now() - t0) / 1000);
W.results.snapshot = JSON.parse(fs.readFileSync(path.join(FUZZ, 'results/snapshot.json'), 'utf8')).sources;
const total = Object.values(W.results.suites).reduce((s, x) => s + x.cases, 0);
W.results.total = total;
const out = path.join(FUZZ, 'results', `run-${seed}${only.length ? '-' + only.join('+') : ''}.json`);
fs.writeFileSync(out, JSON.stringify(W.results, (k, v) => typeof v === 'bigint' ? String(v) : v === Infinity ? null : v, 1));
console.log(`\nseed ${seed}: ${total} cases, ${W.results.unexpected.length} unexpected, ${W.results.invariantChecks || 0} invariant checks, ${W.results.seconds} s → ${path.relative(process.cwd(), out)}`);
for (const [p, c] of Object.entries(W.results.errorCoverage)) console.log(`  ${p}: ${c.reached.length}/${c.reached.length + c.never.length} error variants reached; never: ${c.never.join(', ')}`);
