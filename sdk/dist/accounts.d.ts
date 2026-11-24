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
export declare function decodeCertificate(address: string, data: Uint8Array): Certificate;
export declare function decodeRoom(address: string, data: Uint8Array): Room;
export declare function decodeMember(address: string, data: Uint8Array): Member;
export declare function decodeConfig(data: Uint8Array): Record<string, any>;
/** Live means: status byte live AND the expiry slot not yet reached. */
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
