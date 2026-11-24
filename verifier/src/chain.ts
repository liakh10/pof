/* What the relayer and the keeper need from the pof program. The implementation over the program's IDL is in program.ts;
   tests use a fake. */
export interface CertificateView {
  address: string; status: number; tier: number; expirySlot: bigint; hashes: string[]; payer: string;
}
export interface PofChain {
  slot(): Promise<bigint>;
  certificate(subjectHash: Uint8Array, asset: number): Promise<CertificateView | null>;
  /** the ed25519 instruction, certify, and a Memo with the log anchor, in one transaction paid by the relayer */
  certify(input: { attestation: Uint8Array; signature: Uint8Array; verifierKey: Uint8Array; logIndex: number; memo: string; hashes: Uint8Array[] }): Promise<{ signature: string; lamports: bigint }>;
  revokeSpent(input: { subjectHash: Uint8Array; asset: number; index: number; salt: Uint8Array; nullifier: Uint8Array; tree: string }): Promise<{ signature: string; lamports: bigint }>;
  memo(text: string): Promise<{ signature: string; lamports: bigint }>;
  relayerBalance(): Promise<bigint>;
  /** incoming SOL transfers to the relayer since a slot: [{ signature, slot, lamports }] */
  incoming(sinceSlot: bigint): Promise<{ signature: string; slot: bigint; lamports: bigint }[]>;
  quoteLamports(): Promise<{ fee: bigint; rent: bigint; network: bigint }>;
}
export const STATUS = { live: 0, revokedSpent: 1, revokedHolder: 2, expired: 3 } as const;
