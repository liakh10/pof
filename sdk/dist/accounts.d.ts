import { type Idl } from "./borsh.js";
import { type AddressLike } from "./base58.js";
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
    revealed: {
        index: number;
        salt: string;
        nullifier: string;
    } | null;
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
export declare function decodeCertificate(address: string, data: Uint8Array): Certificate;
export declare function decodeRoom(address: string, data: Uint8Array): Room;
export declare function decodeMember(address: string, data: Uint8Array): Member;
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
    assets: {
        id: number;
        enabled: boolean;
        mint: string;
        decimals: number;
        mins: string[];
    }[];
    paused: boolean;
    closing: boolean;
    launchSlot: number;
    /** a lowered rotation delay takes effect only after the old one ran: until heldUntil, a new verifier waits heldDelay */
    heldDelay: number;
    heldUntil: number;
    /** the delay a verifier proposed at `slot` would wait */
    rotationDelayAt(slot: number): number;
    raw: Record<string, any>;
}
export declare function decodeConfig(data: Uint8Array): PofConfig;
/** The verifier key certify accepts at `slot` (CONTRACT §6: next_verifier once its slot is reached). */
export declare function activeVerifier(c: PofConfig, slot: number): string;
export interface Treasury {
    feesIn: string;
    feesOut: string;
    certified: number;
    renewed: number;
    revokedSpent: number;
    revokedHolder: number;
    expired: number;
    live: number;
    /** sum of tier minimums of live certificates by POF asset id, base units */
    liveMin: string[];
    open: number;
    relayed: number;
    exempt: number;
    /** the transparency log head anchored on chain by anchor_log */
    log: {
        treeSize: number;
        rootHash: string;
        slot: number;
    } | null;
}
export declare function decodeTreasury(data: Uint8Array): Treasury;
/** Live means: status byte live AND `slot <= expiry_slot` (the program's own rule, Certificate::is_live). */
export declare function effectiveStatus(c: Pick<Certificate, "status" | "expirySlot">, currentSlot: number): StatusName;
export declare function isLive(c: Pick<Certificate, "status" | "expirySlot">, currentSlot: number): boolean;
export declare function certificateAddress(subjectHash: Uint8Array, asset: number, programId?: AddressLike): Promise<[string, number]>;
export declare function configAddress(programId?: AddressLike): Promise<[string, number]>;
export declare function treasuryAddress(programId?: AddressLike): Promise<[string, number]>;
export declare function roomAddress(creator: AddressLike, id: bigint | number, gateProgramId?: AddressLike): Promise<[string, number]>;
export declare function memberAddress(room: AddressLike, subjectHash: Uint8Array, gateProgramId?: AddressLike): Promise<[string, number]>;
export declare const layout: {
    certificate: {
        discriminator: () => Uint8Array<ArrayBuffer>;
        offset: (field: "subject_kind" | "subject_hash" | "asset" | "tier" | "status") => number;
    };
    room: {
        discriminator: () => Uint8Array<ArrayBuffer>;
    };
    member: {
        discriminator: () => Uint8Array<ArrayBuffer>;
        offset: (field: "room" | "subject_hash") => number;
    };
};
export interface PofEvent {
    name: string;
    data: Record<string, any>;
}
/** Decode every pof event in a transaction's log lines. */
export declare function decodeEvents(logs: string[], idl?: Idl): PofEvent[];
