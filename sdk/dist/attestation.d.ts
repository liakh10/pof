import { type AddressLike } from "./base58.js";
export declare const ATTESTATION_LEN = 240;
/** the first draft (before `controller`), still parsed for old log entries */
export declare const ATTESTATION_LEN_V0 = 208;
export interface Attestation {
    programId: string;
    subjectKind: number;
    subjectHash: string;
    asset: number;
    tier: number;
    treeRoot: string;
    rootSlot: number;
    noteCount: number;
    nullsetHash: string;
    issuedSlot: number;
    expirySlot: number;
    payer: string;
    /** the key that may revoke and join rooms (null in the 208-byte draft) */
    controller: string | null;
    nonce: string;
}
export declare function parseAttestation(bytes: Uint8Array): Attestation;
export declare function buildAttestation(a: Omit<Attestation, "programId" | "payer" | "controller"> & {
    programId: AddressLike;
    payer: AddressLike;
    controller: AddressLike;
}): Uint8Array;
export declare function verifyAttestationSignature(attestation: Uint8Array, signature: Uint8Array, verifierKey: AddressLike): Promise<boolean>;
