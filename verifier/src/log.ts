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
    // probe forward 8 at a time: the leaves past the cache are usually a few, sometimes many (a cold instance)
    for (;;) {
      const base = this.hashes.length;
      const got = await Promise.all(Array.from({ length: 8 }, (_, k) => this.store.get(ek(base + k))));
      let k = 0;
      for (; k < got.length && got[k]; k++) this.hashes.push(leafHash(got[k]!));
      if (k < got.length) break;
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
    // reads 16 at a time (a sequential walk of 256 Blob reads took about 10 s under load)
    const idx = Array.from({ length: Math.max(0, b - a) }, (_, k) => a + k);
    const out: any[] = new Array(idx.length);
    for (let k = 0; k < idx.length; k += 16) {
      const part = await Promise.all(idx.slice(k, k + 16).map(i => this.entry(i)));
      part.forEach((e, j) => { out[k + j] = e; });
    }
    return { treeSize: n, entries: out };
  }

  /* Only certified attestations are published (audit A2-06): the Verifier keeps each signed leaf privately under
     log/pending/<attestation id>, and the relayer (when its certify lands) or the keeper (when it sees the certificate on
     chain) publishes it. log/published/<id> is taken by create-if-absent, so a leaf is appended once. */
  async hold(attId: string, leaf: Uint8Array) { await this.store.put(`log/pending/${attId}`, leaf); }
  async drop(attId: string) { await this.store.del(`log/pending/${attId}`); }
  /** appends the pending leaf of this attestation if it is not in the log yet; returns its index (null while another
   *  instance is appending it, or when nothing is pending) */
  async publish(attId: string): Promise<number | null> {
    const mark = `log/published/${attId}`;
    const was = await this.store.get(mark);
    if (was) { const v = Buffer.from(was).toString(); return /^\d+$/.test(v) ? Number(v) : null; }
    const leaf = await this.store.get(`log/pending/${attId}`);
    if (!leaf) return null;
    if (!(await this.store.create(mark, new Uint8Array(Buffer.from('appending'))))) return this.publish(attId);
    try {
      const i = await this.append(leaf);
      await this.store.put(mark, new Uint8Array(Buffer.from(String(i))));
      await this.store.del(`log/pending/${attId}`);
      return i;
    } catch (e) { await this.store.del(mark).catch(() => {}); throw e; }
  }
}
