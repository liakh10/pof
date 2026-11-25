// POF fuzz core: a seeded PRNG, ed25519 signing, an IDL codec, CONTRACT §3/§5/§7 bytes written from the contract text (not from
// the program's own JS), a hand-built Ed25519 precompile instruction (any count, any offsets, any instruction index), a sparse
// Poseidon indexed tree for nullifier membership paths, and the chain harness (simulate with the bank slot it ran at, send, the
// error code of a refusal, per-program compute units, transaction sizes).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const FUZZ = path.resolve(here, '..');
export const PROG = path.resolve(FUZZ, '../program');
export const SCRATCH = process.env.FUZZ_SCRATCH || '/private/tmp/claude-501/-Users-artem-Desktop-sol/be802bf9-e299-4d83-b38b-bc795e5cbb1e/scratchpad/pof-fuzz';
const require = createRequire(path.join(PROG, 'package.json'));
export const web3 = require('@solana/web3.js');
export const spl = require('@solana/spl-token');
const { Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction, ComputeBudgetProgram, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY } = web3;
export { Keypair, PublicKey, TransactionInstruction, SystemProgram };

/* ------------------------------------------------------------------ seeded PRNG (splitmix64 → xoshiro256**) */
export function rng(seed) {
  let x = BigInt.asUintN(64, BigInt(seed));
  const sm = () => { x = BigInt.asUintN(64, x + 0x9e3779b97f4a7c15n); let z = x; z = BigInt.asUintN(64, (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n); z = BigInt.asUintN(64, (z ^ (z >> 27n)) * 0x94d049bb133111ebn); return z ^ (z >> 31n); };
  const s = [sm(), sm(), sm(), sm()];
  const rotl = (v, k) => BigInt.asUintN(64, (v << k) | (v >> (64n - k)));
  function next() {
    const r = BigInt.asUintN(64, rotl(BigInt.asUintN(64, s[1] * 5n), 7n) * 9n);
    const t = BigInt.asUintN(64, s[1] << 17n);
    s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3]; s[2] ^= t; s[3] = rotl(s[3], 45n);
    return r;
  }
  const R = {
    u64: next,
    int: n => Number(next() % BigInt(n)),                       // [0, n)
    range: (a, b) => a + Number(next() % BigInt(b - a + 1)),      // [a, b]
    bool: (p = 0.5) => Number(next() >> 11n) / 2 ** 53 < p,
    pick: arr => arr[Number(next() % BigInt(arr.length))],
    bytes: n => { const b = Buffer.alloc(n); for (let i = 0; i < n; i += 8) { let v = next(); for (let j = 0; j < 8 && i + j < n; j++) { b[i + j] = Number(v & 255n); v >>= 8n; } } return b; },
    field: () => { const b = R.bytes(32); b[0] &= 0x1f; return b; },   // < 2^253 < BN254 r
    keypair: () => Keypair.fromSeed(R.bytes(32)),
    shuffle: arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = R.int(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; },
  };
  return R;
}

/* ------------------------------------------------------------------ ed25519 (node crypto, raw 32-byte seed) */
const PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex');
export const edSign = (kp, msg) => crypto.sign(null, Buffer.from(msg), crypto.createPrivateKey({ key: Buffer.concat([PKCS8, Buffer.from(kp.secretKey.subarray(0, 32))]), format: 'der', type: 'pkcs8' }));
export const sha256 = (...p) => crypto.createHash('sha256').update(Buffer.concat(p.map(x => Buffer.from(x)))).digest();
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function b58(bytes) { let x = BigInt('0x' + (Buffer.from(bytes).toString('hex') || '0')), s = ''; while (x > 0n) { s = B58[Number(x % 58n)] + s; x /= 58n; } for (const b of bytes) { if (b !== 0) break; s = '1' + s; } return s; }
export const u64le = v => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt.asUintN(64, BigInt(v))); return b; };
export const u16le = v => { const b = Buffer.alloc(2); b.writeUInt16LE(v & 0xffff); return b; };

/* ------------------------------------------------------------------ CONTRACT §1, §3, §5, §7 (from the contract text) */
export const subjectHash = (kind, value) => sha256(Buffer.from((kind === 0 ? 'pof:wallet:' : kind === 2 ? 'pof:badge:' : 'pof:x:') + value));
export const keySubject = (kind, pubkey) => subjectHash(kind, pubkey.toBase58());
export const salted = (salt, nf) => sha256(Buffer.from('pof:null:'), salt, nf);
export function attBytes(a, payer, programId) {
  const hs = a.null_hashes.map(h => Buffer.from(h));
  const b = Buffer.alloc(240);
  Buffer.from('POF1').copy(b, 0); new PublicKey(programId).toBuffer().copy(b, 4); b[36] = a.subject_kind; Buffer.from(a.subject_hash).copy(b, 37);
  b[69] = a.asset; b[70] = a.tier; Buffer.from(a.tree_root).copy(b, 71); u64le(a.root_slot).copy(b, 103); b[111] = hs.length & 255;
  sha256(...hs).copy(b, 112); u64le(a.issued_slot).copy(b, 144); u64le(a.expiry_slot).copy(b, 152); new PublicKey(payer).toBuffer().copy(b, 160);
  new PublicKey(a.controller).toBuffer().copy(b, 192); Buffer.from(a.nonce).copy(b, 224);
  return b;
}
export const sthBytes = (size, root, programId) => Buffer.concat([Buffer.from('POF-STH1'), new PublicKey(programId).toBuffer(), u64le(size), Buffer.from(root)]);

/* ------------------------------------------------------------------ the Ed25519 precompile instruction, built by hand */
export const ED25519 = new PublicKey('Ed25519SigVerify111111111111111111111111111');
/** entries: [{ sigOff, sigIx, keyOff, keyIx, msgOff, msgLen, msgIx }]; payload appended after the header; count may lie. */
export function edRaw({ count, entries, payload, keys = [] }) {
  const head = [Buffer.from([count ?? entries.length, 0])];
  for (const e of entries) head.push(u16le(e.sigOff), u16le(e.sigIx), u16le(e.keyOff), u16le(e.keyIx), u16le(e.msgOff), u16le(e.msgLen), u16le(e.msgIx));
  return new TransactionInstruction({ programId: ED25519, keys, data: Buffer.concat([...head, payload]) });
}
/** one signature over msg by kp, all data inside the instruction (indexes u16::MAX), the canonical form. Options bend it. */
export function edIx(kp, msg, o = {}) {
  const sig = o.sig ?? edSign(kp, msg);
  const n = o.entriesBefore ?? 0;
  const start = 2 + 14 * (1 + n);
  const keyOff = start, sigOff = start + 32, msgOff = start + 96;
  const ix = o.ix ?? 0xffff;
  const e = { sigOff, sigIx: o.sigIx ?? ix, keyOff, keyIx: o.keyIx ?? ix, msgOff, msgLen: o.msgLen ?? msg.length, msgIx: o.msgIx ?? ix };
  return edRaw({ count: o.count, entries: [...(o.pre || []), e], payload: Buffer.concat([kp.publicKey.toBuffer(), sig, Buffer.from(msg), o.tail || Buffer.alloc(0)]), keys: o.keys });
}

/* ------------------------------------------------------------------ IDL codec (borsh) */
export function loadIdl(dir = path.join(SCRATCH, 'idl')) {
  return { pof: JSON.parse(fs.readFileSync(path.join(dir, 'pof.json'), 'utf8')), gate: JSON.parse(fs.readFileSync(path.join(dir, 'pof_gate.json'), 'utf8')) };
}
export function codec(idl) {
  const types = Object.fromEntries((idl.types || []).map(t => [t.name, t]));
  const INTS = { u8: 1, i8: 1, u16: 2, u32: 4, u64: 8, i64: 8, u128: 16 };
  function enc(t, v, out) {
    if (typeof t === 'string') {
      if (INTS[t]) { const b = Buffer.alloc(INTS[t]); let x = BigInt.asUintN(8 * INTS[t], BigInt(v)); for (let i = 0; i < INTS[t]; i++) { b[i] = Number(x & 255n); x >>= 8n; } out.push(b); return; }
      if (t === 'bool') { out.push(Buffer.from([v ? 1 : 0])); return; }
      if (t === 'pubkey') { out.push(new PublicKey(v).toBuffer()); return; }
      throw Error('type ' + t);
    }
    if (t.array) { const [it, n] = t.array; if (it === 'u8') { const b = Buffer.from(v); if (b.length !== n) throw Error(`want ${n} bytes, got ${b.length}`); out.push(b); return; } for (let i = 0; i < n; i++) enc(it, v[i], out); return; }
    if (t.vec) { const b = Buffer.alloc(4); b.writeUInt32LE(v.length); out.push(b); for (const x of v) enc(t.vec, x, out); return; }
    if (t.option) { if (v === null || v === undefined) out.push(Buffer.from([0])); else { out.push(Buffer.from([1])); enc(t.option, v, out); } return; }
    if (t.defined) { const d = types[t.defined.name]; for (const f of d.type.fields) enc(f.type, v[f.name], out); return; }
    throw Error('type ' + JSON.stringify(t));
  }
  function dec(t, buf, o) {
    if (typeof t === 'string') {
      if (INTS[t]) { let x = 0n; for (let i = INTS[t] - 1; i >= 0; i--) x = (x << 8n) | BigInt(buf[o.at + i]); o.at += INTS[t]; return INTS[t] <= 4 ? Number(x) : x; }
      if (t === 'bool') return buf[o.at++] === 1;
      if (t === 'pubkey') { const k = new PublicKey(buf.subarray(o.at, o.at + 32)); o.at += 32; return k.toBase58(); }
      throw Error('type ' + t);
    }
    if (t.array) { const [it, n] = t.array; if (it === 'u8') { const b = Buffer.from(buf.subarray(o.at, o.at + n)); o.at += n; return b; } return Array.from({ length: n }, () => dec(it, buf, o)); }
    if (t.vec) { const n = buf.readUInt32LE(o.at); o.at += 4; return Array.from({ length: n }, () => dec(t.vec, buf, o)); }
    if (t.option) return buf[o.at++] ? dec(t.option, buf, o) : null;
    if (t.defined) { const d = types[t.defined.name]; const r = {}; for (const f of d.type.fields) r[f.name] = dec(f.type, buf, o); return r; }
    throw Error('type ' + JSON.stringify(t));
  }
  const encode = (t, v) => { const out = []; enc(t, v, out); return Buffer.concat(out); };
  return { types, encode, decode: (t, buf, at = 0) => dec(t, Buffer.from(buf), { at }) };
}
export function builder(idl) {
  const programId = new PublicKey(idl.address);
  const c = codec(idl);
  const ixs = Object.fromEntries(idl.instructions.map(i => [i.name, i]));
  const pda = (seeds, prog = programId) => PublicKey.findProgramAddressSync(seeds.map(s => Buffer.from(s)), prog)[0];
  /** accounts by name; fixed addresses and const PDAs filled in; an optional account left out is None (the program id) */
  function ix(name, args = {}, accounts = {}, o = {}) {
    const d = ixs[name];
    if (!d) throw Error('no instruction ' + name);
    const data = o.data ?? Buffer.concat([Buffer.from(d.discriminator), ...d.args.map(a => { if (!(a.name in args)) throw Error(`${name}: arg ${a.name} missing`); return c.encode(a.type, args[a.name]); })]);
    const keys = d.accounts.map(a => {
      let k = accounts[a.name];
      if (k === undefined && a.address) k = a.address;
      if (k === undefined && a.name === 'system_program') k = SystemProgram.programId;
      if (k === undefined && a.name === 'instructions') k = SYSVAR_INSTRUCTIONS_PUBKEY;
      if (k === undefined && a.pda && a.pda.seeds.every(s => s.kind === 'const')) k = pda(a.pda.seeds.map(s => Buffer.from(s.value)), a.pda.program ? undefined : programId);
      if (k === undefined || k === null) { if (a.optional) return { pubkey: programId, isSigner: false, isWritable: false, name: a.name }; throw Error(`${name}: account ${a.name} missing`); }
      return { pubkey: new PublicKey(k), isSigner: !!a.signer, isWritable: !!a.writable, name: a.name };
    });
    return new TransactionInstruction({ programId, keys: keys.map(({ name: _, ...k }) => k), data });
  }
  const accDisc = Object.fromEntries((idl.accounts || []).map(a => [a.name, Buffer.from(a.discriminator)]));
  const decodeAccount = (name, data) => { const b = Buffer.from(data); if (!b.subarray(0, 8).equals(accDisc[name])) return null; return c.decode({ defined: { name } }, b, 8); };
  const accountNames = name => ixs[name].accounts.map(a => a.name);
  const evs = (idl.events || []).map(e => ({ name: e.name, disc: Buffer.from(e.discriminator) }));
  const events = logs => (logs || []).flatMap(l => { const m = /^Program data: (.+)$/.exec(l); if (!m) return []; const b = Buffer.from(m[1], 'base64'); const e = evs.find(x => b.subarray(0, 8).equals(x.disc)); return e ? [{ name: e.name, data: c.decode({ defined: { name: e.name } }, b, 8) }] : []; });
  const errors = Object.fromEntries((idl.errors || []).map(e => [e.code, e.name]));
  return { programId, ix, ixs, pda, codec: c, decodeAccount, accountNames, events, errors, accDisc };
}

/* ------------------------------------------------------------------ Poseidon and a sparse indexed nullifier tree (height 40) */
let H = null;
export async function poseidonReady() {
  if (H) return H;
  const mod = await import(path.join(PROG, 'node_modules/@heliuslabs/spr/dist/hasher/index.js'));
  const log = console.log; console.log = () => {}; try { await mod.initializePoseidon(); } finally { console.log = log; }
  H = (a, b) => Buffer.from(mod.poseidon([Uint8Array.from(a), Uint8Array.from(b)]));
  return H;
}
export const HEIGHT = 40;
export function sparseTree(leaves /* Map index(BigInt) -> leaf hash */) {
  const zeros = [Buffer.alloc(32)];
  for (let i = 0; i < HEIGHT; i++) zeros.push(H(zeros[i], zeros[i]));
  const levels = [new Map([...leaves].map(([i, h]) => [BigInt(i), Buffer.from(h)]))];
  for (let l = 0; l < HEIGHT; l++) {
    const up = new Map();
    for (const i of levels[l].keys()) { const p = i >> 1n; if (up.has(p)) continue; up.set(p, H(levels[l].get(p * 2n) ?? zeros[l], levels[l].get(p * 2n + 1n) ?? zeros[l])); }
    levels.push(up);
  }
  const root = levels[HEIGHT].get(0n) ?? zeros[HEIGHT];
  const pathOf = idx => Array.from({ length: HEIGHT }, (_, l) => levels[l].get((BigInt(idx) >> BigInt(l)) ^ 1n) ?? zeros[l]);
  return { root, pathOf, zeros, levels };
}
export function foldPath(value, next, idx, path) {
  let cur = H(value, next), i = BigInt(idx);
  for (let l = 0; l < HEIGHT; l++) { const s = path[l] ?? sparseZeros()[l]; cur = (i & 1n) ? H(s, cur) : H(cur, s); i >>= 1n; }
  return cur;
}
let Z = null;
function sparseZeros() { if (!Z) { Z = [Buffer.alloc(32)]; for (let i = 0; i < HEIGHT; i++) Z.push(H(Z[i], Z[i])); } return Z; }

/* ------------------------------------------------------------------ the chain harness */
export const RPC = process.env.FUZZ_RPC || 'http://127.0.0.1:52899';
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export function harness(idls, url = RPC) {
  const conn = new web3.Connection(url, 'confirmed');
  const P = builder(idls.pof), G = builder(idls.gate);
  const errName = {};
  for (const [k, v] of Object.entries(P.errors)) errName['pof:' + k] = v;
  for (const [k, v] of Object.entries(G.errors)) errName['gate:' + k] = v;
  const HOSTILE = new PublicKey(fs.readFileSync(path.join(FUZZ, 'hostile/src/lib.rs'), 'utf8').match(/declare_id!\("(\w+)"\)/)[1]);
  const progTag = { [P.programId.toBase58()]: 'pof', [G.programId.toBase58()]: 'gate', [HOSTILE.toBase58()]: 'hostile' };
  let blockhash = null, bhAt = 0;
  async function bh() { if (!blockhash || Date.now() - bhAt > 20_000) { blockhash = (await conn.getLatestBlockhash('confirmed')).blockhash; bhAt = Date.now(); } return blockhash; }
  /** the reason of a refusal: a program error name when the program logged one, else the runtime error */
  function why(err, logs) {
    for (const l of logs || []) { const m = /Error Code: (\w+)\. Error Number: (\d+)/.exec(l); if (m) return m[1]; }
    if (err && err.InstructionError) {
      const [i, e] = err.InstructionError;
      if (e && e.Custom !== undefined && !(logs || []).some(l => /custom program error/.test(l)) && !(logs || []).some(l => /Error Code/.test(l))) return 'Ed25519:' + (['InvalidPublicKey', 'InvalidRecoveryId', 'InvalidSignature', 'InvalidDataOffsets', 'InvalidInstructionDataSize'][e.Custom] || e.Custom);
      if (e && e.Custom !== undefined) { for (const l of (logs || [])) { const m = /^Program (\w+) failed: custom program error: 0x([0-9a-f]+)/.exec(l); if (m) { const tag = progTag[m[1]]; const n = parseInt(m[2], 16); return (tag && errName[tag + ':' + n]) || `Custom${n}`; } } return `Custom${e.Custom}`; }
      return typeof e === 'string' ? e : JSON.stringify(e);
    }
    return err ? (typeof err === 'string' ? err : JSON.stringify(err)) : null;
  }
  /** top-level compute units per program, from the logs */
  function unitsOf(logs, prog = P.programId.toBase58()) {
    const out = []; let depth = 0;
    for (const l of logs || []) {
      if (/^Program \w+ invoke \[(\d+)\]/.test(l)) depth = Number(/invoke \[(\d+)\]/.exec(l)[1]);
      const m = /^Program (\w+) consumed (\d+) of (\d+) compute units/.exec(l);
      if (m && m[1] === prog) out.push(Number(m[2]));
    }
    return out;
  }
  // every message unique: two identical transactions under one blockhash share a signature and the second never runs (a status
  // lookup would then report the first one's outcome), so the compute-unit limit carries a counter
  let uniq = 0;
  function message(ixs, payer, { units = 1_400_000 - (uniq++ % 200_000), tables = [], legacy = false } = {}, hash) {
    const pre = units ? [ComputeBudgetProgram.setComputeUnitLimit({ units })] : [];
    const m = new TransactionMessage({ payerKey: payer, recentBlockhash: hash, instructions: [...pre, ...ixs] });
    return legacy ? m.compileToLegacyMessage() : m.compileToV0Message(tables);
  }
  async function tx(ixs, signers, o = {}) {
    const t = new VersionedTransaction(message(ixs, (o.feePayer || signers[0]).publicKey, o, await bh()));
    const have = new Set(t.message.staticAccountKeys.slice(0, t.message.header.numRequiredSignatures).map(k => k.toBase58()));
    t.sign([...(o.feePayer ? [o.feePayer] : []), ...signers].filter((s, i, a) => have.has(s.publicKey.toBase58()) && a.findIndex(x => x.publicKey.equals(s.publicKey)) === i));
    return t;
  }
  /** simulate: { ok, why, logs, units, slot, size, accounts } (accounts = post-state of o.watch) */
  async function sim(ixs, signers, o = {}) {
    let t;
    try { t = await tx(ixs, signers, o); } catch (e) { return { ok: false, why: /overruns|too large/i.test(e.message) ? 'TxTooLarge' : 'build: ' + e.message, logs: [], slot: null, pofUnits: [] }; }
    let size; try { size = t.serialize().length; } catch (e) { return { ok: false, why: 'TxTooLarge', logs: [], pofUnits: [] }; }
    if (size > 1232) return { ok: false, why: 'TxTooLarge', logs: [], pofUnits: [], size };
    const cfg = { sigVerify: !!o.sigVerify, commitment: 'confirmed', replaceRecentBlockhash: !o.sigVerify };
    if (o.watch) cfg.accounts = { encoding: 'base64', addresses: o.watch.map(k => new PublicKey(k).toBase58()) };
    let r;
    for (let i = 0; ; i++) { try { r = await conn.simulateTransaction(t, cfg); break; } catch (e) { if (/too large/.test(e.message)) return { ok: false, why: 'TxTooLarge', logs: [], pofUnits: [], size }; if (i > 4) return { ok: false, why: 'rpc: ' + e.message, logs: [], size, pofUnits: [] }; await sleep(300); } }
    const v = r.value;
    return { ok: !v.err, err: v.err, why: v.err ? why(v.err, v.logs) : null, logs: v.logs || [], units: v.unitsConsumed, pofUnits: unitsOf(v.logs), slot: r.context.slot, size, accounts: v.accounts, ret: v.returnData };
  }
  /** send and confirm: { ok, why, sig, slot, logs, size } (no preflight: the chain itself refuses) */
  async function send(ixs, signers, o = {}) {
    let t;
    try { t = await tx(ixs, signers, o); } catch (e) { return { ok: false, why: /overruns|too large/i.test(e.message) ? 'TxTooLarge' : 'build: ' + e.message, pofUnits: [] }; }
    const size = t.serialize().length;
    if (size > 1232) return { ok: false, why: 'TxTooLarge', size, pofUnits: [] };
    let sig;
    try { sig = await conn.sendRawTransaction(t.serialize(), { skipPreflight: true, maxRetries: 5 }); } catch (e) { return { ok: false, why: 'send: ' + (e.message || e), size, pofUnits: [] }; }
    for (let i = 0; i < 120; i++) {
      const st = (await conn.getSignatureStatuses([sig])).value[0];
      if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) {
        const got = await txOf(sig);
        const logs = got?.meta?.logMessages || [];
        return { ok: !st.err, err: st.err, why: st.err ? why(st.err, logs) : null, sig, slot: st.slot, logs, size, units: got?.meta?.computeUnitsConsumed, pofUnits: unitsOf(logs) };
      }
      await sleep(150);
    }
    return { ok: false, why: 'not confirmed', sig, size, pofUnits: [] };
  }
  /** a landed transaction's meta by raw JSON-RPC (any version up to 1: the v1 transactions of the 40-level path included) */
  async function txOf(sig) {
    for (let i = 0; i < 30; i++) {
      const t = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [sig, { commitment: 'confirmed', encoding: 'json', maxSupportedTransactionVersion: 1 }] }) }).then(r => r.json()).then(j => j.result).catch(() => null);
      if (t) return t;
      await sleep(200);
    }
    return null;
  }
  const slotNow = async () => Number(await conn.getSlot('confirmed'));
  async function waitSlot(s) { while ((await conn.getSlot('processed')) < Number(s)) await sleep(60); }
  const info = a => conn.getAccountInfo(new PublicKey(a), 'confirmed');
  const lam = async a => BigInt((await info(a))?.lamports ?? 0);
  async function fund(keys, sol = 50) {
    const sigs = [];
    for (const k of keys) sigs.push(await conn.requestAirdrop(k.publicKey || new PublicKey(k), Math.round(sol * 1e9)));
    for (const s of sigs) await conn.confirmTransaction(s, 'confirmed');
  }
  return { conn, P, G, HOSTILE, sim, send, tx, txOf, message, slotNow, waitSlot, info, lam, fund, why, unitsOf, bh };
}
