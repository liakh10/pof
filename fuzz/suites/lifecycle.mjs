// Suites "orderings" and "donations" (real transactions, invariants after each).
// orderings: renew/expire/evict/revoke in every order inside ONE transaction, and conflicting transactions sent together so they
//   race for the same slot (two certifies of one subject, revoke_spent against revoke_by_holder, two expires, evict against leave).
// donations (POF-07 and its relatives): lamports sent to a revoked certificate before another payer remakes it, to one the same
//   payer remakes, to a certificate address before it exists, to a member and a room address before they exist, to the treasury.
export async function orderings(W, o = {}) {
  const { h, R, P, G, K, users, expect, note } = W;
  W.suite('orderings');
  const hex = s => Buffer.from(s, 'hex');
  const mk = async (o2 = {}) => {
    const ctl = W.kp(); await h.fund([ctl], 5);
    const nfs = o2.nfs ?? [R.field(), R.field()];
    const n = W.notesOf(nfs.length, nfs);
    const a = await W.att({ kind: 2, ctlKp: ctl, null_hashes: n.hashes, valid: o2.valid ?? 500 });
    return { ctl, n, a, sh: a.subject_hash };
  };
  const ed = (payer, a, o2) => W.certifyIxs(payer, a, o2);
  const creator = users[8];
  const name = Buffer.alloc(32);
  const room = W.roomPda(creator.publicKey, 77n);
  await h.send([G.ix('create_room', { id: 77n, asset: 0, min_tier: 1, name }, { creator: creator.publicKey, room, pof_config: K.config })], [creator]);
  // 1. revoke then remake in one transaction (same payer, newer attestation)
  {
    const x = await mk(); expect('setup certify', 'certify', await W.certify(x.ctl, x.a), null);
    const b = await W.att({ kind: 2, ctlKp: x.ctl, null_hashes: x.n.hashes });
    const r = await h.send([W.revokeHolderIx(x.ctl, x.sh), ...ed(x.ctl, b)], [x.ctl]);
    expect('[revoke_by_holder, certify newer] in one transaction', 'certify', r, null);
    const c = await W.cert(x.sh); expect('  remade live', 'certify', { ok: c?.status === 0 && c.issued_slot === BigInt(b.issued_slot) }, null);
    await W.invariants('revoke+remake');
  }
  // 2. certify, revoke, certify newer, all in one transaction (one note each, so two certifies fit 1,232 bytes)
  {
    const x = await mk({ nfs: [R.field()] });
    const b = await W.att({ kind: 2, ctlKp: x.ctl, null_hashes: x.n.hashes, issued_slot: BigInt(x.a.issued_slot) + 1n });
    const r = await h.send([...ed(x.ctl, x.a), W.revokeHolderIx(x.ctl, x.sh), ...ed(x.ctl, b)], [x.ctl], { units: 0 });
    if (r.why === 'TxTooLarge') note('two certify instructions (each with its Ed25519 instruction) do not fit one 1,232-byte transaction even with one note each: same-transaction double certify is covered through the hostile CPI router instead');
    expect('[certify A, revoke, certify B] in one transaction', 'certify', r, r.why === 'TxTooLarge' ? 'TxTooLarge' : null);
    const r2 = await h.send([...ed(x.ctl, x.a), W.revokeHolderIx(x.ctl, x.sh), ...ed(x.ctl, x.a)], [x.ctl], { units: 0 });
    expect('[certify A, revoke, certify A again] (the same attestation twice)', 'certify', r2, ['Replayed', 'AlreadyLive', 'TxTooLarge']);
    await W.invariants('certify+revoke+certify');
  }
  // 3. two revocations in one transaction: the second must fail and take the first with it
  {
    const spent = hex(W.fx.spent0[4]);
    const x = await mk({ nfs: [spent, R.field()] }); await W.certify(x.ctl, x.a);
    const e = x.n.of(spent);
    const rs = W.revokeSpentIx(users[0], x.sh, 0, x.n.index(spent), e.salt, spent);
    expect('[revoke_spent, revoke_by_holder]', 'revoke_by_holder', await h.send([rs, W.revokeHolderIx(x.ctl, x.sh)], [users[0], x.ctl]), 'NotLive');
    expect('[revoke_by_holder, revoke_spent]', 'revoke_spent', await h.send([W.revokeHolderIx(x.ctl, x.sh), rs], [users[0], x.ctl]), 'NotLive');
    expect('  still live after both failed', 'revoke_spent', { ok: (await W.cert(x.sh)).status === 0 }, null);
    expect('[revoke_spent, revoke_spent] (the same pair twice)', 'revoke_spent', await h.send([rs, rs], [users[0]]), 'NotLive');
    await W.invariants('double revoke');
  }
  // 4. join, revoke, evict in one transaction
  {
    const x = await mk(); await W.certify(x.ctl, x.a);
    const m = { payer: x.ctl.publicKey, certificate: W.certPda(x.sh, 0) };
    const r = await h.send([W.joinIx(x.ctl, x.ctl, room, x.sh), W.revokeHolderIx(x.ctl, x.sh), W.evictIx(users[0], room, x.sh, m)], [users[0], x.ctl]);
    expect('[join, revoke_by_holder, evict] in one transaction', 'evict', r, null);
    expect('[evict before join] (no member yet)', 'evict', await h.send([W.evictIx(users[0], room, x.sh, m)], [users[0]]), '*');
    await W.invariants('join+revoke+evict');
  }
  // 5. renew then revoke; revoke then renew
  {
    const x = await mk(); await W.certify(x.ctl, x.a);
    const b = await W.att({ kind: 2, ctlKp: x.ctl, null_hashes: x.n.hashes, tier: 2 });
    expect('[renew, revoke_by_holder]', 'renew', await h.send([...ed(x.ctl, b, { name: 'renew' }), W.revokeHolderIx(x.ctl, x.sh)], [x.ctl]), null);
    const y = await mk(); await W.certify(y.ctl, y.a);
    const c = await W.att({ kind: 2, ctlKp: y.ctl, null_hashes: y.n.hashes });
    expect('[revoke_by_holder, renew]', 'renew', await h.send([W.revokeHolderIx(y.ctl, y.sh), ...ed(y.ctl, c, { name: 'renew' })], [y.ctl]), 'NotLive');
    const w = await mk(); await W.certify(w.ctl, w.a);
    const other = await W.att({ kind: 2, ctlKp: w.ctl, null_hashes: W.notesOf(2).hashes });
    expect('renew with other notes', 'renew', await h.sim(ed(w.ctl, other, { name: 'renew' }), [w.ctl]), 'RenewMismatch');
    const older = await W.att({ kind: 2, ctlKp: w.ctl, null_hashes: w.n.hashes, issued_slot: BigInt(w.a.issued_slot) - 1n });
    expect('renew with an older attestation', 'renew', await h.sim(ed(w.ctl, older, { name: 'renew' }), [w.ctl]), 'Replayed');
    await h.send([W.revokeHolderIx(w.ctl, w.sh)], [w.ctl]);
    expect('remake with an attestation older than the revoked one', 'certify', await h.sim(ed(w.ctl, older), [w.ctl]), 'Replayed');
    await W.invariants('renew/revoke');
  }
  // 6. expire then remake by another payer in one transaction; certify then expire
  {
    const x = await mk({ valid: 12 }); await W.certify(x.ctl, x.a);
    await h.waitSlot(BigInt(x.a.expiry_slot) + 1n);
    const p2 = users[3];
    const b = await W.att({ kind: 2, ctlKp: x.ctl, null_hashes: x.n.hashes });
    const r = await h.send([W.expireIx(users[0], x.sh, 0, x.ctl.publicKey), ...ed(p2, b)], [users[0], p2]);
    expect('[expire, certify by another payer] in one transaction (no prior payer: the account was closed first)', 'certify', r, null);
    const y = await mk();
    expect('[certify, expire] (not expired yet)', 'expire', await h.send([...ed(y.ctl, y.a), W.expireIx(users[0], y.sh, 0, y.ctl.publicKey)], [users[0], y.ctl]), 'NotExpired');
    const z = await mk({ valid: 12 }); await W.certify(z.ctl, z.a);
    await h.waitSlot(BigInt(z.a.expiry_slot) + 1n);
    const zb = await W.att({ kind: 2, ctlKp: z.ctl, null_hashes: z.n.hashes });
    expect('renew of an expired, unclosed certificate (POF-22 fix)', 'renew', await h.send(ed(z.ctl, zb, { name: 'renew' }), [z.ctl]), 'CertificateExpired');
    expect('certify over the expired, unclosed one (same payer)', 'certify', await h.send(ed(z.ctl, zb), [z.ctl]), null);
    await W.invariants('expire/remake');
  }
  // 7. races: conflicting transactions sent together
  const race = async (label, list, ix, wantLanded = 1) => {
    const rs = await Promise.all(list.map(([ixs, signers]) => h.send(ixs, signers)));
    const landed = rs.filter(r => r.ok).length;
    const slots = rs.filter(r => r.slot).map(r => r.slot);
    expect(`${label}: ${landed} of ${list.length} landed (slots ${[...new Set(slots)].join(',')})`, ix, { ok: landed === wantLanded, why: rs.map(r => r.ok ? 'ok' : r.why).join(' | ') }, null);
    return rs;
  };
  for (let i = 0; i < (o.races ?? 4); i++) {
    const ctl = W.kp(); await h.fund([ctl], 5);
    const a1 = await W.att({ kind: 2, ctlKp: ctl }), a2 = await W.att({ kind: 2, ctlKp: ctl });
    await race('two certifies of one new subject', [[ed(ctl, a1), [ctl]], [ed(users[1], a2), [users[1]]]], 'certify');
    const spent = hex(W.fx.spent0[5]);
    const x = await mk({ nfs: [spent] }); await W.certify(x.ctl, x.a);
    await race('revoke_spent against revoke_by_holder', [[[W.revokeSpentIx(users[0], x.sh, 0, 0, x.n.list[0].salt, spent)], [users[0]]], [[W.revokeHolderIx(x.ctl, x.sh)], [x.ctl]]], 'revoke_spent');
    const y = await mk({ valid: 12 }); await W.certify(y.ctl, y.a); await h.waitSlot(BigInt(y.a.expiry_slot) + 1n);
    await race('two expires', [[[W.expireIx(users[0], y.sh, 0, y.ctl.publicKey)], [users[0]]], [[W.expireIx(users[1], y.sh, 0, y.ctl.publicKey)], [users[1]]]], 'expire');
    const z = await mk(); await W.certify(z.ctl, z.a);
    await h.send([W.joinIx(z.ctl, z.ctl, room, z.sh)], [z.ctl]);
    await h.send([W.revokeHolderIx(z.ctl, z.sh)], [z.ctl]);
    const m = await W.decode(G, 'Member', W.memberPda(room, z.sh));
    await race('evict against leave', [[[W.evictIx(users[0], room, z.sh, m)], [users[0]]], [[G.ix('leave', {}, { controller: z.ctl.publicKey, room, member: W.memberPda(room, z.sh), payer: z.ctl.publicKey })], [z.ctl]]], 'evict');
    await W.invariants('races #' + i);
  }
}

export async function donations(W, o = {}) {
  const { h, R, P, G, K, users, expect, note } = W;
  W.suite('donations');
  const rent = BigInt(await h.conn.getMinimumBalanceForRentExemption(8 + 587));
  const certInfo = async sh => h.info(W.certPda(sh, 0));
  const fee = (await W.config()).params.fee_lamports;
  const txfee = sigs => 5000n * BigInt(sigs);
  const mk = async () => { const ctl = W.kp(); await h.fund([ctl], 5); const n = W.notesOf(2); return { ctl, n, a: await W.att({ kind: 2, ctlKp: ctl, null_hashes: n.hashes }) }; };
  const realRent = BigInt(await h.conn.getMinimumBalanceForRentExemption((await (async () => { const x = await mk(); await W.certify(x.ctl, x.a); return (await certInfo(x.a.subject_hash)).data.length; })())));
  // 1. a donation into a revoked certificate, then another payer remakes it
  for (const gift of [1n, 3_000_000_000n, 250_000_000_000n]) {
    const x = await mk(); await W.certify(x.ctl, x.a);
    const giver = W.kp(); await h.fund([giver], Number(gift / 1_000_000_000n) + 2);
    const g = await h.send([W.transfer(giver, W.certPda(x.a.subject_hash, 0), gift)], [giver]);
    if (!g.ok) throw Error('donation did not land: ' + g.why);
    await h.send([W.revokeHolderIx(x.ctl, x.a.subject_hash)], [x.ctl]);
    const p2 = W.kp(); await h.fund([p2], 10);
    const b = await W.att({ kind: 2, ctlKp: x.ctl, null_hashes: x.n.hashes });
    const [b0, pr0, t0, tr0] = await Promise.all([h.lam(p2.publicKey), h.lam(x.ctl.publicKey), W.treasury(), h.lam(K.treasury)]);
    const r = await h.send(W.certifyIxs(p2, b, { prior: x.ctl.publicKey }), [p2]);
    expect(`remake over a revoked certificate holding ${gift} donated lamports`, 'certify', r, null);
    const [b1, pr1, t1, tr1] = await Promise.all([h.lam(p2.publicKey), h.lam(x.ctl.publicKey), W.treasury(), h.lam(K.treasury)]);
    expect(`  the new payer pays rent + fee + 2 signatures, not the donation (gift ${gift})`, 'certify', { ok: b0 - b1 === realRent + fee + txfee(2), why: `paid ${b0 - b1}, rent ${realRent} fee ${fee}` }, null);
    expect(`  the prior payer gets the rent exactly`, 'certify', { ok: pr1 - pr0 === realRent, why: `got ${pr1 - pr0}` }, null);
    expect(`  the treasury gets fee + donation, counted in fees_in`, 'certify', { ok: tr1 - tr0 === fee + gift && t1.fees_in - t0.fees_in === fee + gift, why: `lamports +${tr1 - tr0}, fees_in +${t1.fees_in - t0.fees_in}` }, null);
    expect('  the certificate holds exactly its rent', 'certify', { ok: BigInt((await certInfo(x.a.subject_hash)).lamports) === realRent }, null);
  }
  // 2. the same payer remakes its own donated certificate: the donation goes to the treasury, not back to it
  {
    const x = await mk(); await W.certify(x.ctl, x.a);
    await h.send([W.transfer(x.ctl, W.certPda(x.a.subject_hash, 0), 1_000_000_000n)], [x.ctl]);
    await h.send([W.revokeHolderIx(x.ctl, x.a.subject_hash)], [x.ctl]);
    const b = await W.att({ kind: 2, ctlKp: x.ctl, null_hashes: x.n.hashes });
    const t0 = await W.treasury();
    expect('the same payer remakes its own certificate holding a donation', 'certify', await h.send(W.certifyIxs(x.ctl, b), [x.ctl]), null);
    const t1 = await W.treasury();
    note(`same-payer remake: the payer's own ${1_000_000_000} donated lamports moved to the treasury as fees (fees_in +${t1.fees_in - t0.fees_in})`);
  }
  // 3. a donation to a certificate address before it exists; then expire pays it all to the payer
  {
    const x = await mk();
    const addr = W.certPda(x.a.subject_hash, 0);
    await h.send([W.transfer(users[0], addr, 2_000_000_000n)], [users[0]]);
    const b0 = await h.lam(x.ctl.publicKey);
    const a = await W.att({ kind: 2, ctlKp: x.ctl, null_hashes: x.n.hashes, valid: 12 });
    expect('certify at an address that already holds lamports', 'certify', await W.certify(x.ctl, a), null);
    const b1 = await h.lam(x.ctl.publicKey);
    note(`pre-funded certificate address: the payer paid ${b0 - b1} (fee ${fee} + signatures; no rent, the donation covered it)`);
    await h.waitSlot(BigInt(a.expiry_slot) + 1n);
    const t0 = await W.treasury();
    expect('expire it', 'expire', await h.send([W.expireIx(users[1], a.subject_hash, 0, x.ctl.publicKey)], [users[1]]), null);
    const b2 = await h.lam(x.ctl.publicKey);
    note(`  at expire the payer received ${b2 - b1} (rent it never paid + the donation): a donation to an empty address is a gift to whoever certifies there`);
    await W.invariants('prefunded');
  }
  // 4. member and room addresses donated before they exist
  {
    const creator = W.kp(); await h.fund([creator], 5);
    const room = W.roomPda(creator.publicKey, 5n);
    await h.send([W.transfer(users[0], room, 5_000_000n)], [users[0]]);
    expect('create_room at an address holding lamports', 'create_room', await h.send([G.ix('create_room', { id: 5n, asset: 0, min_tier: 1, name: Buffer.alloc(32) }, { creator: creator.publicKey, room, pof_config: K.config })], [creator]), null);
    const x = await mk(); await W.certify(x.ctl, x.a);
    await h.send([W.transfer(users[0], W.memberPda(room, x.a.subject_hash), 50_000_000n)], [users[0]]);
    expect('join at a member address holding lamports', 'join', await h.send([W.joinIx(x.ctl, x.ctl, room, x.a.subject_hash)], [x.ctl]), null);
  }
  // 5. a donation to the treasury: withdraw_fees(0) takes it as fees
  {
    const t0 = await W.treasury();
    await h.send([W.transfer(users[0], K.treasury, 7_000_000_000n)], [users[0]]);
    const d0 = await h.lam(W.dev.publicKey);
    expect('withdraw_fees(0) after a treasury donation', 'withdraw_fees', await h.send([P.ix('withdraw_fees', { lamports: 0n }, { admin: W.admin.publicKey, dev: W.dev.publicKey })], [W.admin]), null);
    const t1 = await W.treasury(), d1 = await h.lam(W.dev.publicKey);
    note(`treasury donation of 7 SOL: the dev received ${d1 - d0}; fees_out ${t1.fees_out} vs fees_in ${t1.fees_in} (fees_out may exceed fees_in by donations)`);
    await W.invariants('treasury donation');
  }
}
