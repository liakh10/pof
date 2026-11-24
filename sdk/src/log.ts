/** CONTRACT §7: the transparency log. RFC 9162 Merkle hashing, inclusion and consistency proofs, signed tree heads. */
import { concat, ed25519Verify, equalBytes, fromHex, sha256, toHex, utf8, u64le } from "./bytes.js";
import { encodeBase58, toAddressBytes, type AddressLike } from "./base58.js";
import { parseAttestation, verifyAttestationSignature, type Attestation } from "./attestation.js";

/** 1 + 240 (§3) + 64 + 32 + 32 + 8. The 345-byte form carried the 208-byte draft attestation. */
export const LEAF_LEN = 377;
export const LEAF_LEN_V0 = 345;

type Hex = string;
const h = (x: Uint8Array | Hex) => (typeof x === "string" ? fromHex(x) : x);

export function leafHash(leaf: Uint8Array): Promise<Uint8Array> {
  return sha256(Uint8Array.of(0), leaf);
}
export function nodeHash(left: Uint8Array, right: Uint8Array): Promise<Uint8Array> {
  return sha256(Uint8Array.of(1), left, right);
}

function largestPow2Below(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

/** RFC 9162 §2.1.1 MTH over already-hashed leaves. */
export async function merkleRoot(leafHashes: Uint8Array[]): Promise<Uint8Array> {
  if (leafHashes.length === 0) return sha256(new Uint8Array(0));
  if (leafHashes.length === 1) return leafHashes[0];
  const k = largestPow2Below(leafHashes.length);
  return nodeHash(await merkleRoot(leafHashes.slice(0, k)), await merkleRoot(leafHashes.slice(k)));
}

/** RFC 9162 §2.1.3.1 PATH(m, D[n]) over already-hashed leaves. */
export async function inclusionPath(index: number, leafHashes: Uint8Array[]): Promise<Uint8Array[]> {
  const n = leafHashes.length;
  if (index < 0 || index >= n) throw new Error("index out of range");
  if (n === 1) return [];
  const k = largestPow2Below(n);
  if (index < k) return [...(await inclusionPath(index, leafHashes.slice(0, k))), await merkleRoot(leafHashes.slice(k))];
  return [...(await inclusionPath(index - k, leafHashes.slice(k))), await merkleRoot(leafHashes.slice(0, k))];
}

/** RFC 9162 §2.1.4.1 PROOF(m, D[n]) over already-hashed leaves: the consistency proof from size m to size n. */
export async function consistencyProof(m: number, leafHashes: Uint8Array[]): Promise<Uint8Array[]> {
  const n = leafHashes.length;
  if (m < 0 || m > n) throw new Error("size out of range");
  if (m === 0 || m === n) return [];
  return subproof(m, leafHashes, true);
}
async function subproof(m: number, d: Uint8Array[], b: boolean): Promise<Uint8Array[]> {
  const n = d.length;
  if (m === n) return b ? [] : [await merkleRoot(d)];
  const k = largestPow2Below(n);
  if (m <= k) return [...(await subproof(m, d.slice(0, k), b)), await merkleRoot(d.slice(k))];
  return [...(await subproof(m - k, d.slice(k), false)), await merkleRoot(d.slice(0, k))];
}

/** RFC 9162 §2.1.3.2: verify an audit path. */
export async function verifyInclusion(args: {
  leafHash: Uint8Array | Hex; index: number; treeSize: number; path: (Uint8Array | Hex)[]; rootHash: Uint8Array | Hex;
}): Promise<boolean> {
  const { index, treeSize } = args;
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(treeSize) || index < 0 || index >= treeSize) return false;
  let fn = BigInt(index);
  let sn = BigInt(treeSize - 1);
  let r = h(args.leafHash);
  for (const pRaw of args.path) {
    const p = h(pRaw);
    if (sn === 0n) return false;
    if ((fn & 1n) === 1n || fn === sn) {
      r = await nodeHash(p, r);
      if ((fn & 1n) === 0n) {
        while ((fn & 1n) === 0n && fn !== 0n) {
          fn >>= 1n;
          sn >>= 1n;
        }
      }
    } else {
      r = await nodeHash(r, p);
    }
    fn >>= 1n;
    sn >>= 1n;
  }
  return sn === 0n && equalBytes(r, h(args.rootHash));
}

/** RFC 9162 §2.1.4.2: verify a consistency proof between two tree sizes. */
export async function verifyConsistency(args: {
  size1: number; size2: number; root1: Uint8Array | Hex; root2: Uint8Array | Hex; proof: (Uint8Array | Hex)[];
}): Promise<boolean> {
  const { size1, size2 } = args;
  const root1 = h(args.root1);
  const root2 = h(args.root2);
  const proof = args.proof.map(h);
  if (size1 > size2 || size1 < 0) return false;
  if (size1 === size2) return proof.length === 0 && equalBytes(root1, root2);
  if (size1 === 0) return proof.length === 0;
  if (proof.length === 0) return false;
  let path = proof;
  // if size1 is an exact power of two, prepend root1
  if ((size1 & (size1 - 1)) === 0) path = [root1, ...proof];
  let fn = BigInt(size1 - 1);
  let sn = BigInt(size2 - 1);
  while ((fn & 1n) === 1n) {
    fn >>= 1n;
    sn >>= 1n;
  }
  let fr = path[0];
  let sr = path[0];
  for (const c of path.slice(1)) {
    if (sn === 0n) return false;
    if ((fn & 1n) === 1n || fn === sn) {
      fr = await nodeHash(c, fr);
      sr = await nodeHash(c, sr);
      if ((fn & 1n) === 0n) {
        while ((fn & 1n) === 0n && fn !== 0n) {
          fn >>= 1n;
          sn >>= 1n;
        }
      }
    } else {
      sr = await nodeHash(sr, c);
    }
    fn >>= 1n;
    sn >>= 1n;
  }
  return sn === 0n && equalBytes(fr, root1) && equalBytes(sr, root2);
}

/** The 80 bytes the Verifier signs for a tree head. */
export function treeHeadMessage(programId: AddressLike, treeSize: number, rootHash: Uint8Array | Hex): Uint8Array {
  return concat(utf8("POF-STH1"), toAddressBytes(programId), u64le(treeSize), h(rootHash));
}

export interface SignedTreeHead {
  treeSize: number;
  rootHash: Hex;
  slot?: number;
  signature: Hex;
  verifierKey: string;
}

/** A verifier key given as base58 or as 64 hex characters. */
export function keyBytes(k: string): Uint8Array {
  return /^(0x)?[0-9a-fA-F]{64}$/.test(k) ? fromHex(k) : toAddressBytes(k);
}
const sameKey = (a: string, b: string) => {
  try {
    return encodeBase58(keyBytes(a)) === encodeBase58(keyBytes(b));
  } catch {
    return false;
  }
};

export function verifyTreeHead(sth: SignedTreeHead, programId: AddressLike): Promise<boolean> {
  return ed25519Verify(keyBytes(sth.verifierKey), treeHeadMessage(programId, sth.treeSize, sth.rootHash), fromHex(sth.signature));
}

export interface LogLeaf {
  version: number;
  attestationBytes: Hex;
  attestation: Attestation;
  signature: Hex;
  verifierKey: string;
  bundleHash: Hex;
  loggedSlot: number;
}

export function parseLeaf(leaf: Uint8Array | Hex): LogLeaf {
  const b = h(leaf);
  if (b.length !== LEAF_LEN && b.length !== LEAF_LEN_V0) throw new Error(`a log leaf is ${LEAF_LEN} bytes, got ${b.length}`);
  if (b[0] !== 1) throw new Error(`unknown log leaf version ${b[0]}`);
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
export async function verifyLogEntry(args: {
  leaf: Uint8Array | Hex;
  index: number;
  proof: { treeSize: number; rootHash: Hex; path: Hex[] };
  head?: SignedTreeHead;
  programId?: AddressLike;
  /** keys a LEAF may be signed with: every key the program ever accepted (Config, VerifierSet history, certificates) */
  trustedKeys: string[];
  /** keys a HEAD may be signed with now: the active verifier only (audit W-02); default `trustedKeys` */
  headKeys?: string[];
}): Promise<ProofCheck> {
  const checks: ProofCheck["checks"] = { leafParses: false, attestationSigned: false, keyTrusted: false, included: false, headSigned: null, programMatches: null };
  let leaf: LogLeaf | null = null;
  try {
    leaf = parseLeaf(args.leaf);
    checks.leafParses = true;
  } catch {
    return { ok: false, checks, leaf };
  }
  const trusted = args.trustedKeys ?? [];
  checks.keyTrusted = trusted.some((k) => sameKey(k, leaf!.verifierKey));
  checks.attestationSigned = await verifyAttestationSignature(fromHex(leaf.attestationBytes), fromHex(leaf.signature), leaf.verifierKey);
  checks.included = await verifyInclusion({
    leafHash: await leafHash(h(args.leaf)), index: args.index, treeSize: args.proof.treeSize, path: args.proof.path, rootHash: args.proof.rootHash,
  });
  if (args.programId) checks.programMatches = leaf.attestation.programId === encodeBase58(toAddressBytes(args.programId));
  if (args.head) {
    const hk = args.headKeys ?? trusted;
    checks.headSigned =
      hk.some((k) => sameKey(k, args.head!.verifierKey)) &&
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
export function matchCertificateLeaf(
  cert: { subjectHash: string; asset: number; tier: number; nullsetHash: string | null; nonce: string | null; payer: string; controller: string | null; issuedSlot: number | null; expirySlot: number; verifier: string },
  leaf: LogLeaf,
): { matches: boolean; mismatched: string[] } {
  const a = leaf.attestation;
  const pairs: [string, unknown, unknown][] = [
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
export function cosignMessage(programId: AddressLike, treeSize: number, rootHash: Uint8Array | Hex, timestamp: number): Uint8Array {
  return concat(utf8("POF-WIT1"), toAddressBytes(programId), u64le(treeSize), h(rootHash), u64le(timestamp));
}

export interface Cosignature {
  witnessKey: string;
  treeSize: number;
  rootHash: Hex;
  timestamp: number;
  signature: Hex;
}

export function verifyCosignature(c: Cosignature, programId: AddressLike): Promise<boolean> {
  return ed25519Verify(keyBytes(c.witnessKey), cosignMessage(programId, c.treeSize, c.rootHash, c.timestamp), fromHex(c.signature));
}

/* ---------- reading the Verifier's log over HTTP (CONTRACT §7) ---------- */

export interface LogEntryJson { index: number; leaf: Hex; leafHash?: Hex }

/** A small reader for GET /api/attest/log (?head, ?entry, ?proof, ?consistency, ?from&to). */
export class LogReader {
  /** `headers`: extra request headers, e.g. a server-side reader's `x-pof-internal` (never set it in a browser) */
  constructor(public base: string, private f: typeof fetch = fetch, private headers: Record<string, string> = {}) {
    this.base = base.replace(/\/$/, "");
  }
  private async get<T>(qs: string): Promise<T> {
    const r = await this.f(`${this.base}?${qs}`, { headers: { accept: "application/json", ...this.headers } });
    const j: any = await r.json().catch(() => null);
    if (!r.ok || !j) throw new Error(`log ${qs}: ${j?.error?.message ?? j?.message ?? r.status}`);
    return j as T;
  }
  head(): Promise<SignedTreeHead> {
    return this.get("head");
  }
  entry(i: number): Promise<LogEntryJson> {
    return this.get(`entry=${i}`);
  }
  proof(i: number, size: number): Promise<{ index: number; treeSize: number; rootHash: Hex; path: Hex[] }> {
    return this.get(`proof=${i}&size=${size}`);
  }
  consistency(first: number, second: number): Promise<{ first: number; second: number; firstRoot?: Hex; secondRoot?: Hex; path: Hex[] }> {
    return this.get(`consistency=${first}&size=${second}`);
  }
  /** entries [from, to), fetched in pages of up to 256 */
  async entries(from: number, to: number): Promise<LogEntryJson[]> {
    const out: LogEntryJson[] = [];
    for (let a = from; a < to; ) {
      const b = Math.min(to, a + 256);
      const r = await this.get<{ entries: LogEntryJson[] }>(`from=${a}&to=${b}`);
      if (!r.entries?.length) throw new Error(`log returned no entries for ${a}..${b}`);
      out.push(...r.entries);
      a += r.entries.length;
    }
    return out;
  }
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
  anchor: { treeSize: number; rootHash: Hex; slot: number } | null;
}

/**
 * Download the whole log, recompute every leaf hash and the root, check the signed head, every attestation signature,
 * and that the root anchored on chain equals the root of the same-size prefix.
 */
export async function auditLog(args: {
  reader: LogReader;
  programId: AddressLike;
  anchor?: { treeSize: number; rootHash: Hex; slot: number } | null;
  /** verifier keys from the chain (PofClient.verifierKeys); a head or entry signed by any other key fails */
  trustedKeys: string[];
  /** keys the head may be signed with now (the active verifier); default trustedKeys */
  headKeys?: string[];
  onProgress?: (done: number, total: number) => void;
}): Promise<AuditResult> {
  const head = await args.reader.head();
  const trusted = args.trustedKeys ?? [];
  const headSigned = (args.headKeys ?? trusted).some((k) => sameKey(k, head.verifierKey)) && (await verifyTreeHead(head, args.programId));
  const entries = head.treeSize ? await args.reader.entries(0, head.treeSize) : [];
  const hashes: Uint8Array[] = [];
  const bad: number[] = [];
  let signed = 0;
  const pid = encodeBase58(toAddressBytes(args.programId));
  let programMatches = true;
  for (const [i, e] of entries.entries()) {
    const leaf = fromHex(e.leaf);
    hashes.push(await leafHash(leaf));
    try {
      const l = parseLeaf(leaf);
      if (l.attestation.programId !== pid) programMatches = false;
      if (trusted.some((k) => sameKey(k, l.verifierKey)) && (await verifyAttestationSignature(fromHex(l.attestationBytes), fromHex(l.signature), l.verifierKey))) signed++;
      else bad.push(i);
    } catch {
      bad.push(i);
    }
    if (args.onProgress && (i % 64 === 63 || i === entries.length - 1)) args.onProgress(i + 1, entries.length);
  }
  const root = toHex(await merkleRoot(hashes));
  const rootRecomputed = root === String(head.rootHash).toLowerCase() && hashes.length === head.treeSize;
  let anchorMatches: boolean | null = null;
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
