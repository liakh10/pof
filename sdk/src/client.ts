/** PofClient: everything a reader needs, straight from chain. */
import { Rpc, memcmp, type RpcLike, type Commitment } from "./rpc.js";
import { toHex, fromHex } from "./bytes.js";
import { toAddress, toAddressBytes, type AddressLike } from "./base58.js";
import { POF_PROGRAM_ID, POF_GATE_PROGRAM_ID, ASSETS, tierMinimum, parseAsset } from "./constants.js";
import { parseSubjectQuery, subjectHash, type Subject } from "./subject.js";
import {
  certificateAddress, configAddress, treasuryAddress, decodeConfig, decodeTreasury, activeVerifier,
  type PofConfig, type Treasury, decodeCertificate, decodeEvents, decodeMember, decodeRoom, effectiveStatus, layout,
  type Certificate, type Member, type Room, type StatusName,
} from "./accounts.js";

export interface PofClientOptions {
  /** an RPC URL or anything implementing RpcLike */
  rpc: string | RpcLike;
  programId?: AddressLike;
  gateProgramId?: AddressLike;
  commitment?: Commitment;
}

export interface LiveCertificate extends Certificate {
  /** status as of `slot`: a live byte past its expiry reads "expired" */
  effectiveStatus: StatusName;
  live: boolean;
}

export interface SubjectLookup {
  query: string;
  slot: number;
  /** the subjects the query was read as, with their hashes (a bare key is tried as wallet and as badge) */
  candidates: { kind: number; value: string | null; subjectHash: string }[];
  certificates: LiveCertificate[];
}

export interface FundsCheck {
  ok: boolean;
  reason: "ok" | "no_certificate" | "below_tier" | StatusName;
  slot: number;
  certificate: LiveCertificate | null;
}

export interface ListFilter {
  asset?: number | string;
  tier?: number;
  minTier?: number;
  status?: StatusName | "any";
  subjectKind?: number;
}

export class PofClient {
  readonly rpc: RpcLike;
  readonly programId: string;
  readonly gateProgramId: string;

  constructor(opts: PofClientOptions) {
    this.rpc = typeof opts.rpc === "string" ? new Rpc(opts.rpc, { commitment: opts.commitment }) : opts.rpc;
    this.programId = toAddress(opts.programId ?? POF_PROGRAM_ID);
    this.gateProgramId = toAddress(opts.gateProgramId ?? POF_GATE_PROGRAM_ID);
  }

  private live(c: Certificate, slot: number): LiveCertificate {
    const s = effectiveStatus(c, slot);
    return { ...c, effectiveStatus: s, live: s === "live" };
  }

  /** The certificate for one subject and asset, or null. */
  async getCertificate(subject: Subject | Uint8Array, asset: number | string): Promise<LiveCertificate | null> {
    const hash = subject instanceof Uint8Array ? subject : await subjectHash(subject);
    const [addr] = await certificateAddress(hash, parseAsset(asset), this.programId);
    const [acc, slot] = await Promise.all([this.rpc.getAccount(addr), this.rpc.getSlot()]);
    if (!acc || acc.owner !== this.programId) return null;
    return this.live(decodeCertificate(addr, acc.data), slot);
  }

  /**
   * Look a subject up the way a person types it: `@handle`, `x:handle`, `wallet:<key>`, `badge:<key>`,
   * a bare key (tried as wallet and as badge), or a 64-hex subject hash. Every asset is checked.
   */
  async lookup(query: string, opts: { asset?: number | string } = {}): Promise<SubjectLookup> {
    const q = parseSubjectQuery(query);
    const candidates: SubjectLookup["candidates"] = [];
    if (q.type === "hash") candidates.push({ kind: -1, value: null, subjectHash: toHex(q.hash) });
    else for (const s of q.subjects) candidates.push({ kind: s.kind, value: s.value, subjectHash: toHex(await subjectHash(s)) });
    const assets = opts.asset === undefined ? Object.keys(ASSETS).map(Number) : [parseAsset(opts.asset)];
    const addrs: string[] = [];
    for (const c of candidates) for (const a of assets) addrs.push((await certificateAddress(fromHex(c.subjectHash), a, this.programId))[0]);
    const [accs, slot] = await Promise.all([this.rpc.getAccounts(addrs), this.rpc.getSlot()]);
    const certificates: LiveCertificate[] = [];
    accs.forEach((acc) => {
      if (acc && acc.owner === this.programId) certificates.push(this.live(decodeCertificate(acc.address, acc.data), slot));
    });
    // a bare key that matched as a badge: keep only the kinds that exist, and the hash candidate learns its kind
    for (const c of candidates) if (c.kind === -1) c.kind = certificates.find((x) => x.subjectHash === c.subjectHash)?.subjectKind ?? -1;
    return { query, slot, candidates, certificates };
  }

  /** The one-call gate: does this subject hold a live certificate of at least `minTier` in `asset`? */
  async checkProofOfFunds(args: { subject: string | Subject; asset: number | string; minTier: number }): Promise<FundsCheck> {
    const asset = parseAsset(args.asset);
    tierMinimum(asset, args.minTier);
    const query = typeof args.subject === "string" ? args.subject : `${["wallet", "x", "badge"][args.subject.kind]}:${args.subject.value}`;
    const { certificates: certs, slot } = await this.lookup(query, { asset });
    if (!certs.length) return { ok: false, reason: "no_certificate", slot, certificate: null };
    const best = certs.sort((a, b) => Number(b.live) - Number(a.live) || b.tier - a.tier)[0];
    if (!best.live) return { ok: false, reason: best.effectiveStatus, slot, certificate: best };
    if (best.tier < args.minTier) return { ok: false, reason: "below_tier", slot, certificate: best };
    return { ok: true, reason: "ok", slot, certificate: best };
  }

  /** Every certificate matching the filter (getProgramAccounts with memcmp filters). */
  async listCertificates(f: ListFilter = {}): Promise<{ slot: number; certificates: LiveCertificate[] }> {
    const filters = [memcmp(0, layout.certificate.discriminator())];
    if (f.asset !== undefined) filters.push(memcmp(layout.certificate.offset("asset"), Uint8Array.of(parseAsset(f.asset))));
    if (f.tier !== undefined) filters.push(memcmp(layout.certificate.offset("tier"), Uint8Array.of(f.tier)));
    if (f.subjectKind !== undefined) filters.push(memcmp(layout.certificate.offset("subject_kind"), Uint8Array.of(f.subjectKind)));
    const [accs, slot] = await Promise.all([this.rpc.getProgramAccounts(this.programId, filters), this.rpc.getSlot()]);
    let certificates = accs.map((a) => this.live(decodeCertificate(a.address, a.data), slot));
    if (f.minTier !== undefined) certificates = certificates.filter((c) => c.tier >= f.minTier!);
    const st = f.status ?? "any";
    if (st !== "any") certificates = certificates.filter((c) => c.effectiveStatus === st);
    certificates.sort((a, b) => b.certifiedSlot - a.certifiedSlot);
    return { slot, certificates };
  }

  /** The program's Config: verifier keys, fee, validity, tier tables in base units. */
  async getConfig(): Promise<(PofConfig & { activeVerifier: string; slot: number }) | null> {
    const [addr] = await configAddress(this.programId);
    const [acc, slot] = await Promise.all([this.rpc.getAccount(addr), this.rpc.getSlot()]);
    if (!acc || acc.owner !== this.programId) return null;
    const c = decodeConfig(acc.data);
    return { ...c, activeVerifier: activeVerifier(c, slot), slot };
  }

  /**
   * The verifier keys a log head or entry may be signed with: the Config's verifier and scheduled next verifier, plus,
   * with `history`, every key a `VerifierSet` event ever named (read from the Config account's transaction history,
   * when the RPC serves it). Never trust the key a head or a leaf names about itself.
   */
  async verifierKeys(opts: { history?: boolean; maxTransactions?: number } = {}): Promise<{ current: string | null; next: string | null; all: string[]; fromHistory: boolean }> {
    const c = await this.getConfig();
    const keys = new Set<string>();
    const DEFAULT = "11111111111111111111111111111111";
    if (c) {
      keys.add(c.verifier);
      if (c.nextVerifier) keys.add(c.nextVerifier);
    }
    let fromHistory = false;
    if (opts.history && this.rpc.getSignaturesForAddress && this.rpc.getTransactionLogs) {
      const [cfg] = await configAddress(this.programId);
      let before: string | undefined;
      let seen = 0;
      const max = opts.maxTransactions ?? 2000;
      for (;;) {
        const page = await this.rpc.getSignaturesForAddress(cfg, { before, limit: Math.min(1000, max - seen) });
        if (!page.length) break;
        for (const sig of page) {
          if (sig.err) continue;
          const logs = await this.rpc.getTransactionLogs(sig.signature);
          for (const e of decodeEvents(logs ?? [])) {
            if (e.name !== "VerifierSet") continue;
            for (const k of [e.data.verifier, e.data.next_verifier]) if (k && k !== DEFAULT) keys.add(String(k));
          }
        }
        seen += page.length;
        before = page[page.length - 1].signature;
        if (page.length < 1000 || seen >= max) break;
      }
      fromHistory = true;
    }
    return { current: c ? activeVerifier(c, c.slot) : null, next: c?.nextVerifier ?? null, all: [...keys], fromHistory };
  }

  /** The Treasury's public counters, and the transparency log head anchored on chain. */
  async getTreasury(): Promise<(Treasury & { address: string }) | null> {
    const [addr] = await treasuryAddress(this.programId);
    const acc = await this.rpc.getAccount(addr);
    if (!acc || acc.owner !== this.programId) return null;
    return { ...decodeTreasury(acc.data), address: addr };
  }

  async getRoom(address: AddressLike): Promise<Room | null> {
    const addr = toAddress(address);
    const acc = await this.rpc.getAccount(addr);
    if (!acc || acc.owner !== this.gateProgramId) return null;
    return decodeRoom(addr, acc.data);
  }

  async listRooms(): Promise<Room[]> {
    const accs = await this.rpc.getProgramAccounts(this.gateProgramId, [memcmp(0, layout.room.discriminator())]);
    return accs.map((a) => decodeRoom(a.address, a.data));
  }

  /** A room with its members, each with the live status of the certificate behind it. */
  async getRoomWithMembers(address: AddressLike): Promise<{
    slot: number;
    room: Room;
    members: (Member & { certificateStatus: StatusName | "missing"; tier: number | null; live: boolean })[];
  } | null> {
    const room = await this.getRoom(address);
    if (!room) return null;
    const accs = await this.rpc.getProgramAccounts(this.gateProgramId, [
      memcmp(0, layout.member.discriminator()),
      memcmp(layout.member.offset("room"), toAddressBytes(room.address)),
    ]);
    const members = accs.map((a) => decodeMember(a.address, a.data));
    const certAddrs = await Promise.all(
      members.map(async (m) => m.certificate ?? (await certificateAddress(fromHex(m.subjectHash), room.asset, this.programId))[0]),
    );
    const [certs, slot] = await Promise.all([this.rpc.getAccounts(certAddrs), this.rpc.getSlot()]);
    return {
      slot,
      room,
      members: members.map((m, i) => {
        const acc = certs[i];
        if (!acc || acc.owner !== this.programId) return { ...m, certificateStatus: "missing" as const, tier: null, live: false };
        const c = this.live(decodeCertificate(acc.address, acc.data), slot);
        const live = c.live && c.tier >= room.minTier && c.asset === room.asset;
        return { ...m, certificate: acc.address, certificateStatus: c.effectiveStatus, tier: c.tier, live };
      }),
    };
  }

  /**
   * Counters: live certificates, revocations, and the sum of live tier minimums per asset.
   * The cumulative counters come from the Treasury when it exists (expired certificates are closed, so a scan cannot
   * count them); the per-tier breakdown comes from a scan of the open certificates.
   */
  async stats(): Promise<{
    slot: number;
    total: number;
    live: number;
    revokedSpent: number;
    revokedByHolder: number;
    expired: number;
    byAsset: Record<string, { live: number; certifiedMinimum: number; byTier: Record<number, number> }>;
    bySubjectKind: Record<string, number>;
    treasury: (Treasury & { address: string }) | null;
  }> {
    const [{ slot, certificates }, treasury] = await Promise.all([this.listCertificates(), this.getTreasury()]);
    const out = {
      slot, total: certificates.length, live: 0, revokedSpent: 0, revokedByHolder: 0, expired: 0, treasury,
      byAsset: {} as Record<string, { live: number; certifiedMinimum: number; byTier: Record<number, number> }>,
      bySubjectKind: { wallet: 0, x: 0, badge: 0 } as Record<string, number>,
    };
    for (const a of Object.values(ASSETS)) out.byAsset[a.symbol] = { live: 0, certifiedMinimum: 0, byTier: {} };
    for (const c of certificates) {
      if (c.effectiveStatus === "revoked_spent") out.revokedSpent++;
      else if (c.effectiveStatus === "revoked_by_holder") out.revokedByHolder++;
      else if (c.effectiveStatus === "expired") out.expired++;
      if (!c.live) continue;
      out.live++;
      out.bySubjectKind[c.subjectKindName] = (out.bySubjectKind[c.subjectKindName] ?? 0) + 1;
      const b = out.byAsset[c.assetSymbol] ?? (out.byAsset[c.assetSymbol] = { live: 0, certifiedMinimum: 0, byTier: {} });
      b.live++;
      b.byTier[c.tier] = (b.byTier[c.tier] ?? 0) + 1;
      if (ASSETS[c.asset]?.tiers[c.tier] !== undefined) b.certifiedMinimum += tierMinimum(c.asset, c.tier);
    }
    if (treasury) {
      // the program's own counters are authoritative for the cumulative numbers
      out.total = treasury.certified;
      out.revokedSpent = treasury.revokedSpent;
      out.revokedByHolder = treasury.revokedHolder;
      out.expired = Math.max(treasury.expired, out.expired);
    }
    return out;
  }
}
