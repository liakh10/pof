// The POF program suite on the local clone (zsh test/all.sh runs it): every rule of pof and pof_gate against real transactions, with a
// local Verifier key signing CONTRACT §3 bytes into Ed25519 instructions exactly as the off-chain Verifier must. Covers init (only
// the upgrade authority), certify for the three subject kinds, the fee, the relayer and the $ROOT holder exemption, renew, both
// revoke_spent proofs (a nullifier PDA byte for byte as a real spend leaves it, and a REAL mainnet nullifier's membership path in
// the cloned tree's folded nullifier tree), revoke_by_holder, expire with the rent back, remaking over a revoked certificate,
// Verifier rotation with its delay, pause, the fee cap, the log anchor, withdraw_fees, the require_certificate CPI and Rooms
// (join, evict, leave), and the adversarial cases: wrong verifier key, tampered bytes, wrong program id, replayed attestation,
// stale and expired attestations, a signature that points elsewhere or is not right before, forged accounts, double revoke.
// Writes .run/result-suite.txt (passed/total), .run/cu.json (compute units per instruction) and .run/live.json (state for closing.mjs).
import fs from 'fs';
import path from 'path';
import { setup, Keypair, PublicKey, SOL, run, keyOf, web3, spl, rand, field, subjectHash, sortHashes, saltedNullifier } from './kit.mjs';

const k = setup();
const { conn, q, send, lam, fund } = k;
let passed = 0, total = 0;
const fails = [];
async function check(name, fn) {
  total++;
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { fails.push(name); console.log('  FAIL ' + name + '\n       ' + String(e.message || e).slice(0, 700)); if (e.logs && process.env.LOGS) console.log(e.logs.join('\n')); }
}
const eq = (a, b, what = '') => { if (String(a) !== String(b)) throw Error(`${what} expected ${b}, got ${a}`); };
const ok = (c, what) => { if (!c) throw Error(what || 'not true'); };
async function refuses(p, words) {
  try { await p; } catch (e) { const s = (e.why || '') + ' ' + e.message; if (words && !s.toLowerCase().includes(words.toLowerCase())) throw Error(`refused, but not with "${words}": ${s.slice(0, 500)}`); return; }
  throw Error('went through, expected a refusal' + (words ? ` (${words})` : ''));
}
const cu = {};
const unit = name => { (cu[name] = cu[name] || []).push(send.last.units); };
const FEE = 10_000_000n;

const admin = keyOf('authority');
const V = Keypair.generate(), V2 = Keypair.generate(), relayer = Keypair.generate(), dev = Keypair.generate();
const outsider = Keypair.generate(), alice = Keypair.generate(), bob = Keypair.generate(), carol = Keypair.generate(), whale = Keypair.generate();
await fund([admin, outsider, alice, bob, carol, whale, relayer], 50);
await fund([dev], 1);
const spentFile = JSON.parse(fs.readFileSync(path.join(run, 'spent.json'), 'utf8'));
const SPENT = spentFile.spent.map(h => Buffer.from(h, 'hex'));
const FAKES = spentFile.fakes.map(f => Buffer.from(f.nf, 'hex'));
const MF = JSON.parse(fs.readFileSync(path.join(path.dirname(run), 'fixtures/membership.json'), 'utf8'));
const TREE = q.K.TREE;

const params = { fee_lamports: FEE, holder_min: 1_000_000n * 1_000_000n, validity_slots: 3000n, max_attest_age: 150n, max_root_lag: 9000n, rotation_delay: 40n };
const setP = (over = {}, s = admin) => send([q.P.ix('set_params', { params: { ...params, ...over } }, { admin: s.publicKey })], [s], 100_000);
const doCertify = async (payer, a, o = {}) => { const sig = await send(k.certifyIxs(payer, a, { verifier: V, ...o }), [payer], 400_000); unit(o.name || 'certify'); return sig; };

/* ------------------------------------------------------------------ init and settings */
await check('init_config: only the program\'s upgrade authority (an outsider refused); launch settings, SOL and USDC tiers', async () => {
  await refuses(send([q.P.ix('init_config', { verifier: V.publicKey, relayer: relayer.publicKey, dev: dev.publicKey }, { admin: outsider.publicKey })], [outsider], 200_000), 'upgrade authority');
  await send([q.P.ix('init_config', { verifier: V.publicKey, relayer: relayer.publicKey, dev: dev.publicKey }, { admin: admin.publicKey })], [admin], 200_000);
  unit('init_config');
  const c = await k.config();
  eq(c.admin, admin.publicKey.toBase58(), 'admin'); eq(c.verifier, V.publicKey.toBase58(), 'verifier'); eq(c.relayer, relayer.publicKey.toBase58()); eq(c.dev, dev.publicKey.toBase58());
  eq(c.params.fee_lamports, 10_000_000n, 'launch fee'); eq(c.params.validity_slots, 6_480_000n); eq(c.params.rotation_delay, 216_000n);
  eq(c.assets[0].mins.join(), [1e9, 1e10, 1e11, 1e12, 1e13].map(BigInt).join(), 'SOL tiers');
  eq(c.assets[1].mins[0], 100_000_000n, 'USDC tier 1'); eq(c.assets[1].mint, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  ok(!c.assets[2].enabled && !c.assets[3].enabled, 'free asset slots');
  await refuses(send([q.P.ix('init_config', { verifier: V.publicKey, relayer: relayer.publicKey, dev: dev.publicKey }, { admin: admin.publicKey })], [admin], 200_000));
});
await check('set_params: admin only, bounds held (fee above the 0.25 SOL cap, validity under the floor, zero lag refused)', async () => {
  await refuses(setP({}, outsider), 'admin');
  await refuses(setP({ fee_lamports: 250_000_001n }), 'cap');
  await refuses(setP({ validity_slots: 9n }), 'bounds');
  await refuses(setP({ max_root_lag: 0n }), 'bounds');
  await refuses(setP({ rotation_delay: 4n }), 'bounds');
  await setP();
  unit('set_params');
  eq((await k.config()).params.validity_slots, 3000n);
});
await check('set_fee: capped at 0.25 SOL, admin only', async () => {
  await refuses(send([q.P.ix('set_fee', { fee_lamports: 250_000_001n }, { admin: admin.publicKey })], [admin], 100_000), 'cap');
  await refuses(send([q.P.ix('set_fee', { fee_lamports: 1n }, { admin: outsider.publicKey })], [outsider], 100_000), 'admin');
  await send([q.P.ix('set_fee', { fee_lamports: 250_000_000n }, { admin: admin.publicKey })], [admin], 100_000);
  await send([q.P.ix('set_fee', { fee_lamports: FEE }, { admin: admin.publicKey })], [admin], 100_000);
  unit('set_fee');
  eq((await k.config()).params.fee_lamports, FEE);
});
await check('set_asset: a new table in a free slot (ascending, no gaps); a set table only toggles enabled', async () => {
  const t = { enabled: true, mint: Keypair.generate().publicKey, decimals: 6, mins: [10n, 20n, 0n, 0n, 0n] };
  await refuses(send([q.P.ix('set_asset', { asset: 2, tiers: { ...t, mins: [20n, 10n, 0n, 0n, 0n] } }, { admin: admin.publicKey })], [admin], 100_000), 'bounds');
  await refuses(send([q.P.ix('set_asset', { asset: 2, tiers: { ...t, mins: [10n, 0n, 30n, 0n, 0n] } }, { admin: admin.publicKey })], [admin], 100_000), 'bounds');
  await refuses(send([q.P.ix('set_asset', { asset: 4, tiers: t }, { admin: admin.publicKey })], [admin], 100_000), 'asset');
  await send([q.P.ix('set_asset', { asset: 2, tiers: t }, { admin: admin.publicKey })], [admin], 100_000);
  unit('set_asset');
  await refuses(send([q.P.ix('set_asset', { asset: 2, tiers: { ...t, mins: [10n, 25n, 0n, 0n, 0n] } }, { admin: admin.publicKey })], [admin], 100_000), 'bounds');
  await send([q.P.ix('set_asset', { asset: 2, tiers: { ...t, enabled: false } }, { admin: admin.publicKey })], [admin], 100_000);
  const c = await k.config();
  ok(!c.assets[2].enabled && c.assets[2].mins[1] === 20n, 'disabled, table kept');
});

/* ------------------------------------------------------------------ certify */
const live = {};
await check('certify a wallet subject: the signed 240 bytes match, the fee goes to the treasury, every field stored', async () => {
  const n = k.notes(3);
  const a = await k.attestation({ kind: 0, controller: alice.publicKey, tier: 3, null_hashes: n.hashes });
  const t0 = await lam(q.K.treasury), p0 = await lam(alice.publicKey);
  const sig = await doCertify(alice, a, { logIndex: 7 });
  const c = await k.cert(a.subject_hash);
  eq(c.status, 0); eq(c.tier, 3); eq(c.subject_kind, 0); eq(c.note_count, 3); eq(c.controller, alice.publicKey.toBase58()); eq(c.payer, alice.publicKey.toBase58());
  eq(c.verifier, V.publicKey.toBase58()); eq(c.log_index, 7n); eq(c.expiry_slot, a.expiry_slot); eq(c.issued_slot, a.issued_slot); eq(c.revealed_index, 255);
  eq(Buffer.concat(c.null_hashes.slice(0, 3)).toString('hex'), Buffer.concat(n.hashes).toString('hex'), 'salted hashes');
  eq((await lam(q.K.treasury)) - t0, FEE, 'fee into the treasury');
  const rent = await k.rentOf((await k.info(q.certPda(a.subject_hash, 0))).data.length);
  eq(p0 - (await lam(alice.publicKey)), FEE + rent + 10000n, 'alice paid fee + rent + two signatures (hers and the Verifier\'s, checked by the Ed25519 program)');
  const e = await k.ev(sig, 'Certified');
  eq(e.tier, 3); eq(e.fee, FEE); eq(e.log_index, 7n);
  const t = await k.treasury();
  eq(t.live, 1n); eq(t.certified, 1n); eq(t.open, 1n); eq(t.live_min[0], 100n * BigInt(SOL), 'live minimum sum (tier 3: 100 SOL)');
  // the very same signed attestation again, at once: as a renew it is not newer (a replay), as a certify the certificate is live
  await refuses(doCertify(alice, a, { name: 'renew' }), 'newer');
  await refuses(doCertify(alice, a), 'already exists');
  live.alice = { a, n };
});
await check('certify refuses: a wrong Verifier key, tampered bytes (tier, subject, notes, nonce), another program id, another payer', async () => {
  const a = await k.attestation({ kind: 0, controller: bob.publicKey });
  await refuses(send(k.certifyIxs(bob, a, { verifier: Keypair.generate() }), [bob], 400_000), 'active verifier');
  await refuses(send(k.certifyIxs(bob, { ...a, tier: 3 }, { verifier: V, signed: a }), [bob], 400_000), 'differ');
  await refuses(send(k.certifyIxs(bob, { ...a, nonce: rand(16) }, { verifier: V, signed: a }), [bob], 400_000), 'differ');
  await refuses(send(k.certifyIxs(bob, { ...a, null_hashes: k.notes(2).hashes }, { verifier: V, signed: a }), [bob], 400_000), 'differ');
  await refuses(send(k.certifyIxs(bob, { ...a, expiry_slot: a.expiry_slot - 1 }, { verifier: V, signed: a }), [bob], 400_000), 'differ');
  await refuses(send(k.certifyIxs(bob, a, { verifier: V, programId: Keypair.generate().publicKey }), [bob], 400_000), 'differ');
  await refuses(send(k.certifyIxs(bob, a, { verifier: V, signedPayer: relayer.publicKey }), [bob], 400_000), 'differ');
  // a valid signature over the bytes, but the submitted subject is someone else's: carol's hash with bob as controller
  const forged = { ...a, subject_hash: subjectHash(0, carol.publicKey.toBase58()) };
  await refuses(send(k.certifyIxs(bob, forged, { verifier: V }), [bob], 400_000), 'controller');
  ok(!(await k.exists(q.certPda(a.subject_hash, 0))), 'nothing written');
});
await check('certify refuses: no Ed25519 instruction, one not right before, one whose offsets point at another instruction', async () => {
  const a = await k.attestation({ kind: 0, controller: bob.publicKey });
  const [ed, ix] = k.certifyIxs(bob, a, { verifier: V });
  await refuses(send([ix], [bob], 400_000), 'ed25519');
  await refuses(send([ed, web3.SystemProgram.transfer({ fromPubkey: bob.publicKey, toPubkey: bob.publicKey, lamports: 1 }), ix], [bob], 400_000), 'ed25519');
  // the same valid signature, its data addressed by instruction index (1 = itself after the compute budget) instead of u16::MAX
  const msg = q.attestationBytes(a, bob.publicKey);
  const signature = web3.Ed25519Program.createInstructionWithPrivateKey({ privateKey: V.secretKey, message: msg }).data.subarray(16 + 32, 16 + 96);
  const byIndex = web3.Ed25519Program.createInstructionWithPublicKey({ publicKey: V.publicKey.toBytes(), message: msg, signature, instructionIndex: 1 });
  await refuses(send([byIndex, ix], [bob], 400_000), 'own data');
});
await check('certify refuses: stale, from the future, root too old, expiry past the validity or already passed, bad tier, asset, kind, notes', async () => {
  await k.waitSlot(600);   // a fresh chain: room below the current slot for a stale attestation
  const s = await k.slotNow();
  const base = { kind: 0, controller: bob.publicKey };
  const try_ = async (o, words) => { const a = await k.attestation({ ...base, ...o }); await refuses(send(k.certifyIxs(bob, a, { verifier: V }), [bob], 400_000), words); };
  await try_({ issued_slot: s - 400 }, 'too old');
  await try_({ issued_slot: s + 50 }, 'future');
  await setP({ max_root_lag: 5n });
  await try_({ root_slot: s - 12 }, 'root');
  await setP();
  await try_({ valid: 3001 }, 'expiry');
  await try_({ issued_slot: s - 20, valid: 5 }, 'expired');
  await try_({ tier: 6 }, 'tier'); await try_({ tier: 0 }, 'tier');
  await try_({ asset: 2 }, 'asset'); await try_({ asset: 3 }, 'asset');
  await try_({ kind: 3, subject_hash: rand(32) }, 'kind');
  await try_({ null_hashes: [] }, 'note count');
  await try_({ null_hashes: k.notes(9).hashes }, 'note count');
  const h = k.notes(2).hashes;
  await try_({ null_hashes: [h[1], h[0]] }, 'sorted');
  await try_({ null_hashes: [h[0], h[0]] }, 'sorted');
});
await check('certify refuses a second live certificate for the same subject and asset (renew instead); USDC is a separate one', async () => {
  const { a } = live.alice;
  const b = await k.attestation({ kind: 0, controller: alice.publicKey, null_hashes: k.notes(1).hashes });
  await refuses(doCertify(alice, b), 'already exists');
  const u = await k.attestation({ kind: 0, controller: alice.publicKey, asset: 1, tier: 1 });
  await doCertify(alice, u);
  eq((await k.cert(a.subject_hash, 1)).asset, 1);
  eq((await k.treasury()).live_min[1], 100_000_000n, 'USDC live minimum');
  live.aliceUsdc = u;
});
await check('an X-handle subject through the relayer: no on-chain fee (paid privately), the controller is a separate key, counted as relayed', async () => {
  const ctl = Keypair.generate();
  const a = await k.attestation({ kind: 1, handle: '@Some_Anon', controller: ctl.publicKey, tier: 4 });
  eq(Buffer.from(a.subject_hash).toString('hex'), subjectHash(1, 'some_anon').toString('hex'), 'handle hash lowercased, @ dropped');
  const t0 = await lam(q.K.treasury);
  await doCertify(relayer, a);
  eq(await lam(q.K.treasury), t0, 'no fee');
  const c = await k.cert(a.subject_hash);
  eq(c.subject_kind, 1); eq(c.controller, ctl.publicKey.toBase58()); eq(c.payer, relayer.publicKey.toBase58());
  eq((await k.treasury()).relayed, 1n);
  await refuses(doCertify(relayer, await k.attestation({ kind: 1, handle: 'x' + rand(3).toString('hex'), controller: PublicKey.default })), 'controller');
  live.x = { a, ctl };
});
await check('a badge subject: the badge key is the controller; its hash is checked on chain', async () => {
  const badge = Keypair.generate();
  const a = await k.attestation({ kind: 2, controller: badge.publicKey, tier: 1 });
  await refuses(doCertify(bob, { ...a, subject_hash: subjectHash(0, badge.publicKey.toBase58()) }, { signed: { ...a, subject_hash: subjectHash(0, badge.publicKey.toBase58()) } }), 'controller');
  await doCertify(bob, a);
  eq((await k.cert(a.subject_hash)).subject_kind, 2);
  live.badge = { a, badge };
});

/* ------------------------------------------------------------------ renew */
await check('renew: same notes, subject, asset and controller with a newer attestation; tier, root and expiry move; fee charged', async () => {
  const { a, n } = live.alice;
  const fresh = (await k.slotNow()) - 1;
  await refuses(doCertify(alice, { ...a, issued_slot: fresh, root_slot: fresh - 2, expiry_slot: fresh + 2000, nonce: rand(16), null_hashes: k.notes(3).hashes }, { name: 'renew' }), 'same notes');
  const f2 = (await k.slotNow()) - 1;
  await refuses(doCertify(alice, { ...a, issued_slot: f2, root_slot: f2 - 2, expiry_slot: f2 + 2000, controller: bob.publicKey, subject_hash: a.subject_hash }, { name: 'renew' }), 'controller');
  const t0 = await lam(q.K.treasury);
  const r = { ...a, tier: 2, issued_slot: (await k.slotNow()) - 1, tree_root: rand(32), nonce: rand(16) };
  r.root_slot = r.issued_slot - 2; r.expiry_slot = r.issued_slot + 2500;
  const sig = await doCertify(alice, r, { name: 'renew' });
  const c = await k.cert(a.subject_hash);
  eq(c.tier, 2); eq(c.renewals, 1); eq(c.expiry_slot, r.expiry_slot); eq(Buffer.from(c.tree_root).toString('hex'), r.tree_root.toString('hex'));
  eq((await lam(q.K.treasury)) - t0, FEE, 'renew fee');
  eq((await k.treasury()).live_min[0], 10n * BigInt(SOL) + 1000n * BigInt(SOL) + 1n * BigInt(SOL), 'live minimum moved from tier 3 to tier 2 (plus the X 1,000 and badge 1)');
  eq((await k.ev(sig, 'Renewed')).renewals, 1);
  live.alice.a = r;
});

/* ------------------------------------------------------------------ revoke_spent: (a) the nullifier PDA */
await check('revoke_spent (a): the nullifier PDA a real spend leaves; wrong salt, an unspent nullifier, a forged PDA and look-alikes refused', async () => {
  const n = k.notes(2, [SPENT[0], field()]);
  const a = await k.attestation({ kind: 0, controller: carol.publicKey, null_hashes: n.hashes, tier: 1 });
  await doCertify(carol, a);
  const cpda = q.certPda(a.subject_hash, 0);
  const i = n.indexOf(SPENT[0]), spentNote = n.list.find(x => x.nf.equals(SPENT[0])), freshNote = n.list.find(x => !x.nf.equals(SPENT[0]));
  const rv = (idx, salt, nf, nfAcc, tree = TREE) => send([q.P.ix('revoke_spent', { index: idx, salt, nullifier: nf, membership: null }, { caller: outsider.publicKey, certificate: cpda, tree, nullifier_account: nfAcc })], [outsider], 200_000);
  await refuses(rv(i, rand(32), SPENT[0], q.nullifierPda(TREE, SPENT[0])), 'do not hash');
  await refuses(rv(1 - i, spentNote.salt, SPENT[0], q.nullifierPda(TREE, SPENT[0])), 'do not hash');
  await refuses(rv(5, spentNote.salt, SPENT[0], q.nullifierPda(TREE, SPENT[0])), 'index');
  // the other note: its salt and nullifier match, but nothing on chain shows it spent (no PDA): never read as unspent, just refused
  await refuses(rv(n.indexOf(freshNote.nf), freshNote.salt, freshNote.nf, q.nullifierPda(TREE, freshNote.nf)), 'not shown as spent');
  // someone else's spent PDA passed for this nullifier; a tree that is not the Rings program's
  await refuses(rv(i, spentNote.salt, SPENT[0], q.nullifierPda(TREE, SPENT[1])), 'rings');
  await refuses(rv(i, spentNote.salt, SPENT[0], q.nullifierPda(TREE, SPENT[0]), q.K.config), 'rings');
  ok(!(await k.cert(a.subject_hash)).status, 'still live');
  const sig = await rv(i, spentNote.salt, SPENT[0], q.nullifierPda(TREE, SPENT[0]));
  unit('revoke_spent (PDA)');
  const c = await k.cert(a.subject_hash);
  eq(c.status, 1); ok(c.revoked_slot > 0n); eq(c.revealed_index, i); eq(c.revealed_nullifier.toString('hex'), SPENT[0].toString('hex')); eq(c.revealed_salt.toString('hex'), spentNote.salt.toString('hex'));
  const e = await k.ev(sig, 'Revoked'); eq(e.status, 1); eq(e.path, 0); eq(e.by, outsider.publicKey.toBase58());
  await refuses(rv(i, spentNote.salt, SPENT[0], q.nullifierPda(TREE, SPENT[0])), 'not live');   // double revoke
  // the look-alikes (owned by the Privacy Program at the right address, a wrong first byte or a wrong length) do not count
  for (const f of FAKES) {
    const m = k.notes(1, [f]);
    const b = await k.attestation({ kind: 0, controller: Keypair.generate().publicKey, null_hashes: m.hashes, tier: 1 });
    await doCertify(bob, b);
    await refuses(send([q.P.ix('revoke_spent', { index: 0, salt: m.list[0].salt, nullifier: f, membership: null }, { caller: outsider.publicKey, certificate: q.certPda(b.subject_hash, 0), tree: TREE, nullifier_account: q.nullifierPda(TREE, f) })], [outsider], 200_000), 'not shown as spent');
    live.fakes = (live.fakes || []).concat([b]);
  }
  eq((await k.treasury()).revoked_spent, 1n);
  live.carol = { a, n };
});

/* ------------------------------------------------------------------ revoke_spent: (b) membership in the nullifier tree */
await check('revoke_spent (b): a real mainnet nullifier, its PDA absent here, proven spent by its path in the cloned nullifier tree', async () => {
  const nf = Buffer.from(MF.nullifier, 'hex');
  const n = k.notes(1, [nf]);
  const holder = Keypair.generate(); await fund([holder], 5);
  const a = await k.attestation({ kind: 0, controller: holder.publicKey, null_hashes: n.hashes, tier: 2 });
  await doCertify(holder, a);
  const cpda = q.certPda(a.subject_hash, 0), salt = n.list[0].salt;
  const m = { leaf_index: BigInt(MF.leafIndex), next_value: Buffer.from(MF.next, 'hex'), path: MF.path.slice(0, MF.emptyFrom).map(h => Buffer.from(h, 'hex')) };
  const rv = (membership, nfAcc = null, tree = TREE, who = outsider) => send([q.P.ix('revoke_spent', { index: 0, salt, nullifier: nf, membership }, { caller: who.publicKey, certificate: cpda, tree, nullifier_account: nfAcc })], [who], 400_000);
  // the PDA proof: the pool's PDA for this nullifier is not on this chain, which proves nothing either way
  await refuses(rv(null, q.nullifierPda(TREE, nf)), 'not shown as spent');
  await refuses(rv({ ...m, leaf_index: m.leaf_index + 1n }), 'not shown as spent');
  const badNext = Buffer.from(m.next_value); badNext[31] ^= 1;
  await refuses(rv({ ...m, next_value: badNext }), 'not shown as spent');
  const badPath = m.path.map(x => Buffer.from(x)); badPath[5][31] ^= 1;
  await refuses(rv({ ...m, path: badPath }), 'not shown as spent');
  await refuses(rv({ ...m, path: m.path.slice(0, 10) }), 'not shown as spent');   // upper levels are not empty there
  await refuses(rv(m, null, q.K.treasury), 'rings');   // a tree that is not the Rings program's
  const sig = await rv(m);
  unit('revoke_spent (membership, 16 levels)');
  const c = await k.cert(a.subject_hash);
  eq(c.status, 1); eq(c.revealed_nullifier.toString('hex'), MF.nullifier);
  eq((await k.ev(sig, 'Revoked')).path, 1);
  // a longer path (20 levels, the upper four given as the empty subtrees they are) works too; 40 levels need a v1 transaction
  const n2 = k.notes(1, [nf]);
  const h2 = Keypair.generate(); await fund([h2], 5);
  const b = await k.attestation({ kind: 0, controller: h2.publicKey, null_hashes: n2.hashes, tier: 1 });
  await doCertify(h2, b);
  await send([q.P.ix('revoke_spent', { index: 0, salt: n2.list[0].salt, nullifier: nf, membership: { ...m, path: MF.path.slice(0, 20).map(h => Buffer.from(h, 'hex')) } }, { caller: outsider.publicKey, certificate: q.certPda(b.subject_hash, 0), tree: TREE })], [outsider], 400_000);
  unit('revoke_spent (membership, 20 levels)');
  eq((await k.cert(b.subject_hash)).status, 1);
});

/* ------------------------------------------------------------------ revoke_by_holder, re-certify, replay */
await check('revoke_by_holder: only the controller (the X-handle key, not the relayer that paid); then a replay of the old attestation is refused', async () => {
  const { a, ctl } = live.x;
  const rv = s => send([q.P.ix('revoke_by_holder', {}, { controller: s.publicKey, certificate: q.certPda(a.subject_hash, 0) })], [s], 100_000);
  await refuses(rv(relayer), 'controller');
  await refuses(rv(outsider), 'controller');
  await fund([ctl], 1);
  const sig = await rv(ctl);
  unit('revoke_by_holder');
  const c = await k.cert(a.subject_hash);
  eq(c.status, 2); eq((await k.ev(sig, 'Revoked')).path, 3);
  await refuses(rv(ctl), 'not live');
  // a fresh certificate revoked at once, then its own signed attestation submitted again (still fresh): refused as a replay
  const c2 = Keypair.generate(); await fund([c2], 1);
  const b = await k.attestation({ kind: 1, handle: 'replay' + rand(3).toString('hex'), controller: c2.publicKey, tier: 1 });
  await doCertify(relayer, b);
  await send([q.P.ix('revoke_by_holder', {}, { controller: c2.publicKey, certificate: q.certPda(b.subject_hash, 0) })], [c2], 100_000);
  await refuses(doCertify(relayer, b), 'newer');
  eq((await k.cert(b.subject_hash)).status, 2);
});
await check('certify over a revoked certificate: a newer attestation remakes it; its old payer gets the rent back (and must be passed)', async () => {
  const { a } = live.carol;   // revoked spent, paid by carol
  const fresh = await k.attestation({ kind: 0, controller: carol.publicKey, tier: 1 });
  const pdaAcc = await k.info(q.certPda(a.subject_hash, 0)), rent = BigInt(pdaAcc.lamports);
  await refuses(doCertify(bob, fresh), 'previous payer');
  await refuses(doCertify(bob, fresh, { prior: outsider.publicKey }), 'previous payer');
  const c0 = await lam(carol.publicKey);
  await doCertify(bob, fresh, { prior: carol.publicKey });
  unit('certify (remake over revoked)');
  eq((await lam(carol.publicKey)) - c0, rent, 'carol got her rent back');
  const c = await k.cert(a.subject_hash);
  eq(c.status, 0); eq(c.payer, bob.publicKey.toBase58()); eq(c.revealed_index, 255); eq(c.revoked_slot, 0n); eq(c.note_count, 2);
  live.carol.a = fresh;
});
await check('audit POF-07: lamports donated into a revoked certificate never reach the prior payer; the remake costs the rent alone, the surplus goes to the treasury', async () => {
  const s1 = Keypair.generate(), s2 = Keypair.generate(), badge = Keypair.generate(); await fund([s1, s2, badge], 5);
  const a = await k.attestation({ kind: 2, controller: badge.publicKey, tier: 1 });
  await doCertify(s1, a);
  await send([q.P.ix('revoke_by_holder', {}, { controller: badge.publicKey, certificate: q.certPda(a.subject_hash, 0) })], [badge], 100_000);
  const cp = q.certPda(a.subject_hash, 0), rent = await k.rentOf((await k.info(cp)).data.length);
  await send([web3.SystemProgram.transfer({ fromPubkey: s1.publicKey, toPubkey: cp, lamports: 2 * SOL })], [s1], 0);
  const p1 = await lam(s1.publicKey), p2 = await lam(s2.publicKey), t0 = await lam(q.K.treasury);
  const b = await k.attestation({ kind: 2, controller: badge.publicKey, tier: 1 });
  await doCertify(s2, b, { prior: s1.publicKey });
  eq((await lam(s1.publicKey)) - p1, rent, 'the prior payer got the rent only');
  eq(p2 - (await lam(s2.publicKey)), rent + FEE + 10000n, 'the new payer paid rent + fee + signatures, nothing more');
  eq((await lam(q.K.treasury)) - t0, 2n * BigInt(SOL) + FEE, 'the donation went to the treasury');
  eq(BigInt((await k.info(cp)).lamports), rent, 'the certificate holds its rent exactly');
});

/* ------------------------------------------------------------------ expire */
await check('expire: refused before the expiry slot; after it anyone closes the account, the rent goes back to the payer exactly', async () => {
  const s = Keypair.generate(); await fund([s], 2);
  const a = await k.attestation({ kind: 0, controller: s.publicKey, valid: 25, tier: 1 });
  await doCertify(s, a);
  const cpda = q.certPda(a.subject_hash, 0), rent = BigInt((await k.info(cpda)).lamports);
  const ex = () => send([q.P.ix('expire', {}, { caller: outsider.publicKey, certificate: cpda, payer: s.publicKey })], [outsider], 100_000);
  await refuses(ex(), 'not expired');
  await k.waitSlot(Number(a.expiry_slot) + 1);
  await refuses(send([q.P.ix('expire', {}, { caller: outsider.publicKey, certificate: cpda, payer: outsider.publicKey })], [outsider], 100_000), 'payer');
  const t0 = await k.treasury(), b0 = await lam(s.publicKey);
  await ex();
  unit('expire');
  ok(!(await k.exists(cpda)), 'closed');
  eq((await lam(s.publicKey)) - b0, rent, 'rent back');
  const t = await k.treasury();
  eq(t.live, t0.live - 1n); eq(t.expired, t0.expired + 1n); eq(t.open, t0.open - 1n);
});
await check('an expired-but-unclosed certificate is not live for gates, and certify may remake it in place', async () => {
  const s = Keypair.generate(); await fund([s], 2);
  const a = await k.attestation({ kind: 0, controller: s.publicKey, valid: 20, tier: 1 });
  await doCertify(s, a);
  await k.waitSlot(Number(a.expiry_slot) + 1);
  await refuses(send([q.P.ix('require_certificate', { subject_hash: a.subject_hash, asset: 0, min_tier: 1 }, { certificate: q.certPda(a.subject_hash, 0) })], [outsider], 100_000), 'expired');
  await refuses(doCertify(s, { ...(await k.attestation({ kind: 0, controller: s.publicKey, tier: 1 })), null_hashes: a.null_hashes }, { name: 'renew' }), 'expired');   // audit POF-22
  const b = await k.attestation({ kind: 0, controller: s.publicKey, tier: 2 });
  const t0 = await k.treasury();
  await doCertify(s, b);
  const t = await k.treasury();
  eq(t.expired, t0.expired + 1n); eq(t.open, t0.open, 'same account'); eq((await k.cert(a.subject_hash)).tier, 2);
});

/* ------------------------------------------------------------------ the $ROOT holder exemption */
await check('set_roles: the root mint once; a payer holding 1,000,000 $ROOT pays no fee, 999,999 pays, a wrong holder account is refused', async () => {
  const mint = await k.plainMint(admin, [[whale.publicKey, 1_000_000n * 1_000_000n], [bob.publicKey, 999_999n * 1_000_000n]]);
  await refuses(send([q.P.ix('set_roles', { dev: null, relayer: null }, { admin: outsider.publicKey, root_mint: mint })], [outsider], 100_000), 'admin');
  await refuses(send([q.P.ix('set_roles', { dev: null, relayer: null }, { admin: admin.publicKey, root_mint: q.K.config })], [admin], 100_000), 'mint');
  await send([q.P.ix('set_roles', { dev: null, relayer: null }, { admin: admin.publicKey, root_mint: mint })], [admin], 100_000);
  unit('set_roles');
  k.root.mint = mint;
  await refuses(send([q.P.ix('set_roles', { dev: null, relayer: null }, { admin: admin.publicKey, root_mint: mint })], [admin], 100_000), 'already set');
  eq((await k.config()).root_mint, mint.toBase58());
  const wAta = q.ata(whale.publicKey, mint, spl.TOKEN_PROGRAM_ID), bAta = q.ata(bob.publicKey, mint, spl.TOKEN_PROGRAM_ID);
  const t0 = await lam(q.K.treasury);
  const a = await k.attestation({ kind: 0, controller: whale.publicKey, tier: 5 });
  await refuses(doCertify(whale, a, { holderToken: bAta }), 'canonical');
  await doCertify(whale, a, { holderToken: wAta });
  eq(await lam(q.K.treasury), t0, 'holder paid no fee');
  eq((await k.treasury()).exempt, 1n);
  const b = await k.attestation({ kind: 2, controller: Keypair.generate().publicKey, tier: 1 });
  await doCertify(bob, b, { holderToken: bAta });
  eq((await lam(q.K.treasury)) - t0, FEE, 'under the minimum pays');
  live.whale = a;
});

/* ------------------------------------------------------------------ Verifier rotation and pause */
await check('Verifier rotation: proposed by the admin only; the old key signs until the delay passes, then only the new one; apply_verifier records it', async () => {
  const sv = (s, next) => send([q.P.ix('set_verifier', { next }, { admin: s.publicKey })], [s], 100_000);
  await refuses(sv(outsider, V2.publicKey), 'admin');
  await sv(admin, V2.publicKey);
  unit('set_verifier');
  const c = await k.config();
  eq(c.next_verifier, V2.publicKey.toBase58());
  await refuses(send([q.P.ix('apply_verifier', {}, { caller: outsider.publicKey })], [outsider], 100_000), 'delay');
  const p = Keypair.generate(); await fund([p], 2);
  const a1 = await k.attestation({ kind: 0, controller: p.publicKey, tier: 1 });
  await refuses(send(k.certifyIxs(p, a1, { verifier: V2 }), [p], 400_000), 'active verifier');
  await k.waitSlot(c.next_verifier_slot);
  const a2 = await k.attestation({ kind: 0, controller: p.publicKey, tier: 1 });
  await refuses(send(k.certifyIxs(p, a2, { verifier: V }), [p], 400_000), 'active verifier');
  await send(k.certifyIxs(p, a2, { verifier: V2 }), [p], 400_000);
  eq((await k.cert(a2.subject_hash)).verifier, V2.publicKey.toBase58());
  await send([q.P.ix('apply_verifier', {}, { caller: outsider.publicKey })], [outsider], 100_000);
  unit('apply_verifier');
  const c2 = await k.config();
  eq(c2.verifier, V2.publicKey.toBase58()); eq(c2.next_verifier, PublicKey.default.toBase58());
  // a proposal cancelled with the default key never takes over
  await sv(admin, V.publicKey); await sv(admin, PublicKey.default);
  eq((await k.config()).next_verifier, PublicKey.default.toBase58());
  // audit POF-17: lowering the delay (40 -> 5) does not shorten a proposal made right after: it still waits the old 40 slots
  await setP({ rotation_delay: 5n });
  const s0 = await k.slotNow();
  await sv(admin, V.publicKey);
  const c3 = await k.config();
  ok(c3.next_verifier_slot >= BigInt(s0 + 40), `proposal at ${c3.next_verifier_slot}, slot ${s0}: the old delay still holds`);
  eq(c3.held_delay, 40n);
  await sv(admin, PublicKey.default);
  await setP();
});
const VV = V2;   // the active key from here on
const certifyNow = async (payer, a, o = {}) => { await send(k.certifyIxs(payer, a, { verifier: VV, ...o }), [payer], 400_000); };
await check('set_paused: certify and renew stop at once, revocations and expiry do not; admin only', async () => {
  const pz = v => send([q.P.ix('set_paused', { paused: v }, { admin: admin.publicKey })], [admin], 100_000);
  await refuses(send([q.P.ix('set_paused', { paused: true }, { admin: outsider.publicKey })], [outsider], 100_000), 'admin');
  await pz(true);
  unit('set_paused');
  const p = Keypair.generate(); await fund([p], 2);
  await refuses(certifyNow(p, await k.attestation({ kind: 0, controller: p.publicKey, tier: 1 })), 'paused');
  const { a } = live.badge;
  await fund([live.badge.badge], 1);
  await send([q.P.ix('revoke_by_holder', {}, { controller: live.badge.badge.publicKey, certificate: q.certPda(a.subject_hash, 0) })], [live.badge.badge], 100_000);
  await pz(false);
  await certifyNow(p, await k.attestation({ kind: 0, controller: p.publicKey, tier: 1 }));
});

/* ------------------------------------------------------------------ the log anchor, fees */
await check('anchor_log: the §7 signed tree head by the active Verifier key; it only grows; another key or another program id refused', async () => {
  const root = rand(32);
  const al = (signer, size, r, pid) => send([q.signIx(signer, q.sthBytes(size, r, pid)), q.P.ix('anchor_log', { size, head: r }, { caller: outsider.publicKey })], [outsider], 100_000);
  await refuses(al(V, 10n, root), 'active verifier');
  await refuses(al(VV, 10n, root, Keypair.generate().publicKey), 'differ');
  await al(VV, 10n, root);
  unit('anchor_log');
  const t = await k.treasury();
  eq(t.log_size, 10n); eq(t.log_head.toString('hex'), root.toString('hex'));
  await refuses(al(VV, 10n, rand(32)), 'grow');
  await refuses(al(VV, 9n, rand(32)), 'grow');
  await al(VV, 11n, rand(32));
});
await check('withdraw_fees: admin only, to the dev wallet only, never into the treasury\'s rent', async () => {
  const tInfo = await k.info(q.K.treasury), rent = await k.rentOf(tInfo.data.length), free = BigInt(tInfo.lamports) - rent;
  ok(free > 0n, 'fees collected');
  const w = (s, l, to = dev.publicKey) => send([q.P.ix('withdraw_fees', { lamports: l }, { admin: s.publicKey, dev: to })], [s], 100_000);
  await refuses(w(outsider, 1n), 'admin');
  await refuses(w(admin, 1n, outsider.publicKey), 'admin');
  await refuses(w(admin, free + 1n), 'cannot pay');
  const d0 = await lam(dev.publicKey);
  await w(admin, 1000n);
  await w(admin, 0n);
  unit('withdraw_fees');
  eq((await lam(dev.publicKey)) - d0, free, 'every fee to the dev');
  eq(BigInt((await k.info(q.K.treasury)).lamports), rent, 'rent left');
  const t = await k.treasury(); eq(t.fees_out, free); eq(t.fees_in, t.fees_out, 'all fees out');
});

/* ------------------------------------------------------------------ the CPI gate and Rooms */
const roomOf = (creator, id) => q.roomPda(creator, id);
const nm = s => { const b = Buffer.alloc(32); Buffer.from(s).copy(b); return b; };
await check('require_certificate (CPI helper, called directly): live and tier, asset, tier floor, a forged account and a wrong subject refused', async () => {
  const { a } = live.alice;   // tier 2 SOL after renew
  const rc = (h, asset, t, acc) => send([q.P.ix('require_certificate', { subject_hash: h, asset, min_tier: t }, { certificate: acc || q.certPda(h, asset) })], [outsider], 100_000);
  await rc(a.subject_hash, 0, 2);
  unit('require_certificate');
  const rd = (await k.txOf(send.last.sig)).meta.returnData;
  const ret = Buffer.from(rd.data[0], 'base64');
  eq(ret[1], 2, 'returned tier'); eq(new PublicKey(ret.subarray(10, 42)).toBase58(), alice.publicKey.toBase58(), 'returned controller');
  await refuses(rc(a.subject_hash, 0, 3), 'below');
  await refuses(rc(live.carol.a.subject_hash, 0, 1, q.certPda(a.subject_hash, 0)), 'address');
  await refuses(rc(a.subject_hash, 0, 1, q.K.config), 'address');
  await refuses(rc(live.x.a.subject_hash, 0, 1), 'not live');   // revoked by holder
  await refuses(rc(rand(32), 0, 1), 'address');   // nothing there
});
await check('pof_gate create_room / set_room: tiers checked against POF\'s table; creator only', async () => {
  const cr = (id, asset, t, s = carol) => send([q.G.ix('create_room', { id, asset, min_tier: t, name: nm('whales') }, { creator: s.publicKey, room: roomOf(s.publicKey, id), pof_config: q.K.config })], [s], 200_000);
  await refuses(cr(1n, 0, 6), 'tier'); await refuses(cr(1n, 0, 0), 'tier'); await refuses(cr(1n, 2, 1), 'tier');
  await cr(1n, 0, 2);
  unit('create_room');
  await cr(2n, 1, 1);
  const r = await k.decode('Room', roomOf(carol.publicKey, 1n), true);
  eq(r.min_tier, 2); ok(r.open); eq(r.name.toString().replace(/\0+$/, ''), 'whales');
  await refuses(send([q.G.ix('set_room', { min_tier: 1, open: true, name: nm('x') }, { creator: outsider.publicKey, room: roomOf(carol.publicKey, 1n), pof_config: q.K.config })], [outsider], 100_000), 'creator');
});
const join = (ctl, payer, room, h, asset = 0) => send([q.G.ix('join', { subject_hash: h }, { controller: ctl.publicKey, payer: payer.publicKey, room, member: q.memberPda(room, h), certificate: q.certPda(h, asset) })], ctl === payer ? [ctl] : [payer, ctl], 300_000);
await check('join: through the require_certificate CPI; a lower tier, another asset, a non-controller, a revoked one and a shut room refused', async () => {
  const room = roomOf(carol.publicKey, 1n);
  await join(alice, alice, room, live.alice.a.subject_hash);
  unit('join (CPI)');
  const m = await k.decode('Member', q.memberPda(room, live.alice.a.subject_hash), true);
  eq(m.controller, alice.publicKey.toBase58()); eq(m.payer, alice.publicKey.toBase58());
  eq((await k.decode('Room', room, true)).members, 1);
  await refuses(join(alice, alice, room, live.alice.a.subject_hash));   // already a member
  const low = Keypair.generate(); await fund([low], 2);
  const la = await k.attestation({ kind: 0, controller: low.publicKey, tier: 1 }); await certifyNow(low, la);
  await refuses(join(low, low, room, la.subject_hash), 'below');
  await refuses(join(outsider, outsider, room, live.whale.subject_hash), 'controller');
  await refuses(join(live.x.ctl, live.x.ctl, room, live.x.a.subject_hash), 'not live');
  await refuses(join(alice, alice, roomOf(carol.publicKey, 2n), live.alice.a.subject_hash, 0), 'address');   // the USDC room needs the USDC certificate
  await join(alice, alice, roomOf(carol.publicKey, 2n), live.alice.a.subject_hash, 1);
  // a relayer may pay the member's rent while the controller signs
  await join(whale, relayer, room, live.whale.subject_hash);
  eq((await k.decode('Member', q.memberPda(room, live.whale.subject_hash), true)).payer, relayer.publicKey.toBase58());
  await send([q.G.ix('set_room', { min_tier: 2, open: false, name: nm('whales') }, { creator: carol.publicKey, room, pof_config: q.K.config })], [carol], 100_000);
  unit('set_room');
  const p = Keypair.generate(); await fund([p], 2);
  const pa = await k.attestation({ kind: 0, controller: p.publicKey, tier: 3 }); await certifyNow(p, pa);
  await refuses(join(p, p, room, pa.subject_hash), 'no new members');
  await send([q.G.ix('set_room', { min_tier: 2, open: true, name: nm('whales') }, { creator: carol.publicKey, room, pof_config: q.K.config })], [carol], 100_000);
  live.p = { a: pa, kp: p };
  await join(p, p, room, pa.subject_hash);
});
const evictM = async (room, h, asset = 0) => { const m = await k.decode('Member', q.memberPda(room, h), true); return send([q.G.ix('evict', {}, { caller: outsider.publicKey, room, member: q.memberPda(room, h), payer: m.payer, certificate: m.certificate })], [outsider], 200_000); };
await check('evict: refused while the certificate is good; after a revoke anyone evicts, the rent back to the member\'s payer; a forged certificate account refused', async () => {
  const room = roomOf(carol.publicKey, 1n), h = live.p.a.subject_hash;
  await refuses(evictM(room, h), 'still live');
  await refuses(send([q.G.ix('evict', {}, { caller: outsider.publicKey, room, member: q.memberPda(room, h), payer: live.p.kp.publicKey, certificate: q.certPda(live.alice.a.subject_hash, 0) })], [outsider], 200_000), 'certificate');
  await refuses(send([q.G.ix('evict', {}, { caller: outsider.publicKey, room, member: q.memberPda(room, h), payer: outsider.publicKey, certificate: q.certPda(h, 0) })], [outsider], 200_000));
  await send([q.P.ix('revoke_by_holder', {}, { controller: live.p.kp.publicKey, certificate: q.certPda(h, 0) })], [live.p.kp], 100_000);
  const rent = BigInt((await k.info(q.memberPda(room, h))).lamports), b0 = await lam(live.p.kp.publicKey);
  const sig = await evictM(room, h);
  unit('evict');
  ok(!(await k.exists(q.memberPda(room, h))), 'member closed');
  eq((await lam(live.p.kp.publicKey)) - b0, rent, 'rent back to the member\'s payer');
  const e = await k.ev(sig, 'Left'); ok(e.evicted);
  const r = await k.decode('Room', room, true); eq(r.evicted, 1n);
});
await check('evict: a member whose certificate expired and closed, and a member below a raised room tier', async () => {
  const room = roomOf(carol.publicKey, 1n);
  const s = Keypair.generate(); await fund([s], 2);
  const a = await k.attestation({ kind: 0, controller: s.publicKey, valid: 25, tier: 3 }); await certifyNow(s, a);
  await join(s, s, room, a.subject_hash);
  await k.waitSlot(Number(a.expiry_slot) + 1);
  await send([q.P.ix('expire', {}, { caller: outsider.publicKey, certificate: q.certPda(a.subject_hash, 0), payer: s.publicKey })], [outsider], 100_000);
  await evictM(room, a.subject_hash);
  ok(!(await k.exists(q.memberPda(room, a.subject_hash))), 'closed-certificate member evicted');
  // raise the room to tier 3: alice (tier 2) falls out, the whale (tier 5) stays
  await send([q.G.ix('set_room', { min_tier: 3, open: true, name: nm('whales') }, { creator: carol.publicKey, room, pof_config: q.K.config })], [carol], 100_000);
  await refuses(evictM(room, live.whale.subject_hash), 'still live');
  await evictM(room, live.alice.a.subject_hash);
  eq((await k.decode('Room', room, true)).members, 1);
});
await check('leave: only the member\'s controller; close_room refused while members remain, then the creator closes it', async () => {
  const room = roomOf(carol.publicKey, 2n), h = live.alice.a.subject_hash;
  const lv = s => send([q.G.ix('leave', {}, { controller: s.publicKey, room, member: q.memberPda(room, h), payer: alice.publicKey })], [s], 100_000);
  await refuses(lv(outsider), 'controller');
  await refuses(send([q.G.ix('close_room', {}, { creator: carol.publicKey, room })], [carol], 100_000), 'members');
  await lv(alice);
  unit('leave');
  await refuses(send([q.G.ix('close_room', {}, { creator: outsider.publicKey, room })], [outsider], 100_000), 'creator');
  await send([q.G.ix('close_room', {}, { creator: carol.publicKey, room })], [carol], 100_000);
  unit('close_room');
  ok(!(await k.exists(room)), 'closed');
  await refuses(send([q.G.ix('release_room', {}, { caller: outsider.publicKey, room: roomOf(carol.publicKey, 1n), creator: carol.publicKey, pof_config: q.K.config })], [outsider], 100_000), 'winding down');
});

/* ------------------------------------------------------------------ counters */
await check('the treasury counters agree with the certificate accounts on chain', async () => {
  const accs = await conn.getProgramAccounts(q.PID, { commitment: 'confirmed' });
  const certs = accs.map(x => { try { return q.P.decodeAccount('Certificate', x.account.data); } catch { return null; } }).filter(Boolean);
  const slot = BigInt(await k.slotNow());
  const t = await k.treasury();
  eq(t.open, BigInt(certs.length), 'open = certificate accounts');
  const liveNow = certs.filter(c => c.status === 0);
  eq(t.live, BigInt(liveNow.length), 'live = status-live accounts (one past its expiry stays counted until someone calls expire)');
  const c = await k.config();
  const sum = [0, 1].map(a => liveNow.filter(x => x.asset === a).reduce((s, x) => s + c.assets[a].mins[x.tier - 1], 0n));
  eq(t.live_min[0], sum[0], 'SOL live minimum'); eq(t.live_min[1], sum[1], 'USDC live minimum');
});

fs.writeFileSync(path.join(run, 'cu.json'), JSON.stringify(Object.fromEntries(Object.entries(cu).map(([k2, v]) => [k2, { max: Math.max(...v), min: Math.min(...v), n: v.length }])), null, 1));
fs.writeFileSync(path.join(run, 'live.json'), JSON.stringify({ dev: dev.publicKey.toBase58(), verifier: Buffer.from(VV.secretKey).toString('hex'), keys: Object.fromEntries([['carol', carol], ['alice', alice], ['outsider', outsider]].map(([n, kp]) => [n, Buffer.from(kp.secretKey).toString('hex')])), rooms: [roomOf(carol.publicKey, 1n).toBase58()] }, null, 1));
fs.writeFileSync(path.join(run, 'result-suite.txt'), `${passed}/${total}\n`);
console.log(`\n  suite ${passed}/${total}${fails.length ? '  FAILED: ' + fails.join(' | ') : ''}`);
console.log('  CU:', Object.entries(cu).map(([n, v]) => `${n} ${Math.max(...v)}`).join(' · '));
process.exit(0);
