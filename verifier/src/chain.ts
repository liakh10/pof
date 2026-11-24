/* What the relayer and the keeper need from the pof program. The implementation over the program's IDL is in program.ts;
   tests use a fake. */
export interface CertificateView {
  address: string; status: number; tier: number; expirySlot: bigint; hashes: string[]; payer: string;
  controller?: string; nullsetHash?: string; issuedSlot?: bigint;
}
export interface PofChain {
  slot(): Promise<bigint>;
  certificate(subjectHash: Uint8Array, asset: number): Promise<CertificateView | null>;
  /** the ed25519 instruction and certify in one transaction paid by the relayer */
  certify(input: { attestation: Uint8Array; signature: Uint8Array; verifierKey: Uint8Array; logIndex: number | bigint; hashes: Uint8Array[] }): Promise<{ signature: string; lamports: bigint }>;
  revokeSpent(input: { subjectHash: Uint8Array; asset: number; index: number; salt: Uint8Array; nullifier: Uint8Array; tree: string }): Promise<{ signature: string; lamports: bigint }>;
  /** the ed25519 instruction over the §7 signed head and anchor_log (the program keeps the latest head in the treasury) */
  anchorLog(size: number, root: Uint8Array): Promise<{ signature: string; lamports: bigint }>;
  relayerBalance(): Promise<bigint>;
  /** [ed25519(controller, revokeBytes), revoke_signed()] paid by the relayer; absent until the program has it */
  revokeSigned?(input: { subjectHash: Uint8Array; asset: number; signature: Uint8Array; validUntil?: bigint }): Promise<{ signature: string; lamports: bigint }>;
  /** 1: the 148 POF-REVOKE1 bytes; 2: the 156 POF-REVOKE2 bytes with a valid_until slot (RV-01) */
  revokeVersion?: number;
  /** SystemProgram transfers to the relayer since a slot, in transactions that carry the memo "pof:<reference>" (A2-03):
   *  a refund, a close or any other credit that is not a transfer instruction never counts */
  incoming(sinceSlot: bigint, reference: string): Promise<{ signature: string; slot: bigint; lamports: bigint; reference: string }[]>;
  quoteLamports(): Promise<{ fee: bigint; rent: bigint; network: bigint }>;
  /** ZK-06: for each zk tag, whether its note lock ["znote", tag] holds it for a live zk certificate that still lists it */
  zkLocked?(tags: Uint8Array[]): Promise<boolean[]>;
  /** the Config's max_attest_age: how long after its issue slot the program still accepts an attestation */
  maxAttestAge?(): Promise<bigint>;
}
export const STATUS = { live: 0, revokedSpent: 1, revokedHolder: 2, expired: 3 } as const;

/** the largest max_attest_age the program accepts (lib.rs Params::check); the bound used when the Config cannot be read */
export const PROGRAM_MAX_ATTEST_AGE = 9_000n;
/** extra slots on top of max_attest_age, for the clock skew between our read and the program's */
export const LAND_MARGIN = 150n;
/** how long an attestation may still land: max(the given floor, the Config's max_attest_age, or the program's cap) + margin */
export async function landingWindow(chain: PofChain | null, floor = 0n): Promise<bigint> {
  let age = PROGRAM_MAX_ATTEST_AGE;
  if (chain?.maxAttestAge) { try { age = await chain.maxAttestAge(); } catch { age = PROGRAM_MAX_ATTEST_AGE; } }
  return (age > floor ? age : floor) + LAND_MARGIN;
}
