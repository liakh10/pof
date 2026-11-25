// Suite "attest": the 240 signed bytes and every check certify makes before trusting them.
// A1 every byte offset of the signed message mutated (3 values each) while the instruction carries the original: AttestationMismatch.
// A2 every instruction field mutated while the signature covers the original: refused (the reason recorded).
// A3 the model: N random attestations (boundary-biased: kinds, controllers, assets 0..255, tiers 0..255, 0..9 notes, unsorted and
//    repeated hashes, issue/root/expiry slots at and around every bound, u64 extremes), signed exactly as given, simulated; the
//    outcome must equal the model of check_attestation evaluated at the bank slot the simulation ran at.
import { PublicKey } from '../lib/core.mjs';

export async function attest(W, o = {}) {
  const { h, R, P, users, expect, note } = W;
  W.suite('attest');
  const payer = users[0];
  const c = await W.config();
  const base = await W.att({ kind: 0, ctlKp: payer, tier: 2, n: 3 });
  const ok0 = await W.simCertify(payer, base);
  expect('canonical attestation simulates', 'certify', ok0, null);
  W.cu('certify (kind 0, 3 notes, fee)', ok0.pofUnits[0], ok0.size);

  /* A1 */
  const msg = W.attBytes(base, payer.publicKey, P.programId);
  let n1 = 0;
  for (let off = 0; off < 240; off++) {
    for (let k = 0; k < (o.a1PerOffset ?? 3); k++) {
      const m = Buffer.from(msg);
      let v; do { v = R.int(256); } while (v === m[off]);
      m[off] = v;
      const r = await W.simCertify(payer, base, { msg: m });
      expect(`signed byte ${off} = ${v}`, 'certify', r, 'AttestationMismatch', { offset: off });
      n1++;
    }
  }
  note(`A1: ${n1} mutations of the signed bytes (every offset 0..239)`);

  /* A2 */
  const fields = {
    subject_kind: () => R.pick([1, 2, 3, 255]), subject_hash: () => R.bytes(32), asset: () => R.pick([1, 2, 3, 4, 255]), tier: () => R.pick([0, 1, 3, 4, 5, 6, 255]),
    tree_root: () => R.bytes(32), root_slot: () => BigInt(base.root_slot) + BigInt(R.range(-3, 3) || 1), null_hashes: () => W.notesOf(R.range(1, 8)).hashes,
    issued_slot: () => BigInt(base.issued_slot) - BigInt(R.range(1, 3)), expiry_slot: () => BigInt(base.expiry_slot) + BigInt(R.range(-5, 5) || 1),
    controller: () => W.kp().publicKey, nonce: () => R.bytes(16),
  };
  let n2 = 0;
  for (const [f, gen] of Object.entries(fields)) for (let k = 0; k < (o.a2PerField ?? 8); k++) {
    const a = { ...base, [f]: gen() };
    const r = await W.simCertify(payer, a, { signed: base });
    expect(`instruction ${f} changed, signature over the original`, 'certify', r, '*', { field: f });
    n2++;
  }
  // the right bytes signed for another payer, another program id; and paid by a different signer
  expect('signed for another payer', 'certify', await W.simCertify(payer, base, { signedPayer: users[1].publicKey }), 'AttestationMismatch');
  expect('signed for another program id', 'certify', await W.simCertify(payer, base, { programId: W.kp().publicKey }), 'AttestationMismatch');
  expect('submitted by another payer', 'certify', await W.simCertify(users[1], base, { signedPayer: payer.publicKey }), 'AttestationMismatch');
  note(`A2: ${n2 + 3} field mutations with the original signature`);

  /* A3: the model */
  const N = o.a3 ?? 1500;
  let agree = 0;
  const age = Number(c.params.max_attest_age), lag = Number(c.params.max_root_lag), val = Number(c.params.validity_slots);
  const MAX = (1n << 64n) - 1n;
  for (let i = 0; i < N; i++) {
    const slot = await h.slotNow();
    const kind = R.pick([0, 0, 0, 1, 1, 2, 2, 3, 255]);
    const ctlKp = W.kp();
    let controller = ctlKp.publicKey;
    if (R.bool(0.05)) controller = PublicKey.default;
    let subject_hash;
    if (kind === 1) subject_hash = W.subjectHash(1, 'h' + R.bytes(5).toString('hex'));
    else if (R.bool(0.9)) subject_hash = W.keySubject(kind === 2 ? 2 : 0, controller);
    else subject_hash = R.bool() ? R.bytes(32) : W.keySubject(kind === 2 ? 0 : 2, controller);   // the other kind's hash of the same key
    const asset = R.bool(0.75) ? R.pick([0, 0, 1]) : R.pick([2, 3, 4, 7, 255]);
    const tier = R.bool(0.75) ? R.range(1, 5) : R.pick([0, 6, 7, 255]);
    let nn = R.bool(0.85) ? R.range(1, 8) : R.pick([0, 9, 10]);
    let hs = W.notesOf(nn).hashes;
    if (nn >= 2 && R.bool(0.08)) hs = [...hs].reverse();
    if (nn >= 2 && R.bool(0.05)) hs = [hs[0], ...hs.slice(0, nn - 1)];
    const dIssued = R.pick([0, -1, -2, -age + 2, -age, -age - 1, -age - 3, 1, 3, -R.int(age + 10)]);
    let issued = BigInt(Math.max(0, slot + dIssued));
    if (R.bool(0.02)) issued = MAX;
    const dRoot = R.pick([0, 1, 3, lag, lag + 1, -1, R.int(lag)]);
    let root = issued - BigInt(dRoot); if (root < 0n) root = 0n; if (R.bool(0.02)) root = MAX;
    const dExp = R.pick([0, 1, 2, val, val + 1, -1, age + 1, R.range(1, val)]);
    let expiry = issued + BigInt(dExp); if (expiry < 0n) expiry = 0n; if (expiry > MAX) expiry = MAX; if (R.bool(0.02)) expiry = MAX;
    if (R.bool(0.05)) expiry = BigInt(slot);
    const a = { subject_kind: kind, subject_hash, asset, tier, tree_root: R.bytes(32), root_slot: root, null_hashes: hs, issued_slot: issued, expiry_slot: expiry, controller, nonce: R.bytes(16) };
    const r = await W.simCertify(users[i % users.length], a);
    const want = W.model(a, r.slot ?? slot, c);
    const accept = want === null ? null : [want, 'TxTooLarge'];
    if (expect(`model #${i} kind ${kind} asset ${asset} tier ${tier} n ${nn}`, 'certify', r, accept, { model: want, attestation: { kind, asset, tier, n: nn, issued: String(issued), root: String(root), expiry: String(expiry) } })) agree++;
  }
  note(`A3: ${agree}/${N} random attestations agree with the model of check_attestation (evaluated at the simulation's own bank slot)`);
}
