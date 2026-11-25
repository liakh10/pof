// Suite "void" (187914b and later): revoked Verifier keys (revoke_verifier_key, void_by_key, and the key check in check_signed,
// require_certificate, pof_gate join and evict). Runs late: it revokes the signing key, then rotates to a fresh one.
import { PublicKey } from '../lib/core.mjs';

export async function voidkey(W, o = {}) {
  const { h, R, P, G, K, admin, users, expect, note } = W;
  if (!P.ixs.void_by_key) { note('no void_by_key in this snapshot'); return; }
  W.suite('void');
  const rk = key => P.ix('revoke_verifier_key', { key }, { admin: admin.publicKey });
  const vd = (sh, caller = users[0]) => P.ix('void_by_key', {}, { caller: caller.publicKey, certificate: W.certPda(sh, 0) });
  const req = (sh, tier = 1) => h.sim([P.ix('require_certificate', { subject_hash: sh, asset: 0, min_tier: tier }, { certificate: W.certPda(sh, 0) })], [users[0]]);
  const mk = async () => { const ctl = W.kp(); await h.fund([ctl], 5); const a = await W.att({ kind: 2, ctlKp: ctl, tier: 3 }); const r = await W.certify(ctl, a); if (!r.ok) throw Error(r.why); return { ctl, a, sh: a.subject_hash }; };
  const creator = users[8];
  const id = 33000n + BigInt(R.int(1000)), room = W.roomPda(creator.publicKey, id);
  await h.send([G.ix('create_room', { id, asset: 0, min_tier: 1, name: Buffer.alloc(32) }, { creator: creator.publicKey, room, pof_config: K.config })], [creator]);
  const x = await mk(), y = await mk(), z = await mk();
  expect('join before the revocation', 'join', await h.send([W.joinIx(x.ctl, x.ctl, room, x.sh)], [x.ctl]), null);
  expect('void a certificate whose key is fine', 'void_by_key', await h.sim([vd(x.sh)], [users[0]]), 'KeyNotRevoked');
  expect('revoke_verifier_key by a stranger', 'revoke_verifier_key', await h.sim([P.ix('revoke_verifier_key', { key: W.V.publicKey }, { admin: users[0].publicKey })], [users[0]]), 'NotAdmin');
  expect('revoke the default key', 'revoke_verifier_key', await h.sim([rk(PublicKey.default)], [admin]), 'BadParams');
  const old = W.V;
  expect('revoke the active signing key', 'revoke_verifier_key', await h.send([rk(old.publicKey)], [admin]), null);
  expect('the same key again (idempotent)', 'revoke_verifier_key', await h.send([rk(old.publicKey)], [admin]), null);
  expect('certify signed by the revoked active key', 'certify', await W.simCertify(users[1], await W.att({ kind: 0, ctlKp: users[1] })), 'KeyRevoked');
  expect('anchor_log signed by the revoked key', 'anchor_log', await h.sim(W.anchorIxs(old, ((await W.treasury()).log_size) + 1n, R.bytes(32), users[0]), [users[0]]), 'KeyRevoked');
  expect('require_certificate on a certificate it signed', 'require_certificate', await req(x.sh), 'KeyRevoked');
  expect('join a room with it', 'join', await h.sim([W.joinIx(y.ctl, y.ctl, room, y.sh)], [y.ctl]), 'KeyRevoked');
  const m = await W.decode(G, 'Member', W.memberPda(room, x.sh));
  expect('its member is evictable at once', 'evict', await h.send([W.evictIx(users[0], room, x.sh, m)], [users[0]]), null);
  expect('void_by_key', 'void_by_key', await h.send([vd(x.sh)], [users[0]]), null);
  expect('  status 4', 'void_by_key', { ok: (await W.cert(x.sh)).status === 4 }, null);
  expect('void it again', 'void_by_key', await h.sim([vd(x.sh)], [users[0]]), 'NotLive');
  expect('revoke_by_holder of a voided certificate', 'revoke_by_holder', await h.sim([W.revokeHolderIx(x.ctl, x.sh)], [x.ctl]), 'NotLive');
  expect('revoke_by_holder of a not-yet-voided one (still allowed)', 'revoke_by_holder', await h.send([W.revokeHolderIx(z.ctl, z.sh)], [z.ctl]), null);
  await W.invariants('voided');
  // rotate to a fresh key: until then nothing can certify
  const nk = W.kp();
  await h.send([P.ix('set_verifier', { next: nk.publicKey }, { admin: admin.publicKey })], [admin]);
  await h.waitSlot(BigInt((await W.config()).next_verifier_slot) + 1n);
  W.V = nk;
  // y was signed by the revoked key and not voided: the new key renews it (re-attests the same notes), which un-revokes it
  const ry = await W.att({ kind: 2, ctlKp: y.ctl, null_hashes: y.a.null_hashes, tier: 3 });
  const rr = await W.certify(y.ctl, ry, { name: 'renew' });
  expect('renew by the new key of a certificate the revoked key signed', 'renew', rr, null);
  expect('  then it passes require_certificate again', 'require_certificate', await req(y.sh), null);
  note('a certificate signed by a revoked key and not yet voided can be renewed by the new key (a fresh attestation of the same notes): renew does not refuse a revoked cert.verifier');
  const rx = await W.att({ kind: 2, ctlKp: x.ctl, null_hashes: x.a.null_hashes });
  expect('remake over a voided certificate', 'certify', await W.certify(x.ctl, rx), null);
  // the list holds 4 keys and nothing removes one
  let full = null;
  for (let i = 0; i < 4; i++) { const r = await h.send([rk(W.kp().publicKey)], [admin]); if (!r.ok) { full = { i, why: r.why }; break; } }
  expect('a fifth revoked key once the list is full', 'revoke_verifier_key', full ? { ok: false, why: full.why } : await h.sim([rk(W.kp().publicKey)], [admin]), 'BadParams');
  note(`revoked_keys holds ${P.codec.types.Config ? 4 : '?'} keys and has no removal: after ${full ? full.i + 1 : 4} revocations a further leaked key can only be paused, not revoked`);
  await W.invariants('void end');
}
