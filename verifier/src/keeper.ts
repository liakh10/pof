/* The keeper. At attest time the Verifier hands it each note's (salt, nullifier); it seals them (AES-256-GCM, POF_SEAL_KEY)
   under keeper/kits/<subject hash>-<asset>/<attestation hash>. A scan opens every kit, reads its certificate, drops kits whose
   certificate never landed, was replaced, revoked or expired, and for a live one asks the Rings source whether any disclosed
   nullifier is spent; the first spent one is shown to the program in revoke_spent. The holder keeps the same kit, so anyone
   holding it can revoke without us. Before launch the cron is off (POF_KEEPER_LIVE unset). */
import { PofError, hex, sha256, unhex } from './codec.js';
import { open, putJson, seal, type Store } from './store.js';
import { decodeAttestation } from './contract.js';
import type { PofChain } from './chain.js';
import { STATUS, landingWindow } from './chain.js';
import type { RingsSource } from './rings.js';
import { openLock } from './zk.js';
import { toB58 } from './codec.js';

const RINGS_TREE = '777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor';
export interface Kit { subjectHash: string; asset: number; tree: string; expirySlot: number; attestation: string; kit: { h: string; salt: string; nullifier: string }[] }

export class Keeper {
  /** the log and the escrow publish a kit's attestation once its certificate is seen on chain (A2-06) */
  publishers: { log?: { publish(id: string): Promise<number | null>; drop(id: string): Promise<void> }; escrow?: { put(k: Kit): Promise<unknown>; remove(k: Kit): Promise<void> } } = {};
  /** phase 2: the revocation secrets k by key epoch (POF_ZK_ESCROW_KEYS); empty = zk certificates are not watched */
  zkKeys: Map<number, bigint> = new Map();
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
  async scan({ maxRevokes = 10, graceSlots = 9000n, maxAttestAge = undefined as bigint | undefined, budgetMs = 40_000 } = {}) {
    const started = Date.now();
    // a kit is kept while its attestation may still land: the Config's max_attest_age (the program's cap when unread)
    const landWindow = maxAttestAge ?? await landingWindow(this.chain, this.maxAttestAge);
    if (!this.rings || !this.chain) throw new PofError('KEEPER_OFF', 'the keeper has no chain configured', 503);
    const slot = await this.chain.slot();
    const report = { slot: Number(slot), kits: 0, live: 0, pending: 0, dropped: 0, revoked: [] as { certificate: string; index: number; signature: string }[], errors: [] as string[] };
    /* a time budget with a resume cursor (POF-06): a pass that runs out of time saves where it stopped, the next starts there */
    const all = await this.names();
    report.kits = all.length;
    const cur = Buffer.from((await this.store.get('keeper/cursor')) || new Uint8Array()).toString();
    const names = [...all.filter(n => n > cur), ...all.filter(n => n <= cur)];
    let stoppedAt: string | null = null;
    for (const name of names) {
      if (Date.now() - started > budgetMs) { stoppedAt = name; break; }
      let k: Kit;
      try { k = await this.read(name); } catch { report.errors.push(`${name.split('/')[2]}: unreadable`); continue; }
      try {
        const issued = decodeAttestation(unhex(k.attestation)).issuedSlot;
        const canLand = slot <= issued + landWindow;
        const cert = await this.chain.certificate(unhex(k.subjectHash, 32), k.asset);
        const mine = !!cert && cert.hashes.length === k.kit.length && k.kit.every(x => cert.hashes.includes(x.h));
        const attId = hex(sha256(unhex(k.attestation)));
        const gone = async () => { await this.store.del(name); report.dropped++; await this.publishers.log?.drop(attId).catch(() => {}); await this.publishers.escrow?.remove(k).catch(() => {}); };
        if (!mine) {
          if (canLand) { report.pending++; continue; }
          await gone(); continue;
        }
        // its own certificate is revoked or expired: this attestation can never certify again (a remake needs a newer
        // issued slot), so the kit, its pending leaf and its escrow go now (A2-06 retention)
        if (cert!.status !== STATUS.live || slot > cert!.expirySlot + graceSlots) { await gone(); continue; }
        report.live++;
        // it landed: its attestation goes into the public log, and its kit into the keeper escrow (once each)
        if (this.publishers.log) await this.publishers.log.publish(attId).catch(e => report.errors.push(`log: ${String(e?.code || e?.message).slice(0, 60)}`));
        if (this.publishers.escrow) await this.publishers.escrow.put(k).catch(e => report.errors.push(`escrow: ${String(e?.code || e?.message).slice(0, 60)}`));
        const spent = await this.rings.spent(k.tree, k.kit.map(x => unhex(x.nullifier, 32)));
        const at = spent.findIndex(Boolean);
        if (at < 0 || report.revoked.length >= maxRevokes) continue;
        const x = k.kit[at];
        const index = cert!.hashes.indexOf(x.h);
        const r = await this.chain.revokeSpent({ subjectHash: unhex(k.subjectHash, 32), asset: k.asset, index, salt: unhex(x.salt, 32), nullifier: unhex(x.nullifier, 32), tree: k.tree });
        report.revoked.push({ certificate: cert!.address, index, signature: r.signature });
        report.live--;
        await this.store.del(name);
        await this.publishers.escrow?.remove(k).catch(() => {});
      } catch (e: any) { report.errors.push(`${k.subjectHash.slice(0, 8)}: ${String(e?.code || e?.message).slice(0, 80)}`); }
    }
    (report as any).complete = !stoppedAt;
    if (this.zkKeys.size && this.chain.zkLocks) {
      try { (report as any).zk = await this.scanZk({ maxRevokes: Math.max(0, maxRevokes - report.revoked.length) }); }
      catch (e: any) { report.errors.push(`zk: ${String(e?.code || e?.message).slice(0, 80)}`); }
    }
    if (stoppedAt) { const i = names.indexOf(stoppedAt); await this.store.put('keeper/cursor', new Uint8Array(Buffer.from(i > 0 ? names[i - 1] : ''))); }
    else await this.store.del('keeper/cursor').catch(() => {});
    await putJson(this.store, 'keeper/last-scan.json', { slot: report.slot, kits: report.kits, live: report.live, pending: report.pending, dropped: report.dropped, revoked: report.revoked, errors: report.errors.length, complete: !stoppedAt, at: new Date().toISOString() }).catch(() => {});
    return report;
  }

  /** Phase 2: every zero-knowledge certificate is watched from chain data alone. Its note locks hold the nullifiers under the
   *  revocation key; the keeper opens them, asks the Rings source whether any is spent, and revokes with revoke_spent (salt
   *  zero: a zk certificate's hash is the tag) passing that note's lock as the first remaining account (FZ-18). A lock whose
   *  certificate is gone, not live, or no longer lists the tag is skipped. */
  async scanZk({ maxRevokes = 10 } = {}) {
    if (!this.rings || !this.chain?.zkLocks || !this.chain.certificatesAt) throw new PofError('KEEPER_OFF', 'the keeper has no zk chain view', 503);
    const slot = await this.chain.slot();
    const out = { locks: 0, live: 0, revoked: [] as { certificate: string; index: number; signature: string }[], errors: [] as string[] };
    const locks = (await this.chain.zkLocks()).filter(l => !l.spent);
    out.locks = locks.length;
    const byCert = new Map<string, typeof locks>();
    for (const l of locks) { const k = toB58(l.certificate); byCert.set(k, [...(byCert.get(k) || []), l]); }
    const addrs = [...byCert.keys()];
    const certs = await this.chain.certificatesAt(addrs);
    for (const [i, addr] of addrs.entries()) {
      const c = certs[i];
      if (!c || c.status !== STATUS.live || slot > c.expirySlot || (this.chain.zkConfig && c.verifier !== this.chain.zkConfig)) continue;
      out.live++;
      try {
        const opened: { index: number; nf: Uint8Array; lock: string }[] = [];
        for (const l of byCert.get(addr)!) {
          const index = c.hashes.indexOf(hex(l.tag));
          if (index < 0) continue;
          const k = this.zkKeys.get(l.epoch);
          if (k === undefined) { out.errors.push(`${addr.slice(0, 8)}: no revocation key for epoch ${l.epoch}`); continue; }
          opened.push({ index, nf: await openLock(k, l, index), lock: l.address });
        }
        if (!opened.length || out.revoked.length >= maxRevokes) continue;
        const spent = await this.rings.spent(RINGS_TREE, opened.map(x => x.nf));
        const at = spent.findIndex(Boolean);
        if (at < 0) continue;
        const x = opened[at];
        const r = await this.chain.revokeSpent({ subjectHash: unhex(c.subjectHash!, 32), asset: c.asset!, index: x.index, salt: new Uint8Array(32), nullifier: x.nf, tree: RINGS_TREE, zkLock: x.lock });
        out.revoked.push({ certificate: addr, index: x.index, signature: r.signature });
        out.live--;
      } catch (e: any) { out.errors.push(`${addr.slice(0, 8)}: ${String(e?.code || e?.message).slice(0, 80)}`); }
    }
    return out;
  }
}
