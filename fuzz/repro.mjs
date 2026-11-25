// One reproducing test per fuzz finding (pof/reports/fuzz.md §5), on the fuzz chain (zsh fuzz/chain.sh, snapshot of zsh fuzz/build.sh).
// Each prints REPRODUCED (the finding is still there) or FIXED (the secure behaviour), and the run exits with the number reproduced.
//   SEED=77 node fuzz/repro.mjs [FZ-01 ...]
import fs from 'node:fs';
import path from 'node:path';
import { FUZZ, PublicKey, Keypair, web3, spl } from './lib/core.mjs';
import { world } from './lib/world.mjs';

const W = await world(BigInt(process.env.SEED || 77));
const { h, P, admin, users } = W;
await W.setup({ fee_lamports: 10_000_000n, holder_min: 1_000_000n * 1_000_000n, validity_slots: 600n, max_attest_age: 150n, max_root_lag: 9_000n, rotation_delay: 40n });
W.suite('repro');
const only = process.argv.slice(2);
const out = {};
async function finding(id, title, f) {
  if (only.length && !only.includes(id)) return;
  let r;
  try { r = await f(); } catch (e) { r = { reproduced: null, detail: 'error: ' + e.message }; }
  out[id] = { title, ...r };
  console.log(`${id} ${r.reproduced === true ? 'REPRODUCED' : r.reproduced === false ? 'FIXED     ' : 'ERROR     '} ${title}${r.detail ? ' · ' + r.detail : ''}`);
}
const req = (sh, tier) => h.sim([P.ix('require_certificate', { subject_hash: sh, asset: 0, min_tier: tier }, { certificate: W.certPda(sh, 0) })], [users[0]]);

await finding('FZ-01', 'a certificate signed by a rotated-out (leaked) Verifier key stays live for every gate; pause does not stop it, nothing voids it', async () => {
  const ctl = W.kp(); await h.fund([ctl], 3);
  const a = await W.att({ kind: 2, ctlKp: ctl, tier: 5, valid: 590 });   // the leaked key signs a tier-5 certificate with fake notes
  const c = await W.certify(ctl, a); if (!c.ok) throw Error('certify ' + c.why);
  await h.send([P.ix('set_paused', { paused: true }, { admin: admin.publicKey })], [admin]);
  const p = await h.send([P.ix('set_verifier', { next: W.V2.publicKey }, { admin: admin.publicKey })], [admin]);
  await h.waitSlot(BigInt((await W.config()).next_verifier_slot) + 1n);
  await h.send([P.ix('apply_verifier', {}, { caller: users[0].publicKey })], [users[0]]);
  let r = await req(a.subject_hash, 5);
  await h.send([P.ix('set_paused', { paused: false }, { admin: admin.publicKey })], [admin]);
  W.V = W.V2;
  if (P.ixs.revoke_verifier_key) {
    // the fix: the admin revokes the leaked key; the certificate dies for every gate at once and anyone voids it
    const old = (await W.cert(a.subject_hash)).verifier;
    const rv = await h.send([P.ix('revoke_verifier_key', { key: new PublicKey(old) }, { admin: admin.publicKey })], [admin]);
    r = await req(a.subject_hash, 5);
    const v = await h.send([P.ix('void_by_key', {}, { caller: users[0].publicKey, certificate: W.certPda(a.subject_hash, 0) })], [users[0]]);
    return { reproduced: r.ok, detail: `after revoke_verifier_key (${rv.ok ? 'ok' : rv.why}): require_certificate ${r.ok ? 'still yes' : r.why}; void_by_key ${v.ok ? 'voided it' : v.why}` };
  }
  return { reproduced: r.ok, detail: `require_certificate after rotation + pause: ${r.ok ? 'yes' : r.why}; no instruction revokes a Verifier key or voids its certificates` };
});

await finding('FZ-02', 'anchor_log accepts a signed head of size 2^64-1, after which no head can ever be anchored (no reset, survives rotation)', async () => {
  const MAX = (1n << 64n) - 1n;
  const r = await h.sim(W.anchorIxs(W.V, MAX, W.R.bytes(32), users[0]), [users[0]]);
  return { reproduced: r.ok, detail: r.ok ? 'size 2^64-1 accepted (simulated)' : 'refused: ' + r.why };
});

await finding('FZ-03', 'revoke_spent trusts any Privacy Program account as `tree`: a spent PDA under the protocol config (not a tree) revokes', async () => {
  const nf = Buffer.from(W.fx.spentConf, 'hex');
  const ctl = W.kp(); await h.fund([ctl], 3);
  const n = W.notesOf(1, [nf]);
  const a = await W.att({ kind: 2, ctlKp: ctl, null_hashes: n.hashes }); await W.certify(ctl, a);
  const r = await h.sim([W.revokeSpentIx(users[0], a.subject_hash, 0, 0, n.list[0].salt, nf, { tree: new PublicKey(W.fx.protocolConfig) })], [users[0]]);
  return { reproduced: r.ok, detail: r.ok ? 'accepted with tree = the protocol config EienwB…' : 'refused: ' + r.why };
});

await finding('FZ-04', 'set_roles accepts an SPL token ACCOUNT as the $ROOT mint (one-way: the holder exemption is then dead for good)', async () => {
  const mint = Keypair.generate();
  const rent = await h.conn.getMinimumBalanceForRentExemption(spl.MINT_SIZE);
  await h.send([web3.SystemProgram.createAccount({ fromPubkey: admin.publicKey, newAccountPubkey: mint.publicKey, lamports: rent, space: spl.MINT_SIZE, programId: spl.TOKEN_PROGRAM_ID }), spl.createInitializeMint2Instruction(mint.publicKey, 6, admin.publicKey, null)], [admin, mint]);
  const ta = spl.getAssociatedTokenAddressSync(mint.publicKey, admin.publicKey);
  await h.send([spl.createAssociatedTokenAccountIdempotentInstruction(admin.publicKey, ta, admin.publicKey, mint.publicKey)], [admin]);
  const r = await h.sim([P.ix('set_roles', { dev: null, relayer: null }, { admin: admin.publicKey, root_mint: ta })], [admin]);
  return { reproduced: r.ok, detail: r.ok ? 'a 165-byte token account accepted as the mint (simulated)' : 'refused: ' + r.why };
});

await finding('FZ-05', 'revoke_signed has no cap on valid_until: a signed revoke with valid_until = 2^64-1 is usable for the certificate\'s whole life', async () => {
  if (!P.ixs.revoke_signed) return { reproduced: false, detail: 'no revoke_signed in this build' };
  const ctl = W.kp(); await h.fund([ctl], 3);
  const a = await W.att({ kind: 2, ctlKp: ctl }); await W.certify(ctl, a);
  const addr = W.certPda(a.subject_hash, 0), c = await W.cert(a.subject_hash);
  const MAX = (1n << 64n) - 1n;
  const msg = Buffer.concat([Buffer.from('POF-REVOKE1'), P.programId.toBuffer(), addr.toBuffer(), Buffer.from(c.subject_hash), Buffer.from([c.asset]), Buffer.from(c.nullset_hash), W.u64le(c.issued_slot), W.u64le(MAX)]);
  const r = await h.sim([W.edIx(ctl, msg), P.ix('revoke_signed', { valid_until: MAX }, { caller: users[0].publicKey, certificate: addr })], [users[0]]);
  return { reproduced: r.ok, detail: r.ok ? 'valid_until = 2^64-1 accepted' : 'refused: ' + r.why };
});

await finding('FZ-06', 'a membership path longer than 24 levels cannot be submitted (v0 over 1,232 bytes; this validator refuses larger v1 too), so path (b) covers trees under 2^24 nullifiers only', async () => {
  const MF = JSON.parse(fs.readFileSync(path.join(FUZZ, '../program/test/fixtures/membership.json'), 'utf8'));
  const nf = Buffer.from(MF.nullifier, 'hex');
  const ctl = W.kp(); await h.fund([ctl], 3);
  const n = W.notesOf(1, [nf]);
  const a = await W.att({ kind: 2, ctlKp: ctl, null_hashes: n.hashes }); await W.certify(ctl, a);
  const sizes = {};
  for (const k of [16, 24, 25, 40]) {
    const m = { leaf_index: BigInt(MF.leafIndex), next_value: Buffer.from(MF.next, 'hex'), path: MF.path.slice(0, k).map(x => Buffer.from(x, 'hex')) };
    const r = await h.sim([W.revokeSpentIx(users[0], a.subject_hash, 0, 0, n.list[0].salt, nf, { membership: m })], [users[0]]);
    sizes[k] = r.ok ? 'ok' : r.why;
  }
  const staged = P.ixs.stage_path || P.ixs.revoke_spent_membership;
  return { reproduced: sizes[40] !== 'ok' && !staged, detail: `16: ${sizes[16]}, 24: ${sizes[24]}, 25: ${sizes[25]}, 40: ${sizes[40]}; a staged path instruction ${staged ? 'exists (' + staged.name + ')' : 'does not exist'}` };
});

await finding('FZ-18', 'certify_zk: a zk certificate revoked as spent is remade by replaying its own proof, and passes the gates after the settle window', async () => {
  if (!P.ixs.certify_zk) return { reproduced: false, detail: 'launch build: no certify_zk' };
  // the zk suite does it with real Groth16 proofs; run it here and read its record
  const { zk } = await import('./suites/zk.mjs');
  await zk(W, { proofOffsets: 2 });
  const r = W.zkReplay;
  return { reproduced: !!r, detail: r ? `replayed proof landed; after the settle window require_certificate ${r.passes ? 'passes' : 'refuses'}` : `the replayed proof was refused: ${W.zkReplayWhy}` };
});

await finding('FZ-09', 'revoked_keys holds 4 keys and nothing removes one: a fifth leaked Verifier key cannot be revoked', async () => {
  if (!P.ixs.revoke_verifier_key) return { reproduced: false, detail: 'no revoke_verifier_key in this build' };
  let n = 0, last;
  for (let i = 0; i < 12; i++) { last = await h.send([P.ix('revoke_verifier_key', { key: W.kp().publicKey }, { admin: admin.publicKey })], [admin]); if (!last.ok) break; n++; }
  const c = await W.config();
  const reuse = 'revoked_at' in c;
  return { reproduced: !reuse, detail: `${c.revoked_keys.filter(k => k !== PublicKey.default.toBase58()).length} keys held; the next one: ${last.ok ? 'accepted' : last.why}; ${reuse ? 'an entry is reusable VALIDITY_MAX slots after its revocation (revoked_at)' : 'no entry is ever freed'}` };
});

await finding('FZ-07', 'a kind 0 / kind 2 attestation whose controller is the default key (11111…) is accepted (nobody can ever revoke_by_holder it)', async () => {
  const a = await W.att({ kind: 0, controller: PublicKey.default });
  const r = await W.simCertify(users[1], a);
  return { reproduced: r.ok, detail: r.ok ? 'accepted (simulated)' : 'refused: ' + r.why };
});

await finding('FZ-08', 'close_config succeeds while a staged path buffer is open; close_path then needs the closed config: the buffer and its rent are stranded', async () => {
  if (!P.ixs.open_path) return { reproduced: false, detail: 'no staged path in this build' };
  const rev = W.kp(); await h.fund([rev], 3);
  const ctl = W.kp(); await h.fund([ctl], 3);
  const a = await W.att({ kind: 2, ctlKp: ctl }); await W.certify(ctl, a);
  const cert = W.certPda(a.subject_hash, 0);
  const buf = P.pda([Buffer.from('path'), rev.publicKey.toBuffer(), cert.toBuffer()]);
  const o = await h.send([P.ix('open_path', { nullifier: W.R.field(), next_value: W.R.field(), leaf_index: 0n, siblings: [] }, { revoker: rev.publicKey, certificate: cert, buffer: buf })], [rev]);
  if (!o.ok) throw Error('open_path ' + o.why);
  await h.send([P.ix('close_begin', {}, { admin: admin.publicKey })], [admin]);
  for (const x of (await h.conn.getProgramAccounts(P.programId)).map(x => P.decodeAccount('Certificate', x.account.data)).filter(Boolean)) await h.send([W.expireIx(users[0], x.subject_hash, x.asset, new PublicKey(x.payer))], [users[0]]);
  const cc = await h.send([P.ix('close_config', {}, { admin: admin.publicKey })], [admin]);
  if (!cc.ok) return { reproduced: false, detail: 'close_config refused with a buffer open: ' + cc.why };
  const cp = await h.send([P.ix('close_path', {}, { caller: rev.publicKey, buffer: buf, revoker: rev.publicKey })], [rev]);
  const left = await h.info(buf);
  return { reproduced: !!left, detail: `close_config ok; close_path afterwards: ${cp.ok ? 'ok' : cp.why}; buffer ${left ? 'still exists (' + left.lamports + ' lamports)' : 'gone'}` };
});

await finding('FZ-19', 'zk build: ZkOwner records ["zkowner", owner] have no close path: after the wind-down POF still owns them and their rent is stranded', async () => {
  if (!P.ixs.register_zk_owner || !P.ixs.register_zk_owner.accounts.some(a => a.name === 'owner_record')) return { reproduced: false, detail: 'no ZkOwner records in this build' };
  let left = (await h.conn.getProgramAccounts(P.programId)).filter(x => P.decodeAccount('ZkOwner', x.account.data));
  const closer = Object.keys(P.ixs).find(n => /owner/.test(n) && /close|release/.test(n));
  if (closer && (await W.config())?.closing) {
    for (const x of left) { const o = P.decodeAccount('ZkOwner', x.account.data); const b0 = await h.lam(o.payer); const r = await h.send([P.ix(closer, {}, { owner_record: x.pubkey, payer: new PublicKey(o.payer) })], [users[1]]); if (!r.ok) throw Error(closer + ': ' + r.why); if ((await h.lam(o.payer)) - b0 !== BigInt(x.account.lamports)) throw Error('rent not back to the payer'); }
    left = (await h.conn.getProgramAccounts(P.programId)).filter(x => P.decodeAccount('ZkOwner', x.account.data));
  }
  return { reproduced: left.length > 0 && !closer, detail: `${left.length} ZkOwner records left after the wind-down (${left.reduce((a, x) => a + x.account.lamports, 0)} lamports); a closing instruction ${closer ? 'exists: ' + closer : 'does not exist'}` };
});

fs.writeFileSync(path.join(FUZZ, 'results', 'repro.json'), JSON.stringify({ at: new Date().toISOString(), snapshot: JSON.parse(fs.readFileSync(path.join(FUZZ, 'results/snapshot.json'), 'utf8')).sources['programs/pof/src/lib.rs'], findings: out }, null, 1));
const n = Object.values(out).filter(x => x.reproduced === true).length;
console.log(`${n} of ${Object.keys(out).length} reproduced`);
process.exit(n);
