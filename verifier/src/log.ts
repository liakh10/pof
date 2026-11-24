/* The transparency log (CONTRACT §7). Entries are 377-byte leaves at log/e/<index>; each append is a create-if-absent of the
   next index, so two function instances never write the same index and the log never has a gap. log/hashes caches the leaf
   hashes (a prefix of the true log: if it is behind, the next read probes forward and catches up). Nothing is ever
   rewritten or deleted. */
import { PofError, concat, hex } from './codec.js';
import { LEAF_LEN, decodeLeaf, sthBytes } from './contract.js';
import { leafHash, root, inclusionPath, consistencyProof } from './merkle.js';
import type { Signer } from './keys.js';
import type { Store } from './store.js';

const ek = (i: number) => 'log/e/' + String(i).padStart(12, '0');

export class TransparencyLog {
  private hashes: Uint8Array[] = [];
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private store: Store, private signer: Signer, private programId: Uint8Array) {}

  /** one reader or writer of the in-memory hash list at a time, per instance */
  private serial<T>(f: () => Promise<T>): Promise<T> { const r = this.chain.then(f, f); this.chain = r.catch(() => {}); return r; }

  /** reads the log to its true end */
  sync(): Promise<number> { return this.serial(() => this.syncNow()); }

  private async syncNow(): Promise<number> {
    if (!this.hashes.length) {
      const c = await this.store.get('log/hashes');
      if (c) for (let o = 0; o + 32 <= c.length; o += 32) this.hashes.push(c.slice(o, o + 32));
    }
    const before = this.hashes.length;
    for (;;) {
      const e = await this.store.get(ek(this.hashes.length));
      if (!e) break;
      this.hashes.push(leafHash(e));
    }
    if (this.hashes.length > before) await this.store.put('log/hashes', concat(...this.hashes)).catch(() => {});
    return this.hashes.length;
  }

  append(leaf: Uint8Array): Promise<number> {
    if (leaf.length !== LEAF_LEN) throw new PofError('INTERNAL', 'leaf length', 500);
    return this.serial(() => this.appendNow(leaf));
  }

  private async appendNow(leaf: Uint8Array): Promise<number> {
    let i = await this.syncNow();
    for (let tries = 0; tries < 64; tries++, i++) {
      if (await this.store.create(ek(i), leaf)) {
        while (this.hashes.length < i) { const e = await this.store.get(ek(this.hashes.length)); if (!e) break; this.hashes.push(leafHash(e)); }
        if (this.hashes.length === i) this.hashes.push(leafHash(leaf));
        await this.store.put('log/hashes', concat(...this.hashes)).catch(() => {});
        return i;
      }
    }
    throw new PofError('LOG_BUSY', 'the log is busy, try again in a moment', 503);
  }

  async head(slot?: bigint | number) {
    const n = await this.sync();
    const hs = this.hashes.slice(0, n);
    const r = root(hs, 0, n);
    return { treeSize: n, rootHash: hex(r), slot: slot === undefined ? null : Number(slot), signature: hex(this.signer.sign(sthBytes(this.programId, n, r))), verifierKey: this.signer.address };
  }

  async entry(i: number) {
    const e = await this.store.get(ek(i));
    if (!e) throw new PofError('NOT_FOUND', `log entry ${i} does not exist`, 404);
    const d = decodeLeaf(e);
    return { index: i, leaf: hex(e), leafHash: hex(leafHash(e)), attestation: hex(d.attestation), signature: hex(d.signature), verifierKey: hex(d.verifierKey), bundleHash: hex(d.bundleHash), loggedSlot: Number(d.loggedSlot) };
  }

  async proof(i: number, size?: number) {
    const n = await this.sync();
    const s = size ?? n;
    if (!Number.isInteger(i) || i < 0 || !Number.isInteger(s) || i >= s || s > n) throw new PofError('BAD_RANGE', `entry ${i} is not inside a log of size ${s} (the log has ${n})`, 404);
    return { index: i, treeSize: s, rootHash: hex(root(this.hashes, 0, s)), leafHash: hex(this.hashes[i]), path: inclusionPath(this.hashes.slice(0, s), i).map(hex) };
  }

  async consistency(m: number, n2?: number) {
    const n = await this.sync();
    const s = n2 ?? n;
    if (!Number.isInteger(m) || m < 0 || m > s || s > n) throw new PofError('BAD_RANGE', `no consistency proof from ${m} to ${s} (the log has ${n})`, 404);
    return { first: m, second: s, firstRoot: hex(root(this.hashes, 0, m)), secondRoot: hex(root(this.hashes, 0, s)), path: consistencyProof(this.hashes.slice(0, s), m).map(hex) };
  }

  async range(from: number, to: number) {
    const n = await this.sync();
    const a = Math.max(0, from | 0), b = Math.min(n, to | 0, a + 256);
    const out = [];
    for (let i = a; i < b; i++) out.push(await this.entry(i));
    return { treeSize: n, entries: out };
  }
}
