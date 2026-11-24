/**
 * THE one module that knows the on-chain account layouts (CONTRACT.md §6).
 * Layouts come from the IDL; this file maps the raw IDL fields to stable SDK objects,
 * tolerating small naming differences so an IDL rename does not break consumers.
 */
import { POF_IDL, POF_GATE_IDL } from "./idl/index.js";
import { decodeAccount, fieldOffset, Reader, type Idl } from "./borsh.js";
import { toHex, u64le } from "./bytes.js";
import { findProgramAddress } from "./pda.js";
import { toAddressBytes, type AddressLike } from "./base58.js";
import {
  CERT_STATUS_NAMES, SUBJECT_KIND_NAMES, ASSETS, tierLabel, POF_PROGRAM_ID, POF_GATE_PROGRAM_ID,
} from "./constants.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const pofIdl = POF_IDL as unknown as Idl;
const gateIdl = POF_GATE_IDL as unknown as Idl;

export type StatusName = "live" | "revoked_spent" | "revoked_by_holder" | "expired";

export interface Certificate {
  address: string;
  subjectKind: number;
  subjectKindName: "wallet" | "x" | "badge";
  /** hex */
  subjectHash: string;
  asset: number;
  assetSymbol: string;
  tier: number;
  tierLabel: string;
  /** the status byte stored on chain */
  status: number;
  statusName: StatusName;
  certifiedSlot: number;
  expirySlot: number;
  /** null while never revoked */
  revokedSlot: number | null;
  noteCount: number;
  /** hex, the salted nullifier hashes in use (note_count of them) */
  nullifierHashes: string[];
  payer: string;
  logIndex: number | null;
  verifier: string;
  /** the key that may revoke the certificate and join rooms with it (CONTRACT §3) */
  controller: string | null;
  /** the slot the Verifier read when it signed (changes on renew) */
  issuedSlot: number | null;
  /** hex, the Rings state root the notes were checked against */
  treeRoot: string | null;
  rootSlot: number | null;
  /** hex, sha256 of the salted nullifier hashes (§5) */
  nullsetHash: string | null;
  renewals: number;
  /** hex, the attestation's nonce (with nullsetHash it ties the certificate to exactly one log leaf) */
  nonce: string | null;
  /** after revoke_spent: the disclosed note's index, salt and nullifier, public from then on */
  revealed: { index: number; salt: string; nullifier: string } | null;
}

export interface Room {
  address: string;
  creator: string;
  id: string;
  asset: number;
  assetSymbol: string;
  minTier: number;
  minTierLabel: string;
  memberCount: number;
  createdSlot: number | null;
  name: string | null;
  /** false when the creator closed it to new joins */
  open: boolean;
  joined: number;
  evicted: number;
  raw: Record<string, any>;
}

export interface Member {
  address: string;
  room: string;
  /** hex */
  subjectHash: string;
  certificate: string | null;
  joinedSlot: number | null;
  subjectKind: number | null;
  controller: string | null;
  payer: string | null;
}

function pick(raw: Record<string, any>, ...names: string[]): any {
  for (const n of names) if (raw[n] !== undefined) return raw[n];
  return undefined;
}
function num(v: any): number | null {
  if (v === undefined || v === null) return null;
  const n = typeof v === "bigint" ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}
function hex(v: any): string {
  if (v instanceof Uint8Array) return toHex(v);
  if (Array.isArray(v)) return toHex(Uint8Array.from(v));
  return String(v);
}

export function decodeCertificate(address: string, data: Uint8Array): Certificate {
  const r = decodeAccount(pofIdl, "Certificate", data);
  const asset = Number(pick(r, "asset"));
  const tier = Number(pick(r, "tier"));
  const status = Number(pick(r, "status"));
  const noteCount = Number(pick(r, "note_count", "noteCount") ?? 0);
  const hashes: any[] = pick(r, "null_hashes", "nullifier_hashes", "nullifierHashes", "nullifiers") ?? [];
  const revIdx = num(pick(r, "revealed_index", "revealedIndex"));
  const optHex = (v: any) => (v === undefined || v === null ? null : hex(v));
  const optKey = (v: any) => (v === undefined || v === null ? null : String(v));
  const revoked = num(pick(r, "revoked_slot", "revokedSlot"));
  const kind = Number(pick(r, "subject_kind", "subjectKind"));
  const logIndex = num(pick(r, "log_index", "logIndex"));
  return {
    address,
    subjectKind: kind,
    subjectKindName: SUBJECT_KIND_NAMES[kind] ?? ("wallet" as const),
    subjectHash: hex(pick(r, "subject_hash", "subjectHash")),
    asset,
    assetSymbol: ASSETS[asset]?.symbol ?? `asset${asset}`,
    tier,
    tierLabel: ASSETS[asset]?.tiers[tier] !== undefined ? tierLabel(asset, tier) : `tier ${tier}`,
    status,
    statusName: CERT_STATUS_NAMES[status] ?? "live",
    certifiedSlot: num(pick(r, "certified_slot", "certifiedSlot")) ?? 0,
    expirySlot: num(pick(r, "expiry_slot", "expirySlot")) ?? 0,
    revokedSlot: revoked ? revoked : null,
    noteCount,
    nullifierHashes: hashes.slice(0, noteCount).map(hex),
    payer: String(pick(r, "payer") ?? ""),
    logIndex: logIndex === 18446744073709552000 ? null : logIndex,
    verifier: String(pick(r, "verifier", "verifier_key", "verifierKey") ?? ""),
    controller: optKey(pick(r, "controller")),
    issuedSlot: num(pick(r, "issued_slot", "issuedSlot")),
    treeRoot: optHex(pick(r, "tree_root", "treeRoot")),
    rootSlot: num(pick(r, "root_slot", "rootSlot")),
    nullsetHash: optHex(pick(r, "nullset_hash", "nullsetHash")),
    renewals: num(pick(r, "renewals")) ?? 0,
    nonce: optHex(pick(r, "nonce")),
    revealed:
      revIdx !== null && revIdx !== 255
        ? { index: revIdx, salt: hex(pick(r, "revealed_salt")), nullifier: hex(pick(r, "revealed_nullifier")) }
        : null,
  };
}

export function decodeRoom(address: string, data: Uint8Array): Room {
  const r = decodeAccount(gateIdl, "Room", data);
  const asset = Number(pick(r, "asset"));
  const minTier = Number(pick(r, "min_tier", "minTier", "tier"));
  const name = pick(r, "name", "label", "title");
  return {
    address,
    creator: String(pick(r, "creator", "authority", "admin")),
    id: String(pick(r, "id", "room_id", "roomId")),
    asset,
    assetSymbol: ASSETS[asset]?.symbol ?? `asset${asset}`,
    minTier,
    minTierLabel: ASSETS[asset]?.tiers[minTier] !== undefined ? tierLabel(asset, minTier) : `tier ${minTier}`,
    memberCount: num(pick(r, "member_count", "memberCount", "members")) ?? 0,
    createdSlot: num(pick(r, "created_slot", "createdSlot")),
    name: typeof name === "string" ? name.replace(/\0+$/, "") || null : name instanceof Uint8Array ? new TextDecoder().decode(name).replace(/\0+$/, "") || null : null,
    open: pick(r, "open") === undefined ? true : !!pick(r, "open"),
    joined: num(pick(r, "joined")) ?? 0,
    evicted: num(pick(r, "evicted")) ?? 0,
    raw: r,
  };
}

export function decodeMember(address: string, data: Uint8Array): Member {
  const r = decodeAccount(gateIdl, "Member", data);
  const cert = pick(r, "certificate", "cert");
  return {
    address,
    room: String(pick(r, "room")),
    subjectHash: hex(pick(r, "subject_hash", "subjectHash")),
    certificate: cert ? String(cert) : null,
    joinedSlot: num(pick(r, "joined_slot", "joinedSlot")),
    subjectKind: num(pick(r, "subject_kind", "subjectKind")),
    controller: pick(r, "controller") ? String(pick(r, "controller")) : null,
    payer: pick(r, "payer") ? String(pick(r, "payer")) : null,
  };
}

export interface PofConfig {
  admin: string;
  dev: string;
  relayer: string;
  verifier: string;
  nextVerifier: string | null;
  nextVerifierSlot: number;
  rootMint: string;
  feeLamports: number;
  holderMin: string;
  validitySlots: number;
  maxAttestAge: number;
  maxRootLag: number;
  rotationDelay: number;
  /** by POF asset id: enabled, mint, decimals and the tier minimums in base units */
  assets: { id: number; enabled: boolean; mint: string; decimals: number; mins: string[] }[];
  paused: boolean;
  closing: boolean;
  launchSlot: number;
  raw: Record<string, any>;
}

const DEFAULT_KEY = "11111111111111111111111111111111";

export function decodeConfig(data: Uint8Array): PofConfig {
  const r = decodeAccount(pofIdl, "Config", data);
  const p = r.params ?? {};
  return {
    admin: String(r.admin), dev: String(r.dev ?? ""), relayer: String(r.relayer ?? ""), verifier: String(r.verifier),
    nextVerifier: r.next_verifier && r.next_verifier !== DEFAULT_KEY ? String(r.next_verifier) : null,
    nextVerifierSlot: num(r.next_verifier_slot) ?? 0,
    rootMint: String(r.root_mint ?? ""),
    feeLamports: num(p.fee_lamports ?? r.fee_lamports) ?? 0,
    holderMin: String(p.holder_min ?? "0"),
    validitySlots: num(p.validity_slots ?? r.validity_slots) ?? 0,
    maxAttestAge: num(p.max_attest_age) ?? 0,
    maxRootLag: num(p.max_root_lag) ?? 0,
    rotationDelay: num(p.rotation_delay) ?? 0,
    assets: (r.assets ?? []).map((a: any, id: number) => ({
      id, enabled: !!a.enabled, mint: String(a.mint), decimals: Number(a.decimals), mins: (a.mins ?? []).map((m: any) => String(m)),
    })),
    paused: !!r.paused, closing: !!r.closing, launchSlot: num(r.launch_slot) ?? 0,
    raw: r,
  };
}

/** The verifier key certify accepts at `slot` (CONTRACT §6: next_verifier once its slot is reached). */
export function activeVerifier(c: PofConfig, slot: number): string {
  return c.nextVerifier && slot >= c.nextVerifierSlot ? c.nextVerifier : c.verifier;
}

export interface Treasury {
  feesIn: string; feesOut: string; certified: number; renewed: number; revokedSpent: number; revokedHolder: number;
  expired: number; live: number;
  /** sum of tier minimums of live certificates by POF asset id, base units */
  liveMin: string[];
  open: number; relayed: number; exempt: number;
  /** the transparency log head anchored on chain by anchor_log */
  log: { treeSize: number; rootHash: string; slot: number } | null;
}

export function decodeTreasury(data: Uint8Array): Treasury {
  const r = decodeAccount(pofIdl, "Treasury", data);
  const n = (k: string) => num(r[k]) ?? 0;
  const size = n("log_size");
  return {
    feesIn: String(r.fees_in ?? 0), feesOut: String(r.fees_out ?? 0), certified: n("certified"), renewed: n("renewed"),
    revokedSpent: n("revoked_spent"), revokedHolder: n("revoked_holder"), expired: n("expired"), live: n("live"),
    liveMin: (r.live_min ?? []).map((x: any) => String(x)), open: n("open"), relayed: n("relayed"), exempt: n("exempt"),
    log: size ? { treeSize: size, rootHash: hex(r.log_head), slot: n("log_slot") } : null,
  };
}

/** Live means: status byte live AND `slot <= expiry_slot` (the program's own rule, Certificate::is_live). */
export function effectiveStatus(c: Pick<Certificate, "status" | "expirySlot">, currentSlot: number): StatusName {
  if (c.status === 0 && currentSlot > c.expirySlot) return "expired";
  return CERT_STATUS_NAMES[c.status] ?? "live";
}

export function isLive(c: Pick<Certificate, "status" | "expirySlot">, currentSlot: number): boolean {
  return effectiveStatus(c, currentSlot) === "live";
}

/* ---------- PDAs (CONTRACT §6) ---------- */

export async function certificateAddress(subjectHash: Uint8Array, asset: number, programId: AddressLike = POF_PROGRAM_ID) {
  return findProgramAddress(["cert", subjectHash, Uint8Array.of(asset)], programId);
}
export async function configAddress(programId: AddressLike = POF_PROGRAM_ID) {
  return findProgramAddress(["config"], programId);
}
export async function treasuryAddress(programId: AddressLike = POF_PROGRAM_ID) {
  return findProgramAddress(["treasury"], programId);
}
export async function roomAddress(creator: AddressLike, id: bigint | number, gateProgramId: AddressLike = POF_GATE_PROGRAM_ID) {
  return findProgramAddress(["room", toAddressBytes(creator), u64le(id)], gateProgramId);
}
export async function memberAddress(room: AddressLike, subjectHash: Uint8Array, gateProgramId: AddressLike = POF_GATE_PROGRAM_ID) {
  return findProgramAddress(["member", toAddressBytes(room), subjectHash], gateProgramId);
}

/* ---------- memcmp offsets for getProgramAccounts filters ---------- */

export const layout = {
  certificate: {
    discriminator: () => Uint8Array.from(pofIdl.accounts!.find((a) => a.name === "Certificate")!.discriminator),
    offset: (field: "subject_kind" | "subject_hash" | "asset" | "tier" | "status") => fieldOffset(pofIdl, "Certificate", field),
  },
  room: {
    discriminator: () => Uint8Array.from(gateIdl.accounts!.find((a) => a.name === "Room")!.discriminator),
  },
  member: {
    discriminator: () => Uint8Array.from(gateIdl.accounts!.find((a) => a.name === "Member")!.discriminator),
    offset: (field: "room" | "subject_hash") => fieldOffset(gateIdl, "Member", field),
  },
};

/* ---------- events (Anchor `emit!`, "Program data: <base64>" log lines) ---------- */

export interface PofEvent { name: string; data: Record<string, any> }

/** Decode every pof event in a transaction's log lines. */
export function decodeEvents(logs: string[], idl: Idl = pofIdl): PofEvent[] {
  const evs = (idl as any).events ?? [];
  const out: PofEvent[] = [];
  for (const l of logs) {
    const m = /^Program data: (.+)$/.exec(l);
    if (!m) continue;
    let b: Uint8Array;
    try {
      const bin = atob(m[1]);
      b = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    } catch {
      continue;
    }
    const e = evs.find((x: any) => x.discriminator.every((v: number, i: number) => b[i] === v));
    if (!e) continue;
    const d = idl.types?.find((t) => t.name === e.name);
    if (!d || d.type.kind !== "struct") continue;
    try {
      out.push({ name: e.name, data: new Reader(b, 8).struct(idl, d.type.fields ?? []) });
    } catch {
      /* a truncated line */
    }
  }
  return out;
}
