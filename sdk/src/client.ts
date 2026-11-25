/** PofClient: everything a reader needs, straight from chain. */
import { Rpc, memcmp, type RpcLike, type Commitment } from "./rpc.js";
import { toHex, fromHex } from "./bytes.js";
import { POF_ZK_IDL } from "./idl/index.js";
import { decodeAccount, type Idl } from "./borsh.js";
import { toAddress, toAddressBytes, type AddressLike } from "./base58.js";
import { POF_PROGRAM_ID, POF_GATE_PROGRAM_ID, ASSETS, tierMinimum, parseAsset, ZK_CONFIG, assertPinned } from "./constants.js";
import { parseSubjectQuery, subjectHash, type Subject } from "./subject.js";
import {
  certificateAddress, configAddress, treasuryAddress, decodeConfig, decodeTreasury, activeVerifier,
  type PofConfig, type Treasury, decodeCertificate, decodeEvents, decodeMember, decodeRoom, effectiveStatus, layout,
  type Certificate, type Member, type Room, type StatusName,
} from "./accounts.js";

export interface PofClientOptions {
  /** an RPC URL or anything implementing RpcLike */
  rpc: string | RpcLike;
  /**
   * Another deployment of pof. Pinned to POF's program id by default: an account owned by any other program is never read
   * as a certificate (a consumer that does not pin it accepts a fake POF). Overriding needs `allowOtherDeployment: true`.
   */
  programId?: AddressLike;
  gateProgramId?: AddressLike;
  /** set only for your own local or test deployment of pof */
  allowOtherDeployment?: boolean;
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
    assertPinned(this.programId, this.gateProgramId, opts.allowOtherDeployment);
  }

  /** accounts and the slot in one RPC call when the RPC supports it, else two in parallel */
  private async accountsAt(addrs: string[]): Promise<{ slot: number; accounts: (import("./rpc.js").AccountData | null)[] }> {
    if (this.rpc.getAccountsWithSlot) return this.rpc.getAccountsWithSlot(addrs);
    const [accounts, slot] = await Promise.all([this.rpc.getAccounts(addrs), this.rpc.getSlot()]);
    return { slot, accounts };
  }
  private async programAccountsAt(programId: string, filters: import("./rpc.js").MemcmpFilter[]) {
    if (this.rpc.getProgramAccountsWithSlot) return this.rpc.getProgramAccountsWithSlot(programId, filters);
    const [accounts, slot] = await Promise.all([this.rpc.getProgramAccounts(programId, filters), this.rpc.getSlot()]);
    return { slot, accounts };
  }

  private live(c: Certificate, slot: number, revokedKeys: readonly string[] = this.revoked): LiveCertificate {
    const s = effectiveStatus(c, slot, revokedKeys);
    return { ...c, effectiveStatus: s, live: s === "live" };
  }

  /** the Config's revoked verifier keys, refreshed with every read that can carry the Config account at no extra call */
  private revoked: string[] = [];
  private configAddr: string | null = null;
  private async cfgAddr() {
    return (this.configAddr ??= (await configAddress(this.programId))[0]);
  }
  /** read `addrs` and the Config in ONE getMultipleAccounts; keeps the revoked keys current */
  private async withConfig(addrs: string[]) {
    const cfg = await this.cfgAddr();
    const { slot, accounts } = await this.accountsAt([...addrs, cfg]);
    const c = accounts.pop();
    if (c && c.owner === this.programId) {
      try {
        this.revoked = decodeConfig(c.data).revokedKeys;
      } catch {}
    }
    return { slot, accounts };
  }

  /** The certificate for one subject and asset, or null. */
  async getCertificate(subject: Subject | Uint8Array, asset: number | string): Promise<LiveCertificate | null> {
    const hash = subject instanceof Uint8Array ? subject : await subjectHash(subject);
    const [addr] = await certificateAddress(hash, parseAsset(asset), this.programId);
    const { slot, accounts: [acc] } = await this.withConfig([addr]);
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
    const { slot, accounts: accs } = await this.withConfig(addrs);
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
    const [{ slot, accounts: accs }] = await Promise.all([this.programAccountsAt(this.programId, filters), this.withConfig([])]);
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
    const { slot, accounts: [acc] } = await this.accountsAt([addr]);
    if (!acc || acc.owner !== this.programId) return null;
    const c = decodeConfig(acc.data);
    this.revoked = c.revokedKeys;
    return { ...c, activeVerifier: activeVerifier(c, slot), slot };
  }

  /**
   * The verifier keys the program accepted, for checking log ENTRIES (never trust the key a leaf names about itself):
   *  - the Config's verifier and scheduled next verifier;
   *  - with `fromCertificates`, the `verifier` of every open certificate (certify only stores the key it accepted);
   *  - with `history`, every key a `VerifierSet` event named, read from the ADMIN's transactions (set_verifier and
   *    init_config are admin-signed; scanning the Config account instead would walk every certify ever made).
   * `active` is the one key a log HEAD may be signed with now (audit W-02): a retired key must not sign new heads.
   */
  async verifierKeys(opts: { history?: boolean; fromCertificates?: boolean; maxTransactions?: number } = {}): Promise<{
    active: string | null; current: string | null; next: string | null; all: string[]; revoked: string[]; fromHistory: boolean; rpcCalls: number;
  }> {
    let calls = 1;
    const c = await this.getConfig();
    const keys = new Set<string>();
    const DEFAULT = "11111111111111111111111111111111";
    if (c) {
      keys.add(c.verifier);
      if (c.nextVerifier) keys.add(c.nextVerifier);
    }
    if (opts.fromCertificates) {
      calls++;
      const { certificates } = await this.listCertificates();
      for (const x of certificates) if (x.verifier && x.verifier !== DEFAULT) keys.add(x.verifier);
    }
    let fromHistory = false;
    if (opts.history && c && this.rpc.getSignaturesForAddress && this.rpc.getTransactionLogs) {
      let before: string | undefined;
      let seen = 0;
      const max = opts.maxTransactions ?? 200;
      for (;;) {
        calls++;
        const page = await this.rpc.getSignaturesForAddress(c.admin, { before, limit: Math.min(1000, max - seen) });
        if (!page.length) break;
        for (const sig of page) {
          if (sig.err) continue;
          calls++;
          const logs = await this.rpc.getTransactionLogs(sig.signature);
          if (!logs?.some((l) => l.startsWith("Program " + this.programId + " invoke"))) continue;
          for (const e of decodeEvents(logs)) {
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
    // a revoked key is trusted for nothing: not for old entries, not for heads (the program voids what it signed)
    const revoked = new Set(c?.revokedKeys ?? []);
    for (const k of revoked) keys.delete(k);
    const a = c ? activeVerifier(c, c.slot) : null;
    const active = a && !revoked.has(a) ? a : null;
    return { active, current: active, next: c?.nextVerifier ?? null, all: [...keys], revoked: [...revoked], fromHistory, rpcCalls: calls };
  }

  /**
   * The zk path's ZkConfig (zk build only), decoded with the zk build's IDL, or null when the account does not exist
   * (the launch build) or the SDK ships without the zk IDL. `active` is what is in force at `slot`: a change waits for
   * `nextSlot` (turning zk on waits the rotation delay; turning it off is immediate), as ZkConfig::active does on chain.
   */
  async getZkConfig(): Promise<{
    slot: number; enabled: boolean; nextEnabled: boolean; nextSlot: number; escrowEpoch: number; vkHash: string; certified: number;
    active: { enabled: boolean; escrowEpoch: number };
  } | null> {
    const idl = POF_ZK_IDL as unknown as Idl | null;
    if (!idl) return null;
    const { slot, accounts: [acc] } = await this.accountsAt([ZK_CONFIG]);
    if (!acc || acc.owner !== this.programId) return null;
    let r: Record<string, any>;
    try {
      r = decodeAccount(idl, "ZkConfig", acc.data);
    } catch {
      return null; // not a ZkConfig: never read as enabled
    }
    const nextSlot = Number(r.next_slot ?? 0);
    const escrowEpoch = Number(r.escrow_epoch ?? 0);
    const switched = nextSlot !== 0 && slot >= nextSlot;
    const sameKey = toHex(Uint8Array.from((r.next_escrow ?? []).flatMap((x: Uint8Array) => [...x]))) === toHex(Uint8Array.from((r.escrow ?? []).flatMap((x: Uint8Array) => [...x])));
    return {
      slot,
      enabled: !!r.enabled,
      nextEnabled: !!r.next_enabled,
      nextSlot,
      escrowEpoch,
      vkHash: toHex(r.vk_hash),
      certified: Number(r.certified ?? 0),
      active: switched ? { enabled: !!r.next_enabled, escrowEpoch: sameKey ? escrowEpoch : escrowEpoch + 1 } : { enabled: !!r.enabled, escrowEpoch },
    };
  }

  /** Whether zk certificates can be issued now: the ZkConfig exists, decodes, and is enabled at this slot (past any delay). */
  async zkEnabled(): Promise<boolean> {
    const z = await this.getZkConfig();
    return !!z?.active.enabled;
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
  async getRoomWithMembers(address: AddressLike, opts: { room?: Room } = {}): Promise<{
    slot: number;
    room: Room;
    members: (Member & { certificateStatus: StatusName | "missing"; tier: number | null; live: boolean })[];
  } | null> {
    // the room and its members in parallel: the member filter needs only the room's address
    const addr = toAddress(address);
    const [room, accs] = await Promise.all([
      opts.room ? Promise.resolve(opts.room) : this.getRoom(addr),
      this.rpc.getProgramAccounts(this.gateProgramId, [memcmp(0, layout.member.discriminator()), memcmp(layout.member.offset("room"), toAddressBytes(addr))]),
    ]);
    if (!room) return null;
    const members = accs.map((a) => decodeMember(a.address, a.data));
    const certAddrs = await Promise.all(
      members.map(async (m) => m.certificate ?? (await certificateAddress(fromHex(m.subjectHash), room.asset, this.programId))[0]),
    );
    const { slot, accounts: certs } = await this.withConfig(certAddrs);
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
  async stats(opts: { list?: { slot: number; certificates: LiveCertificate[] } } = {}): Promise<{
    slot: number;
    total: number;
    live: number;
    revokedSpent: number;
    revokedByHolder: number;
    expired: number;
    voided: number;
    settling: number;
    byAsset: Record<string, { live: number; certifiedMinimum: number; byTier: Record<number, number> }>;
    bySubjectKind: Record<string, number>;
    treasury: (Treasury & { address: string }) | null;
  }> {
    const [{ slot, certificates }, treasury] = await Promise.all([opts.list ? Promise.resolve(opts.list) : this.listCertificates(), this.getTreasury()]);
    const out = {
      slot, total: certificates.length, live: 0, revokedSpent: 0, revokedByHolder: 0, expired: 0, voided: 0, settling: 0, treasury,
      byAsset: {} as Record<string, { live: number; certifiedMinimum: number; byTier: Record<number, number> }>,
      bySubjectKind: { wallet: 0, x: 0, badge: 0 } as Record<string, number>,
    };
    for (const a of Object.values(ASSETS)) out.byAsset[a.symbol] = { live: 0, certifiedMinimum: 0, byTier: {} };
    for (const c of certificates) {
      if (c.effectiveStatus === "revoked_spent") out.revokedSpent++;
      else if (c.effectiveStatus === "revoked_by_holder") out.revokedByHolder++;
      else if (c.effectiveStatus === "expired") out.expired++;
      else if (c.effectiveStatus === "voided") out.voided++;
      else if (c.effectiveStatus === "settling") out.settling++;
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
      out.voided = Math.max(treasury.voided, out.voided);
    }
    return out;
  }
}
