import { type Idl } from "./borsh.js";
import { type AddressLike } from "./base58.js";
import { type Subject } from "./subject.js";
export interface AccountMeta {
    pubkey: string;
    isSigner: boolean;
    isWritable: boolean;
}
export interface Instruction {
    programId: string;
    keys: AccountMeta[];
    data: Uint8Array;
}
/** Resolve an IDL instruction's account list from a name → address map. Fixed addresses in the IDL fill themselves. */
export declare function resolveAccounts(idl: Idl, ixName: string, given: Record<string, AddressLike | undefined>): AccountMeta[];
/**
 * The accounts to pass when your program CPIs into `pof::require_certificate(subject_hash, asset, min_tier)`.
 * The call fails unless the certificate is live, unexpired and at least `min_tier`; on success it returns
 * `CertView { subject_kind, tier, expiry_slot, controller }` as return data. Check `controller` against your signer.
 * Put them in your instruction's remaining accounts (or name them in your Accounts struct) in this order,
 * followed by the pof program account itself.
 */
export declare function requireCertificateAccounts(args: {
    subject: Subject | Uint8Array;
    asset: number | string;
    minTier: number;
    programId?: AddressLike;
}): Promise<{
    subjectHash: Uint8Array;
    certificate: string;
    accounts: AccountMeta[];
    data: Uint8Array;
    programId: string;
}>;
/** A ready `pof_gate.join` instruction. The member PDA is written only if the certificate is live and meets the room. */
export declare function joinRoomInstruction(args: {
    room: AddressLike;
    /** the room's asset (read it with PofClient.getRoom) */
    asset: number | string;
    subject: Subject | Uint8Array;
    payer: AddressLike;
    /** the certificate's controller (the wallet for kind 0, the badge key for kind 2); it signs. Default: the payer */
    controller?: AddressLike;
    programId?: AddressLike;
    gateProgramId?: AddressLike;
    /** extra or renamed accounts if the program's IDL names them differently */
    extra?: Record<string, AddressLike>;
}): Promise<Instruction & {
    member: string;
    certificate: string;
}>;
/** Convert to @solana/web3.js objects without depending on it: pass the PublicKey and TransactionInstruction classes. */
export declare function toWeb3Instruction<T>(ix: Instruction, web3: {
    PublicKey: new (s: string) => unknown;
    TransactionInstruction: new (o: any) => T;
}): T;
/** A `pof_gate.evict` instruction: anyone may evict a member whose certificate no longer passes the room's gate. */
export declare function evictMemberInstruction(args: {
    room: AddressLike;
    member: AddressLike;
    /** the member's rent payer (from the Member account) */
    payer: AddressLike;
    certificate: AddressLike;
    caller: AddressLike;
    programId?: AddressLike;
    gateProgramId?: AddressLike;
}): Promise<Instruction>;
