/* One note, one live certificate (RINGS.md §7: otherwise one whale certifies a hundred handles). The index key is
   HMAC(seal key, nullifier): no amount, and nobody without the key can test a nullifier against it.
   Each note's lock is a chain of generations notes/<key>/<gen>; taking a lock is a create-if-absent of the next generation
   (atomic in Blob and in the folder store), so two parallel attests can never both take it (POF-04). The newest generation
   is the lock. It binds while its certificate is live on chain, or, before it lands, for as long as the program could still
   accept the attestation (see binding). The same subject and asset may take its own lock again (renew). */
import crypto from 'node:crypto';
import { PofError, unhex } from './codec.js';
import { getJson, type Store } from './store.js';
import type { PofChain } from './chain.js';
import { STATUS, landingWindow } from './chain.js';

export interface Lock { subjectHash: string; asset: number; issuedSlot: number; expirySlot: number }
const gk = (base: string, g: number) => `${base}/${String(g).padStart(8, '0')}`;

export class NoteLocks {
  constructor(private store: Store, private key: Uint8Array, private certifyWindow: bigint, private chain: PofChain | null) {}
  private name(nf: Uint8Array) { return 'notes/' + crypto.createHmac('sha256', this.key).update('pof:lock:').update(nf).digest('hex'); }

  /** A lock binds while its certificate is live, or while its attestation may still land: issued + the larger of the
   *  configured window and the Config's max_attest_age (the program's cap when unread), plus a margin. Without a chain to
   *  read it binds until the attestation's expiry, since the certificate may be live (audit A2-02). */
  private async binding(l: Lock, slot: bigint): Promise<boolean> {
    if (slot > BigInt(l.expirySlot)) return false;
    if (!this.chain) return true;
    const c = await this.chain.certificate(unhex(l.subjectHash, 32), l.asset);
    if (c && c.status === STATUS.live && c.expirySlot > slot) return true;
    return slot <= BigInt(l.issuedSlot) + await landingWindow(this.chain, this.certifyWindow);
  }
  get hasChain() { return !!this.chain; }

  /** the newest generation: [gen, lock] or [-1, null]. Generations are never deleted (a release is a tombstone generation on
   *  top), so the chain has no gaps and the first missing generation ends it; a head hint skips the old ones. */
  private async newest(base: string): Promise<[number, Lock | null]> {
    const hint = Number(Buffer.from((await this.store.get(base + '/head')) || new Uint8Array()).toString() || 0) || 0;
    let g = -1, l: Lock | null = null;
    let i = Math.max(0, hint - 1);
    if (i > 0 && !(await this.store.get(gk(base, i)))) i = 0; // a bad hint: read from the start
    for (let n = 0; n < 10_000; n++, i++) { const x = await getJson<Lock>(this.store, gk(base, i)); if (!x) break; g = i; l = x; }
    if (g >= 0 && g + 1 > hint) await this.store.put(base + '/head', new Uint8Array(Buffer.from(String(g + 1)))).catch(() => {});
    return [g, l && (l as any).released ? null : l];
  }

  async take(nullifiers: Uint8Array[], lock: Lock, slot: bigint) {
    const body = new Uint8Array(Buffer.from(JSON.stringify(lock)));
    const made: string[] = [];
    try {
      for (const [i, nf] of nullifiers.entries()) {
        const base = this.name(nf);
        for (let attempt = 0; ; attempt++) {
          if (attempt > 8) throw new PofError('LOCK_BUSY', 'that note is being certified by another request right now; try again', 409);
          const [g, l] = await this.newest(base);
          if (l && l.subjectHash === lock.subjectHash && l.asset === lock.asset) {
            // its own lock: renew it as a newer generation (a create, so a racing other subject cannot slip in between)
            if (await this.store.create(gk(base, g + 1), body)) { made.push(gk(base, g + 1)); break; }
            continue;
          }
          if (l && await this.binding(l, slot)) throw new PofError('NOTE_IN_USE', `notes[${i}] already backs another live certificate; one note backs one certificate`);
          if (await this.store.create(gk(base, g + 1), body)) { made.push(gk(base, g + 1)); break; }
        }
      }
    } catch (e) {
      // give back what this call took: a tombstone generation on top of each (if someone already built on top, theirs stands)
      for (const k of made) {
        const base = k.slice(0, k.lastIndexOf('/')), g = Number(k.slice(k.lastIndexOf('/') + 1));
        await this.store.create(gk(base, g + 1), new Uint8Array(Buffer.from(JSON.stringify({ released: true, subjectHash: '', asset: -1, issuedSlot: 0, expirySlot: 0 })))).catch(() => {});
      }
      throw e;
    }
  }
}
