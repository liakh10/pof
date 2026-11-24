import { type AddressLike } from "./base58.js";
import { type Attestation } from "./attestation.js";
/** 1 + 240 (§3) + 64 + 32 + 32 + 8. The 345-byte form carried the 208-byte draft attestation. */
export declare const LEAF_LEN = 377;
export declare const LEAF_LEN_V0 = 345;
type Hex = string;
export declare function leafHash(leaf: Uint8Array): Promise<Uint8Array>;
export declare function nodeHash(left: Uint8Array, right: Uint8Array): Promise<Uint8Array>;
/** RFC 9162 §2.1.1 MTH over already-hashed leaves. */
export declare function merkleRoot(leafHashes: Uint8Array[]): Promise<Uint8Array>;
/** RFC 9162 §2.1.3.1 PATH(m, D[n]) over already-hashed leaves. */
export declare function inclusionPath(index: number, leafHashes: Uint8Array[]): Promise<Uint8Array[]>;
/** RFC 9162 §2.1.3.2: verify an audit path. */
export declare function verifyInclusion(args: {
    leafHash: Uint8Array | Hex;
    index: number;
    treeSize: number;
    path: (Uint8Array | Hex)[];
    rootHash: Uint8Array | Hex;
}): Promise<boolean>;
/** RFC 9162 §2.1.4.2: verify a consistency proof between two tree sizes. */
export declare function verifyConsistency(args: {
    size1: number;
    size2: number;
    root1: Uint8Array | Hex;
    root2: Uint8Array | Hex;
    proof: (Uint8Array | Hex)[];
}): Promise<boolean>;
/** The 80 bytes the Verifier signs for a tree head. */
export declare function treeHeadMessage(programId: AddressLike, treeSize: number, rootHash: Uint8Array | Hex): Uint8Array;
export interface SignedTreeHead {
    treeSize: number;
    rootHash: Hex;
    slot?: number;
    signature: Hex;
    verifierKey: string;
}
/** A verifier key given as base58 or as 64 hex characters. */
export declare function keyBytes(k: string): Uint8Array;
export declare function verifyTreeHead(sth: SignedTreeHead, programId: AddressLike): Promise<boolean>;
export interface LogLeaf {
    version: number;
    attestationBytes: Hex;
    attestation: Attestation;
    signature: Hex;
    verifierKey: string;
    bundleHash: Hex;
    loggedSlot: number;
}
export declare function parseLeaf(leaf: Uint8Array | Hex): LogLeaf;
export interface ProofCheck {
    ok: boolean;
    /** each check, so a UI can show which one failed */
    checks: {
        leafParses: boolean;
        attestationSigned: boolean;
        included: boolean;
        headSigned: boolean | null;
        programMatches: boolean | null;
    };
    leaf: LogLeaf | null;
}
/**
 * Verify a log entry end to end: the leaf parses, the attestation inside carries a valid Verifier signature,
 * the audit path leads to the root, and (if a signed head is given) the head is signed by the same key set.
 */
export declare function verifyLogEntry(args: {
    leaf: Uint8Array | Hex;
    index: number;
    proof: {
        treeSize: number;
        rootHash: Hex;
        path: Hex[];
    };
    head?: SignedTreeHead;
    programId?: AddressLike;
    /** keys you trust for tree heads; default: the leaf's own verifier key */
    trustedKeys?: string[];
}): Promise<ProofCheck>;
export {};
