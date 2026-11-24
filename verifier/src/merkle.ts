/* RFC 9162 §2.1 Merkle tree hashing: leaf = sha256(0x00 ‖ d), node = sha256(0x01 ‖ l ‖ r), split at the largest power of
   two smaller than n. Inclusion (§2.1.3) and consistency (§2.1.4) proofs, both generated and checked. Pure functions. */
import { sha256, equal } from './codec.js';

const Z = Uint8Array.of(0), O = Uint8Array.of(1);
export const leafHash = (d: Uint8Array): Uint8Array => sha256(Z, d);
export const nodeHash = (l: Uint8Array, r: Uint8Array): Uint8Array => sha256(O, l, r);
const split = (n: number): number => { let k = 1; while (k << 1 < n) k <<= 1; return k; };

/** MTH over leaf hashes [lo, hi) */
export function root(hashes: Uint8Array[], lo = 0, hi = hashes.length): Uint8Array {
  const n = hi - lo;
  if (n === 0) return sha256();
  if (n === 1) return hashes[lo];
  const k = split(n);
  return nodeHash(root(hashes, lo, lo + k), root(hashes, lo + k, hi));
}

/** PATH(m, D[lo:hi]) */
export function inclusionPath(hashes: Uint8Array[], m: number, lo = 0, hi = hashes.length): Uint8Array[] {
  const n = hi - lo;
  if (n <= 1) return [];
  const k = split(n);
  return m < k ? [...inclusionPath(hashes, m, lo, lo + k), root(hashes, lo + k, hi)]
               : [...inclusionPath(hashes, m - k, lo + k, hi), root(hashes, lo, lo + k)];
}

/** RFC 9162 §2.1.3.2 */
export function verifyInclusion(leaf: Uint8Array, index: number, size: number, path: Uint8Array[], expected: Uint8Array): boolean {
  if (index >= size) return false;
  let fn = index, sn = size - 1, r = leaf;
  for (const p of path) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      r = nodeHash(p, r);
      if (fn % 2 === 0) while (fn % 2 === 0 && fn !== 0) { fn >>= 1; sn >>= 1; }
    } else r = nodeHash(r, p);
    fn >>= 1; sn >>= 1;
  }
  return sn === 0 && equal(r, expected);
}

/** PROOF(m, D[0:n]) per §2.1.4.1 */
export function consistencyProof(hashes: Uint8Array[], m: number, n = hashes.length): Uint8Array[] {
  if (m === 0 || m === n) return [];
  const sub = (m: number, lo: number, hi: number, complete: boolean): Uint8Array[] => {
    const n = hi - lo;
    if (m === n) return complete ? [] : [root(hashes, lo, hi)];
    const k = split(n);
    return m <= k ? [...sub(m, lo, lo + k, complete), root(hashes, lo + k, hi)]
                  : [...sub(m - k, lo + k, hi, false), root(hashes, lo, lo + k)];
  };
  return sub(m, 0, n, true);
}

/** §2.1.4.2 */
export function verifyConsistency(m: number, n: number, oldRoot: Uint8Array, newRoot: Uint8Array, proof: Uint8Array[]): boolean {
  if (m > n) return false;
  if (m === n) return proof.length === 0 && equal(oldRoot, newRoot);
  if (m === 0) return proof.length === 0;
  let p = [...proof];
  if ((m & (m - 1)) === 0) p = [oldRoot, ...p];
  if (p.length === 0) return false;
  let fn = m - 1, sn = n - 1;
  while (fn % 2 === 1) { fn >>= 1; sn >>= 1; }
  let fr = p[0], sr = p[0];
  for (const c of p.slice(1)) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      fr = nodeHash(c, fr); sr = nodeHash(c, sr);
      while (fn % 2 === 0 && fn !== 0) { fn >>= 1; sn >>= 1; }
    } else sr = nodeHash(sr, c);
    fn >>= 1; sn >>= 1;
  }
  return sn === 0 && equal(fr, oldRoot) && equal(sr, newRoot);
}
