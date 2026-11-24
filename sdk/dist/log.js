/** CONTRACT §7: the transparency log. RFC 9162 Merkle hashing, inclusion and consistency proofs, signed tree heads. */
import { concat, ed25519Verify, equalBytes, fromHex, sha256, toHex, utf8, u64le } from "./bytes.js";
import { encodeBase58, toAddressBytes } from "./base58.js";
import { parseAttestation, verifyAttestationSignature } from "./attestation.js";
export const LEAF_LEN = 345;
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
export function verifyTreeHead(sth, programId) {
    return ed25519Verify(toAddressBytes(sth.verifierKey), treeHeadMessage(programId, sth.treeSize, sth.rootHash), fromHex(sth.signature));
}
export function parseLeaf(leaf) {
    const b = h(leaf);
    if (b.length !== LEAF_LEN)
        throw new Error(`a log leaf is ${LEAF_LEN} bytes, got ${b.length}`);
    if (b[0] !== 1)
        throw new Error(`unknown log leaf version ${b[0]}`);
    const att = b.slice(1, 209);
    return {
        version: b[0],
        attestationBytes: toHex(att),
        attestation: parseAttestation(att),
        signature: toHex(b.slice(209, 273)),
        verifierKey: encodeBase58(b.slice(273, 305)),
        bundleHash: toHex(b.slice(305, 337)),
        loggedSlot: Number(new DataView(b.buffer, b.byteOffset).getBigUint64(337, true)),
    };
}
/**
 * Verify a log entry end to end: the leaf parses, the attestation inside carries a valid Verifier signature,
 * the audit path leads to the root, and (if a signed head is given) the head is signed by the same key set.
 */
export async function verifyLogEntry(args) {
    const checks = { leafParses: false, attestationSigned: false, included: false, headSigned: null, programMatches: null };
    let leaf = null;
    try {
        leaf = parseLeaf(args.leaf);
        checks.leafParses = true;
    }
    catch {
        return { ok: false, checks, leaf };
    }
    checks.attestationSigned = await verifyAttestationSignature(fromHex(leaf.attestationBytes), fromHex(leaf.signature), leaf.verifierKey);
    checks.included = await verifyInclusion({
        leafHash: await leafHash(h(args.leaf)), index: args.index, treeSize: args.proof.treeSize, path: args.proof.path, rootHash: args.proof.rootHash,
    });
    if (args.programId)
        checks.programMatches = leaf.attestation.programId === encodeBase58(toAddressBytes(args.programId));
    if (args.head) {
        const trusted = args.trustedKeys ?? [leaf.verifierKey];
        checks.headSigned =
            trusted.includes(args.head.verifierKey) &&
                args.head.treeSize === args.proof.treeSize &&
                args.head.rootHash.toLowerCase() === args.proof.rootHash.toLowerCase() &&
                (await verifyTreeHead(args.head, leaf.attestation.programId));
    }
    const ok = checks.leafParses && checks.attestationSigned && checks.included && checks.headSigned !== false && checks.programMatches !== false;
    return { ok, checks, leaf };
}
