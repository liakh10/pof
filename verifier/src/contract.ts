/* The bytes of pof/CONTRACT.md, in one place: §1 subjects, §2 assets and tiers, §3 the attestation, §5 salted nullifiers,
   §7 the transparency log leaf and signed tree head. The program rebuilds §3 on chain; devx's SDK rebuilds §7. */
import { PofError, concat, equal, fromB58, readU64le, sha256, text, toB58, u64le } from './codec.js';

/* §1 */
export const SUBJECT = { wallet: 0, x: 1, badge: 2 } as const;
export type SubjectKind = 0 | 1 | 2;

export function normalHandle(v: string): string {
  const h = String(v || '').trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_]{1,15}$/.test(h)) throw new PofError('BAD_HANDLE', 'an X handle is 1 to 15 letters, digits or underscores');
  return h;
}

export function subjectHash(kind: number, value: string): Uint8Array {
  if (kind === SUBJECT.wallet) { fromB58(value, 32, 'subject wallet'); return sha256(text('pof:wallet:' + value)); }
  if (kind === SUBJECT.x) return sha256(text('pof:x:' + normalHandle(value)));
  if (kind === SUBJECT.badge) { fromB58(value, 32, 'badge key'); return sha256(text('pof:badge:' + value)); }
  throw new PofError('BAD_SUBJECT_KIND', 'subject.kind is 0 (wallet), 1 (X handle) or 2 (badge)');
}

/* §2: the minimum of each tier in base units (lamports, USDC micro-units). The program's Config is the source of truth; the
   Verifier's copy must equal it (checked at start-up against the chain when POF_PROGRAM is deployed). */
export const ASSETS: Record<number, { name: string; decimals: number; mint: string; tiers: bigint[] }> = {
  0: { name: 'SOL', decimals: 9, mint: '11111111111111111111111111111111', tiers: [1n, 10n, 100n, 1_000n, 10_000n].map(x => x * 1_000_000_000n) },
  1: { name: 'USDC', decimals: 6, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', tiers: [100n, 1_000n, 10_000n, 100_000n, 1_000_000n].map(x => x * 1_000_000n) },
};

export function tierMinimum(asset: number, tier: number): bigint {
  const a = ASSETS[asset];
  if (!a) throw new PofError('BAD_ASSET', 'asset is 0 (SOL) or 1 (USDC)');
  if (!Number.isInteger(tier) || tier < 1 || tier > a.tiers.length) throw new PofError('BAD_TIER', `tier is 1 to ${a.tiers.length} for ${a.name}`);
  return a.tiers[tier - 1];
}

/* §3: 208 bytes */
export const ATTESTATION_LEN = 208;
export const DOMAIN = text('POF1');
export interface Attestation {
  programId: Uint8Array; subjectKind: number; subjectHash: Uint8Array; asset: number; tier: number;
  treeRoot: Uint8Array; rootSlot: bigint; noteCount: number; nullsetHash: Uint8Array;
  issuedSlot: bigint; expirySlot: bigint; payer: Uint8Array; nonce: Uint8Array;
}

export function encodeAttestation(a: Attestation): Uint8Array {
  const b = concat(DOMAIN, a.programId, Uint8Array.of(a.subjectKind), a.subjectHash, Uint8Array.of(a.asset), Uint8Array.of(a.tier),
    a.treeRoot, u64le(a.rootSlot), Uint8Array.of(a.noteCount), a.nullsetHash, u64le(a.issuedSlot), u64le(a.expirySlot), a.payer, a.nonce);
  if (b.length !== ATTESTATION_LEN) throw new PofError('INTERNAL', `attestation is ${b.length} bytes`, 500);
  return b;
}

export function decodeAttestation(b: Uint8Array): Attestation {
  if (b.length !== ATTESTATION_LEN || !equal(b.subarray(0, 4), DOMAIN)) throw new PofError('BAD_ATTESTATION', 'not a POF1 attestation');
  return {
    programId: b.slice(4, 36), subjectKind: b[36], subjectHash: b.slice(37, 69), asset: b[69], tier: b[70],
    treeRoot: b.slice(71, 103), rootSlot: readU64le(b, 103), noteCount: b[111], nullsetHash: b.slice(112, 144),
    issuedSlot: readU64le(b, 144), expirySlot: readU64le(b, 152), payer: b.slice(160, 192), nonce: b.slice(192, 208),
  };
}

/* §5 */
export const saltedNullifier = (salt: Uint8Array, nullifier: Uint8Array): Uint8Array => sha256(text('pof:null:'), salt, nullifier);
export function sortHashes(hs: Uint8Array[]): Uint8Array[] {
  return [...hs].sort((x, y) => { for (let i = 0; i < 32; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; });
}
export const nullsetHash = (sorted: Uint8Array[]): Uint8Array => sha256(...sorted);

/* §7 */
export const LEAF_LEN = 345;
export function logLeaf(att: Uint8Array, sig: Uint8Array, verifierKey: Uint8Array, bundleHash: Uint8Array, loggedSlot: bigint): Uint8Array {
  const b = concat(Uint8Array.of(1), att, sig, verifierKey, bundleHash, u64le(loggedSlot));
  if (b.length !== LEAF_LEN) throw new PofError('INTERNAL', 'leaf length', 500);
  return b;
}
export function decodeLeaf(b: Uint8Array) {
  if (b.length !== LEAF_LEN || b[0] !== 1) throw new PofError('BAD_LEAF', 'not a v1 log leaf');
  return { attestation: b.slice(1, 209), signature: b.slice(209, 273), verifierKey: b.slice(273, 305), bundleHash: b.slice(305, 337), loggedSlot: readU64le(b, 337) };
}
export const sthBytes = (programId: Uint8Array, size: bigint | number, root: Uint8Array): Uint8Array => concat(text('POF-STH1'), programId, u64le(size), root);
export const anchorMemo = (size: bigint | number, root: Uint8Array): string => `pof:log:${String(size)}:${Buffer.from(root).toString('hex')}`;

/* §4: the message a wallet (kind 0) or a badge key (kind 2) signs to prove the subject. Human-readable, so a wallet shows
   what it signs. `slot` is a recent slot read by the client; the Verifier takes it within SUBJECT_PROOF_SLOTS. */
export function subjectMessage(m: { programId: string; kind: number; value: string; ring: string; asset: number; tier: number; payer: string; slot: bigint | number }): Uint8Array {
  return text([
    'Proof of Funds: subject proof',
    `program: ${m.programId}`,
    `subject: ${['wallet', 'x', 'badge'][m.kind]} ${m.value}`,
    `ring: ${m.ring}`,
    `asset: ${ASSETS[m.asset]?.name} tier: ${m.tier}`,
    `payer: ${m.payer}`,
    `slot: ${String(m.slot)}`,
  ].join('\n'));
}

/* the X link token (subject kind 1 proof): the Verifier's own signature over this, so no state is kept between link and attest */
export const linkTokenBytes = (programId: Uint8Array, handle: string, expiresAt: bigint | number): Uint8Array =>
  concat(text('POF-LINK1'), programId, text(normalHandle(handle)), Uint8Array.of(0), u64le(expiresAt));

export const certificateSeeds = (subjectHash: Uint8Array, asset: number): Uint8Array[] => [text('cert'), subjectHash, Uint8Array.of(asset)];
export { toB58 };
