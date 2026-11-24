/**
 * THE one module that knows the on-chain account layouts (CONTRACT.md §6).
 * Layouts come from the IDL; this file maps the raw IDL fields to stable SDK objects,
 * tolerating small naming differences so an IDL rename does not break consumers.
 */
import { POF_IDL, POF_GATE_IDL } from "./idl/index.js";
import { decodeAccount, fieldOffset, type Idl } from "./borsh.js";
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
  raw: Record<string, any>;
}

export interface Member {
  address: string;
  room: string;
  /** hex */
  subjectHash: string;
  certificate: string | null;
  joinedSlot: number | null;
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
  const hashes: any[] = pick(r, "nullifier_hashes", "nullifierHashes", "nullset", "nullifiers") ?? [];
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
    name: typeof name === "string" ? name.replace(/\0+$/, "") : name instanceof Uint8Array ? new TextDecoder().decode(name).replace(/\0+$/, "") : null,
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
  };
}

export function decodeConfig(data: Uint8Array): Record<string, any> {
  return decodeAccount(pofIdl, "Config", data);
}

/** Live means: status byte live AND the expiry slot not yet reached. */
export function effectiveStatus(c: Pick<Certificate, "status" | "expirySlot">, currentSlot: number): StatusName {
  if (c.status === 0 && currentSlot >= c.expirySlot) return "expired";
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
