// Suite "machine": a seeded random walk over certify, renew, revoke_spent, revoke_by_holder, expire, join, evict, leave, lamport
// donations and waits, on a small pool of subjects (so the same certificate is hit again and again in every state), with short
// validities so expiry happens all the time. A model predicts every outcome, evaluated at the slot the transaction actually landed
// in (from its status), and the invariants over every account run every few steps.
export async function machine(W, o = {}) {
  const { h, R, P, G, K, users, expect, note } = W;
  W.suite('machine');
  const age = Number((await W.config()).params.max_attest_age);
  const creator = users[8];
  const roomId = 9000n + BigInt(R.int(1000));
  const room = W.roomPda(creator.publicKey, roomId);
  await h.send([G.ix('create_room', { id: roomId, asset: 0, min_tier: 2, name: Buffer.alloc(32) }, { creator: creator.publicKey, room, pof_config: K.config })], [creator]);
  const payers = users.slice(0, 4);
  const spentPool = W.fx.spent0.slice(6).map(s => Buffer.from(s, 'hex'));
  const subs = [];
  for (let i = 0; i < (o.subjects ?? 6); i++) { const ctl = W.kp(); await h.fund([ctl], 20); subs.push({ ctl, sh: W.keySubject(2, ctl.publicKey), m: null, member: null }); }
  const counts = {};
  const steps = o.steps ?? 300;
  for (let i = 0; i < steps; i++) {
    const s = R.pick(subs);
    const op = R.pick(['certify', 'certify', 'certify', 'renew', 'revoke_holder', 'revoke_spent', 'expire', 'expire', 'join', 'evict', 'leave', 'donate', 'wait']);
    counts[op] = (counts[op] || 0) + 1;
    const m = s.m;   // model: { status, issued, expiry, payer, tier, n (notes), spentIdx }
    const live = slot => m && m.status === 0 && BigInt(slot) <= m.expiry;
    if (op === 'certify') {
      const stale = R.bool(0.1);
      const now = await h.slotNow();
      const useSpent = R.bool(0.3);
      const nfs = [useSpent ? R.pick(spentPool) : R.field(), R.field()];
      const n = W.notesOf(2, nfs);
      const tier = R.range(1, 4);
      const a = await W.att({ kind: 2, ctlKp: s.ctl, null_hashes: n.hashes, tier, valid: R.range(12, 60), issued_slot: stale ? now - age - 20 : now - 1 });
      const payer = R.pick(payers);
      const prior = m && m.payer !== payer.publicKey.toBase58() ? new (await import('../lib/core.mjs')).PublicKey(m.payer) : null;
      const r = await h.send(W.certifyIxs(payer, a, { prior }), [payer]);
      const want = stale ? 'AttestationStale' : !m ? null : live(r.slot) ? 'AlreadyLive' : BigInt(a.issued_slot) <= m.issued ? 'Replayed' : null;
      expect(`#${i} certify (${stale ? 'stale' : 'fresh'}, ${m ? (live(r.slot) ? 'over live' : 'over dead') : 'new'})`, 'certify', r, want);
      if (r.ok) s.m = { status: 0, issued: BigInt(a.issued_slot), expiry: BigInt(a.expiry_slot), payer: payer.publicKey.toBase58(), tier, n, spentIdx: useSpent ? n.index(nfs[0]) : -1, spentNf: nfs[0] };
    } else if (op === 'renew') {
      if (!m) continue;
      const a = await W.att({ kind: 2, ctlKp: s.ctl, null_hashes: m.n.hashes, tier: R.range(1, 4), valid: R.range(12, 60) });
      const payer = R.pick(payers);
      const r = await h.send(W.certifyIxs(payer, a, { name: 'renew' }), [payer]);
      const want = m.status !== 0 ? 'NotLive' : !live(r.slot) ? 'CertificateExpired' : BigInt(a.issued_slot) <= m.issued ? 'Replayed' : null;
      expect(`#${i} renew`, 'renew', r, want);
      if (r.ok) { m.issued = BigInt(a.issued_slot); m.expiry = BigInt(a.expiry_slot); m.tier = a.tier; }
    } else if (op === 'revoke_holder') {
      if (!m) continue;
      const right = R.bool(0.8);
      const ctl = right ? s.ctl : R.pick(payers);
      const r = await h.send([W.revokeHolderIx(ctl, s.sh)], [ctl]);
      expect(`#${i} revoke_by_holder (${right ? 'controller' : 'stranger'})`, 'revoke_by_holder', r, !right ? 'NotController' : m.status !== 0 ? 'NotLive' : null);
      if (r.ok) m.status = 2;
    } else if (op === 'revoke_spent') {
      if (!m) continue;
      const has = m.spentIdx >= 0;
      const nf = has ? m.spentNf : m.n.list[0].nf;
      const e = m.n.of(nf);
      const r = await h.send([W.revokeSpentIx(users[9], s.sh, 0, m.n.index(nf), e.salt, nf)], [users[9]]);
      expect(`#${i} revoke_spent (${has ? 'spent note' : 'unspent note'})`, 'revoke_spent', r, !has ? 'NotSpent' : m.status !== 0 ? 'NotLive' : null);
      if (r.ok) m.status = 1;
    } else if (op === 'expire') {
      if (!m) { const r = await h.send([W.expireIx(users[9], s.sh, 0, users[9].publicKey)], [users[9]]); expect(`#${i} expire (no account)`, 'expire', r, '*'); continue; }
      const r = await h.send([W.expireIx(users[9], s.sh, 0, new (await import('../lib/core.mjs')).PublicKey(m.payer))], [users[9]]);
      expect(`#${i} expire`, 'expire', r, BigInt(r.slot ?? 0) > m.expiry ? null : 'NotExpired');
      if (r.ok) s.m = null;
    } else if (op === 'join') {
      const r = await h.send([W.joinIx(s.ctl, s.ctl, room, s.sh)], [s.ctl]);
      const want = s.member ? '*' : !m ? 'BadCertificate' : m.status !== 0 ? 'NotLive' : !live(r.slot) ? 'CertificateExpired' : m.tier < 2 ? 'TierTooLow' : null;
      expect(`#${i} join`, 'join', r, want);
      if (r.ok) s.member = (await W.decode(G, 'Member', W.memberPda(room, s.sh)));
    } else if (op === 'evict') {
      if (!s.member) continue;
      const r = await h.send([W.evictIx(users[9], room, s.sh, s.member)], [users[9]]);
      const good = m && m.status === 0 && live(r.slot) && m.tier >= 2;
      expect(`#${i} evict (${good ? 'still good' : 'dead or low'})`, 'evict', r, good ? 'StillValid' : null);
      if (r.ok) s.member = null;
    } else if (op === 'leave') {
      if (!s.member) continue;
      const r = await h.send([G.ix('leave', {}, { controller: s.ctl.publicKey, room, member: W.memberPda(room, s.sh), payer: s.ctl.publicKey })], [s.ctl]);
      expect(`#${i} leave`, 'leave', r, null);
      if (r.ok) s.member = null;
    } else if (op === 'donate') {
      await h.send([W.transfer(users[9], W.certPda(s.sh, 0), BigInt(R.pick([1, 1000, 5_000_000, 1_000_000_000])))], [users[9]]);
    } else await h.waitSlot((await h.slotNow()) + R.range(5, 40));
    if (i % (o.every ?? 15) === 0) await W.invariants('step ' + i);
  }
  await W.invariants('end');
  note(`${steps} random steps over ${subs.length} subjects: ${JSON.stringify(counts)}`);
}
