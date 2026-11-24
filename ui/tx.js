/* The transactions the site asks a holder's wallet to sign, built from the program IDLs with @pof/sdk (no Anchor in the
   page): certify (a wallet subject submits its own certificate), revoke_by_holder, and the pof_gate Room calls
   (create_room, join, leave, evict). Each returns web3.js instructions for client/wallet.js send(), which simulates first,
   asks the wallet once and confirms. */
import * as sdk from '/sdk/dist/index.js';
import { PublicKey, TransactionInstruction, Buffer } from '/client/dist/web3.js';

const CFG = window.POF || {};
const PROGRAM = CFG.PROGRAM || sdk.POF_PROGRAM_ID;
const GATE = CFG.GATE || sdk.POF_GATE_PROGRAM_ID;
const ED25519 = 'Ed25519SigVerify111111111111111111111111111';
const ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const SYSTEM = '11111111111111111111111111111111';

const ix = (programId, keys, data) => new TransactionInstruction({
  programId: new PublicKey(programId),
  keys: keys.map(k => ({ pubkey: new PublicKey(k.pubkey), isSigner: !!k.isSigner, isWritable: !!k.isWritable })),
  data: Buffer.from(data),
});

/** the native Ed25519 program instruction: one signature, key, signature and message all inside this instruction */
export function ed25519Instruction(publicKey, signature, message) {
  const pk = typeof publicKey === 'string' ? sdk.decodeBase58(publicKey) : publicKey;
  const HEAD = 16, PK = HEAD, SIG = PK + 32, MSG = SIG + 64;
  const data = new Uint8Array(MSG + message.length);
  const dv = new DataView(data.buffer);
  data[0] = 1; data[1] = 0;
  dv.setUint16(2, SIG, true); dv.setUint16(4, 0xffff, true);
  dv.setUint16(6, PK, true); dv.setUint16(8, 0xffff, true);
  dv.setUint16(10, MSG, true); dv.setUint16(12, message.length, true); dv.setUint16(14, 0xffff, true);
  data.set(pk, PK); data.set(signature, SIG); data.set(message, MSG);
  return ix(ED25519, [], data);
}

async function pda(seeds, program) { return (await sdk.findProgramAddress(seeds, program))[0]; }

/**
 * certify, submitted by the payer itself (a wallet subject). `answer` is the Verifier's §4 answer.
 * client: a PofClient for the Config (root mint) and the existing certificate (prior payer).
 */
export async function certifyInstructions(answer, { payer, client }) {
  const att = sdk.fromHex(answer.attestation);
  const a = sdk.parseAttestation(att);
  const [certificate] = await sdk.certificateAddress(sdk.fromHex(a.subjectHash), a.asset, PROGRAM);
  const [config] = await sdk.configAddress(PROGRAM);
  const [treasury] = await sdk.treasuryAddress(PROGRAM);
  const cfg = await client.getConfig();
  const existing = await client.rpc.getAccount(certificate).catch(() => null);
  let prior = PROGRAM;   // an absent optional account is the program id (Anchor)
  if (existing && existing.owner === PROGRAM) {
    const c = sdk.decodeCertificate(certificate, existing.data);
    if (c.payer && c.payer !== payer) prior = c.payer;
  }
  let holder = SYSTEM;
  if (cfg && cfg.rootMint && cfg.rootMint !== SYSTEM) {
    holder = await pda([sdk.toAddressBytes(payer), sdk.toAddressBytes(String(cfg.raw?.root_token_program || 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')), sdk.toAddressBytes(cfg.rootMint)], ATA);
  }
  const hashes = (answer.hashes || []).map(h => sdk.fromHex(h));
  const data = sdk.encodeInstruction(sdk.POF_IDL, 'certify', {
    att: { subject_kind: a.subjectKind, subject_hash: sdk.fromHex(a.subjectHash), asset: a.asset, tier: a.tier, tree_root: sdk.fromHex(a.treeRoot),
      root_slot: BigInt(a.rootSlot), null_hashes: hashes, issued_slot: BigInt(a.issuedSlot), expiry_slot: BigInt(a.expirySlot), controller: a.controller, nonce: sdk.fromHex(a.nonce) },
    log_index: BigInt(answer.logIndex),
  });
  const keys = sdk.resolveAccounts(sdk.POF_IDL, 'certify', { payer, config, treasury, certificate, prior_payer: prior, holder_token: holder });
  keys[0].isSigner = true; keys[0].isWritable = true;
  const verifier = answer.verifierKey;
  return { certificate, instructions: [ed25519Instruction(verifier, sdk.fromHex(answer.signature), att), ix(PROGRAM, keys, data)] };
}

/** revoke_by_holder: the certificate's controller signs */
export async function revokeByHolderInstruction({ subjectHash, asset, controller }) {
  const [certificate] = await sdk.certificateAddress(typeof subjectHash === 'string' ? sdk.fromHex(subjectHash) : subjectHash, asset, PROGRAM);
  const [config] = await sdk.configAddress(PROGRAM);
  const [treasury] = await sdk.treasuryAddress(PROGRAM);
  const keys = sdk.resolveAccounts(sdk.POF_IDL, 'revoke_by_holder', { controller, config, treasury, certificate });
  return ix(PROGRAM, keys, sdk.encodeInstruction(sdk.POF_IDL, 'revoke_by_holder', {}));
}

/** pof_gate.create_room: a creator opens a room with a minimum tier of one asset */
export async function createRoomInstruction({ creator, name, asset, minTier, id }) {
  const roomId = BigInt(id ?? (BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000))));
  const [room] = await sdk.roomAddress(creator, roomId, GATE);
  const [pofConfig] = await sdk.configAddress(PROGRAM);
  const nameBytes = new Uint8Array(32); nameBytes.set(new TextEncoder().encode(String(name)).slice(0, 32));
  const keys = sdk.resolveAccounts(sdk.POF_GATE_IDL, 'create_room', { creator, room, pof_config: pofConfig });
  return { room, instruction: ix(GATE, keys, sdk.encodeInstruction(sdk.POF_GATE_IDL, 'create_room', { id: roomId, asset, min_tier: minTier, name: nameBytes })) };
}

/** pof_gate.join (the SDK builds it from the IDL) */
export async function joinInstruction({ room, asset, subject, payer, controller }) {
  const j = await sdk.joinRoomInstruction({ room, asset, subject, payer, controller, programId: PROGRAM, gateProgramId: GATE });
  return { member: j.member, instruction: ix(j.programId, j.keys, j.data) };
}

/** pof_gate.leave: the member's controller leaves and the rent returns to the payer */
export async function leaveInstruction({ room, subjectHash, controller, payer }) {
  const [member] = await sdk.memberAddress(room, typeof subjectHash === 'string' ? sdk.fromHex(subjectHash) : subjectHash, GATE);
  const keys = sdk.resolveAccounts(sdk.POF_GATE_IDL, 'leave', { controller, room, member, payer });
  return ix(GATE, keys, sdk.encodeInstruction(sdk.POF_GATE_IDL, 'leave', {}));
}

/** pof_gate.evict: anyone removes a member whose certificate stopped passing */
export async function evictInstruction({ room, member, payer, certificate, caller }) {
  const keys = sdk.resolveAccounts(sdk.POF_GATE_IDL, 'evict', { caller, room, member, payer, certificate });
  return ix(GATE, keys, sdk.encodeInstruction(sdk.POF_GATE_IDL, 'evict', {}));
}

/** the program's error names from a failed simulation, as words */
export function chainReason(e) {
  const logs = (e && (e.logs || e.transactionLogs)) || [];
  const m = logs.map(l => /Error Code: (\w+)\. Error Number: \d+\. Error Message: (.*)/.exec(l)).find(Boolean);
  return m ? { code: m[1], message: m[2] } : null;
}
export { PROGRAM, GATE };
