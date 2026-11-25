// Suite "staged" (187914b and later): the full-depth membership proof staged in a buffer PDA ["path", revoker, certificate]
// (open_path, stage_path, revoke_spent_staged, close_path).
// The real 40-level mainnet path and a synthetic deep leaf (index 2^40-1) staged over several transactions; partial staging;
// gaps, overflow and empty writes; another revoker writing, using or closing my buffer; a buffer of certificate A used for B;
// a nullifier with another note's path; a level rewritten wrong then right; buffer reuse after the revoke; renew, remake and
// revoke_by_holder while a buffer is open; rent back to the revoker exactly.
import fs from 'node:fs';
import path from 'node:path';
import { PROG, PublicKey, web3 } from '../lib/core.mjs';

export async function staged(W, o = {}) {
  const { h, R, P, K, users, expect, note, fx } = W;
  if (!P.ixs.open_path) { note('no staged path instructions in this snapshot'); return; }
  W.suite('staged');
  const hex = s => Buffer.from(s, 'hex');
  const bufPda = (rev, cert) => P.pda([Buffer.from('path'), new PublicKey(rev).toBuffer(), new PublicKey(cert).toBuffer()]);
  const open = (rev, cert, nf, next, idx, sibs) => P.ix('open_path', { nullifier: nf, next_value: next, leaf_index: idx, siblings: sibs }, { revoker: rev.publicKey, certificate: cert, buffer: bufPda(rev.publicKey, cert) });
  const stage = (rev, buf, offset, sibs) => P.ix('stage_path', { offset, siblings: sibs }, { revoker: rev.publicKey, buffer: buf });
  const revoke = (rev, cert, index, salt, o2 = {}) => P.ix('revoke_spent_staged', { index, salt }, { revoker: rev.publicKey, certificate: cert, tree: o2.tree ?? K.tree0, buffer: o2.buffer ?? bufPda(rev.publicKey, cert) });
  const close = (caller, buf, revoker) => P.ix('close_path', {}, { caller: caller.publicKey, buffer: buf, revoker });
  const live = async nfs => { const ctl = W.kp(); await h.fund([ctl], 5); const n = W.notesOf(nfs.length, nfs.map(x => Buffer.from(x))); const a = await W.att({ kind: 2, ctlKp: ctl, null_hashes: n.hashes }); const r = await W.certify(ctl, a); if (!r.ok) throw Error('certify ' + r.why); return { ctl, n, a, cert: W.certPda(a.subject_hash, 0) }; };
  /** stage a full path in chunks: open with the first `first` siblings, then stage_path in chunks of `chunk` */
  async function stageAll(rev, L, nf, next, idx, sibs, first = 16, chunk = 12) {
    const rs = [await h.send([open(rev, L.cert, nf, next, idx, sibs.slice(0, first))], [rev])];
    for (let at = first; at < sibs.length; at += chunk) rs.push(await h.send([stage(rev, bufPda(rev.publicKey, L.cert), at, sibs.slice(at, at + chunk))], [rev]));
    return rs;
  }
  const rev = W.kp(), other = W.kp(); await h.fund([rev, other], 20);
  const MF = JSON.parse(fs.readFileSync(path.join(PROG, 'test/fixtures/membership.json'), 'utf8'));
  const realNf = hex(MF.nullifier), realNext = hex(MF.next), realIdx = BigInt(MF.leafIndex), realPath = MF.path.map(hex);
  /* 1. the real 40-level path */
  {
    const L = await live([realNf, R.field()]);
    const b0 = await h.lam(rev.publicKey);
    const rs = await stageAll(rev, L, realNf, realNext, realIdx, realPath);
    rs.forEach((r, i) => expect(`real path: transaction ${i + 1} of ${rs.length}`, i ? 'stage_path' : 'open_path', r, null));
    W.cu('open_path (16 siblings)', rs[0].pofUnits[0], rs[0].size); W.cu('stage_path (12 siblings)', rs[1]?.pofUnits[0], rs[1]?.size);
    const e = L.n.of(realNf);
    expect('another revoker submits with my buffer', 'revoke_spent_staged', await h.sim([revoke(other, L.cert, L.n.index(realNf), e.salt, { buffer: bufPda(rev.publicKey, L.cert) })], [other]), '*');
    expect('the right buffer, a wrong salt', 'revoke_spent_staged', await h.sim([revoke(rev, L.cert, L.n.index(realNf), R.bytes(32))], [rev]), 'NullifierMismatch');
    expect('the right buffer, another note index', 'revoke_spent_staged', await h.sim([revoke(rev, L.cert, (L.n.index(realNf) + 1) % 2, e.salt)], [rev]), 'NullifierMismatch');
    expect('a forged tree account', 'revoke_spent_staged', await h.sim([revoke(rev, L.cert, L.n.index(realNf), e.salt, { tree: K.ft })], [rev]), 'BadRingsAccounts');
    const r = await h.send([revoke(rev, L.cert, L.n.index(realNf), e.salt)], [rev]);
    expect('revoke_spent_staged with the real 40-level mainnet path', 'revoke_spent_staged', r, null);
    W.cu('revoke_spent_staged (40 levels)', r.pofUnits[0], r.size);
    const b1 = await h.lam(rev.publicKey);
    note(`staged revoke: ${rs.length + 1} transactions of at most ${Math.max(...rs.map(x => x.size), r.size)} bytes; the revoker paid ${b0 - b1} lamports net (fees only: the buffer rent came back)`);
    expect('  buffer closed', 'revoke_spent_staged', { ok: !(await h.info(bufPda(rev.publicKey, L.cert))) }, null);
    expect('  revoker paid only signature fees', 'revoke_spent_staged', { ok: b0 - b1 === 5000n * BigInt(rs.length + 1), why: `paid ${b0 - b1}` }, null);
    expect('reopen a buffer on the revoked certificate', 'open_path', await h.sim([open(rev, L.cert, realNf, realNext, realIdx, [])], [rev]), 'NotLive');
  }
  /* 2. the synthetic deep leaf 2^40-1 (its root is in our copy of tree 0) */
  {
    const deep = fx.leaves.find(l => l.index === String((1n << 40n) - 1n));
    const nf = hex(deep.value);
    const L = await live([nf]);
    const sibs = deep.path.map(hex);
    // partial: only 30 levels staged -> not shown spent
    await h.send([open(rev, L.cert, nf, hex(deep.next), BigInt(deep.index), sibs.slice(0, 16))], [rev]);
    await h.send([stage(rev, bufPda(rev.publicKey, L.cert), 16, sibs.slice(16, 30))], [rev]);
    expect('deep leaf, 30 of 40 levels staged', 'revoke_spent_staged', await h.sim([revoke(rev, L.cert, 0, L.n.list[0].salt)], [rev]), 'NotSpent');
    expect('stage with a gap (offset 31 > 30 written)', 'stage_path', await h.sim([stage(rev, bufPda(rev.publicKey, L.cert), 31, sibs.slice(31, 33))], [rev]), 'BadIndex');
    expect('stage past level 40', 'stage_path', await h.sim([stage(rev, bufPda(rev.publicKey, L.cert), 30, sibs.slice(30, 40).concat([sibs[0]]))], [rev]), 'BadIndex');
    expect('stage nothing', 'stage_path', await h.sim([stage(rev, bufPda(rev.publicKey, L.cert), 30, [])], [rev]), 'BadIndex');
    expect('another key stages into my buffer', 'stage_path', await h.sim([stage(other, bufPda(rev.publicKey, L.cert), 30, sibs.slice(30, 40))], [other]), 'NotPayer');
    // a wrong level 35, then rewritten right
    const bad = sibs.slice(30, 40).map(x => Buffer.from(x)); bad[5][31] ^= 1;
    await h.send([stage(rev, bufPda(rev.publicKey, L.cert), 30, bad)], [rev]);
    expect('all 40 levels, level 35 wrong', 'revoke_spent_staged', await h.sim([revoke(rev, L.cert, 0, L.n.list[0].salt)], [rev]), 'NotSpent');
    await h.send([stage(rev, bufPda(rev.publicKey, L.cert), 35, [sibs[35]])], [rev]);
    expect('level 35 rewritten right: the deep leaf revokes', 'revoke_spent_staged', await h.send([revoke(rev, L.cert, 0, L.n.list[0].salt)], [rev]), null);
  }
  /* 3. buffers and certificates mixed up */
  {
    const nfA = hex(fx.leaves[0].value), nfB = hex(fx.leaves[1].value);
    const A = await live([nfA]), B = await live([nfB]);
    const pA = fx.leaves[0].path.map(hex).slice(0, 16), pB = fx.leaves[1].path.map(hex).slice(0, 16);
    await h.send([open(rev, A.cert, nfA, hex(fx.leaves[0].next), 0n, pA)], [rev]);
    expect('A\'s buffer named for B', 'revoke_spent_staged', await h.sim([revoke(rev, B.cert, 0, B.n.list[0].salt, { buffer: bufPda(rev.publicKey, A.cert) })], [rev]), '*');
    // B's buffer carrying A's (spent) nullifier and path: B's salted hash does not match
    await h.send([open(rev, B.cert, nfA, hex(fx.leaves[0].next), 0n, pA)], [rev]);
    expect('B\'s buffer with A\'s nullifier', 'revoke_spent_staged', await h.sim([revoke(rev, B.cert, 0, B.n.list[0].salt)], [rev]), 'NullifierMismatch');
    expect('close_path by a stranger (not winding down)', 'close_path', await h.sim([close(other, bufPda(rev.publicKey, B.cert), rev.publicKey)], [other]), 'NotPayer');
    expect('close_path naming another revoker for the rent', 'close_path', await h.sim([close(rev, bufPda(rev.publicKey, B.cert), other.publicKey)], [rev]), 'NotPayer');
    const c0 = await h.lam(rev.publicKey);
    expect('close_path by its revoker', 'close_path', await h.send([close(rev, bufPda(rev.publicKey, B.cert), rev.publicKey)], [rev]), null);
    note(`close_path returned ${(await h.lam(rev.publicKey)) - c0 + 5000n} lamports of buffer rent`);
    // a nullifier with another leaf's path
    await h.send([open(rev, B.cert, nfB, hex(fx.leaves[1].next), 1n, pA)], [rev]);
    expect('B\'s nullifier with A\'s path', 'revoke_spent_staged', await h.sim([revoke(rev, B.cert, 0, B.n.list[0].salt)], [rev]), 'NotSpent');
    await h.send([stage(rev, bufPda(rev.publicKey, B.cert), 0, pB)], [rev]);
    // interleave: renew B while the buffer is open, then revoke with it
    const rb = await W.att({ kind: 2, ctlKp: B.ctl, null_hashes: B.n.hashes });
    expect('renew B while a buffer is open', 'renew', await W.certify(B.ctl, rb, { name: 'renew' }), null);
    expect('the open buffer still revokes the renewed certificate', 'revoke_spent_staged', await h.send([revoke(rev, B.cert, 0, B.n.list[0].salt)], [rev]), null);
    // interleave: revoke_by_holder while a buffer is open, then remake with other notes
    await h.send([open(rev, A.cert, nfA, hex(fx.leaves[0].next), 0n, pA)], [rev]).catch(() => {});
    await h.send([W.revokeHolderIx(A.ctl, A.a.subject_hash)], [A.ctl]);
    expect('buffer open, certificate revoked by its holder', 'revoke_spent_staged', await h.sim([revoke(rev, A.cert, 0, A.n.list[0].salt)], [rev]), 'NotLive');
    const n2 = W.notesOf(1);
    const ra = await W.att({ kind: 2, ctlKp: A.ctl, null_hashes: n2.hashes });
    expect('remake A with another note', 'certify', await W.certify(A.ctl, ra), null);
    expect('the old buffer (old note) on the remade certificate', 'revoke_spent_staged', await h.sim([revoke(rev, A.cert, 0, n2.list[0].salt)], [rev]), 'NullifierMismatch');
    const n3 = W.notesOf(1, [nfA]);
    await h.send([W.revokeHolderIx(A.ctl, A.a.subject_hash)], [A.ctl]);
    const ra2 = await W.att({ kind: 2, ctlKp: A.ctl, null_hashes: n3.hashes });
    await W.certify(A.ctl, ra2);
    expect('remade again with the SAME (spent) note, new salt: the old buffer revokes it', 'revoke_spent_staged', await h.send([revoke(rev, A.cert, 0, n3.list[0].salt)], [rev]), null);
    expect('open_path with 41 siblings', 'open_path', await h.sim([open(rev, B.cert, nfB, hex(fx.leaves[1].next), 1n, Array.from({ length: 41 }, () => Buffer.alloc(32)))], [rev]), ['BadIndex', 'TxTooLarge']);
  }
  await W.invariants('staged');
  W.openBuffer = async () => { const L = await live([R.field()]); const r = await h.send([open(rev, L.cert, R.field(), R.field(), 0n, [])], [rev]); return { L, buf: bufPda(rev.publicKey, L.cert), rev, ok: r.ok, close: () => close(rev, bufPda(rev.publicKey, L.cert), rev.publicKey) }; };
}
