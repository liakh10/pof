/* The keeper. At attest time the Verifier hands it each note's (salt, nullifier); it seals them (AES-256-GCM, POF_SEAL_KEY)
   under keeper/kits/<subject hash>-<asset>/<attestation hash>. A scan opens every kit, reads its certificate, drops kits whose
   certificate never landed, was replaced, revoked or expired, and for a live one asks the Rings source whether any disclosed
   nullifier is spent; the first spent one is shown to the program in revoke_spent. The holder keeps the same kit, so anyone
   holding it can revoke without us. Before launch the cron is off (POF_KEEPER_LIVE unset). */
import { PofError, hex, sha256, unhex } from './codec.js';
import { open, putJson, seal, type Store } from './store.js';
import { decodeAttestation } from './contract.js';
import type { PofChain } from './chain.js';
import { STATUS } from './chain.js';
import type { RingsSource } from './rings.js';

export interface Kit { subjectHash: string; asset: number; tree: string; expirySlot: number; attestation: string; kit: { h: string; salt: string; nullifier: string }[] }

export class Keeper {
  constructor(private store: Store, private sealKey: Uint8Array, private rings: RingsSource | null = null, private chain: PofChain | null = null, private maxAttestAge = 300n) {
    if (sealKey.length !== 32) throw new PofError('KEY_MISSING', 'POF_SEAL_KEY must be 32 bytes of hex', 500);
  }
  private key(k: Kit) { return `keeper/kits/${k.subjectHash}-${k.asset}/${hex(sha256(unhex(k.attestation)))}`; }

  async hold(k: Kit) {
    const name = this.key(k);
    await this.store.put(name, seal(this.sealKey, name, new Uint8Array(Buffer.from(JSON.stringify(k)))));
  }

  async read(name: string): Promise<Kit> { const b = await this.store.get(name); if (!b) throw new PofError('NOT_FOUND', 'no kit', 404); return JSON.parse(Buffer.from(open(this.sealKey, name, b)).toString()); }

  async names() { return this.store.list('keeper/kits/'); }

  /** one pass over every kit; returns what it did, without salts or nullifiers. A kit is kept while it can still land
   *  (issued + maxAttestAge) or while its certificate is live; it is never dropped because another attestation of the same
   *  subject is live (POF-05). Dead kits go at the first scan after they can no longer land (POF-06). */
  async scan({ maxRevokes = 10, graceSlots = 9000n, maxAttestAge = this.maxAttestAge } = {}) {
    if (!this.rings || !this.chain) throw new PofError('KEEPER_OFF', 'the keeper has no chain configured', 503);
    const slot = await this.chain.slot();
    const report = { slot: Number(slot), kits: 0, live: 0, pending: 0, dropped: 0, revoked: [] as { certificate: string; index: number; signature: string }[], errors: [] as string[] };
    const names = await this.names();
    report.kits = names.length;
    for (const name of names) {
      let k: Kit;
      try { k = await this.read(name); } catch { report.errors.push(`${name.split('/')[2]}: unreadable`); continue; }
      try {
        const issued = decodeAttestation(unhex(k.attestation)).issuedSlot;
        const canLand = slot <= issued + maxAttestAge;
        const cert = await this.chain.certificate(unhex(k.subjectHash, 32), k.asset);
        const mine = !!cert && cert.hashes.length === k.kit.length && k.kit.every(x => cert.hashes.includes(x.h));
        if (!mine) {
          if (canLand) { report.pending++; continue; }
          await this.store.del(name); report.dropped++; continue;
        }
        if (cert!.status !== STATUS.live || slot > cert!.expirySlot + graceSlots) {
          if (canLand) { report.pending++; continue; } // a certify from a sibling attestation may still remake it
          await this.store.del(name); report.dropped++; continue;
        }
        report.live++;
        const spent = await this.rings.spent(k.tree, k.kit.map(x => unhex(x.nullifier, 32)));
        const at = spent.findIndex(Boolean);
        if (at < 0 || report.revoked.length >= maxRevokes) continue;
        const x = k.kit[at];
        const index = cert!.hashes.indexOf(x.h);
        const r = await this.chain.revokeSpent({ subjectHash: unhex(k.subjectHash, 32), asset: k.asset, index, salt: unhex(x.salt, 32), nullifier: unhex(x.nullifier, 32), tree: k.tree });
        report.revoked.push({ certificate: cert!.address, index, signature: r.signature });
        report.live--;
        await this.store.del(name);
      } catch (e: any) { report.errors.push(`${k.subjectHash.slice(0, 8)}: ${String(e?.code || e?.message).slice(0, 80)}`); }
    }
    await putJson(this.store, 'keeper/last-scan.json', { slot: report.slot, kits: report.kits, live: report.live, pending: report.pending, dropped: report.dropped, revoked: report.revoked, errors: report.errors.length, at: new Date().toISOString() }).catch(() => {});
    return report;
  }
}
