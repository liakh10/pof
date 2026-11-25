// Suite "revoke": revoke_spent's two proofs against forged accounts and forged paths.
// (a) the nullifier PDA: the real spend shape under tree 0; an unspent nullifier; five look-alikes at the right address; the PDA
//     of another nullifier; no account; a tree that is not the Privacy Program's; and the PDA under a Privacy Program account that
//     is NOT tree 0 (a forged tree, the protocol config): accepted, since only the owner of `tree` is checked.
// (b) the membership path in the synthetic indexed tree (FT): every leaf (indexes 0, 1, 2, 3, 77, 2^39+12345, 2^40-1) with its
//     40-level path; every path length 0..41; each sibling level flipped; each leaf-index bit flipped; index >= 2^40; next flipped;
//     a sibling >= the field modulus; a level-1 node presented as a leaf; the later root at history index 99; look-alike trees
//     (discriminator 0, one byte short, system-owned); the real mainnet path in tree 0 (16 levels in a legacy-size transaction).
import fs from 'node:fs';
import path from 'node:path';
import { PROG, PublicKey, foldPath, poseidonReady } from '../lib/core.mjs';
import { sendV1 } from './cu.mjs';

export async function revoke(W, o = {}) {
  const { h, R, users, expect, note, fx, K } = W;
  await poseidonReady();
  W.suite('revoke');
  // 187914b pinned Rings tree 0 in every spent proof (fuzz finding FZ-03); before it any Privacy Program account served as the tree
  const pinned = 'revoke_spent_staged' in W.P.ixs;
  const caller = users[4];
  const hex = s => Buffer.from(s, 'hex');
  /** a live certificate whose notes are the given nullifiers (badge subject, self-paid) */
  async function live(nfs) {
    const badge = W.kp(); await h.fund([badge], 5);
    const n = W.notesOf(nfs.length, nfs.map(x => Buffer.from(x)));
    const a = await W.att({ kind: 2, ctlKp: badge, n: nfs.length, null_hashes: n.hashes });
    const r = await W.certify(badge, a);
    if (!r.ok) throw Error('setup certify: ' + r.why);
    return { a, n, sh: a.subject_hash, badge };
  }
  // a path too long for 1,232 bytes goes in a version 1 transaction (simulated through @solana/kit)
  let v1n = 0;
  const simAny = async (ixs, signers) => { const r = await h.sim(ixs, signers); if (r.why !== 'TxTooLarge') return r; v1n++; const v = await sendV1(W, ixs, signers, { simulate: true }); if (!v.ok && /too large/.test(v.why || '')) return { ...v, why: 'TxTooLarge(v1)', pofUnits: [] }; return { ...v, v1: true }; };
  const rv = (L, nf, opts = {}) => {
    const e = L.n.of(nf);
    return simAny([W.revokeSpentIx(caller, L.sh, 0, opts.index ?? L.n.index(nf), opts.salt ?? e.salt, opts.nf ?? Buffer.from(nf), opts)], [caller]);
  };
  /* (a) */
  const spent = fx.spent0.map(hex);
  const look = fx.lookAlikes.map(l => ({ ...l, nf: hex(l.nf) }));
  const unspent = R.field();
  const A = await live([spent[0], spent[1], unspent, ...look.map(l => l.nf)]);   // 8 notes
  const r0 = await rv(A, spent[0]);
  expect('(a) the PDA a real spend leaves', 'revoke_spent', r0, null);
  W.cu('revoke_spent (PDA)', r0.pofUnits[0], r0.size);
  expect('(a) an unspent nullifier (no account)', 'revoke_spent', await rv(A, unspent), 'NotSpent');
  for (const l of look) expect(`(a) look-alike: ${l.why}`, 'revoke_spent', await rv(A, l.nf), 'NotSpent');
  expect('(a) the PDA of another nullifier', 'revoke_spent', await rv(A, spent[0], { nfAccount: W.nfPda(K.tree0, spent[1]) }), 'BadRingsAccounts');
  expect('(a) no nullifier account', 'revoke_spent', await rv(A, spent[0], { nfAccount: null }), 'BadRingsAccounts');
  expect('(a) tree = a system-owned copy of the tree', 'revoke_spent', await rv(A, spent[0], { tree: new PublicKey(fx.ftSys) }), 'BadRingsAccounts');
  expect('(a) tree = a random key', 'revoke_spent', await rv(A, spent[0], { tree: W.kp().publicKey }), 'BadRingsAccounts');
  expect('(a) wrong salt', 'revoke_spent', await rv(A, spent[0], { salt: R.bytes(32) }), 'NullifierMismatch');
  expect('(a) the right pair at another index', 'revoke_spent', await rv(A, spent[0], { index: (A.n.index(spent[0]) + 1) % 8 }), 'NullifierMismatch');
  expect('(a) index 8 (= note_count)', 'revoke_spent', await rv(A, spent[0], { index: 8 }), 'BadIndex');
  expect('(a) index 255', 'revoke_spent', await rv(A, spent[0], { index: 255 }), 'BadIndex');
  const B = await live([hex(fx.spentFT), hex(fx.spentConf)]);
  const rFT = await rv(B, hex(fx.spentFT), { tree: K.ft });
  expect('(a) a spent PDA under a FORGED tree account (owner = Privacy Program, not tree 0)', 'revoke_spent', rFT, pinned ? 'BadRingsAccounts' : null);
  const rConf = await rv(B, hex(fx.spentConf), { tree: new PublicKey(fx.protocolConfig) });
  expect('(a) a spent PDA under the protocol config (a Privacy Program account that is no tree)', 'revoke_spent', rConf, pinned ? 'BadRingsAccounts' : null);
  note(pinned ? 'tree 0 is pinned: a forged tree and the protocol config are refused as `tree`' : 'the `tree` account is checked for its owner only: any Privacy Program account (a tree, the protocol config, a nullifier PDA) serves as the PDA seed of path (a) and, with byte 0 == 1, as the root source of path (b)');

  /* (b) */
  const leaves = fx.leaves.map(l => ({ index: BigInt(l.index), value: hex(l.value), next: hex(l.next), deep: l.deep, path: l.path.map(hex) }));
  const late = { index: BigInt(fx.late.index), value: hex(fx.late.value), next: hex(fx.late.next), path: fx.late.path.map(hex) };
  const internal = { value: hex(fx.internal.value), next: hex(fx.internal.next), path: fx.internal.path.map(hex) };
  const C = await live([...leaves.map(l => l.value), late.value]);
  const zeros = fx.zeros.map(hex);
  const roots = [fx.r1, fx.r2, fx.r3].map(x => BigInt('0x' + x));
  const inRoots = root => roots.includes(BigInt('0x' + root.toString('hex')));
  // the shortest path a leaf needs (upper levels that are empty subtrees left out)
    const shortest = l => { let k = 40; while (k > 0 && l.path[k - 1].equals(zeros[k - 1])) k--; return l.path.slice(0, k); };
  const mem = (L, l, m = {}) => rv(L, l.value, { tree: m.tree ?? K.tree0, membership: { leaf_index: m.index ?? l.index, next_value: m.next ?? l.next, path: m.path ?? shortest(l) } });
  let tooLarge = 0;
  for (const l of [...leaves, late]) {
    const p = shortest(l);
    const r = await mem(C, l, { path: p });
    if (r.why && r.why.startsWith('TxTooLarge')) tooLarge++;
    expect(`(b) leaf ${l.index}, its shortest path (${p.length} levels)`, 'revoke_spent', r, l.deep ? [null, 'TxTooLarge', 'TxTooLarge(v1)'].includes(r.why) ? (r.ok ? null : r.why) : null : null);
    if (r.ok) W.cu(`revoke_spent (membership, ${p.length} levels)`, r.pofUnits[0], r.size);
  }
  note(`deep leaves (index >= 2^30) need a path of 39-40 levels: ${tooLarge} of them could not be submitted at all on this validator (a v1 transaction over 1,232 bytes is refused by its RPC)`);
  // every path length: the program fills the missing upper levels with empty subtrees; the outcome must match a JS fold
  let lens = 0;
  for (const l of [leaves[0], leaves[4]]) for (let k = 0; k <= 41; k++) {
    const p = l.path.slice(0, Math.min(k, 40)); if (k === 41) p.push(zeros[0]);
    const want = k > 40 ? 'NotSpent' : (inRoots(foldPath(l.value, l.next, l.index, p)) ? null : 'NotSpent');
    const r = await mem(C, l, { path: p });
    expect(`(b) leaf ${l.index}, path length ${k}`, 'revoke_spent', r, r.why && r.why.startsWith('TxTooLarge') ? r.why : want); lens++;
    if (r.why && r.why.startsWith('TxTooLarge') && !W.maxPath) W.maxPath = k - 1;
    if (k === 16 && want === null) W.cu('revoke_spent (membership, 16 levels)', r.pofUnits[0], r.size);
  }
  let flips = 0;
  for (const l of [leaves[2], leaves[4]]) {
    for (let lv = 0; lv < 40; lv++) { const p = l.path.slice(0, Math.max(shortest(l).length, lv + 1)).map(x => Buffer.from(x)); p[lv][31] ^= 1; const r = await mem(C, l, { path: p }); expect(`(b) leaf ${l.index}: sibling at level ${lv} flipped`, 'revoke_spent', r, ['NotSpent', 'TxTooLarge', 'TxTooLarge(v1)']); flips++; }
    for (let b = 0; b < 40; b++) { expect(`(b) leaf ${l.index}: index bit ${b} flipped`, 'revoke_spent', await mem(C, l, { index: l.index ^ (1n << BigInt(b)) }), 'NotSpent'); flips++; }
  }
  expect('(b) leaf index 2^40 + the real index', 'revoke_spent', await mem(C, leaves[0], { index: leaves[0].index | (1n << 40n) }), 'NotSpent');
  expect('(b) leaf index u64::MAX', 'revoke_spent', await mem(C, leaves[0], { index: (1n << 64n) - 1n, path: shortest(leaves[0]) }), 'NotSpent');
  { const nx = Buffer.from(leaves[1].next); nx[31] ^= 1; expect('(b) next value flipped', 'revoke_spent', await mem(C, leaves[1], { next: nx }), 'NotSpent'); }
  { const p = leaves[3].path.slice(0, 8).map(x => Buffer.from(x)); p[5] = Buffer.alloc(32, 0xff); expect('(b) a sibling >= the field modulus', 'revoke_spent', await mem(C, leaves[3], { path: p }), 'NotSpent'); }
  { const nx = Buffer.alloc(32, 0xff); expect('(b) next value >= the field modulus', 'revoke_spent', await mem(C, leaves[3], { next: nx }), 'NotSpent'); }
  {
    const D = await live([internal.value]);
    let k = internal.path.length; while (k > 0 && internal.path[k - 1].equals(zeros[k])) k--;
    const r = await rv(D, internal.value, { tree: K.tree0, membership: { leaf_index: 0n, next_value: internal.next, path: internal.path.slice(0, k) } });
    expect('(b) a level-1 node presented as a leaf (39-level path)', 'revoke_spent', r, 'NotSpent');
  }
  for (const [name, t] of [['discriminator 0', fx.ftDisc0], ['one byte short', fx.ftShort], ['system-owned', fx.ftSys]]) {
    expect(`(b) look-alike tree: ${name}`, 'revoke_spent', await mem(C, leaves[0], { tree: new PublicKey(t) }), 'BadRingsAccounts');
  }
  expect('(b) the right path against the forged tree FT (which holds the same roots)', 'revoke_spent', await mem(C, leaves[0], { tree: K.ft }), pinned ? 'BadRingsAccounts' : null);
  {
    // membership given AND a nullifier account: the path decides, the account is ignored
    const l = leaves[1];
    const r = await simAny([W.revokeSpentIx(caller, C.sh, 0, C.n.index(l.value), C.n.of(l.value).salt, l.value, { tree: K.tree0, membership: { leaf_index: l.index, next_value: l.next, path: shortest(l) }, nfAccount: W.nfPda(K.tree0, spent[2]) })], [caller]);
    expect('(b) path plus an unrelated nullifier account', 'revoke_spent', r, null);
  }
  /* the real mainnet nullifier of the suite's fixture, its path in tree 0's cloned nullifier root history */
  {
    const MF = JSON.parse(fs.readFileSync(path.join(PROG, 'test/fixtures/membership.json'), 'utf8'));
    const nf = hex(MF.nullifier);
    const E = await live([nf]);
    const m = { leaf_index: BigInt(MF.leafIndex), next_value: hex(MF.next), path: MF.path.slice(0, MF.emptyFrom).map(hex) };
    const r = await h.sim([W.revokeSpentIx(caller, E.sh, 0, 0, E.n.list[0].salt, nf, { membership: m })], [caller]);
    expect(`(b) the real mainnet path, ${m.path.length} levels`, 'revoke_spent', r, null);
    W.results.sizes['revoke_spent membership, real path ' + m.path.length + ' levels (v0, 1 signer)'] = r.size;
    const full = { ...m, path: MF.path.map(hex) };
    const rf = await h.sim([W.revokeSpentIx(caller, E.sh, 0, 0, E.n.list[0].salt, nf, { membership: full })], [caller]);
    expect('(b) the real mainnet path, all 40 levels, in a v0 transaction', 'revoke_spent', rf, 'TxTooLarge');
    const rv1 = await simAny([W.revokeSpentIx(caller, E.sh, 0, 0, E.n.list[0].salt, nf, { membership: full })], [caller]);
    expect('(b) the real mainnet path, all 40 levels, in a v1 transaction (simulated)', 'revoke_spent', rv1, rv1.why === 'TxTooLarge(v1)' ? 'TxTooLarge(v1)' : null);
    note(`the real 40-level path in a v1 transaction: ${rv1.ok ? 'simulates ok' : rv1.why} (${rv1.size} bytes)`);
    W.real40 = { E, full, nf };
  }
  note(`(b) ${lens} path-length cases, ${flips} single-bit path and index mutations; ${v1n} cases needed a version 1 transaction`);
}
