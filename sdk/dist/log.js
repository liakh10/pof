/** CONTRACT §7: the transparency log. RFC 9162 Merkle hashing, inclusion and consistency proofs, signed tree heads. */
import { concat, ed25519Verify, equalBytes, fromHex, sha256, toHex, utf8, u64le } from "./bytes.js";
import { encodeBase58, toAddressBytes } from "./base58.js";
import { parseAttestation, verifyAttestationSignature } from "./attestation.js";
/** 1 + 240 (§3) + 64 + 32 + 32 + 8. The 345-byte form carried the 208-byte draft attestation. */
export const LEAF_LEN = 377;
export const LEAF_LEN_V0 = 345;
const h = (x) => (typeof x === "string" ? fromHex(x) : x);
export function leafHash(leaf) {
    return sha256(Uint8Array.of(0), leaf);
}
export function nodeHash(left, right) {
    return sha256(Uint8Array.of(1), left, right);
}
function largestPow2Below(n) {
    let k = 1;
    while (k * 2 < n)
        k *= 2;
    return k;
}
/** RFC 9162 §2.1.1 MTH over already-hashed leaves. */
export async function merkleRoot(leafHashes) {
    if (leafHashes.length === 0)
        return sha256(new Uint8Array(0));
    if (leafHashes.length === 1)
        return leafHashes[0];
    const k = largestPow2Below(leafHashes.length);
    return nodeHash(await merkleRoot(leafHashes.slice(0, k)), await merkleRoot(leafHashes.slice(k)));
}
/** RFC 9162 §2.1.3.1 PATH(m, D[n]) over already-hashed leaves. */
export async function inclusionPath(index, leafHashes) {
    const n = leafHashes.length;
    if (index < 0 || index >= n)
        throw new Error("index out of range");
    if (n === 1)
        return [];
    const k = largestPow2Below(n);
    if (index < k)
        return [...(await inclusionPath(index, leafHashes.slice(0, k))), await merkleRoot(leafHashes.slice(k))];
    return [...(await inclusionPath(index - k, leafHashes.slice(k))), await merkleRoot(leafHashes.slice(0, k))];
}
/** RFC 9162 §2.1.4.1 PROOF(m, D[n]) over already-hashed leaves: the consistency proof from size m to size n. */
export async function consistencyProof(m, leafHashes) {
    const n = leafHashes.length;
    if (m < 0 || m > n)
        throw new Error("size out of range");
    if (m === 0 || m === n)
        return [];
    return subproof(m, leafHashes, true);
}
async function subproof(m, d, b) {
    const n = d.length;
    if (m === n)
        return b ? [] : [await merkleRoot(d)];
    const k = largestPow2Below(n);
    if (m <= k)
        return [...(await subproof(m, d.slice(0, k), b)), await merkleRoot(d.slice(k))];
    return [...(await subproof(m - k, d.slice(k), false)), await merkleRoot(d.slice(0, k))];
}
/** RFC 9162 §2.1.3.2: verify an audit path. */
export async function verifyInclusion(args) {
    const { index, treeSize } = args;
    if (!Number.isSafeInteger(index) || !Number.isSafeInteger(treeSize) || index < 0 || index >= treeSize)
        return false;
    let fn = BigInt(index);
    let sn = BigInt(treeSize - 1);
    let r = h(args.leafHash);
    for (const pRaw of args.path) {
        const p = h(pRaw);
        if (sn === 0n)
            return false;
        if ((fn & 1n) === 1n || fn === sn) {
            r = await nodeHash(p, r);
            if ((fn & 1n) === 0n) {
                while ((fn & 1n) === 0n && fn !== 0n) {
                    fn >>= 1n;
                    sn >>= 1n;
                }
            }
        }
        else {
            r = await nodeHash(r, p);
        }
        fn >>= 1n;
        sn >>= 1n;
    }
    return sn === 0n && equalBytes(r, h(args.rootHash));
}
/** RFC 9162 §2.1.4.2: verify a consistency proof between two tree sizes. */
export async function verifyConsistency(args) {
    const { size1, size2 } = args;
    const root1 = h(args.root1);
    const root2 = h(args.root2);
    const proof = args.proof.map(h);
    if (size1 > size2 || size1 < 0)
        return false;
    if (size1 === size2)
        return proof.length === 0 && equalBytes(root1, root2);
    if (size1 === 0)
        return proof.length === 0;
    if (proof.length === 0)
        return false;
    let path = proof;
    // if size1 is an exact power of two, prepend root1
    if ((size1 & (size1 - 1)) === 0)
        path = [root1, ...proof];
    let fn = BigInt(size1 - 1);
    let sn = BigInt(size2 - 1);
    while ((fn & 1n) === 1n) {
        fn >>= 1n;
        sn >>= 1n;
    }
    let fr = path[0];
    let sr = path[0];
    for (const c of path.slice(1)) {
        if (sn === 0n)
            return false;
        if ((fn & 1n) === 1n || fn === sn) {
            fr = await nodeHash(c, fr);
            sr = await nodeHash(c, sr);
            if ((fn & 1n) === 0n) {
                while ((fn & 1n) === 0n && fn !== 0n) {
                    fn >>= 1n;
                    sn >>= 1n;
                }
            }
        }
        else {
            sr = await nodeHash(sr, c);
        }
        fn >>= 1n;
        sn >>= 1n;
    }
    return sn === 0n && equalBytes(fr, root1) && equalBytes(sr, root2);
}
/** The 80 bytes the Verifier signs for a tree head. */
export function treeHeadMessage(programId, treeSize, rootHash) {
    return concat(utf8("POF-STH1"), toAddressBytes(programId), u64le(treeSize), h(rootHash));
}
/** A verifier key given as base58 or as 64 hex characters. */
export function keyBytes(k) {
    return /^(0x)?[0-9a-fA-F]{64}$/.test(k) ? fromHex(k) : toAddressBytes(k);
}
const sameKey = (a, b) => {
    try {
        return encodeBase58(keyBytes(a)) === encodeBase58(keyBytes(b));
    }
    catch {
        return false;
    }
};
export function verifyTreeHead(sth, programId) {
    return ed25519Verify(keyBytes(sth.verifierKey), treeHeadMessage(programId, sth.treeSize, sth.rootHash), fromHex(sth.signature));
}
export function parseLeaf(leaf) {
    const b = h(leaf);
    if (b.length !== LEAF_LEN && b.length !== LEAF_LEN_V0)
        throw new Error(`a log leaf is ${LEAF_LEN} bytes, got ${b.length}`);
    if (b[0] !== 1)
        throw new Error(`unknown log leaf version ${b[0]}`);
    const n = b.length - 137; // attestation length
    const att = b.slice(1, 1 + n);
    const o = 1 + n;
    return {
        version: b[0],
        attestationBytes: toHex(att),
        attestation: parseAttestation(att),
        signature: toHex(b.slice(o, o + 64)),
        verifierKey: encodeBase58(b.slice(o + 64, o + 96)),
        bundleHash: toHex(b.slice(o + 96, o + 128)),
        loggedSlot: Number(new DataView(b.buffer, b.byteOffset).getBigUint64(o + 128, true)),
    };
}
/**
 * Verify a log entry end to end: the leaf parses, the attestation inside carries a valid signature by a TRUSTED verifier
 * key, the audit path leads to the root, and (if a signed head is given) the head is signed by a trusted key.
 * `trustedKeys` must come from the chain (PofClient.verifierKeys()), never from the log: without them `ok` is false.
 */
export async function verifyLogEntry(args) {
    const checks = { leafParses: false, attestationSigned: false, keyTrusted: false, included: false, headSigned: null, programMatches: null };
    let leaf = null;
    try {
        leaf = parseLeaf(args.leaf);
        checks.leafParses = true;
    }
    catch {
        return { ok: false, checks, leaf };
    }
    const trusted = args.trustedKeys ?? [];
    checks.keyTrusted = trusted.some((k) => sameKey(k, leaf.verifierKey));
    checks.attestationSigned = await verifyAttestationSignature(fromHex(leaf.attestationBytes), fromHex(leaf.signature), leaf.verifierKey);
    checks.included = await verifyInclusion({
        leafHash: await leafHash(h(args.leaf)), index: args.index, treeSize: args.proof.treeSize, path: args.proof.path, rootHash: args.proof.rootHash,
    });
    if (args.programId)
        checks.programMatches = leaf.attestation.programId === encodeBase58(toAddressBytes(args.programId));
    if (args.head) {
        checks.headSigned =
            trusted.some((k) => sameKey(k, args.head.verifierKey)) &&
                args.head.treeSize === args.proof.treeSize &&
                args.head.rootHash.toLowerCase() === args.proof.rootHash.toLowerCase() &&
                (await verifyTreeHead(args.head, leaf.attestation.programId));
    }
    const ok = checks.leafParses && checks.attestationSigned && checks.keyTrusted && checks.included && checks.headSigned !== false && checks.programMatches !== false;
    return { ok, checks, leaf };
}
/**
 * Does this log leaf hold the attestation behind this certificate? The certificate's `log_index` is not signed
 * (the submitter chose it), so match on the signed bytes: subject, asset, tier, nullset hash, nonce, payer, controller,
 * issue and expiry slots, and the verifier key.
 */
export function matchCertificateLeaf(cert, leaf) {
    const a = leaf.attestation;
    const pairs = [
        ["subjectHash", cert.subjectHash, a.subjectHash],
        ["asset", cert.asset, a.asset],
        ["tier", cert.tier, a.tier],
        ["nullsetHash", cert.nullsetHash, a.nullsetHash],
        ["nonce", cert.nonce, a.nonce],
        ["payer", cert.payer, a.payer],
        ["controller", cert.controller, a.controller],
        ["issuedSlot", cert.issuedSlot, a.issuedSlot],
        ["expirySlot", cert.expirySlot, a.expirySlot],
        ["verifier", cert.verifier, leaf.verifierKey],
    ];
    const mismatched = pairs.filter(([, x, y]) => x !== null && x !== undefined && String(x).toLowerCase() !== String(y).toLowerCase()).map(([k]) => k);
    return { matches: mismatched.length === 0, mismatched };
}
/* ---------- witness cosignatures (CONTRACT §8) ---------- */
/** The 88 bytes a witness signs: "POF-WIT1" ‖ program_id ‖ tree_size u64 LE ‖ root_hash ‖ timestamp u64 LE (unix seconds). */
export function cosignMessage(programId, treeSize, rootHash, timestamp) {
    return concat(utf8("POF-WIT1"), toAddressBytes(programId), u64le(treeSize), h(rootHash), u64le(timestamp));
}
export function verifyCosignature(c, programId) {
    return ed25519Verify(keyBytes(c.witnessKey), cosignMessage(programId, c.treeSize, c.rootHash, c.timestamp), fromHex(c.signature));
}
/** A small reader for GET /api/attest/log (?head, ?entry, ?proof, ?consistency, ?from&to). */
export class LogReader {
    base;
    f;
    constructor(base, f = fetch) {
        this.base = base;
        this.f = f;
        this.base = base.replace(/\/$/, "");
    }
    async get(qs) {
        const r = await this.f(`${this.base}?${qs}`, { headers: { accept: "application/json" } });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j)
            throw new Error(`log ${qs}: ${j?.error?.message ?? j?.message ?? r.status}`);
        return j;
    }
    head() {
        return this.get("head");
    }
    entry(i) {
        return this.get(`entry=${i}`);
    }
    proof(i, size) {
        return this.get(`proof=${i}&size=${size}`);
    }
    consistency(first, second) {
        return this.get(`consistency=${first}&size=${second}`);
    }
    /** entries [from, to), fetched in pages of up to 256 */
    async entries(from, to) {
        const out = [];
        for (let a = from; a < to;) {
            const b = Math.min(to, a + 256);
            const r = await this.get(`from=${a}&to=${b}`);
            if (!r.entries?.length)
                throw new Error(`log returned no entries for ${a}..${b}`);
            out.push(...r.entries);
            a += r.entries.length;
        }
        return out;
    }
}
/**
 * Download the whole log, recompute every leaf hash and the root, check the signed head, every attestation signature,
 * and that the root anchored on chain equals the root of the same-size prefix.
 */
export async function auditLog(args) {
    const head = await args.reader.head();
    const trusted = args.trustedKeys ?? [];
    const headSigned = trusted.some((k) => sameKey(k, head.verifierKey)) && (await verifyTreeHead(head, args.programId));
    const entries = head.treeSize ? await args.reader.entries(0, head.treeSize) : [];
    const hashes = [];
    const bad = [];
    let signed = 0;
    const pid = encodeBase58(toAddressBytes(args.programId));
    let programMatches = true;
    for (const [i, e] of entries.entries()) {
        const leaf = fromHex(e.leaf);
        hashes.push(await leafHash(leaf));
        try {
            const l = parseLeaf(leaf);
            if (l.attestation.programId !== pid)
                programMatches = false;
            if (trusted.some((k) => sameKey(k, l.verifierKey)) && (await verifyAttestationSignature(fromHex(l.attestationBytes), fromHex(l.signature), l.verifierKey)))
                signed++;
            else
                bad.push(i);
        }
        catch {
            bad.push(i);
        }
        if (args.onProgress && (i % 64 === 63 || i === entries.length - 1))
            args.onProgress(i + 1, entries.length);
    }
    const root = toHex(await merkleRoot(hashes));
    const rootRecomputed = root === String(head.rootHash).toLowerCase() && hashes.length === head.treeSize;
    let anchorMatches = null;
    const anchor = args.anchor ?? null;
    if (anchor) {
        anchorMatches = anchor.treeSize <= hashes.length && toHex(await merkleRoot(hashes.slice(0, anchor.treeSize))) === anchor.rootHash.toLowerCase();
    }
    const ok = headSigned && rootRecomputed && bad.length === 0 && anchorMatches !== false && programMatches;
    return {
        ok, treeSize: head.treeSize, rootHash: root,
        checks: { headSigned, rootRecomputed, entriesSigned: signed, entriesBad: bad, anchorMatches, programMatches },
        anchor,
    };
}
