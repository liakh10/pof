/* What the relayer and the keeper need from the pof program. The implementation over the program's IDL is in program.ts;
   tests use a fake. */
export interface CertificateView {
  address: string; status: number; tier: number; expirySlot: bigint; hashes: string[]; payer: string;
}
export interface PofChain {
  slot(): Promise<bigint>;
  certificate(subjectHash: Uint8Array, asset: number): Promise<CertificateView | null>;
  /** the ed25519 instruction and certify in one transaction paid by the relayer */
  certify(input: { attestation: Uint8Array; signature: Uint8Array; verifierKey: Uint8Array; logIndex: number; hashes: Uint8Array[] }): Promise<{ signature: string; lamports: bigint }>;
  revokeSpent(input: { subjectHash: Uint8Array; asset: number; index: number; salt: Uint8Array; nullifier: Uint8Array; tree: string }): Promise<{ signature: string; lamports: bigint }>;
  /** the ed25519 instruction over the §7 signed head and anchor_log (the program keeps the latest head in the treasury) */
  anchorLog(size: number, root: Uint8Array): Promise<{ signature: string; lamports: bigint }>;
  relayerBalance(): Promise<bigint>;
  /** [ed25519(controller, revokeBytes), revoke_signed()] paid by the relayer; absent until the program has it */
  revokeSigned?(input: { subjectHash: Uint8Array; asset: number; signature: Uint8Array }): Promise<{ signature: string; lamports: bigint }>;
  /** incoming SOL transfers to the relayer since a slot: [{ signature, slot, lamports }] */
  incoming(sinceSlot: bigint): Promise<{ signature: string; slot: bigint; lamports: bigint }[]>;
  quoteLamports(): Promise<{ fee: bigint; rent: bigint; network: bigint }>;
}
export const STATUS = { live: 0, revokedSpent: 1, revokedHolder: 2, expired: 3 } as const;
