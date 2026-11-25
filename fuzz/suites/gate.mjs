// Suite "gate": pof_gate rooms against revoked, expired, closed and re-issued certificates, and the hostile program
// (fuzz/hostile): a fake POF answering require_certificate, a consumer that does not pin POF, a careful consumer comparing the CPI
// answer with a direct read, certify through a CPI with a PDA payer (once and twice under one signature), and a program-controlled
// certificate that joins a room and revokes itself between two checks in one instruction.
import { web3, PublicKey, TransactionInstruction } from '../lib/core.mjs';
import crypto from 'node:crypto';

const disc = name => crypto.createHash('sha256').update('global:' + name).digest().subarray(0, 8);

export async function gate(W, o = {}) {
  const { h, R, P, G, K, HOSTILE, users, expect, note } = W;
  W.suite('gate');
  const creator = users[8];
  const name = Buffer.alloc(32);
  let id = 1000n + BigInt(R.int(1000));
  const newRoom = async (tier = 1, asset = 0) => { id++; const room = W.roomPda(creator.publicKey, id); const r = await h.send([G.ix('create_room', { id, asset, min_tier: tier, name }, { creator: creator.publicKey, room, pof_config: K.config })], [creator]); if (!r.ok) throw Error('room ' + r.why); return room; };
  const mk = async (o2 = {}) => {
    const ctl = W.kp(); await h.fund([ctl], 5);
    const n = W.notesOf(2);
    const a = await W.att({ kind: o2.kind ?? 2, ctlKp: ctl, controller: o2.controller, handle: o2.handle, null_hashes: n.hashes, tier: o2.tier ?? 2, valid: o2.valid ?? 500, asset: o2.asset ?? 0 });
    if (o2.certify !== false) { const r = await W.certify(o2.payer ?? ctl, a); if (!r.ok) throw Error('certify ' + r.why); }
    return { ctl, n, a, sh: a.subject_hash };
  };
  const join = (x, room, o2 = {}) => h.send([W.joinIx(o2.ctl ?? x.ctl, o2.payer ?? x.ctl, room, x.sh, o2.asset ?? 0, o2)], [o2.payer ?? x.ctl, ...(o2.ctl && o2.ctl.secretKey ? [o2.ctl] : [x.ctl])]);
  const evict = async (room, sh) => { const m = await W.decode(G, 'Member', W.memberPda(room, sh)); return h.send([W.evictIx(users[0], room, sh, m)], [users[0]]); };
  const room = await newRoom(2);
  // the room's door against every certificate state
  { const x = await mk({ tier: 1 }); expect('join below the room tier', 'join', await join(x, room), 'TierTooLow'); }
  { const x = await mk(); await h.send([W.revokeHolderIx(x.ctl, x.sh)], [x.ctl]); expect('join with a revoked certificate', 'join', await join(x, room), 'NotLive'); }
  { const x = await mk({ valid: 12 }); await h.waitSlot(BigInt(x.a.expiry_slot) + 1n); expect('join with an expired, unclosed certificate', 'join', await join(x, room), 'CertificateExpired');
    await h.send([W.expireIx(users[0], x.sh, 0, x.ctl.publicKey)], [users[0]]); expect('join with a closed certificate', 'join', await join(x, room), 'BadCertificate'); }
  { const x = await mk({ asset: 1 }); expect('join a SOL room with a USDC certificate', 'join', await join(x, room, { asset: 1 }), 'BadCertificate'); }
  { const x = await mk({ certify: false }); expect('join with no certificate', 'join', await join(x, room), 'BadCertificate'); }
  { const x = await mk(); const y = await mk(); expect('join with another subject\'s certificate account', 'join', await join(x, room, { certificate: W.certPda(y.sh, 0) }), 'BadCertificate'); }
  { const x = await mk(); expect('join signed by a key that is not the controller', 'join', await join(x, room, { ctl: users[2] }), 'NotController'); }
  // re-issued certificates: the same controller keeps the seat; another controller makes it evictable
  {
    const handle = 'reissue' + R.bytes(3).toString('hex');
    const k1 = W.kp(), k2 = W.kp(); await h.fund([k1, k2], 2);
    const n = W.notesOf(2);
    const a1 = await W.att({ kind: 1, handle, controller: k1.publicKey, null_hashes: n.hashes, tier: 3 });
    await W.certify(users[3], a1);
    const x = { ctl: k1, sh: a1.subject_hash };
    expect('join (X handle, controller k1)', 'join', await join(x, room), null);
    expect('evict while live', 'evict', await evict(room, x.sh), 'StillValid');
    await h.send([W.revokeHolderIx(k1, x.sh)], [k1]);
    const a2 = await W.att({ kind: 1, handle, controller: k1.publicKey, null_hashes: W.notesOf(2).hashes, tier: 2 });
    await W.certify(users[3], a2);
    expect('re-issued with the same controller at a tier the room still takes: the seat stays', 'evict', await evict(room, x.sh), 'StillValid');
    note('a member whose certificate was revoked and re-issued (same controller) before anyone evicted keeps the seat: the room checks the certificate now, not its history');
    await h.send([W.revokeHolderIx(k1, x.sh)], [k1]);
    const a3 = await W.att({ kind: 1, handle, controller: k2.publicKey, null_hashes: W.notesOf(2).hashes, tier: 3 });
    await W.certify(users[3], a3);
    expect('re-issued live with another controller: the old seat is evictable', 'evict', await evict(room, x.sh), null);
    expect('the new controller joins', 'join', await join({ ctl: k2, sh: x.sh }, room), null);
    await h.send([W.revokeHolderIx(k2, x.sh)], [k2]);
    const a4 = await W.att({ kind: 1, handle, controller: k2.publicKey, null_hashes: W.notesOf(2).hashes, tier: 1 });
    await W.certify(users[3], a4);
    expect('re-issued below the room tier: evictable', 'evict', await evict(room, x.sh), null);
  }
  // the creator's controls
  {
    const r2 = await newRoom(1);
    const x = await mk({ tier: 2 }); await join(x, r2);
    expect('close a room with a member', 'close_room', await h.send([G.ix('close_room', {}, { creator: creator.publicKey, room: r2 })], [creator]), 'MembersLeft');
    expect('release a room while POF is not winding down', 'release_room', await h.send([G.ix('release_room', {}, { caller: users[0].publicKey, room: r2, creator: creator.publicKey, pof_config: K.config })], [users[0]]), ['NotClosing', 'MembersLeft']);
    expect('set_room by someone else', 'set_room', await h.send([G.ix('set_room', { min_tier: 3, open: true, name }, { creator: users[0].publicKey, room: r2, pof_config: K.config })], [users[0]]), '*');
    for (const t of [0, 6, 255]) expect(`set_room tier ${t}`, 'set_room', await h.send([G.ix('set_room', { min_tier: t, open: true, name }, { creator: creator.publicKey, room: r2, pof_config: K.config })], [creator]), 'BadTier');
    expect('set_room with a fake POF config', 'set_room', await h.send([G.ix('set_room', { min_tier: 3, open: true, name }, { creator: creator.publicKey, room: r2, pof_config: K.treasury })], [creator]), 'BadPofConfig');
    expect('shut the door', 'set_room', await h.send([G.ix('set_room', { min_tier: 1, open: false, name }, { creator: creator.publicKey, room: r2, pof_config: K.config })], [creator]), null);
    { const y = await mk({ tier: 2 }); expect('join a shut room', 'join', await join(y, r2), 'RoomShut'); }
    expect('raise the tier to 3', 'set_room', await h.send([G.ix('set_room', { min_tier: 3, open: true, name }, { creator: creator.publicKey, room: r2, pof_config: K.config })], [creator]), null);
    expect('the tier-2 member is now evictable', 'evict', await evict(r2, x.sh), null);
    expect('leave by a non-member key', 'leave', await h.send([G.ix('leave', {}, { controller: users[0].publicKey, room: r2, member: W.memberPda(r2, x.sh), payer: x.ctl.publicKey })], [users[0]]), '*');
    for (const [a, t] of [[2, 1], [3, 1], [4, 1], [0, 0], [0, 6]]) expect(`create_room asset ${a} tier ${t}`, 'create_room', await h.send([G.ix('create_room', { id: 5000n + BigInt(a * 10 + t), asset: a, min_tier: t, name }, { creator: creator.publicKey, room: W.roomPda(creator.publicKey, 5000n + BigInt(a * 10 + t)), pof_config: K.config })], [creator]), a === 2 && t === 1 && W.asset2 ? null : ['BadTier', '*']);
  }
  /* the hostile program */
  const HP = HOSTILE;
  const hix = (name, args, keys) => new TransactionInstruction({ programId: HP, keys, data: Buffer.concat([disc(name), ...args]) });
  const ro = k => ({ pubkey: new PublicKey(k), isSigner: false, isWritable: false });
  const rw = k => ({ pubkey: new PublicKey(k), isSigner: false, isWritable: true });
  const req = (sh, asset, tier) => [Buffer.from(sh), Buffer.from([asset, tier])];
  {
    const x = await mk({ tier: 2 });
    const fakeJoin = await h.send([W.joinIx(x.ctl, x.ctl, room, x.sh, 0, { pofProgram: HP })], [x.ctl]);
    expect('pof_gate join with the fake POF as pof_program', 'join', fakeJoin, ['InvalidProgramId', 'ConstraintAddress', '*']);
    const naiveFake = await h.sim([hix('naive_gate', req(W.R.bytes(32), 0, 5), [ro(W.kp().publicKey), ro(K.config), ro(HP)])], [users[0]]);
    const ev = naiveFake.ok ? (naiveFake.logs || []).find(l => l.startsWith('Program data:')) : null;
    note(`a consumer that does not pin POF (hostile naive_gate) asked the FAKE POF about a random subject: ${naiveFake.ok ? 'it answered yes, tier 5' : 'refused: ' + naiveFake.why}. pof_gate pins POF (Program<Pof>) and is not exposed; integrators must pin it too`);
    W.results.suites.gate.cases++;
    expect('naive consumer, real POF, live certificate', 'require_certificate', await h.sim([hix('naive_gate', req(x.sh, 0, 2), [ro(W.certPda(x.sh, 0)), ro(K.config), ro(P.programId)])], [users[0]]), null);
    expect('careful consumer (probe): CPI == direct read on a live certificate', 'require_certificate', await h.sim([hix('probe', req(x.sh, 0, 2), [ro(W.certPda(x.sh, 0)), ro(K.config), ro(P.programId)])], [users[0]]), null);
    expect('probe at tier 3 (above)', 'require_certificate', await h.sim([hix('probe', req(x.sh, 0, 3), [ro(W.certPda(x.sh, 0)), ro(K.config), ro(P.programId)])], [users[0]]), 'TierTooLow');
    expect('probe with the config account as the certificate', 'require_certificate', await h.sim([hix('probe', req(x.sh, 0, 1), [ro(K.config), ro(K.config), ro(P.programId)])], [users[0]]), 'BadCertificate');
    expect('probe with the hostile program as POF', 'require_certificate', await h.sim([hix('probe', req(x.sh, 0, 1), [ro(W.certPda(x.sh, 0)), ro(K.config), ro(HP)])], [users[0]]), '*');
    await h.send([W.revokeHolderIx(x.ctl, x.sh)], [x.ctl]);
    expect('probe on the revoked certificate', 'require_certificate', await h.sim([hix('probe', req(x.sh, 0, 1), [ro(W.certPda(x.sh, 0)), ro(K.config), ro(P.programId)])], [users[0]]), 'NotLive');
  }
  // certify through a CPI, payer = hostile PDA ["payer"]
  {
    const payerPda = PublicKey.findProgramAddressSync([Buffer.from('payer')], HP)[0];
    await h.send([W.transfer(users[0], payerPda, 3_000_000_000n)], [users[0]]);
    const ctl = W.kp();
    const a = await W.att({ kind: 2, ctlKp: ctl });
    const msg = W.attBytes(a, payerPda, P.programId);
    const args = n => [P.codec.encode({ defined: { name: 'Attestation' } }, a), W.u64le(0), Buffer.from([n])];
    const keys = [rw(payerPda), ro(K.config), rw(K.treasury), rw(W.certPda(a.subject_hash, 0)), ro(payerPda), ro(web3.SYSVAR_INSTRUCTIONS_PUBKEY), ro(P.programId), ro(web3.SystemProgram.programId)];
    expect('certify through a CPI, twice under one signature', 'certify', await h.send([W.edIx(W.V, msg), hix('certify_cpi', args(2), keys)], [users[0]]), 'AlreadyLive');
    expect('certify through a CPI, no signature before the top-level instruction', 'certify', await h.send([hix('certify_cpi', args(1), keys)], [users[0]]), 'NoSignature');
    const r = await h.send([W.edIx(W.V, msg), hix('certify_cpi', args(1), keys)], [users[0]]);
    expect('certify through a CPI, once, payer a PDA', 'certify', r, null);
    note('certify through a CPI works with a program PDA as payer: POF reads the signature before the TOP-LEVEL instruction, so a router cannot reuse one signature for two certificates (the second fails), and the payer is still the one the Verifier signed');
  }
  // a program-controlled X certificate: join through a CPI, then revoke itself between two checks
  {
    const ctlPda = PublicKey.findProgramAddressSync([Buffer.from('ctl')], HP)[0];
    const mkX = async () => { const a = await W.att({ kind: 1, controller: ctlPda, tier: 2 }); const r = await W.certify(users[3], a); if (!r.ok) throw Error(r.why); return a; };
    const a = await mkX();
    const r = await h.send([hix('ctl_join', [Buffer.from(a.subject_hash)], [ro(ctlPda), { pubkey: users[0].publicKey, isSigner: true, isWritable: true }, rw(room), rw(W.memberPda(room, a.subject_hash)), ro(W.certPda(a.subject_hash, 0)), ro(K.config), ro(P.programId), ro(G.programId), ro(web3.SystemProgram.programId)])], [users[0]]);
    expect('a program PDA as controller joins a room through a CPI', 'join', r, null);
    const tk = (sh, tol) => hix('ctl_toctou', [Buffer.from(sh), Buffer.from([0, tol ? 1 : 0])], [ro(ctlPda), ro(K.config), rw(K.treasury), rw(W.certPda(sh, 0)), ro(P.programId)]);
    expect('ask, revoke, ask again in one instruction: the second ask fails', 'require_certificate', await h.send([tk(a.subject_hash, false)], [users[0]]), 'NotLive');
    expect('ask, revoke, read directly: the read says not live', 'revoke_by_holder', await h.send([tk(a.subject_hash, true)], [users[0]]), null);
    expect('the member of that revoked certificate is evictable at once', 'evict', await evict(room, a.subject_hash), null);
    await W.invariants('gate');
  }
}
