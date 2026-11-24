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
/** RFC 9162 §2.1.4.1 PROOF(m, D[n]) over already-hashed leaves: the consistency proof from size m to size n. */
export declare function consistencyProof(m: number, leafHashes: Uint8Array[]): Promise<Uint8Array[]>;
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
        /** the leaf's (and the head's) verifier key is one of `trustedKeys`: false when no trusted keys were given */
        keyTrusted: boolean;
        included: boolean;
        headSigned: boolean | null;
        programMatches: boolean | null;
    };
    leaf: LogLeaf | null;
}
/**
 * Verify a log entry end to end: the leaf parses, the attestation inside carries a valid signature by a TRUSTED verifier
 * key, the audit path leads to the root, and (if a signed head is given) the head is signed by a trusted key.
 * `trustedKeys` must come from the chain (PofClient.verifierKeys()), never from the log: without them `ok` is false.
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
    trustedKeys: string[];
}): Promise<ProofCheck>;
/**
 * Does this log leaf hold the attestation behind this certificate? The certificate's `log_index` is not signed
 * (the submitter chose it), so match on the signed bytes: subject, asset, tier, nullset hash, nonce, payer, controller,
 * issue and expiry slots, and the verifier key.
 */
export declare function matchCertificateLeaf(cert: {
    subjectHash: string;
    asset: number;
    tier: number;
    nullsetHash: string | null;
    nonce: string | null;
    payer: string;
    controller: string | null;
    issuedSlot: number | null;
    expirySlot: number;
    verifier: string;
}, leaf: LogLeaf): {
    matches: boolean;
    mismatched: string[];
};
/** The 88 bytes a witness signs: "POF-WIT1" ‖ program_id ‖ tree_size u64 LE ‖ root_hash ‖ timestamp u64 LE (unix seconds). */
export declare function cosignMessage(programId: AddressLike, treeSize: number, rootHash: Uint8Array | Hex, timestamp: number): Uint8Array;
export interface Cosignature {
    witnessKey: string;
    treeSize: number;
    rootHash: Hex;
    timestamp: number;
    signature: Hex;
}
export declare function verifyCosignature(c: Cosignature, programId: AddressLike): Promise<boolean>;
export interface LogEntryJson {
    index: number;
    leaf: Hex;
    leafHash?: Hex;
}
/** A small reader for GET /api/attest/log (?head, ?entry, ?proof, ?consistency, ?from&to). */
export declare class LogReader {
    base: string;
    private f;
    constructor(base: string, f?: typeof fetch);
    private get;
    head(): Promise<SignedTreeHead>;
    entry(i: number): Promise<LogEntryJson>;
    proof(i: number, size: number): Promise<{
        index: number;
        treeSize: number;
        rootHash: Hex;
        path: Hex[];
    }>;
    consistency(first: number, second: number): Promise<{
        first: number;
        second: number;
        firstRoot?: Hex;
        secondRoot?: Hex;
        path: Hex[];
    }>;
    /** entries [from, to), fetched in pages of up to 256 */
    entries(from: number, to: number): Promise<LogEntryJson[]>;
}
export interface AuditResult {
    ok: boolean;
    treeSize: number;
    rootHash: Hex;
    checks: {
        headSigned: boolean;
        rootRecomputed: boolean;
        entriesSigned: number;
        entriesBad: number[];
        /** the on-chain anchor (Treasury) is a prefix of this log with the same root, or null when there is none */
        anchorMatches: boolean | null;
        programMatches: boolean;
    };
    anchor: {
        treeSize: number;
        rootHash: Hex;
        slot: number;
    } | null;
}
/**
 * Download the whole log, recompute every leaf hash and the root, check the signed head, every attestation signature,
 * and that the root anchored on chain equals the root of the same-size prefix.
 */
export declare function auditLog(args: {
    reader: LogReader;
    programId: AddressLike;
    anchor?: {
        treeSize: number;
        rootHash: Hex;
        slot: number;
    } | null;
    /** verifier keys from the chain (PofClient.verifierKeys); a head or entry signed by any other key fails */
    trustedKeys: string[];
    onProgress?: (done: number, total: number) => void;
}): Promise<AuditResult>;
export {};
