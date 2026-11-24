/* One note, one live certificate (RINGS.md §7: otherwise one whale certifies a hundred handles). The index key is
   HMAC(seal key, nullifier): no amount, and nobody without the key can test a nullifier against it.
   Each note's lock is a chain of generations notes/<key>/<gen>; taking a lock is a create-if-absent of the next generation
   (atomic in Blob and in the folder store), so two parallel attests can never both take it (POF-04). The newest generation
   is the lock. It binds while its certificate is live on chain, or, before it lands, until issued + certifyWindow (the
   program refuses a certify older than max_attest_age). The same subject and asset may take its own lock again (renew). */
import crypto from 'node:crypto';
import { PofError, unhex } from './codec.js';
import { getJson, type Store } from './store.js';
import type { PofChain } from './chain.js';
import { STATUS } from './chain.js';

export interface Lock { subjectHash: string; asset: number; issuedSlot: number; expirySlot: number }
const gk = (base: string, g: number) => `${base}/${String(g).padStart(8, '0')}`;

export class NoteLocks {
  constructor(private store: Store, private key: Uint8Array, private certifyWindow: bigint, private chain: PofChain | null) {}
  private name(nf: Uint8Array) { return 'notes/' + crypto.createHmac('sha256', this.key).update('pof:lock:').update(nf).digest('hex'); }

  private async binding(l: Lock, slot: bigint): Promise<boolean> {
    if (slot > BigInt(l.expirySlot)) return false;
    if (this.chain) {
      const c = await this.chain.certificate(unhex(l.subjectHash, 32), l.asset);
      if (c && c.status === STATUS.live && c.expirySlot > slot) return true;
    }
    return slot <= BigInt(l.issuedSlot) + this.certifyWindow;
  }

  /** the newest generation: [gen, lock] or [-1, null] */
  private async newest(base: string): Promise<[number, Lock | null]> {
    let g = -1, l: Lock | null = null;
    for (let i = 0; i < 1000; i++) { const x = await getJson<Lock>(this.store, gk(base, i)); if (!x) break; g = i; l = x; }
    return [g, l];
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
      for (const k of made) await this.store.del(k).catch(() => {});
      throw e;
    }
  }
}
