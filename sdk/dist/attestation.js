/** CONTRACT §3: the 208 bytes the Verifier signs. */
import { concat, ed25519Verify, fromHex, toHex, utf8, u64le } from "./bytes.js";
import { encodeBase58, toAddressBytes } from "./base58.js";
export const ATTESTATION_LEN = 208;
export function parseAttestation(bytes) {
    if (bytes.length !== ATTESTATION_LEN)
        throw new Error(`an attestation is ${ATTESTATION_LEN} bytes, got ${bytes.length}`);
    if (new TextDecoder().decode(bytes.slice(0, 4)) !== "POF1")
        throw new Error("not a POF1 attestation");
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return {
        programId: encodeBase58(bytes.slice(4, 36)),
        subjectKind: bytes[36],
        subjectHash: toHex(bytes.slice(37, 69)),
        asset: bytes[69],
        tier: bytes[70],
        treeRoot: toHex(bytes.slice(71, 103)),
        rootSlot: Number(dv.getBigUint64(103, true)),
        noteCount: bytes[111],
        nullsetHash: toHex(bytes.slice(112, 144)),
        issuedSlot: Number(dv.getBigUint64(144, true)),
        expirySlot: Number(dv.getBigUint64(152, true)),
        payer: encodeBase58(bytes.slice(160, 192)),
        nonce: toHex(bytes.slice(192, 208)),
    };
}
export function buildAttestation(a) {
    const out = concat(utf8("POF1"), toAddressBytes(a.programId), Uint8Array.of(a.subjectKind), fromHex(a.subjectHash), Uint8Array.of(a.asset, a.tier), fromHex(a.treeRoot), u64le(a.rootSlot), Uint8Array.of(a.noteCount), fromHex(a.nullsetHash), u64le(a.issuedSlot), u64le(a.expirySlot), toAddressBytes(a.payer), fromHex(a.nonce));
    if (out.length !== ATTESTATION_LEN)
        throw new Error("bad attestation field sizes");
    return out;
}
export function verifyAttestationSignature(attestation, signature, verifierKey) {
    return ed25519Verify(toAddressBytes(verifierKey), attestation, signature);
}
