import { type AddressLike } from "./base58.js";
export declare const ATTESTATION_LEN = 208;
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
    nonce: string;
}
export declare function parseAttestation(bytes: Uint8Array): Attestation;
export declare function buildAttestation(a: Omit<Attestation, "programId" | "payer"> & {
    programId: AddressLike;
    payer: AddressLike;
}): Uint8Array;
export declare function verifyAttestationSignature(attestation: Uint8Array, signature: Uint8Array, verifierKey: AddressLike): Promise<boolean>;
