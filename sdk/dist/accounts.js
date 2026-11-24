/**
 * THE one module that knows the on-chain account layouts (CONTRACT.md §6).
 * Layouts come from the IDL; this file maps the raw IDL fields to stable SDK objects,
 * tolerating small naming differences so an IDL rename does not break consumers.
 */
import { POF_IDL, POF_GATE_IDL } from "./idl/index.js";
import { decodeAccount, fieldOffset, Reader } from "./borsh.js";
import { toHex, u64le } from "./bytes.js";
import { findProgramAddress } from "./pda.js";
import { toAddressBytes } from "./base58.js";
import { CERT_STATUS_NAMES, SUBJECT_KIND_NAMES, ASSETS, tierLabel, POF_PROGRAM_ID, POF_GATE_PROGRAM_ID, } from "./constants.js";
/* eslint-disable @typescript-eslint/no-explicit-any */
const pofIdl = POF_IDL;
const gateIdl = POF_GATE_IDL;
function pick(raw, ...names) {
    for (const n of names)
        if (raw[n] !== undefined)
            return raw[n];
    return undefined;
}
function num(v) {
    if (v === undefined || v === null)
        return null;
    const n = typeof v === "bigint" ? Number(v) : Number(v);
    return Number.isFinite(n) ? n : null;
}
function hex(v) {
    if (v instanceof Uint8Array)
        return toHex(v);
    if (Array.isArray(v))
        return toHex(Uint8Array.from(v));
    return String(v);
}
export function decodeCertificate(address, data) {
    const r = decodeAccount(pofIdl, "Certificate", data);
    const asset = Number(pick(r, "asset"));
    const tier = Number(pick(r, "tier"));
    const status = Number(pick(r, "status"));
    const noteCount = Number(pick(r, "note_count", "noteCount") ?? 0);
    const hashes = pick(r, "null_hashes", "nullifier_hashes", "nullifierHashes", "nullifiers") ?? [];
    const revIdx = num(pick(r, "revealed_index", "revealedIndex"));
    const optHex = (v) => (v === undefined || v === null ? null : hex(v));
    const optKey = (v) => (v === undefined || v === null ? null : String(v));
    const revoked = num(pick(r, "revoked_slot", "revokedSlot"));
    const kind = Number(pick(r, "subject_kind", "subjectKind"));
    const logIndex = num(pick(r, "log_index", "logIndex"));
    return {
        address,
        subjectKind: kind,
        subjectKindName: SUBJECT_KIND_NAMES[kind] ?? "wallet",
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
        revealed: revIdx !== null && revIdx !== 255
            ? { index: revIdx, salt: hex(pick(r, "revealed_salt")), nullifier: hex(pick(r, "revealed_nullifier")) }
            : null,
    };
}
export function decodeRoom(address, data) {
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
export function decodeMember(address, data) {
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
const DEFAULT_KEY = "11111111111111111111111111111111";
export function decodeConfig(data) {
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
        assets: (r.assets ?? []).map((a, id) => ({
            id, enabled: !!a.enabled, mint: String(a.mint), decimals: Number(a.decimals), mins: (a.mins ?? []).map((m) => String(m)),
        })),
        paused: !!r.paused, closing: !!r.closing, launchSlot: num(r.launch_slot) ?? 0,
        raw: r,
    };
}
/** The verifier key certify accepts at `slot` (CONTRACT §6: next_verifier once its slot is reached). */
export function activeVerifier(c, slot) {
    return c.nextVerifier && slot >= c.nextVerifierSlot ? c.nextVerifier : c.verifier;
}
export function decodeTreasury(data) {
    const r = decodeAccount(pofIdl, "Treasury", data);
    const n = (k) => num(r[k]) ?? 0;
    const size = n("log_size");
    return {
        feesIn: String(r.fees_in ?? 0), feesOut: String(r.fees_out ?? 0), certified: n("certified"), renewed: n("renewed"),
        revokedSpent: n("revoked_spent"), revokedHolder: n("revoked_holder"), expired: n("expired"), live: n("live"),
        liveMin: (r.live_min ?? []).map((x) => String(x)), open: n("open"), relayed: n("relayed"), exempt: n("exempt"),
        log: size ? { treeSize: size, rootHash: hex(r.log_head), slot: n("log_slot") } : null,
    };
}
/** Live means: status byte live AND `slot <= expiry_slot` (the program's own rule, Certificate::is_live). */
export function effectiveStatus(c, currentSlot) {
    if (c.status === 0 && currentSlot > c.expirySlot)
        return "expired";
    return CERT_STATUS_NAMES[c.status] ?? "live";
}
export function isLive(c, currentSlot) {
    return effectiveStatus(c, currentSlot) === "live";
}
/* ---------- PDAs (CONTRACT §6) ---------- */
export async function certificateAddress(subjectHash, asset, programId = POF_PROGRAM_ID) {
    return findProgramAddress(["cert", subjectHash, Uint8Array.of(asset)], programId);
}
export async function configAddress(programId = POF_PROGRAM_ID) {
    return findProgramAddress(["config"], programId);
}
export async function treasuryAddress(programId = POF_PROGRAM_ID) {
    return findProgramAddress(["treasury"], programId);
}
export async function roomAddress(creator, id, gateProgramId = POF_GATE_PROGRAM_ID) {
    return findProgramAddress(["room", toAddressBytes(creator), u64le(id)], gateProgramId);
}
export async function memberAddress(room, subjectHash, gateProgramId = POF_GATE_PROGRAM_ID) {
    return findProgramAddress(["member", toAddressBytes(room), subjectHash], gateProgramId);
}
/* ---------- memcmp offsets for getProgramAccounts filters ---------- */
export const layout = {
    certificate: {
        discriminator: () => Uint8Array.from(pofIdl.accounts.find((a) => a.name === "Certificate").discriminator),
        offset: (field) => fieldOffset(pofIdl, "Certificate", field),
    },
    room: {
        discriminator: () => Uint8Array.from(gateIdl.accounts.find((a) => a.name === "Room").discriminator),
    },
    member: {
        discriminator: () => Uint8Array.from(gateIdl.accounts.find((a) => a.name === "Member").discriminator),
        offset: (field) => fieldOffset(gateIdl, "Member", field),
    },
};
/** Decode every pof event in a transaction's log lines. */
export function decodeEvents(logs, idl = pofIdl) {
    const evs = idl.events ?? [];
    const out = [];
    for (const l of logs) {
        const m = /^Program data: (.+)$/.exec(l);
        if (!m)
            continue;
        let b;
        try {
            const bin = atob(m[1]);
            b = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        }
        catch {
            continue;
        }
        const e = evs.find((x) => x.discriminator.every((v, i) => b[i] === v));
        if (!e)
            continue;
        const d = idl.types?.find((t) => t.name === e.name);
        if (!d || d.type.kind !== "struct")
            continue;
        try {
            out.push({ name: e.name, data: new Reader(b, 8).struct(idl, d.type.fields ?? []) });
        }
        catch {
            /* a truncated line */
        }
    }
    return out;
}
