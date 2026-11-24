/**
 * Accounts and instructions for gating with a certificate:
 *  - `require_certificate` (the pof CPI helper other programs call),
 *  - `pof_gate.join` (the reference program that uses it).
 * Account lists are read from the IDL, so they follow the program as it changes.
 */
import { POF_IDL, POF_GATE_IDL } from "./idl/index.js";
import { encodeInstruction } from "./borsh.js";
import { toAddress } from "./base58.js";
import { POF_PROGRAM_ID, POF_GATE_PROGRAM_ID, SYSTEM_PROGRAM_ID, SYSVAR_INSTRUCTIONS_ID, parseAsset, tierMinimum } from "./constants.js";
import { subjectHash } from "./subject.js";
import { certificateAddress, configAddress, memberAddress } from "./accounts.js";
const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
/** Resolve an IDL instruction's account list from a name → address map. Fixed addresses in the IDL fill themselves. */
export function resolveAccounts(idl, ixName, given) {
    const ix = idl.instructions.find((x) => x.name === ixName);
    if (!ix)
        throw new Error(`IDL instruction ${ixName} not found`);
    const missing = [];
    const keys = ix.accounts.map((a) => {
        const v = given[a.name] ?? given[camel(a.name)] ?? a.address;
        if (!v)
            missing.push(a.name);
        return { pubkey: v ? toAddress(v) : "", isSigner: !!(a.signer ?? a.isSigner), isWritable: !!(a.writable ?? a.isMut) };
    });
    if (missing.length)
        throw new Error(`${ixName}: missing accounts ${missing.join(", ")}`);
    return keys;
}
async function hashOf(s) {
    return s instanceof Uint8Array ? s : subjectHash(s);
}
/** Common accounts every gate needs, filled from the subject and asset. */
async function common(subject, asset, programId) {
    const hash = await hashOf(subject);
    const [certificate] = await certificateAddress(hash, asset, programId);
    const [config] = await configAddress(programId);
    return {
        hash, certificate, config,
        pof_program: programId, pofProgram: programId,
        system_program: SYSTEM_PROGRAM_ID, instructions: SYSVAR_INSTRUCTIONS_ID, instructions_sysvar: SYSVAR_INSTRUCTIONS_ID,
    };
}
/**
 * The accounts to pass when your program CPIs into `pof::require_certificate(subject_hash, asset, min_tier)`.
 * Put them in your instruction's remaining accounts (or name them in your Accounts struct) in this order,
 * followed by the pof program account itself.
 */
export async function requireCertificateAccounts(args) {
    const asset = parseAsset(args.asset);
    tierMinimum(asset, args.minTier);
    const programId = toAddress(args.programId ?? POF_PROGRAM_ID);
    const c = await common(args.subject, asset, programId);
    const idl = POF_IDL;
    const accounts = [...resolveAccounts(idl, "require_certificate", c), { pubkey: programId, isSigner: false, isWritable: false }];
    const data = encodeInstruction(idl, "require_certificate", { subject_hash: c.hash, asset, min_tier: args.minTier });
    return { subjectHash: c.hash, certificate: c.certificate, accounts, data, programId };
}
/** A ready `pof_gate.join` instruction. The member PDA is written only if the certificate is live and meets the room. */
export async function joinRoomInstruction(args) {
    const asset = parseAsset(args.asset);
    const programId = toAddress(args.programId ?? POF_PROGRAM_ID);
    const gateProgramId = toAddress(args.gateProgramId ?? POF_GATE_PROGRAM_ID);
    const c = await common(args.subject, asset, programId);
    const room = toAddress(args.room);
    const [member] = await memberAddress(room, c.hash, gateProgramId);
    const payer = toAddress(args.payer);
    const idl = POF_GATE_IDL;
    const keys = resolveAccounts(idl, "join", { ...c, room, member, payer, signer: payer, user: payer, ...args.extra });
    const ixArgs = { subject_hash: c.hash, asset, subject_kind: args.subject instanceof Uint8Array ? 0 : args.subject.kind };
    const data = encodeInstruction(idl, "join", ixArgs);
    return { programId: gateProgramId, keys, data, member, certificate: c.certificate };
}
/** Convert to @solana/web3.js objects without depending on it: pass the PublicKey and TransactionInstruction classes. */
export function toWeb3Instruction(ix, web3) {
    return new web3.TransactionInstruction({
        programId: new web3.PublicKey(ix.programId),
        keys: ix.keys.map((k) => ({ pubkey: new web3.PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })),
        data: globalThis.Buffer ? globalThis.Buffer.from(ix.data) : ix.data,
    });
}
