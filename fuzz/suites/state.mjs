// A ready state that every instruction can be called on canonically (simulations never change it): a live certificate L with a
// spent note, a revoked one RV (another payer remakes it), an expired one EX, a room with L and EX as members, an empty room, and
// a canonical, valid call of every instruction of pof and pof_gate (each simulated ok before a suite mutates it).
export async function readyState(W) {
  const { h, users, V, K, P, G, fx } = W;
  const hex = s => Buffer.from(s, 'hex');
  const alice = users[5], rvPayer = users[6], remaker = users[7], creator = users[8], fresh = users[9];
  const spentNf = hex(fx.spent0[3]);
  const nL = W.notesOf(3, [spentNf, W.R.field(), W.R.field()]);
  const aL = await W.att({ kind: 0, ctlKp: alice, tier: 3, null_hashes: nL.hashes });
  must(await W.certify(alice, aL), 'certify L');
  const rvKp = W.kp(); await h.fund([rvKp], 2);
  const aRV = await W.att({ kind: 2, ctlKp: rvKp, tier: 1 });
  must(await W.certify(rvPayer, aRV, { signedPayer: rvPayer.publicKey }), 'certify RV');
  must(await h.send([W.revokeHolderIx(rvKp, aRV.subject_hash)], [rvKp]), 'revoke RV');
  const exKp = W.kp(); await h.fund([exKp], 2);
  const aEX = await W.att({ kind: 2, ctlKp: exKp, tier: 1, valid: 30 });
  must(await W.certify(exKp, aEX), 'certify EX');
  const room = W.roomPda(creator.publicKey, 1n), empty = W.roomPda(creator.publicKey, 2n);
  const name = Buffer.alloc(32); Buffer.from('fuzz room').copy(name);
  must(await h.send([G.ix('create_room', { id: 1n, asset: 0, min_tier: 1, name }, { creator: creator.publicKey, room, pof_config: K.config })], [creator]), 'room');
  must(await h.send([G.ix('create_room', { id: 2n, asset: 0, min_tier: 1, name }, { creator: creator.publicKey, room: empty, pof_config: K.config })], [creator]), 'empty room');
  must(await h.send([W.joinIx(alice, alice, room, aL.subject_hash)], [alice]), 'join L');
  must(await h.send([W.joinIx(exKp, exKp, room, aEX.subject_hash)], [exKp]), 'join EX');
  await h.waitSlot(BigInt(aEX.expiry_slot) + 2n);
  const mEX = await W.decode(G, 'Member', W.memberPda(room, aEX.subject_hash));
  return { alice, rvPayer, remaker, creator, fresh, spentNf, nL, aL, aRV, rvKp, aEX, exKp, room, empty, name, mEX };
}
function must(r, what) { if (!r.ok) throw Error(`state: ${what}: ${r.why}\n${(r.logs || []).slice(-8).join('\n')}`); return r; }

/** canonical calls: { name, ixs, signers, target (index of the mutated instruction), free (account names that may be anything) } */
export async function canonicals(W, S) {
  const { h, P, G, K, V, admin, relayer } = W;
  const out = [];
  const add = (name, ixs, signers, free = [], target = ixs.length - 1) => out.push({ name, ixs, signers, free, target });
  const aNew = await W.att({ kind: 0, ctlKp: S.fresh, tier: 1 });
  add('certify', W.certifyIxs(S.fresh, aNew), [S.fresh], ['holder_token', 'prior_payer']);
  const aRe = await W.att({ kind: 2, ctlKp: S.rvKp, tier: 2, issued_slot: (await h.slotNow()) - 1 });
  add('certify (remake, prior payer)', W.certifyIxs(S.remaker, aRe, { prior: S.rvPayer.publicKey }), [S.remaker], ['holder_token']);
  const aRn = await W.att({ kind: 0, ctlKp: S.alice, tier: 2, null_hashes: S.nL.hashes, controller: S.alice.publicKey });
  add('renew', W.certifyIxs(S.alice, aRn, { name: 'renew' }), [S.alice], ['holder_token']);
  const e = S.nL.of(S.spentNf);
  add('revoke_spent', [W.revokeSpentIx(S.fresh, S.aL.subject_hash, 0, S.nL.index(S.spentNf), e.salt, S.spentNf)], [S.fresh], ['caller']);
  add('revoke_by_holder', [W.revokeHolderIx(S.alice, S.aL.subject_hash)], [S.alice]);
  add('expire', [W.expireIx(S.fresh, S.aEX.subject_hash, 0, S.exKp.publicKey)], [S.fresh], ['caller']);
  add('anchor_log', W.anchorIxs(V, 1_000_000n + BigInt(W.R.int(1000)), W.R.bytes(32), S.fresh), [S.fresh], ['caller']);
  add('require_certificate', [P.ix('require_certificate', { subject_hash: S.aL.subject_hash, asset: 0, min_tier: 3 }, { certificate: W.certPda(S.aL.subject_hash, 0) })], [S.fresh]);
  const params = (await W.config()).params;
  add('set_params', [P.ix('set_params', { params }, { admin: admin.publicKey })], [admin]);
  add('set_fee', [P.ix('set_fee', { fee_lamports: params.fee_lamports }, { admin: admin.publicKey })], [admin]);
  add('set_paused', [P.ix('set_paused', { paused: false }, { admin: admin.publicKey })], [admin]);
  add('set_asset', [P.ix('set_asset', { asset: 3, tiers: { enabled: true, mint: W.kp().publicKey, decimals: 6, mins: [5n, 6n, 0n, 0n, 0n] } }, { admin: admin.publicKey })], [admin]);
  add('set_verifier', [P.ix('set_verifier', { next: W.V3.publicKey }, { admin: admin.publicKey })], [admin]);
  add('set_roles', [P.ix('set_roles', { dev: null, relayer: relayer.publicKey }, { admin: admin.publicKey, root_mint: null })], [admin]);
  add('withdraw_fees', [P.ix('withdraw_fees', { lamports: 1n }, { admin: admin.publicKey, dev: W.dev.publicKey })], [admin]);
  add('close_begin', [P.ix('close_begin', {}, { admin: admin.publicKey })], [admin]);
  add('create_room', [G.ix('create_room', { id: 99n, asset: 0, min_tier: 2, name: S.name }, { creator: S.creator.publicKey, room: W.roomPda(S.creator.publicKey, 99n), pof_config: K.config })], [S.creator]);
  add('set_room', [G.ix('set_room', { min_tier: 2, open: true, name: S.name }, { creator: S.creator.publicKey, room: S.room, pof_config: K.config })], [S.creator]);
  add('join', [W.joinIx(S.alice, S.fresh, S.empty, S.aL.subject_hash)], [S.fresh, S.alice], ['payer']);
  add('evict', [W.evictIx(S.fresh, S.room, S.aEX.subject_hash, S.mEX)], [S.fresh], ['caller']);
  add('leave', [G.ix('leave', {}, { controller: S.alice.publicKey, room: S.room, member: W.memberPda(S.room, S.aL.subject_hash), payer: S.alice.publicKey })], [S.alice]);
  add('close_room', [G.ix('close_room', {}, { creator: S.creator.publicKey, room: S.empty })], [S.creator]);
  for (const c of out) {
    const r = await h.sim(c.ixs, c.signers);
    if (!r.ok) throw Error(`canonical ${c.name} does not simulate: ${r.why}\n${r.logs.slice(-8).join('\n')}`);
    c.ixName = c.name.split(' ')[0];
  }
  return out;
}
