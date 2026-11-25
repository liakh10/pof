// Suite "ed25519": the Verifier's signature as the instructions sysvar shows it to certify (and anchor_log).
// Hand-made variants (count 0/2/255, every index field pointing at itself by number, at other instructions, at u16::MAX-1; message
// offsets and lengths off by one; trailing bytes; account metas on the precompile instruction; the signature after certify, two
// before, two certifies sharing one; certify at index 0; a signature by the next key before its slot; a corrupt signature with a
// valid layout, both simulated and sent), then a random fuzz of the 16-byte header. Any "ok" in a must-fail case is re-sent for
// real (a simulation might skip the precompile) before it counts.
import { web3, edIx, edRaw, edSign, u16le, ED25519, PublicKey } from '../lib/core.mjs';
const { SystemProgram, ComputeBudgetProgram } = web3;

export async function ed25519(W, o = {}) {
  const { h, R, P, users, expect, note } = W;
  W.suite('ed25519');
  const payer = users[2];
  const a = await W.att({ kind: 0, ctlKp: payer, tier: 1, n: 2 });
  const msg = W.attBytes(a, payer.publicKey, P.programId);
  const [, cix] = W.certifyIxs(payer, a);
  const sim = (ixs, units = 1_400_000) => h.sim(ixs, [payer], { units });
  /** a must-fail case that simulated ok is sent for real before it is judged */
  async function judge(name, ixs, want, units) {
    let r = await sim(ixs, units);
    if (r.ok && want !== null) { const s = await h.send(ixs, [payer], { units }); note(`${name}: simulation said ok, sent for real: ${s.ok ? 'LANDED' : s.why}`); r = s; }
    return expect(name, 'certify', r, want);
  }
  const V = W.V;
  /** a must-succeed variant: a fresh attestation and payer each time, sent for real (the precompile must accept it too) */
  async function judgeOk(name, mk, units = 1_400_000) {
    const p = W.kp(); await h.fund([p], 2);
    const b = await W.att({ kind: 0, ctlKp: p, tier: 1, n: 2 });
    const m = W.attBytes(b, p.publicKey, P.programId);
    const [, c] = W.certifyIxs(p, b);
    const r = await h.send(mk(m, c), [p], { units });
    return expect(name, 'certify', r, null);
  }
  // index of the Ed25519 instruction in these transactions: 1 (0 is the compute budget limit)
  await judgeOk('canonical: one signature, all indexes u16::MAX', (m, c) => [edIx(V, m), c]);
  await judge('count 0', [edRaw({ count: 0, entries: [], payload: Buffer.alloc(0) }), cix], ['BadSignatureLayout', 'NoSignature', '*']);
  await judge('count 2, the attestation first and a second valid signature', [edIx(V, msg, { pre: [], count: 2, entriesBefore: 0, tail: Buffer.alloc(0) }), cix], '*');
  {
    // two real entries: [attestation by V, another message by V]
    const m2 = Buffer.from('another message');
    const s1 = edSign(V, msg), s2 = edSign(V, m2);
    const start = 2 + 14 * 2;
    const payload = Buffer.concat([V.publicKey.toBuffer(), s1, msg, s2, m2]);
    const e1 = { sigOff: start + 32, sigIx: 0xffff, keyOff: start, keyIx: 0xffff, msgOff: start + 96, msgLen: msg.length, msgIx: 0xffff };
    const e2 = { sigOff: start + 96 + msg.length, sigIx: 0xffff, keyOff: start, keyIx: 0xffff, msgOff: start + 96 + msg.length + 64, msgLen: m2.length, msgIx: 0xffff };
    await judge('two valid signatures, the attestation first', [edRaw({ entries: [e1, e2], payload }), cix], 'BadSignatureLayout');
    await judge('two valid signatures, the attestation second', [edRaw({ entries: [e2, e1], payload }), cix], 'BadSignatureLayout');
  }
  for (const [field, v] of [['sigIx', 1], ['keyIx', 1], ['msgIx', 1], ['sigIx', 0], ['keyIx', 2], ['msgIx', 2], ['sigIx', 0xfffe], ['msgIx', 0xfffe]]) {
    await judge(`${field} = ${v} (the same data addressed by number)`, [edIx(V, msg, { [field]: v }), cix], ['BadSignatureLayout', '*']);
  }
  {
    // every index field = 1, the precompile instruction's own index: a valid signature the precompile accepts, refused by POF
    await judge('all three indexes = its own instruction index', [edIx(V, msg, { ix: 1 }), cix], 'BadSignatureLayout');
    // the signature, key and message inside a memo instruction at 0 (no compute budget), the precompile pointing at it
    const memo = new web3.TransactionInstruction({ programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), keys: [], data: Buffer.concat([V.publicKey.toBuffer(), edSign(V, msg), msg]) });
    const ptr = edRaw({ entries: [{ sigOff: 32, sigIx: 0, keyOff: 0, keyIx: 0, msgOff: 96, msgLen: msg.length, msgIx: 0 }], payload: Buffer.alloc(0) });
    await judge('signature data in another instruction (a memo at 0)', [memo, ptr, cix], ['BadSignatureLayout', '*'], 0);
  }
  await judge('message length 239', [edIx(V, msg.subarray(0, 239)), cix], 'AttestationMismatch');
  await judge('message length 241 (one extra byte signed)', [edIx(V, Buffer.concat([msg, Buffer.from([0])])), cix], 'AttestationMismatch');
  await judge('message length field 239 over the 240 bytes', [edIx(V, msg, { msgLen: 239, sig: edSign(V, msg.subarray(0, 239)) }), cix], 'AttestationMismatch');
  await judgeOk('trailing bytes after the message', (m, c) => [edIx(V, m, { tail: R.bytes(40) }), c]);
  for (const n of [1, 3]) {
    const keys = Array.from({ length: n }, () => ({ pubkey: W.kp().publicKey, isSigner: false, isWritable: false }));
    await judgeOk(`the precompile instruction with ${n} account meta(s)`, (m, c) => [edIx(V, m, { keys }), c]);
  }
  await judge('no signature instruction', [cix], 'NoSignature');
  await judge('signature after certify', [cix, edIx(V, msg)], 'NoSignature');
  await judge('signature two before (a transfer between)', [edIx(V, msg), SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: payer.publicKey, lamports: 1 }), cix], 'NoSignature');
  await judge('certify at index 0 (no compute budget, nothing before)', [cix], 'NoSignature', 0);
  await judgeOk('signature at 0, certify at 1 (no compute budget)', (m, c) => [edIx(V, m), c], 0);
  {
    // two certifies after one signature: the second sees a certify before it, not a signature
    const a1 = await W.att({ kind: 0, ctlKp: payer, tier: 1, n: 1 });
    const msg1 = W.attBytes(a1, payer.publicKey, P.programId);
    const [, cix1] = W.certifyIxs(payer, a1);
    const b = await W.att({ kind: 0, ctlKp: users[3], tier: 1, n: 1 });
    const [, cix2] = W.certifyIxs(users[3], b);
    const r = await h.sim([edIx(V, msg1), cix1, cix2], [payer, users[3]], { units: 0 });
    expect('two certifies after one signature', 'certify', r, ['NoSignature', 'TxTooLarge']);
    const r2 = await h.sim([edIx(V, msg1), cix1, edIx(V, W.attBytes(b, users[3].publicKey, P.programId)), cix2], [payer, users[3]], { units: 0 });
    if (r2.why === 'TxTooLarge') note('two certifies, each with its own signature, do not fit one transaction even with one note each');
    expect('two certifies, each after its own signature', 'certify', r2, [null, 'TxTooLarge'].includes(r2.why) ? r2.why : null);
  }
  await judge('signed by another key', [edIx(W.kp(), msg), cix], 'WrongVerifier');
  {
    // a corrupt signature with a valid layout: only the precompile can refuse it
    const bad = edSign(V, msg); bad[7] ^= 1;
    const ixs = [edIx(V, msg, { sig: bad }), cix];
    const s = await sim(ixs);
    note(`corrupt signature, valid layout: simulation ${s.ok ? 'ok (the simulation does not verify the precompile)' : 'refused: ' + s.why}`);
    const r = await h.send(ixs, [payer]);
    expect('corrupt signature, valid layout, sent', 'certify', r, '*');
    note(`  sent: ${r.ok ? 'LANDED' : 'refused: ' + r.why}`);
  }
  {
    // the key the precompile verified is the one POF compares: point the key offset at the payer's key inside the message
    const e = { sigOff: 2 + 14 + 32, sigIx: 0xffff, keyOff: 2 + 14 + 96 + 160, keyIx: 0xffff, msgOff: 2 + 14 + 96, msgLen: 240, msgIx: 0xffff };
    await judge('key offset into the message (the payer key at 160)', [edRaw({ entries: [e], payload: Buffer.concat([V.publicKey.toBuffer(), edSign(V, msg), msg]) }), cix], '*');
  }
  {
    // the instructions sysvar replaced by another account
    const fake = P.ix('certify', { att: a, log_index: 0 }, { payer: payer.publicKey, certificate: W.certPda(a.subject_hash, a.asset), holder_token: payer.publicKey, prior_payer: null, instructions: W.K.config });
    await judge('instructions sysvar replaced by the config account', [edIx(V, msg), fake], '*');
  }
  /* random header fuzz */
  const N = o.header ?? 400;
  let landed = 0;
  for (let i = 0; i < N; i++) {
    const ed = edIx(V, msg);
    const d = Buffer.from(ed.data);
    const k = R.range(1, 3);
    for (let j = 0; j < k; j++) {
      const at = R.int(16);
      if (at === 1) continue;   // the padding byte: no meaning
      const v = R.pick([0, 1, 2, 0xff, 0xfe, R.int(256)]);
      d[at] = v;
    }
    if (d.equals(ed.data)) continue;
    const ix = new web3.TransactionInstruction({ programId: ED25519, keys: [], data: d });
    const r = await sim([ix, cix]);
    if (r.ok) {
      // the header changed yet POF accepted: must be a change the precompile and POF both read the same (none is expected)
      const s = await h.send([ix, cix], [payer]);
      if (s.ok) landed++;
      expect(`header fuzz #${i} ${d.subarray(0, 16).toString('hex')}`, 'certify', s, '*');
    } else expect(`header fuzz #${i}`, 'certify', r, '*');
  }
  note(`random header fuzz: ${N} cases, ${landed} landed`);
}
