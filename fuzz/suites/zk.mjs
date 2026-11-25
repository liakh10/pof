// Suite "zk" (builds with certify_zk): phase 2 with REAL Groth16 proofs from the development setup (pof/zk/setup, snarkjs), the
// zk agent's own fixture scenarios (read-only), on our tree 0 whose root histories hold them (fuzz/prep.mjs).
// - every public input and argument of one valid proof changed in turn (subject kind, asset, tier, nonce, payer, controller, state
//   / nullifier / registry root, ephemeral key, each tag and ciphertext, proof bytes at 32 offsets, a tag + r): all refused;
// - the lock accounts: missing, extra, reordered, read-only, another certificate's lock;
// - the settle window judged at the simulation's own bank slot; revoke_signed, renew, certify over a zk certificate;
// - revoke_spent of a zk certificate by its tag, then the SAME proof submitted again (and a fresh proof of the same spent note);
// - revoke_verifier_key(ZkConfig) as a kill switch for every zk certificate, void_by_key on one;
// - set_zk: the delay, off at once, a key off the curve; CU and sizes of certify_zk with 1 and 4 notes.
import fs from 'node:fs';
import path from 'node:path';
import { PROG, PublicKey, Keypair, web3, sleep } from '../lib/core.mjs';

export async function zk(W, o = {}) {
  const { h, R, P, K, admin, users, expect, note, fx } = W;
  if (!P.ixs.certify_zk) { note('no certify_zk in this snapshot (launch build)'); return; }
  if (!fx.zk) { note('no zk scenarios in the genesis (run fuzz/prep.mjs with pof/zk present)'); return; }
  W.suite('zk');
  const step = m => { if (process.env.ZKDBG) console.log('  zk · ' + m); };
  const ZKD = path.resolve(PROG, '../zk');
  const snarkjs = await import(path.join(ZKD, 'node_modules/snarkjs/main.js'));
  const Z = await import(path.join(ZKD, 'js/zk.js'));
  const F = await import(path.join(ZKD, 'test/fixtures.mjs'));
  const vkey = JSON.parse(fs.readFileSync(F.VKEY, 'utf8'));
  const ringOwner = Keypair.fromSecretKey(Uint8Array.from(fx.zk.ringOwner));
  const ownerKey = ringOwner.publicKey.toBytes();
  const big = x => x === undefined ? undefined : BigInt(x);
  const S = {};
  for (const [k, v] of Object.entries(fx.zk.specs)) S[k] = await F.scenario({ amounts: v.amounts.map(BigInt), minAmount: big(v.minAmount), seed: BigInt(v.seed), ownerKey });
  const older = await F.scenario({ amounts: fx.zk.older.amounts.map(BigInt), seed: BigInt(fx.zk.older.seed), ownerKey, extraNullifiers: 2 });
  const ZKP = P.pda([Buffer.from('zk')]), REG = P.pda([Buffer.from('zkreg')]);
  const lockPda = tag => P.pda([Buffer.from('znote'), Buffer.from(tag)]);
  const escrowArg = [Z.be32(S.one.escrow.public[0]), Z.be32(S.one.escrow.public[1])];
  const setZk = (enabled, escrow = escrowArg) => h.send([P.ix('set_zk', { enabled, escrow }, { admin: admin.publicKey, zk: ZKP, registry: REG })], [admin], { units: 600_000 });
  /* turn on: the escrow key must be on the curve; on waits the rotation delay */
  {
    const bad = [escrowArg[0], Z.be32(Z.toBig(escrowArg[1]) ^ 1n)];
    expect('set_zk with a key off Baby Jubjub', 'set_zk', await setZk(true, bad), 'ZkBadEscrowKey');
    expect('set_zk by a stranger', 'set_zk', await h.sim([P.ix('set_zk', { enabled: true, escrow: escrowArg }, { admin: users[0].publicKey, zk: ZKP, registry: REG })], [users[0]]), '*');
    const r = await setZk(true);
    expect('set_zk on', 'set_zk', r, null);
    W.cu('set_zk (first: creates ZkConfig + registry)', r.pofUnits[0], r.size);
  }
  step('registry');
  /* the owner registry, as the chain builds it */
  const leaves = [];
  async function register(kp, secret) {
    const commitment = Z.be32(Z.ownerCommitment(S.one.P, secret));
    // a3b15d1 (ZK-11): one paid ZkOwner record per owner ["zkowner", owner], a payer for its rent and the fee
    const acc = { owner: kp.publicKey, registry: REG, payer: users[0].publicKey, owner_record: P.pda([Buffer.from('zkowner'), kp.publicKey.toBuffer()]) };
    const r = await h.send([P.ix('register_zk_owner', { commitment }, acc)], [users[0], kp]);
    if (!r.ok) throw Error('register ' + r.why);
    const e = P.events(r.logs).find(x => x.name === 'ZkOwnerRegistered').data;
    leaves[Number(e.index)] = Z.toBig(e.leaf);
    W.cu('register_zk_owner', r.pofUnits[0], r.size);
  }
  await register(W.kp(), 111n); await register(W.kp(), 222n); await register(ringOwner, S.one.ring.ownerSecret);
  expect('register a zero commitment', 'register_zk_owner', await h.sim([P.ix('register_zk_owner', { commitment: Buffer.alloc(32) }, { owner: users[1].publicKey, registry: REG, payer: users[1].publicKey, owner_record: P.pda([Buffer.from('zkowner'), users[1].publicKey.toBuffer()]) })], [users[1]]), 'BadParams');
  if (P.ixs.register_zk_owner.accounts.some(a => a.name === 'owner_record')) expect('register the same owner twice', 'register_zk_owner', await h.sim([P.ix('register_zk_owner', { commitment: Buffer.from(Z.be32(5n)) }, { owner: ringOwner.publicKey, registry: REG, payer: users[0].publicKey, owner_record: P.pda([Buffer.from('zkowner'), ringOwner.publicKey.toBuffer()]) })], [users[0], ringOwner]), '*');
  const withRegistry = s => { const t = new F.Sparse(s.P, Z.REG_H); leaves.forEach((l, i) => t.set(i, l)); const index = leaves.findIndex(l => l === Z.registryLeaf(s.P, Z.ownerId(s.P, ownerKey), s.ring.ownerSecret)); return { ...s, registry: { root: t.root(), index, path: t.path(index) } }; };
  const z0 = W.decodeZk = async () => P.decodeAccount('ZkConfig', (await h.info(ZKP)).data);
  step('wait for set_zk ' + (await z0()).next_slot);
  await h.waitSlot(BigInt((await z0()).next_slot) + 1n);
  step('table');
  /* an address lookup table for the 4-note form */
  const table = await makeTable(W, [K.config, K.treasury, ZKP, REG, K.tree0, web3.SystemProgram.programId]);
  const cfg = await W.config();
  let proofs = 0, proveMs = 0;
  async function prove(s, bind) {
    const ctx = await Z.context({ programId: P.programId.toBytes(), subjectKind: bind.kind, subjectHash: W.subjectHash(bind.kind, bind.controller.toBase58()), asset: bind.asset, tier: bind.tier, controller: bind.controller.toBytes(), payer: bind.payer.toBytes(), nonce: bind.nonce });
    const minAmount = cfg.assets[bind.asset].mins[bind.tier - 1];
    const b = Z.buildInputs(s.P, { ...withRegistry(s), pub: { ...s.pub, ctx, minAmount } });
    const t0 = Date.now();
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(b.input, F.WASM, F.ZKEY);
    proveMs += Date.now() - t0; proofs++;
    if (!(await snarkjs.groth16.verify(vkey, publicSignals, proof))) throw Error('snarkjs does not verify its own proof');
    const a = Z.certifyZkArgs(proof, publicSignals);
    return { b, args: { subject_kind: bind.kind, asset: bind.asset, tier: bind.tier, nonce: bind.nonce, proof: Buffer.from(a.proof), state_root: Buffer.from(a.stateRoot), null_root: Buffer.from(a.nullRoot), registry_root: Buffer.from(a.registryRoot), eph: a.eph.map(x => Buffer.from(x)), tags: a.tags.slice(0, a.noteCount).map(x => Buffer.from(x)), cts: a.cts.slice(0, a.noteCount).map(x => Buffer.from(x)) } };
  }
  const zix = (args, { controller, payer = controller, locks = null, prior = null, tree = K.tree0 }) => {
    const subject = W.subjectHash(args.subject_kind === 2 ? 2 : 0, controller.publicKey.toBase58());
    const ix = P.ix('certify_zk', { args }, { payer: payer.publicKey, controller: controller.publicKey, zk: ZKP, registry: REG, certificate: W.certPda(subject, args.asset), prior_payer: prior, holder_token: payer.publicKey, tree });
    for (const t of locks || args.tags) ix.keys.push({ pubkey: lockPda(t), isSigner: false, isWritable: true });
    return { ix, subject, signers: payer === controller ? [payer] : [payer, controller] };
  };
  const simZ = (z, o2 = {}) => h.sim([z.ix, ...(o2.after || [])], z.signers, { tables: [table] });
  const sendZ = (z, o2 = {}) => h.send([z.ix, ...(o2.after || [])], z.signers, { tables: [table] });
  const req = (sh, tier = 1) => h.sim([P.ix('require_certificate', { subject_hash: sh, asset: 0, min_tier: tier }, { certificate: W.certPda(sh, 0) })], [users[0]]);

  step('proof 1');
  /* 1. one valid proof and every field of it changed */
  const w = W.kp(), w2 = W.kp(); await h.fund([w, w2], 20);
  const nonce = R.bytes(16);
  const p1 = await prove(S.shared, { controller: w.publicKey, payer: w.publicKey, kind: 0, asset: 0, tier: 1, nonce });
  expect('a valid proof simulates', 'certify_zk', await simZ(zix(p1.args, { controller: w })), null);
  const A = p1.args;
  const muts = {
    'subject kind 2': { subject_kind: 2 }, 'subject kind 1': { subject_kind: 1 }, 'asset 1': { asset: 1 }, 'tier 2': { tier: 2 }, 'tier 0': { tier: 0 }, 'tier 6': { tier: 6 },
    'nonce': { nonce: R.bytes(16) }, 'state root (another scenario\'s)': { state_root: Buffer.from(Z.be32(S.one.pub.stateRoot)) }, 'state root unknown': { state_root: R.bytes(32) },
    'null root older': { null_root: Buffer.from(Z.be32(older.pub.nullRoot)) }, 'null root zero': { null_root: Buffer.alloc(32) }, 'registry root unknown': { registry_root: R.bytes(32) }, 'registry root zero': { registry_root: Buffer.alloc(32) },
    'ephemeral x': { eph: [R.field(), A.eph[1]] }, 'ephemeral y': { eph: [A.eph[0], R.field()] }, 'tag': { tags: [R.field()] }, 'ciphertext': { cts: [R.field()] },
    'tag + r (not canonical)': { tags: [Buffer.from(Z.be32(Z.toBig(A.tags[0]) + Z.FIELD))] }, 'no tags': { tags: [], cts: [] }, 'two tags (dup)': { tags: [A.tags[0], A.tags[0]], cts: [A.cts[0], A.cts[0]] }, 'zero tag': { tags: [Buffer.alloc(32)] },
  };
  for (const [name, m] of Object.entries(muts)) {
    const args = { ...A, ...m };
    const r = await simZ(zix(args, { controller: w, locks: m.tags && m.tags.length ? m.tags : (m.tags ? [] : A.tags) }));
    expect(`proof kept, ${name} changed`, 'certify_zk', r, '*', { mutated: name });
  }
  for (let k = 0; k < (o.proofOffsets ?? 32); k++) {
    const off = R.int(256); const pr = Buffer.from(A.proof); pr[off] ^= 1 << R.int(8);
    expect(`proof byte ${off} flipped`, 'certify_zk', await simZ(zix({ ...A, proof: pr }, { controller: w })), '*');
  }
  expect('proof of all zero bytes', 'certify_zk', await simZ(zix({ ...A, proof: Buffer.alloc(256) }, { controller: w })), '*');
  expect('proof bound to w submitted for w2', 'certify_zk', await simZ(zix(A, { controller: w2 })), 'ZkProofInvalid');
  expect('proof bound to payer w paid by w2', 'certify_zk', await simZ(zix(A, { controller: w, payer: w2 })), 'ZkProofInvalid');
  expect('no lock accounts', 'certify_zk', await simZ(zix(A, { controller: w, locks: [] })), 'ZkLockMissing');
  expect('an extra lock account', 'certify_zk', await simZ(zix(A, { controller: w, locks: [A.tags[0], R.field()] })), 'ZkLockMissing');
  { const z = zix(A, { controller: w }); z.ix.keys[z.ix.keys.length - 1].isWritable = false; expect('the lock read-only', 'certify_zk', await simZ(z), '*'); }
  { const z = zix(A, { controller: w, locks: [R.field()] }); expect('a lock at another tag\'s address', 'certify_zk', await simZ(z), 'ZkLockMissing'); }
  expect('a forged tree account', 'certify_zk', await simZ(zix(A, { controller: w, tree: K.ft })), 'BadRingsAccounts');
  step('land');
  /* 2. land it; the settle window, exactly */
  const r1 = await sendZ(zix(A, { controller: w }));
  expect('certify_zk, 1 note', 'certify_zk', r1, null);
  W.cu('certify_zk (1 note, ALT)', r1.pofUnits[0], r1.size);
  const sh = W.subjectHash(0, w.publicKey.toBase58());
  const c1 = await W.cert(sh);
  expect('  verifier = the ZkConfig PDA, issued_slot = certified + settle', 'certify_zk', { ok: c1.verifier === ZKP.toBase58() && c1.issued_slot > c1.certified_slot }, null);
  let before = 0, after = 0;
  while (true) {
    const g = await req(sh);
    const want = BigInt(g.slot) >= BigInt(c1.issued_slot) ? null : 'ZkSettling';
    expect(`gate at slot ${g.slot} (settles at ${c1.issued_slot})`, 'require_certificate', g, want);
    want ? before++ : after++;
    if (after >= 3) break;
    await sleep(40);
  }
  note(`settle window: ${before} gate simulations refused before slot ${c1.issued_slot}, ${after} passed from it`);
  expect('the same proof again while live', 'certify_zk', await simZ(zix(A, { controller: w })), 'AlreadyLive');
  { const p2 = await prove(S.shared, { controller: w2.publicKey, payer: w2.publicKey, kind: 0, asset: 0, tier: 1, nonce: R.bytes(16) }); expect('the same note for another wallet (its own fresh proof)', 'certify_zk', await simZ(zix(p2.args, { controller: w2 })), 'ZkNoteLocked'); }
  expect('release the lock of a live certificate', 'release_note_lock', await h.sim([P.ix('release_note_lock', {}, { lock: lockPda(A.tags[0]), certificate: W.certPda(sh, 0), payer: w.publicKey })], [users[0]]), 'ZkNoteStillLive');
  { const b = await W.att({ kind: 0, ctlKp: w, null_hashes: [A.tags[0]] }); expect('renew a zk certificate with a Verifier attestation', 'renew', await h.sim(W.certifyIxs(w, b, { name: 'renew' }), [w]), 'RenewMismatch'); }
  step('spent');
  /* 3. a spent note: revoke by its tag, then the SAME proof again */
  const ws = W.kp(); await h.fund([ws], 20);
  const ps = await prove(S.spend, { controller: ws.publicKey, payer: ws.publicKey, kind: 0, asset: 0, tier: 1, nonce: R.bytes(16) });
  expect('certify_zk with a note whose nullifier PDA exists (queued spend: the proof cannot see it)', 'certify_zk', await sendZ(zix(ps.args, { controller: ws })), null);
  const shs = W.subjectHash(0, ws.publicKey.toBase58());
  const nf = Buffer.from(fx.zk.spentNf, 'hex');
  if (P.ixs.revoke_signed) {
    const c = await W.cert(shs), addr = W.certPda(shs, 0);
    const vu = BigInt(await h.slotNow()) + 100n;
    const msg = Buffer.concat([Buffer.from('POF-REVOKE1'), P.programId.toBuffer(), addr.toBuffer(), Buffer.from(c.subject_hash), Buffer.from([c.asset]), Buffer.from(c.nullset_hash), W.u64le(c.issued_slot), W.u64le(vu)]);
    expect('revoke_signed during the settle window (the holder may withdraw a settling certificate)', 'revoke_signed', await h.sim([W.edIx(ws, msg), P.ix('revoke_signed', { valid_until: vu }, { caller: users[0].publicKey, certificate: addr })], [users[0]]), null);
  }
  const withLock = (ix, tag) => { ix.keys.push({ pubkey: lockPda(tag), isSigner: false, isWritable: true }); return ix; };
  const lockNeeded = !!P.types?.NoteLock || (P.codec.types.NoteLock?.type.fields || []).some(f => f.name === 'spent');
  const tagS = ps.args.tags[0];
  if (lockNeeded) expect('revoke_spent of a zk certificate without its note lock', 'revoke_spent', await h.sim([W.revokeSpentIx(users[0], shs, 0, 0, Buffer.alloc(32), nf)], [users[0]]), 'ZkLockMissing');
  if (lockNeeded) expect('revoke_spent of a zk certificate with another tag\'s lock', 'revoke_spent', await h.sim([withLock(W.revokeSpentIx(users[0], shs, 0, 0, Buffer.alloc(32), nf), A.tags[0])], [users[0]]), 'ZkLockMissing');
  expect('revoke_spent with a wrong nullifier', 'revoke_spent', await h.sim([withLock(W.revokeSpentIx(users[0], shs, 0, 0, Buffer.alloc(32), Buffer.from(Z.be32(Z.toBig(nf) + 1n))), tagS)], [users[0]]), ['NotSpent', 'NullifierMismatch']);
  const rv = await h.send([withLock(W.revokeSpentIx(users[0], shs, 0, 0, Buffer.alloc(32), nf), tagS)], [users[0]]);
  expect('revoke_spent of the zk certificate by its tag (PDA path), during the settle window', 'revoke_spent', rv, null);
  if (lockNeeded) {
    expect('release the lock of a note proven spent', 'release_note_lock', await h.sim([P.ix('release_note_lock', {}, { lock: lockPda(tagS), certificate: W.certPda(shs, 0), payer: ws.publicKey })], [users[0]]), 'ZkNoteStillLive');
    const fresh = await prove(S.spend, { controller: ws.publicKey, payer: ws.publicKey, kind: 0, asset: 0, tier: 1, nonce: R.bytes(16) });
    expect('a FRESH proof (new nonce) of the spent note for the same subject', 'certify_zk', await simZ(zix(fresh.args, { controller: ws })), 'ZkNoteLocked');
    const wo = W.kp(); await h.fund([wo], 5);
    const other = await prove(S.spend, { controller: wo.publicKey, payer: wo.publicKey, kind: 0, asset: 0, tier: 1, nonce: R.bytes(16) });
    expect('a fresh proof of the spent note for another subject', 'certify_zk', await simZ(zix(other.args, { controller: wo })), 'ZkNoteLocked');
  }
  const replay = await sendZ(zix(ps.args, { controller: ws }));
  W.zkReplayWhy = replay.ok ? 'landed' : replay.why;
  expect('the SAME proof submitted again after revoke_spent (must refuse: the note is proven spent)', 'certify_zk', replay, '*');
  if (replay.ok) {
    const c = await W.cert(shs);
    note(`a zk certificate revoked as spent is remade by replaying its own proof: status ${c.status}, settles at ${c.issued_slot}; it passes every gate after the settle window unless someone revokes it again (the nullifier is public now)`);
    await h.waitSlot(BigInt(c.issued_slot) + 3n);
    const g = await req(shs);
    W.zkReplay = { resurrected: true, passes: g.ok };
    note(`  after the settle window the resurrected certificate ${g.ok ? 'PASSES require_certificate' : 'is refused: ' + g.why}`);
    expect('  revoke_spent again (anyone: the nullifier is public)', 'revoke_spent', await h.send([withLock(W.revokeSpentIx(users[1], shs, 0, 0, Buffer.alloc(32), nf), tagS)], [users[1]]), null);
  }
  step('kill');
  /* 4. the ZkConfig key as a kill switch; void */
  if (P.ixs.revoke_verifier_key) {
    const wa = W.kp(); await h.fund([wa], 20);
    const pa = await prove(S.again, { controller: wa.publicKey, payer: wa.publicKey, kind: 0, asset: 0, tier: 1, nonce: R.bytes(16) });
    expect('certify_zk (for the kill switch)', 'certify_zk', await sendZ(zix(pa.args, { controller: wa })), null);
    const sha = W.subjectHash(0, wa.publicKey.toBase58());
    await h.waitSlot(BigInt((await W.cert(sha)).issued_slot) + 3n);
    { const g = await req(sha); expect('  settled: gate passes', 'require_certificate', g, BigInt(g.slot ?? 0) >= BigInt((await W.cert(sha)).issued_slot) ? null : 'ZkSettling'); }
    note('revoke_verifier_key(ZkConfig) is not run here: it would end phase 2 for the rest of the run; it is checked by simulation only');
    const sim = await h.sim([P.ix('revoke_verifier_key', { key: ZKP }, { admin: admin.publicKey }), P.ix('require_certificate', { subject_hash: sha, asset: 0, min_tier: 1 }, { certificate: W.certPda(sha, 0) })], [admin]);
    expect('revoke the ZkConfig as a key, then gate a zk certificate in the same transaction', 'require_certificate', sim, 'KeyRevoked');
  }
  step('four');
  /* 5. four notes, tier 2, a badge subject, a separate payer, with the ALT */
  {
    const badge = W.kp(), payer = W.kp(); await h.fund([badge, payer], 20);
    const p4 = await prove(S.four, { controller: badge.publicKey, payer: payer.publicKey, kind: 2, asset: 0, tier: 2, nonce: R.bytes(16) });
    const z = zix(p4.args, { controller: badge, payer });
    const r = await sendZ(z);
    expect('certify_zk, 4 notes, badge subject, separate payer (ALT)', 'certify_zk', r, null);
    W.cu('certify_zk (4 notes, ALT, 2 signers)', r.pofUnits[0], r.size);
    W.results.sizes['certify_zk, 4 notes, ALT, 2 signers (v0)'] = r.size;
    const noAlt = await h.sim([z.ix], z.signers);
    W.results.sizes['certify_zk, 4 notes, no ALT'] = noAlt.why === 'TxTooLarge' ? '> 1232' : noAlt.size;
  }
  step('off');
  /* 6. off is immediate */
  expect('set_zk off (same key): immediate', 'set_zk', await setZk(false), null);
  { const p = await prove(S.one, { controller: w2.publicKey, payer: w2.publicKey, kind: 0, asset: 0, tier: 1, nonce: R.bytes(16) }); expect('certify_zk while off', 'certify_zk', await simZ(zix(p.args, { controller: w2 })), 'ZkDisabled'); }
  note(`${proofs} real Groth16 proofs, ${Math.round(proveMs / Math.max(1, proofs))} ms each on average`);
  await W.invariants('zk');
}

async function makeTable(W, list) {
  const { h } = W;
  const payer = W.admin;
  const s0 = await h.conn.getSlot('finalized');
  const [mk, key] = web3.AddressLookupTableProgram.createLookupTable({ authority: payer.publicKey, payer: payer.publicKey, recentSlot: Math.max(0, s0 - 5) });
  const r = await h.send([mk, web3.AddressLookupTableProgram.extendLookupTable({ lookupTable: key, authority: payer.publicKey, payer: payer.publicKey, addresses: list })], [payer]);
  if (!r.ok) throw Error('lookup table: ' + r.why);
  for (let i = 0; i < 60; i++) { await sleep(400); const t = (await h.conn.getAddressLookupTable(key)).value; if (t && t.state.addresses.length === list.length && (await h.conn.getSlot()) > r.slot + 1) return t; }
  throw Error('table not ready');
}
