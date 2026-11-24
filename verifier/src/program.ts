/* The pof program as the relayer and the keeper use it, encoded straight from the committed IDL (program/idl/pof.json is
   bundled, so the bundle hash covers it). Transactions are legacy, paid and signed by the relayer key:
     certify     = [ed25519(verifier, §3 bytes), certify(att, log_index)]
     anchor_log  = [ed25519(verifier, §7 signed head), anchor_log(size, head)]
     revoke_spent(index, salt, nullifier, membership?)  (PDA path; the nullifier-tree path when the PDA is gone) */
import IDL from '../idl/pof.json'; // vendored: npm run sync-idl copies it from program/idl, so the bundle reads only files in this folder
import { PofError, fromB58, toB58 } from './codec.js';
import { decodeAttestation, revokeBytes, revokeBytesV2, sthBytes } from './contract.js';
import type { CertificateView, PofChain } from './chain.js';
import type { Signer } from './keys.js';
import type { RingsSource } from './rings.js';

type Idl = any;
const idl: Idl = IDL;
const types: Record<string, any> = Object.fromEntries(idl.types.map((t: any) => [t.name, t]));
const INTS: Record<string, number> = { u8: 1, u16: 2, u32: 4, u64: 8, i64: 8, u128: 16 };

function enc(t: any, v: any, out: Buffer[]) {
  if (typeof t === 'string') {
    if (INTS[t]) { const b = Buffer.alloc(INTS[t]); let x = BigInt(v); for (let i = 0; i < INTS[t]; i++) { b[i] = Number(x & 255n); x >>= 8n; } out.push(b); return; }
    if (t === 'bool') { out.push(Buffer.from([v ? 1 : 0])); return; }
    if (t === 'pubkey') { out.push(Buffer.from(typeof v === 'string' ? fromB58(v) : v)); return; }
    throw new Error('idl type ' + t);
  }
  if (t.array) { const [it, n] = t.array; if (it === 'u8') { const b = Buffer.from(v); if (b.length !== n) throw new Error(`expected ${n} bytes`); out.push(b); return; } for (let i = 0; i < n; i++) enc(it, v[i], out); return; }
  if (t.vec) { const l = Buffer.alloc(4); l.writeUInt32LE(v.length); out.push(l); for (const x of v) enc(t.vec, x, out); return; }
  if (t.option) { if (v == null) out.push(Buffer.from([0])); else { out.push(Buffer.from([1])); enc(t.option, v, out); } return; }
  if (t.defined) { for (const f of types[t.defined.name].type.fields) enc(f.type, v[f.name], out); return; }
  throw new Error('idl type ' + JSON.stringify(t));
}
function dec(t: any, b: Buffer, o: { at: number }): any {
  if (typeof t === 'string') {
    if (INTS[t]) { let x = 0n; for (let i = INTS[t] - 1; i >= 0; i--) x = (x << 8n) | BigInt(b[o.at + i]); o.at += INTS[t]; return INTS[t] <= 4 ? Number(x) : x; }
    if (t === 'bool') return b[o.at++] === 1;
    if (t === 'pubkey') { const k = toB58(b.subarray(o.at, o.at + 32)); o.at += 32; return k; }
  }
  if (t.array) { const [it, n] = t.array; if (it === 'u8') { const x = b.subarray(o.at, o.at + n); o.at += n; return new Uint8Array(x); } return Array.from({ length: n }, () => dec(it, b, o)); }
  if (t.vec) { const n = b.readUInt32LE(o.at); o.at += 4; return Array.from({ length: n }, () => dec(t.vec, b, o)); }
  if (t.option) return b[o.at++] ? dec(t.option, b, o) : null;
  if (t.defined) return Object.fromEntries(types[t.defined.name].type.fields.map((f: any) => [f.name, dec(f.type, b, o)]));
  throw new Error('idl type ' + JSON.stringify(t));
}
export function decodeAccount(name: string, data: Uint8Array) {
  const a = idl.accounts.find((x: any) => x.name === name);
  const b = Buffer.from(data);
  if (!a || !b.subarray(0, 8).equals(Buffer.from(a.discriminator))) throw new PofError('BAD_ACCOUNT', `not a ${name} account`, 502);
  return dec({ defined: { name } }, b, { at: 8 });
}
export function ixData(name: string, args: Record<string, any>): Buffer {
  const ix = idl.instructions.find((x: any) => x.name === name);
  const out: Buffer[] = [Buffer.from(ix.discriminator)];
  for (const a of ix.args) enc(a.type, args[a.name], out);
  return Buffer.concat(out);
}
export const PROGRAM_ID: string = idl.address;

export async function makeProgramChain(o: { web3: any; rpcUrl: string; programId: string; relayer: Signer; verifier: Signer; rings: RingsSource | null; commitment?: string }): Promise<PofChain> {
  const { Connection, PublicKey, Keypair, Transaction, TransactionInstruction, SystemProgram, Ed25519Program, SYSVAR_INSTRUCTIONS_PUBKEY } = o.web3;
  const conn = new Connection(o.rpcUrl, o.commitment || 'confirmed');
  const PID = new PublicKey(o.programId);
  const payer = Keypair.fromSecretKey(o.relayer.secretForWeb3());
  const pda = (seeds: (Uint8Array | Buffer)[], prog = PID) => PublicKey.findProgramAddressSync(seeds.map(s => Buffer.from(s)), prog)[0];
  const CONFIG = pda([Buffer.from('config')]), TREASURY = pda([Buffer.from('treasury')]);
  const SPP = new PublicKey('ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW');
  const ATA = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
  const certPda = (sh: Uint8Array, asset: number) => pda([Buffer.from('cert'), Buffer.from(sh), Buffer.from([asset])]);
  const meta = (pubkey: any, isSigner = false, isWritable = false) => ({ pubkey, isSigner, isWritable });

  async function config() {
    const a = await conn.getAccountInfo(CONFIG);
    if (!a) throw new PofError('CHAIN_OFF', 'the pof program has no Config on this network yet', 503);
    return decodeAccount('Config', a.data);
  }
  async function send(ixs: any[], what: string): Promise<{ signature: string; lamports: bigint }> {
    const before = BigInt(await conn.getBalance(payer.publicKey));
    const tx = new Transaction().add(...ixs);
    tx.feePayer = payer.publicKey;
    const bh = await conn.getLatestBlockhash('confirmed');
    tx.recentBlockhash = bh.blockhash;
    tx.sign(payer);
    let sig = '';
    const refused = (e: any) => {
      const logs: string[] = e?.logs || e?.transactionLogs || [];
      const m = logs.map(l => l.match(/Error Code: (\w+)\. Error Number: \d+\. Error Message: (.*)/)).find(Boolean);
      return new PofError('CHAIN_REJECTED', m ? `${what}: the program refused (${m[1]}: ${m[2]})` : `${what}: the transaction was refused (${String(e?.message || e).slice(0, 160)})`, 502);
    };
    try { sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 }); }
    catch (e: any) { throw refused(e); } // the preflight simulation refused it: it never reached a block
    try {
      const r = await conn.confirmTransaction({ signature: sig, ...bh }, 'confirmed');
      if (r.value.err) throw Object.assign(refused({ message: JSON.stringify(r.value.err) }), { landedFailed: true });
    } catch (e: any) {
      if (e?.landedFailed) throw e; // it landed and failed: nothing changed but the fee
      // no answer before the blockhash expired, or the node dropped the connection: it may or may not have landed
      throw new PofError('CHAIN_UNCERTAIN', `${what}: sent as ${sig}, but its confirmation did not arrive; check it before retrying`, 504, { signature: sig });
    }
    const after = BigInt(await conn.getBalance(payer.publicKey));
    return { signature: sig, lamports: before > after ? before - after : 0n };
  }
  const edIx = (message: Uint8Array, signature: Uint8Array) => Ed25519Program.createInstructionWithPublicKey({ publicKey: Buffer.from(o.verifier.publicKey), message: Buffer.from(message), signature: Buffer.from(signature) });

  const chain: PofChain = {
    async slot() { return BigInt(await conn.getSlot('confirmed')); },
    async certificate(sh, asset) {
      const addr = certPda(sh, asset);
      const a = await conn.getAccountInfo(addr);
      if (!a || !a.owner.equals(PID)) return null;
      const c = decodeAccount('Certificate', a.data);
      const hashes = c.null_hashes.slice(0, c.note_count).map((h: Uint8Array) => Buffer.from(h).toString('hex'));
      return { address: addr.toBase58(), status: c.status, tier: c.tier, expirySlot: c.expiry_slot, hashes, payer: c.payer, controller: c.controller, nullsetHash: Buffer.from(c.nullset_hash).toString('hex'), issuedSlot: c.issued_slot } as CertificateView;
    },
    async certify(x) {
      const a = decodeAttestation(x.attestation);
      const cfg = await config();
      const cert = certPda(a.subjectHash, a.asset);
      const existing = await chain.certificate(a.subjectHash, a.asset);
      const prior = existing && existing.payer !== payer.publicKey.toBase58() ? new PublicKey(existing.payer) : null;
      const rootSet = cfg.root_mint !== SystemProgram.programId.toBase58();
      const holder = rootSet ? PublicKey.findProgramAddressSync([payer.publicKey.toBuffer(), new PublicKey(cfg.root_token_program).toBuffer(), new PublicKey(cfg.root_mint).toBuffer()], ATA)[0] : SystemProgram.programId;
      const att = { subject_kind: a.subjectKind, subject_hash: a.subjectHash, asset: a.asset, tier: a.tier, tree_root: a.treeRoot, root_slot: a.rootSlot, null_hashes: x.hashes, issued_slot: a.issuedSlot, expiry_slot: a.expirySlot, controller: a.controller, nonce: a.nonce };
      const ix = new TransactionInstruction({ programId: PID, data: ixData('certify', { att, log_index: BigInt(x.logIndex) }), keys: [
        meta(payer.publicKey, true, true), meta(CONFIG), meta(TREASURY, false, true), meta(cert, false, true),
        prior ? meta(prior, false, true) : meta(PID), meta(holder), meta(SYSVAR_INSTRUCTIONS_PUBKEY), meta(SystemProgram.programId),
      ] });
      return send([edIx(x.attestation, x.signature), ix], 'certify');
    },
    async revokeSpent(x) {
      const tree = new PublicKey(x.tree);
      const nfPda = pda([Buffer.from('nullifier'), tree.toBuffer(), Buffer.from(x.nullifier)], SPP);
      const pdaLive = await conn.getAccountInfo(nfPda);
      let membership: any = null;
      if (!pdaLive) {
        if (!o.rings || !(o.rings as any).nullifierMembership) throw new PofError('NO_SPEND_PROOF', 'the nullifier PDA is gone and no membership source is configured', 503);
        membership = await (o.rings as any).nullifierMembership(x.tree, x.nullifier);
      }
      const ix = new TransactionInstruction({ programId: PID, data: ixData('revoke_spent', { index: x.index, salt: x.salt, nullifier: x.nullifier, membership }), keys: [
        meta(payer.publicKey, true, false), meta(CONFIG), meta(TREASURY, false, true), meta(certPda(x.subjectHash, x.asset), false, true), meta(tree),
        pdaLive ? meta(nfPda) : meta(PID),
      ] });
      return send([ix], 'revoke_spent');
    },
    async anchorLog(size, root) {
      const msg = sthBytes(fromB58(o.programId), size, root);
      const ix = new TransactionInstruction({ programId: PID, data: ixData('anchor_log', { size: BigInt(size), head: root }), keys: [meta(payer.publicKey, true, false), meta(CONFIG), meta(TREASURY, false, true), meta(SYSVAR_INSTRUCTIONS_PUBKEY)] });
      return send([edIx(msg, o.verifier.sign(msg)), ix], 'anchor_log');
    },
    async relayerBalance() { return BigInt(await conn.getBalance(payer.publicKey)); },
    async incoming(sinceSlot) {
      const sigs = await conn.getSignaturesForAddress(payer.publicKey, { limit: 60 }, 'confirmed');
      const out: { signature: string; slot: bigint; lamports: bigint }[] = [];
      for (const s of sigs.filter((s: any) => !s.err && BigInt(s.slot) >= sinceSlot)) {
        const t = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 1, commitment: 'confirmed' });
        if (!t?.meta) continue;
        const keys = t.transaction.message.getAccountKeys ? t.transaction.message.getAccountKeys({ accountKeysFromLookups: t.meta.loadedAddresses }).staticAccountKeys.concat(t.meta.loadedAddresses?.writable || [], t.meta.loadedAddresses?.readonly || []) : t.transaction.message.accountKeys;
        const i = keys.findIndex((k: any) => k.equals(payer.publicKey));
        if (i <= 0) continue; // index 0 is the fee payer: our own transactions
        const d = BigInt(t.meta.postBalances[i]) - BigInt(t.meta.preBalances[i]);
        if (d > 0n) out.push({ signature: s.signature, slot: BigInt(s.slot), lamports: d });
      }
      return out;
    },
    async quoteLamports() {
      const cfg = await config();
      const space = 8 + CERTIFICATE_SPACE;
      return { fee: BigInt(cfg.params.fee_lamports), rent: BigInt(await conn.getMinimumBalanceForRentExemption(space)), network: 10_000n };
    },
  };
  const rs = idl.instructions.find((x: any) => x.name === 'revoke_signed');
  const v2 = !!rs && rs.args.some((a: any) => a.name === 'valid_until');
  if (rs) chain.revokeVersion = v2 ? 2 : 1;
  if (rs) chain.revokeSigned = async ({ subjectHash, asset, signature, validUntil }) => {
    const cert = certPda(subjectHash, asset);
    const a = await conn.getAccountInfo(cert);
    if (!a || !a.owner.equals(PID)) throw new PofError('NOT_FOUND', 'no certificate for that subject and asset', 404);
    const c = decodeAccount('Certificate', a.data);
    const msg = v2 ? revokeBytesV2(fromB58(o.programId), cert.toBytes(), subjectHash, asset, c.nullset_hash, c.issued_slot, validUntil ?? 0n)
                   : revokeBytes(fromB58(o.programId), cert.toBytes(), subjectHash, asset, c.nullset_hash, c.issued_slot);
    const named: Record<string, any> = { caller: meta(payer.publicKey, true, false), payer: meta(payer.publicKey, true, true), config: meta(CONFIG), treasury: meta(TREASURY, false, true), certificate: meta(cert, false, true), instructions: meta(SYSVAR_INSTRUCTIONS_PUBKEY), system_program: meta(SystemProgram.programId) };
    const keys = rs.accounts.map((x: any) => { const k = named[x.name]; if (!k) throw new PofError('PROGRAM_NOT_READY', `revoke_signed wants an account ${x.name} the relayer does not know`, 503); return { ...k, isWritable: !!x.writable, isSigner: !!x.signer }; });
    const ix = new TransactionInstruction({ programId: PID, data: ixData('revoke_signed', v2 ? { valid_until: validUntil ?? 0n } : {}), keys });
    const ed = Ed25519Program.createInstructionWithPublicKey({ publicKey: new PublicKey(c.controller).toBuffer(), message: Buffer.from(msg), signature: Buffer.from(signature) });
    return send([ed, ix], 'revoke_signed');
  };
  (chain as any).treasury = async () => { const a = await conn.getAccountInfo(TREASURY); return a ? decodeAccount('Treasury', a.data) : null; };
  return chain;
}

/** Certificate::INIT_SPACE from the IDL (fixed-size struct) */
function sizeOf(t: any): number {
  if (typeof t === 'string') return t === 'pubkey' ? 32 : t === 'bool' ? 1 : INTS[t];
  if (t.array) return sizeOf(t.array[0]) * t.array[1];
  if (t.defined) return types[t.defined.name].type.fields.reduce((s: number, f: any) => s + sizeOf(f.type), 0);
  throw new Error('variable size');
}
export const CERTIFICATE_SPACE = sizeOf({ defined: { name: 'Certificate' } });
