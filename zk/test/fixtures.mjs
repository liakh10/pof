// Test fixtures: a sparse Rings-shaped state tree (height 32) and an indexed nullifier tree (height 40) built with the same
// Poseidon, a test ring and notes, and the paths the circuit takes. Paths and artifacts come from $POF_ZK_OUT (scratch) or setup/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPoseidon } from 'circomlibjs';
import * as Z from '../js/zk.js';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, '..');
const OUT = process.env.POF_ZK_OUT || '/Users/artem/Desktop/sol/scratchpad/pof-zk';
const pick = (...c) => c.find(f => fs.existsSync(f));
export const WASM = pick(path.join(root, 'setup/pof.wasm'), path.join(OUT, 'build/pof_js/pof.wasm'));
export const ZKEY = pick(path.join(root, 'setup/pof_final.zkey'), path.join(OUT, 'ceremony/pof_final.zkey'));
export const VKEY = pick(path.join(root, 'setup/verification_key.json'), path.join(OUT, 'ceremony/verification_key.json'));

let _P;
export async function poseidon() {
  if (_P) return _P;
  const p = await buildPoseidon();
  _P = xs => p.F.toObject(p(xs.map(BigInt)));
  return _P;
}

export function zeros(P, h) { const z = [0n]; for (let i = 0; i < h; i++) z.push(P([z[i], z[i]])); return z; }

/* a sparse binary Merkle tree: leaves by index, empty leaf 0 */
export class Sparse {
  constructor(P, height) { this.P = P; this.h = height; this.z = zeros(P, height); this.levels = [new Map()]; this.dirty = true; }
  set(i, v) { this.levels[0].set(BigInt(i), BigInt(v)); this.dirty = true; return this; }
  build() {
    if (!this.dirty) return;
    this.levels = [this.levels[0]];
    for (let l = 0; l < this.h; l++) {
      const cur = this.levels[l], up = new Map();
      for (const i of cur.keys()) {
        const p = i >> 1n;
        if (up.has(p)) continue;
        up.set(p, this.P([this.node(l, p * 2n, cur), this.node(l, p * 2n + 1n, cur)]));
      }
      this.levels.push(up);
    }
    this.dirty = false;
  }
  node(l, i, m = this.levels[l]) { return m.has(i) ? m.get(i) : this.z[l]; }
  root() { this.build(); return this.node(this.h, 0n); }
  path(i) { this.build(); const out = []; let k = BigInt(i); for (let l = 0; l < this.h; l++) { out.push(this.node(l, k ^ 1n)); k >>= 1n; } return out; }
}

/* an indexed tree in the Rings layout: leaf Poseidon(value, nextValue); element 0 is (0, max) at start */
export class Indexed {
  constructor(P, height = Z.NULL_H) { this.P = P; this.tree = new Sparse(P, height); this.items = [{ value: 0n, next: Z.FIELD - 1n }]; this.items.push({ value: Z.FIELD - 1n, next: 0n }); this.sync(); }
  sync() { this.items.forEach((it, i) => this.tree.set(i, this.P([it.value, it.next]))); }
  insert(v) {
    v = BigInt(v);
    const low = this.items.find(it => it.value < v && (v < it.next || it.next === 0n));
    if (!low) throw Error('already in the tree');
    this.items.push({ value: v, next: low.next });
    low.next = v;
    this.sync();
  }
  root() { return this.tree.root(); }
  nonInclusion(v) {
    v = BigInt(v);
    const i = this.items.findIndex(it => it.value < v && v < it.next);
    if (i < 0) return null;
    return { lowValue: this.items[i].value, nextValue: this.items[i].next, lowIndex: i, nullPath: this.tree.path(i) };
  }
  /* what a cheating prover would send for an element that is in the tree: the leaf just below it */
  lowOf(v) { v = BigInt(v); const i = this.items.findIndex(it => it.next === v); return { lowValue: this.items[i].value, nextValue: this.items[i].next, lowIndex: i, nullPath: this.tree.path(i) }; }
}

export const SOL_MINT = new Uint8Array(32);
export const ONE_SOL = 1_000_000_000n;

/* a ring, its notes in a state tree, an empty-ish nullifier tree, an escrow key: everything one proof needs */
export async function scenario({ amounts = [3n * ONE_SOL], minAmount = ONE_SOL, spent = [], ctx = 12345n, extraNullifiers = 3, leafBase = 64_160, seed = 0n, mint = SOL_MINT } = {}) {
  const P = await poseidon();
  const ownerKey = Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 255);
  const nk = 0x0badc0ffee0ddf00dn * 1_000_003n + 7n; // a 31-byte-ish secret
  const ring = { ownerKey, nk };
  const oid = Z.ownerId(P, ownerKey);
  const asset = Z.assetHash(P, mint);
  const state = new Sparse(P, Z.STATE_H);
  // some other people's leaves around ours
  for (let i = 0; i < 6; i++) state.set(leafBase - 6 + i, P([BigInt(i + 1), 99n]));
  const notes = amounts.map((amount, i) => {
    const blinding = P([BigInt(i + 1), 4242n + BigInt(seed)]);
    const leafIndex = leafBase + i * 3;
    const h = Z.noteHashes(P, { ownerId: oid, nk, asset, amount, blinding });
    state.set(leafIndex, h.commitment);
    return { amount, blinding, leafIndex, h };
  });
  const nulls = new Indexed(P);
  for (let i = 0; i < extraNullifiers; i++) nulls.insert(P([BigInt(i), 777n]));
  for (const i of spent) nulls.insert(notes[i].h.nullifier);
  const escrow = Z.escrowKeypair(987654321987654321n);
  const full = notes.map((n, i) => {
    const ni = nulls.nonInclusion(n.h.nullifier) ?? nulls.lowOf(n.h.nullifier);
    return { amount: n.amount, blinding: n.blinding, leafIndex: n.leafIndex, statePath: state.path(n.leafIndex), ...ni };
  });
  const pub = { stateRoot: state.root(), nullRoot: nulls.root(), mint, minAmount, ctx, escrow: escrow.public };
  return { P, ring, notes: full, raw: notes, pub, escrow, state, nulls, r: 1234567890123456789012345678901234567890n };
}
