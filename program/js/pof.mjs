// The program side's own codec for pof and pof_gate (Node: the suite, the rehearsal, launch.mjs, wind-down.mjs): PDAs, the
// CONTRACT §1/§3/§5/§7 bytes, and every instruction, account and event encoded straight from the committed IDLs
// (program/idl/*.json). The public SDK is @pof/sdk (devx); this file is what the program's tests and scripts stand on.
// makePof(web3) takes @solana/web3.js so the caller chooses the copy.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const IDL = JSON.parse(fs.readFileSync(path.join(here, '../idl/pof.json'), 'utf8'));
export const GATE_IDL = JSON.parse(fs.readFileSync(path.join(here, '../idl/pof_gate.json'), 'utf8'));

export const sha256 = (...parts) => createHash('sha256').update(Buffer.concat(parts.map(p => Buffer.from(p)))).digest();
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function b58(bytes) {
  let x = BigInt('0x' + (Buffer.from(bytes).toString('hex') || '0')), s = '';
  while (x > 0n) { s = B58[Number(x % 58n)] + s; x /= 58n; }
  for (const b of bytes) { if (b !== 0) break; s = '1' + s; }
  return s;
}
export const KIND = { wallet: 0, x: 1, badge: 2 };
export const STATUS = ['live', 'revoked_spent', 'revoked_holder', 'expired'];
/** CONTRACT §1 */
export function subjectHash(kind, value) {
  if (kind === 0) return sha256(Buffer.from('pof:wallet:' + String(value)));
  if (kind === 2) return sha256(Buffer.from('pof:badge:' + String(value)));
  if (kind === 1) return sha256(Buffer.from('pof:x:' + String(value).replace(/^@/, '').toLowerCase()));
  throw Error('kind');
}
/** CONTRACT §5 */
export const saltedNullifier = (salt, nf) => sha256(Buffer.from('pof:null:'), salt, nf);
export const nullsetHash = hs => sha256(...hs);
export const sortHashes = hs => [...hs].map(h => Buffer.from(h)).sort(Buffer.compare);
const u64le = v => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };

/* ------------------------------------------------------------------ borsh from the IDL */
function codec(idl) {
  const types = Object.fromEntries((idl.types || []).map(t => [t.name, t]));
  function enc(t, v, out) {
    if (typeof t === 'string') {
      const ints = { u8: 1, i8: 1, u16: 2, u32: 4, u64: 8, i64: 8, u128: 16 };
      if (ints[t]) { const b = Buffer.alloc(ints[t]); let x = BigInt(v); if (x < 0n) x += 1n << BigInt(8 * ints[t]); for (let i = 0; i < ints[t]; i++) { b[i] = Number(x & 255n); x >>= 8n; } out.push(b); return; }
      if (t === 'bool') { out.push(Buffer.from([v ? 1 : 0])); return; }
      if (t === 'pubkey') { out.push(Buffer.from(v.toBytes ? v.toBytes() : v)); return; }
      if (t === 'string') { const s = Buffer.from(v); out.push(u32(s.length), s); return; }
      if (t === 'bytes') { out.push(u32(v.length), Buffer.from(v)); return; }
      throw Error('type ' + t);
    }
    if (t.array) { const [it, n] = t.array; if (it === 'u8') { const b = Buffer.from(v); if (b.length !== n) throw Error(`expected ${n} bytes, got ${b.length}`); out.push(b); return; } for (let i = 0; i < n; i++) enc(it, v[i], out); return; }
    if (t.vec) { out.push(u32(v.length)); for (const x of v) enc(t.vec, x, out); return; }
    if (t.option) { if (v === null || v === undefined) out.push(Buffer.from([0])); else { out.push(Buffer.from([1])); enc(t.option, v, out); } return; }
    if (t.defined) { const d = types[t.defined.name]; if (d.type.kind !== 'struct') throw Error('enum'); for (const f of d.type.fields) enc(f.type, v[f.name], out); return; }
    throw Error('type ' + JSON.stringify(t));
  }
  function dec(t, buf, o) {
    if (typeof t === 'string') {
      const ints = { u8: 1, u16: 2, u32: 4, u64: 8, u128: 16 };
      if (ints[t]) { let x = 0n; for (let i = ints[t] - 1; i >= 0; i--) x = (x << 8n) | BigInt(buf[o.at + i]); o.at += ints[t]; return ints[t] <= 4 ? Number(x) : x; }
      if (t === 'bool') return buf[o.at++] === 1;
      if (t === 'pubkey') { const k = buf.subarray(o.at, o.at + 32); o.at += 32; return b58(k); }
      throw Error('type ' + t);
    }
    if (t.array) { const [it, n] = t.array; if (it === 'u8') { const b = Buffer.from(buf.subarray(o.at, o.at + n)); o.at += n; return b; } return Array.from({ length: n }, () => dec(it, buf, o)); }
    if (t.vec) { const n = buf.readUInt32LE(o.at); o.at += 4; return Array.from({ length: n }, () => dec(t.vec, buf, o)); }
    if (t.option) { return buf[o.at++] ? dec(t.option, buf, o) : null; }
    if (t.defined) { const d = types[t.defined.name]; const r = {}; for (const f of d.type.fields) r[f.name] = dec(f.type, buf, o); return r; }
    throw Error('type ' + JSON.stringify(t));
  }
  const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  const encode = (t, v) => { const out = []; enc(t, v, out); return Buffer.concat(out); };
  const decode = (t, buf, at = 0) => dec(t, Buffer.from(buf), { at });
  return { types, encode, decode };
}

export function makePof(web3) {
  const { PublicKey, TransactionInstruction, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY, Ed25519Program } = web3;
  const PID = new PublicKey(IDL.address), GATE = new PublicKey(GATE_IDL.address);
  const SPP = new PublicKey('ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW');
  const TREE = new PublicKey('777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor');
  const LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
  const ATA = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
  const pk = x => (x instanceof PublicKey ? x : new PublicKey(x));
  const pda = (seeds, prog = PID) => PublicKey.findProgramAddressSync(seeds.map(s => Buffer.from(s)), prog)[0];
  const K = {
    PID, GATE, SPP, TREE,
    config: pda(['config']), treasury: pda(['treasury']),
    programData: pda([PID.toBuffer()], LOADER), gateData: pda([GATE.toBuffer()], LOADER),
  };
  const certPda = (subjectHash, asset) => pda([Buffer.from('cert'), Buffer.from(subjectHash), Buffer.from([asset])]);
  const roomPda = (creator, id) => pda([Buffer.from('room'), pk(creator).toBuffer(), u64le(id)], GATE);
  const memberPda = (room, subjectHash) => pda([Buffer.from('member'), pk(room).toBuffer(), Buffer.from(subjectHash)], GATE);
  const nullifierPda = (tree, nf) => pda([Buffer.from('nullifier'), pk(tree).toBuffer(), Buffer.from(nf)], SPP);
  const ata = (owner, mint, tp) => PublicKey.findProgramAddressSync([pk(owner).toBuffer(), pk(tp).toBuffer(), pk(mint).toBuffer()], ATA)[0];

  /** CONTRACT §3: the 240 bytes */
  function attestationBytes(a, payer, programId = PID) {
    const hs = a.null_hashes.map(h => Buffer.from(h));
    return Buffer.concat([Buffer.from('POF1'), pk(programId).toBuffer(), Buffer.from([a.subject_kind]), Buffer.from(a.subject_hash), Buffer.from([a.asset, a.tier]),
      Buffer.from(a.tree_root), u64le(a.root_slot), Buffer.from([hs.length]), nullsetHash(hs), u64le(a.issued_slot), u64le(a.expiry_slot), pk(payer).toBuffer(), pk(a.controller).toBuffer(), Buffer.from(a.nonce)]);
  }
  /** CONTRACT §7: the signed tree head */
  const sthBytes = (size, root, programId = PID) => Buffer.concat([Buffer.from('POF-STH1'), pk(programId).toBuffer(), u64le(size), Buffer.from(root)]);
  /** the Ed25519 program instruction the Verifier's signature rides in (all offsets inside itself) */
  const signIx = (signer, message) => Ed25519Program.createInstructionWithPrivateKey({ privateKey: signer.secretKey, message: Buffer.from(message) });

  /* instructions from the IDL: args by name, accounts by name (fixed addresses filled in; a missing optional account is None) */
  function builder(idl, programId) {
    const c = codec(idl);
    const ixs = Object.fromEntries(idl.instructions.map(i => [i.name, i]));
    function ix(name, args = {}, accounts = {}) {
      const d = ixs[name];
      if (!d) throw Error('no instruction ' + name);
      const data = Buffer.concat([Buffer.from(d.discriminator), ...d.args.map(a => { if (!(a.name in args)) throw Error(`${name}: arg ${a.name} missing`); return c.encode(a.type, args[a.name]); })]);
      const keys = d.accounts.map(a => {
        let k = accounts[a.name];
        if (k === undefined && a.address) k = a.address;
        if (k === undefined && a.name === 'system_program') k = SystemProgram.programId;
        if (k === undefined && a.name === 'instructions') k = SYSVAR_INSTRUCTIONS_PUBKEY;
        if (k === undefined && a.name === 'pof_program') k = PID;
        if (k === undefined && a.pda && a.pda.seeds.every(s => s.kind === 'const')) k = pda(a.pda.seeds.map(s => Buffer.from(s.value)), programId);
        if (k === undefined || k === null) { if (a.optional) return { pubkey: programId, isSigner: false, isWritable: false }; throw Error(`${name}: account ${a.name} missing`); }
        return { pubkey: pk(k), isSigner: !!a.signer, isWritable: !!a.writable };
      });
      return new TransactionInstruction({ programId, keys, data });
    }
    const accDisc = Object.fromEntries((idl.accounts || []).map(a => [a.name, Buffer.from(a.discriminator)]));
    function decodeAccount(name, data) {
      const b = Buffer.from(data);
      if (!b.subarray(0, 8).equals(accDisc[name])) throw Error('not a ' + name);
      return c.decode({ defined: { name } }, b, 8);
    }
    const evs = (idl.events || []).map(e => ({ name: e.name, disc: Buffer.from(e.discriminator) }));
    function events(logs) {
      const out = [];
      for (const l of logs || []) {
        const m = /^Program data: (.+)$/.exec(l); if (!m) continue;
        const b = Buffer.from(m[1], 'base64');
        const e = evs.find(x => b.subarray(0, 8).equals(x.disc));
        if (e) out.push({ name: e.name, data: c.decode({ defined: { name: e.name } }, b, 8) });
      }
      return out;
    }
    const errors = Object.fromEntries((idl.errors || []).map(e => [e.code, e]));
    return { ix, decodeAccount, events, errors, codec: c };
  }
  const P = builder(IDL, PID), G = builder(GATE_IDL, GATE);
  /** the program's reason for a refusal, from simulation logs */
  function reason(logs) {
    for (const l of logs || []) {
      const m = /Error Code: (\w+)\. Error Number: (\d+)\. Error Message: (.+?)\.?$/.exec(l);
      if (m) return `${m[1]}: ${m[3]}`;
    }
    return '';
  }
  return { K, PID, GATE, pda, certPda, roomPda, memberPda, nullifierPda, ata, attestationBytes, sthBytes, signIx, P, G, reason };
}
