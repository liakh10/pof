/** CONTRACT §3: the 208 bytes the Verifier signs. */
import { concat, ed25519Verify, fromHex, toHex, utf8, u64le } from "./bytes.js";
import { encodeBase58, toAddressBytes, type AddressLike } from "./base58.js";

export const ATTESTATION_LEN = 240;
/** the first draft (before `controller`), still parsed for old log entries */
export const ATTESTATION_LEN_V0 = 208;

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

export function parseAttestation(bytes: Uint8Array): Attestation {
  if (bytes.length !== ATTESTATION_LEN && bytes.length !== ATTESTATION_LEN_V0)
    throw new Error(`an attestation is ${ATTESTATION_LEN} bytes, got ${bytes.length}`);
  const v0 = bytes.length === ATTESTATION_LEN_V0;
  if (new TextDecoder().decode(bytes.slice(0, 4)) !== "POF1") throw new Error("not a POF1 attestation");
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
    controller: v0 ? null : encodeBase58(bytes.slice(192, 224)),
    nonce: v0 ? toHex(bytes.slice(192, 208)) : toHex(bytes.slice(224, 240)),
  };
}

export function buildAttestation(
  a: Omit<Attestation, "programId" | "payer" | "controller"> & { programId: AddressLike; payer: AddressLike; controller: AddressLike },
): Uint8Array {
  const out = concat(
    utf8("POF1"),
    toAddressBytes(a.programId),
    Uint8Array.of(a.subjectKind),
    fromHex(a.subjectHash),
    Uint8Array.of(a.asset, a.tier),
    fromHex(a.treeRoot),
    u64le(a.rootSlot),
    Uint8Array.of(a.noteCount),
    fromHex(a.nullsetHash),
    u64le(a.issuedSlot),
    u64le(a.expirySlot),
    toAddressBytes(a.payer),
    toAddressBytes(a.controller),
    fromHex(a.nonce),
  );
  if (out.length !== ATTESTATION_LEN) throw new Error("bad attestation field sizes");
  return out;
}

export function verifyAttestationSignature(attestation: Uint8Array, signature: Uint8Array, verifierKey: AddressLike): Promise<boolean> {
  return ed25519Verify(toAddressBytes(verifierKey), attestation, signature);
}
