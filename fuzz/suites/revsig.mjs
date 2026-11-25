// Suite "revsig" (programs with revoke_signed, 74654cb and later): the controller's signed revoke, POF-REVOKE1, 156 bytes.
// Every byte offset of the signed message mutated; valid_until at, before and far after the slot (u64::MAX: nothing caps it);
// another signer, the Verifier's key; a revoked certificate; a message made before a renew or a remake replayed after it; the
// same transaction replayed; the precompile pointing elsewhere; the instruction invoked with nothing before it.
import { PublicKey } from '../lib/core.mjs';

export async function revsig(W, o = {}) {
  const { h, R, P, users, expect, note } = W;
  if (!P.ixs.revoke_signed) { note('no revoke_signed in this snapshot'); return; }
  W.suite('revsig');
  const caller = users[4];
  const revBytes = (certAddr, c, validUntil) => Buffer.concat([Buffer.from('POF-REVOKE1'), P.programId.toBuffer(), new PublicKey(certAddr).toBuffer(), Buffer.from(c.subject_hash), Buffer.from([c.asset]), Buffer.from(c.nullset_hash), W.u64le(c.issued_slot), W.u64le(validUntil)]);
  const ix = (cert, validUntil) => P.ix('revoke_signed', { valid_until: validUntil }, { caller: caller.publicKey, certificate: cert });
  const mk = async () => { const ctl = W.kp(); await h.fund([ctl], 5); const a = await W.att({ kind: 2, ctlKp: ctl }); const r = await W.certify(ctl, a); if (!r.ok) throw Error(r.why); const addr = W.certPda(a.subject_hash, 0); return { ctl, a, addr, c: await W.cert(a.subject_hash) }; };
  const x = await mk();
  const vu = BigInt(await h.slotNow()) + 1500n;
  const msg = revBytes(x.addr, x.c, vu);
  const ok = await h.sim([W.edIx(x.ctl, msg), ix(x.addr, vu)], [caller]);
  expect('canonical signed revoke', 'revoke_signed', ok, null);
  W.cu('revoke_signed', ok.pofUnits[0], ok.size);
  for (let off = 0; off < 156; off++) for (let k = 0; k < (o.perOffset ?? 2); k++) {
    const m = Buffer.from(msg); let v; do { v = R.int(256); } while (v === m[off]); m[off] = v;
    expect(`signed byte ${off} changed`, 'revoke_signed', await h.sim([W.edIx(x.ctl, m), ix(x.addr, vu)], [caller]), 'AttestationMismatch');
  }
  expect('valid_until in the past', 'revoke_signed', await h.sim([W.edIx(x.ctl, revBytes(x.addr, x.c, 5n)), ix(x.addr, 5n)], [caller]), 'Expired');
  const MAX = (1n << 64n) - 1n;
  expect('valid_until = u64::MAX', 'revoke_signed', await h.sim([W.edIx(x.ctl, revBytes(x.addr, x.c, MAX)), ix(x.addr, MAX)], [caller]), W.fixed2 ? 'BadExpiry' : null);
  if (W.fixed2) {
    const s0 = BigInt(await h.slotNow());
    for (const [d, want] of [[8_990n, null], [9_010n, 'BadExpiry']]) { const v = s0 + d; const r = await h.sim([W.edIx(x.ctl, revBytes(x.addr, x.c, v)), ix(x.addr, v)], [caller]); expect(`valid_until = now + ${d} (window 9,000)`, 'revoke_signed', r, want); }
  } else note('valid_until has no upper bound on chain: a signed revoke with valid_until = u64::MAX stays usable for the certificate\'s whole life (the client chooses now + 1,500)');
  expect('signed by another key', 'revoke_signed', await h.sim([W.edIx(W.kp(), msg), ix(x.addr, vu)], [caller]), 'NotController');
  expect('signed by the Verifier key', 'revoke_signed', await h.sim([W.edIx(W.V, msg), ix(x.addr, vu)], [caller]), 'NotController');
  expect('no Ed25519 instruction', 'revoke_signed', await h.sim([ix(x.addr, vu)], [caller]), 'NoSignature');
  expect('precompile data addressed by index', 'revoke_signed', await h.sim([W.edIx(x.ctl, msg, { ix: 1 }), ix(x.addr, vu)], [caller]), 'BadSignatureLayout');
  const y = await mk();
  expect('the message of certificate X on certificate Y', 'revoke_signed', await h.sim([W.edIx(x.ctl, msg), ix(y.addr, vu)], [caller]), 'NotController');
  expect('Y\'s controller signs X\'s message, sent for Y', 'revoke_signed', await h.sim([W.edIx(y.ctl, msg), ix(y.addr, vu)], [caller]), 'AttestationMismatch');
  // a message signed before a renew, replayed after it
  {
    const z = await mk();
    const m0 = revBytes(z.addr, z.c, vu);
    const b = await W.att({ kind: 2, ctlKp: z.ctl, null_hashes: z.a.null_hashes });
    expect('renew', 'renew', await W.certify(z.ctl, b, { name: 'renew' }), null);
    expect('a signed revoke made before the renew', 'revoke_signed', await h.sim([W.edIx(z.ctl, m0), ix(z.addr, vu)], [caller]), 'AttestationMismatch');
    const r = await h.send([W.edIx(z.ctl, revBytes(z.addr, await W.cert(z.a.subject_hash), vu)), ix(z.addr, vu)], [caller]);
    expect('a fresh one after the renew lands', 'revoke_signed', r, null);
    expect('the same signed revoke again', 'revoke_signed', await h.send([W.edIx(z.ctl, revBytes(z.addr, await W.cert(z.a.subject_hash), vu)), ix(z.addr, vu)], [caller]), 'NotLive');
    const c2 = await W.att({ kind: 2, ctlKp: z.ctl, null_hashes: z.a.null_hashes });
    expect('remake over it', 'certify', await W.certify(z.ctl, c2), null);
    expect('the pre-remake signed revoke on the remade certificate', 'revoke_signed', await h.sim([W.edIx(z.ctl, m0), ix(z.addr, vu)], [caller]), 'AttestationMismatch');
  }
  await W.invariants('revsig');
}
