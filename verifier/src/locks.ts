/* One note, one live certificate (RINGS.md §7: otherwise one whale certifies a hundred handles). The index key is
   HMAC(seal key, nullifier): no amount, and nobody without the key can test a nullifier against it. A lock binds while its
   certificate is live on chain, or, before it lands, until issued + certifyWindow (the program refuses a certify older than
   that). The same subject and asset may take its own lock again (renew). */
import crypto from 'node:crypto';
import { PofError, unhex } from './codec.js';
import { getJson, putJson, type Store } from './store.js';
import type { PofChain } from './chain.js';
import { STATUS } from './chain.js';

export interface Lock { subjectHash: string; asset: number; issuedSlot: number; expirySlot: number }

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

  async take(nullifiers: Uint8Array[], lock: Lock, slot: bigint) {
    const names = nullifiers.map(n => this.name(n));
    for (const [i, nm] of names.entries()) {
      const l = await getJson<Lock>(this.store, nm);
      if (!l || (l.subjectHash === lock.subjectHash && l.asset === lock.asset)) continue;
      if (await this.binding(l, slot)) throw new PofError('NOTE_IN_USE', `notes[${i}] already backs another live certificate; one note backs one certificate`);
    }
    for (const nm of names) await putJson(this.store, nm, lock);
  }
}
