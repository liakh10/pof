/* Proof of Funds phase 2 in the browser: certify with a zero-knowledge proof instead of a Verifier attestation
   (docs-src/zk.md). Nothing here runs unless the pof program on this network carries the zk build AND ZkConfig is on
   (`state().enabled`): the launch program has no ZkConfig, so every entry point answers ZK_OFF and sends nothing.

     const zk = await createZkFlow(pof, { wallet })       pof = createPofClient(...), after deriveVault() / deriveRing()
     await zk.state()                                       { deployed, enabled, escrow, epoch, pending, vkHash }
     await zk.register()                                    register_zk_owner once per vault (paid: rent + the certify fee)
     const c = await zk.certify({ asset, tier })            notes → witness → proof in this page → certify_zk
     await zk.settle(c.kit)                                  waits out the settle window (ZK_SETTLE_SLOTS), status 'settling'
     await zk.revoke(c.kit)                                  revoke_by_holder + release_note_lock (rent back), one transaction
     await zk.revokeSpent(kit, i)                            anyone holding the kit, once note i is spent: revoke_spent + its NoteLock

   What leaves the page: the certify_zk transaction (proof, roots, tags, the escrow ciphertexts) and, on mainnet and devnet,
   the Rings indexer reads (the notes' leaves for their Merkle paths, their nullifiers for the non-inclusion paths, through
   the site's /api/spr proxy). No opening, amount, nk or owner secret is sent anywhere. The kit (nullifiers, a badge secret)
   stays on the device, sealed under the vault's kit key.

   Transactions: certify_zk is legacy when it fits 1,232 bytes (measured: a wallet subject with 1 note 993 B, 3 notes 1,187 B;
   a badge, two signers, 1 note 1,089 B); otherwise it needs an address lookup table (opts.lookupTable) and a wallet with
   sendVersioned. At most 3 notes by default; 4 (1,230 B over the table, no room for a priority fee) only with
   certify({ allowFourNotes: true }) and a lookup table. */
import * as C from './core.js';
import { rpc, account, slot as chainSlot } from './chain.js';
import ZK_IDL from './zk-idl.js';
import * as Z from '../zk/js/zk.js';

const enc = new TextEncoder();
const u8 = s => enc.encode(s);
const zkErr = (code, message, extra = {}) => Object.assign(Error(message), { code, ...extra });
const eqb = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/* ------------------------------------------------------------------ borsh from the zk IDL (as verifier/src/program.ts) */
const TYPES = Object.fromEntries(ZK_IDL.types.map(t => [t.name, t]));
const INTS = { u8: 1, u16: 2, u32: 4, u64: 8, i64: 8, u128: 16 };
function encT(t, v, out) {
  if (typeof t === 'string') {
    if (INTS[t]) { const b = new Uint8Array(INTS[t]); let x = BigInt(v); for (let i = 0; i < INTS[t]; i++) { b[i] = Number(x & 255n); x >>= 8n; } out.push(b); return; }
    if (t === 'bool') { out.push(Uint8Array.of(v ? 1 : 0)); return; }
    if (t === 'pubkey') { out.push(typeof v === 'string' ? C.b58decode(v, 32) : v.toBytes ? v.toBytes() : Uint8Array.from(v)); return; }
    throw Error('idl type ' + t);
  }
  if (t.array) { const [it, n] = t.array; if (it === 'u8') { const b = Uint8Array.from(v); if (b.length !== n) throw Error(`expected ${n} bytes`); out.push(b); return; } for (let i = 0; i < n; i++) encT(it, v[i], out); return; }
  if (t.vec) { const l = new Uint8Array(4); new DataView(l.buffer).setUint32(0, v.length, true); out.push(l); for (const x of v) encT(t.vec, x, out); return; }
  if (t.option) { if (v == null) out.push(Uint8Array.of(0)); else { out.push(Uint8Array.of(1)); encT(t.option, v, out); } return; }
  if (t.defined) { for (const f of TYPES[t.defined.name].type.fields) encT(f.type, v[f.name], out); return; }
  throw Error('idl type ' + JSON.stringify(t));
}
function decT(t, b, o) {
  if (typeof t === 'string') {
    if (INTS[t]) { let x = 0n; for (let i = INTS[t] - 1; i >= 0; i--) x = (x << 8n) | BigInt(b[o.at + i]); o.at += INTS[t]; return INTS[t] <= 4 ? Number(x) : x; }
    if (t === 'bool') return b[o.at++] === 1;
    if (t === 'pubkey') { const k = C.b58encode(b.subarray(o.at, o.at + 32)); o.at += 32; return k; }
  }
  if (t.array) { const [it, n] = t.array; if (it === 'u8') { const x = b.slice(o.at, o.at + n); o.at += n; return x; } return Array.from({ length: n }, () => decT(it, b, o)); }
  if (t.vec) { const n = new DataView(b.buffer, b.byteOffset + o.at, 4).getUint32(0, true); o.at += 4; return Array.from({ length: n }, () => decT(t.vec, b, o)); }
  if (t.option) return b[o.at++] ? decT(t.option, b, o) : null;
  if (t.defined) return Object.fromEntries(TYPES[t.defined.name].type.fields.map(f => [f.name, decT(f.type, b, o)]));
  throw Error('idl type ' + JSON.stringify(t));
}
export function decodeZkAccount(name, data) {
  const a = ZK_IDL.accounts.find(x => x.name === name);
  if (!a || !eqb(data.subarray(0, 8), Uint8Array.from(a.discriminator))) throw zkErr('BAD_ACCOUNT', `not a ${name} account`);
  return decT({ defined: { name } }, data, { at: 8 });
}
export function zkIxData(name, args) {
  const ix = ZK_IDL.instructions.find(x => x.name === name);
  if (!ix) throw zkErr('ZK_OFF', `the zk IDL has no ${name}`);
  const out = [Uint8Array.from(ix.discriminator)];
  for (const a of ix.args) encT(a.type, args[a.name], out);
  const all = new Uint8Array(out.reduce((n, p) => n + p.length, 0)); let k = 0; for (const p of out) { all.set(p, k); k += p.length; }
  return all;
}
function sizeOf(t) {
  if (typeof t === 'string') return t === 'pubkey' ? 32 : t === 'bool' ? 1 : INTS[t];
  if (t.array) return sizeOf(t.array[0]) * t.array[1];
  if (t.defined) return TYPES[t.defined.name].type.fields.reduce((s, f) => s + sizeOf(f.type), 0);
  throw Error('variable size');
}
export const NOTE_LOCK_SIZE = 8 + sizeOf({ defined: { name: 'NoteLock' } });
export const ZK_OWNER_SIZE = 8 + sizeOf({ defined: { name: 'ZkOwner' } });

/* a sparse Poseidon Merkle tree (empty leaf 0), the shape of the POF owner registry */
function sparse(P, height, leaves) {
  const z = [0n]; for (let i = 0; i < height; i++) z.push(P([z[i], z[i]]));
  const levels = [new Map(leaves)];
  for (let l = 0; l < height; l++) {
    const cur = levels[l], up = new Map();
    for (const i of cur.keys()) { const p = i >> 1n; if (!up.has(p)) up.set(p, P([cur.get(p * 2n) ?? z[l], cur.get(p * 2n + 1n) ?? z[l]])); }
    levels.push(up);
  }
  const node = (l, i) => levels[l].get(i) ?? z[l];
  return { root: node(height, 0n), path: i => { const out = []; let k = BigInt(i); for (let l = 0; l < height; l++) { out.push(node(l, k ^ 1n)); k >>= 1n; } return out; } };
}

/* the proving artifacts (4.6 MB circuit, 38.5 MB gzipped key), fetched once with progress; the key unpacks as it streams */
async function fetchBytes(url, onProgress, gz) {
  const r = await fetch(url);
  if (!r.ok) throw zkErr('ZK_ASSETS', `could not load ${url} (${r.status})`);
  const len = Number(r.headers.get('content-length') || 0);
  let wire = 0;
  const counted = r.body.pipeThrough(new TransformStream({ transform(c, ctl) { wire += c.length; onProgress?.(wire, len); ctl.enqueue(c); } }));
  const body = gz ? counted.pipeThrough(new DecompressionStream('gzip')) : counted;
  const reader = body.getReader(); const parts = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; }
  const out = new Uint8Array(got); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export async function createZkFlow(pof, opts = {}) {
  await C.ready();
  const P = Z.fromBytesPoseidon(C.poseidon);
  const W3 = await import('./dist/web3.js');
  const { PublicKey, TransactionInstruction, Transaction, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } = W3;
  const W = opts.wallet || await import('./wallet.js');
  const programId = opts.programId || pof.config.programId;
  if (!programId) throw zkErr('NO_PROGRAM', 'the POF program id is not set');
  const PID = new PublicKey(programId);
  const pda = (seeds, prog = PID) => PublicKey.findProgramAddressSync(seeds, prog)[0];
  const K = { config: pda([u8('config')]), treasury: pda([u8('treasury')]), zk: pda([u8('zk')]), registry: pda([u8('zkreg')]) };
  const TREE = new PublicKey(C.RINGS.tree), SPP = new PublicKey(C.RINGS.spp), SYSTEM = new PublicKey('11111111111111111111111111111111');
  const ATA = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
  const lockPda = tag => pda([u8('znote'), tag]);
  const ownerRecord = owner => pda([u8('zkowner'), C.b58decode(owner, 32)]);
  const certPda = (sh, asset) => pda([u8('cert'), sh, Uint8Array.of(asset)]);
  const nullifierPda = nf => pda([u8('nullifier'), TREE.toBytes(), nf], SPP);
  const status = (phase, d = {}) => { try { opts.onStatus?.({ step: 'zk', phase, ...d, at: Date.now() }); } catch {} };
  const SETTLE_FALLBACK = 150;

  /* the accounts of an instruction in the IDL's order with its flags; an absent optional account is the program id */
  function ixOf(name, args, named, extra = []) {
    const ix = ZK_IDL.instructions.find(i => i.name === name);
    const keys = ix.accounts.map(a => {
      const k = named[a.name] ?? (a.address ? new PublicKey(a.address) : null);
      if (!k) { if (a.optional) return { pubkey: PID, isSigner: false, isWritable: false }; throw zkErr('ZK_ACCOUNTS', `${name} wants an account ${a.name}`); }
      return { pubkey: typeof k === 'string' ? new PublicKey(k) : k, isSigner: !!a.signer, isWritable: !!a.writable };
    });
    return new TransactionInstruction({ programId: PID, keys: [...keys, ...extra], data: W3.Buffer.from(zkIxData(name, args)) });
  }
  async function decoded(addr, name) { const a = await account(addr.toBase58()); return a && a.owner === programId ? decodeZkAccount(name, a.data) : null; }

  /* ---------------------------------------------------------------- the switch */
  async function state() {
    const a = await account(K.zk.toBase58());
    if (!a || a.owner !== programId) return { deployed: false, enabled: false, reason: 'ZK_NOT_DEPLOYED' };
    const z = decodeZkAccount('ZkConfig', a.data);
    const s = await chainSlot();
    const taken = z.next_slot !== 0n && s >= z.next_slot;   // ZkConfig.active(slot): a pending change takes over by itself
    const escrow = taken ? z.next_escrow : z.escrow;
    return {
      deployed: true, enabled: taken ? z.next_enabled : z.enabled, escrow: escrow.map(Z.toBig),
      epoch: taken && !eqb(z.next_escrow[0], z.escrow[0]) ? z.escrow_epoch + 1 : z.escrow_epoch,
      pending: z.next_slot !== 0n && s < z.next_slot ? { enabled: z.next_enabled, atSlot: z.next_slot } : null,
      vkHash: C.hex(z.vk_hash), certified: z.certified, slot: s, ...(taken ? {} : {}),
    };
  }
  const enabled = async () => (await state()).enabled;
  async function needOn() { const s = await state(); if (!s.enabled) throw zkErr('ZK_OFF', s.deployed ? 'zero-knowledge certificates are switched off on this network' : 'this network runs the POF program without zero-knowledge certificates'); return s; }

  /* ---------------------------------------------------------------- the owner registry (ZK-04, ZK-11) */
  async function registered(from = 'vault') { return !!(await account(ownerRecord(pof.zkIdentity(from).owner).toBase58())); }
  async function register({ from = 'vault' } = {}) {
    const id = pof.zkIdentity(from);
    if (await account(ownerRecord(id.owner).toBase58())) { status('register', { already: true }); return { already: true }; }
    const s = await state();
    if (!s.deployed || !(s.enabled || s.pending?.enabled)) throw zkErr('ZK_OFF', 'zero-knowledge certificates are not on here: nothing to register for');
    const commitment = Z.be32(Z.ownerCommitment(P, id.ownerSecret));
    const ix = ixOf('register_zk_owner', { commitment }, { owner: new PublicKey(id.owner), payer: new PublicKey(W.state().address), config: K.config, treasury: K.treasury, registry: K.registry, owner_record: ownerRecord(id.owner) });
    status('register', { phase2: 'sign' });
    const r = await W.send([ix], { cosigners: id.signer ? [id.signer] : [] });
    const done = await r.wait();
    status('register', { done: true, signature: r.signature });
    return { signature: r.signature, slot: done.slot };
  }
  /* every registration on chain (one ZkOwner record each), as the program built its tree; the path of this owner */
  async function registryPath(owner) {
    const disc = Uint8Array.from(ZK_IDL.accounts.find(a => a.name === 'ZkOwner').discriminator);
    for (let attempt = 0; attempt < 3; attempt++) {
      const rows = await rpc('getProgramAccounts', [programId, { encoding: 'base64', commitment: 'confirmed', filters: [{ dataSize: ZK_OWNER_SIZE }, { memcmp: { offset: 0, bytes: C.b58encode(disc) } }] }]);
      const leaves = new Map(); let mine = -1n;
      for (const r of rows) {
        const o = decodeZkAccount('ZkOwner', Uint8Array.from(atob(r.account.data[0]), c => c.charCodeAt(0)));
        leaves.set(BigInt(o.index), P([Z.ownerId(P, C.b58decode(o.owner, 32)), Z.toBig(o.commitment)]));
        if (o.owner === owner) mine = BigInt(o.index);
      }
      if (mine < 0n) throw zkErr('ZK_NOT_REGISTERED', 'register this vault for zero-knowledge certificates first (one paid transaction)');
      const reg = await decoded(K.registry, 'ZkRegistry');
      const t = sparse(P, Z.REG_H, leaves);
      if (reg.roots.some(r => Z.toBig(r) === t.root) && BigInt(reg.next_index) === BigInt(leaves.size)) return { root: t.root, index: mine, path: t.path(mine) };
      await new Promise(r => setTimeout(r, 800));   // a registration landed between the two reads
    }
    throw zkErr('ZK_REGISTRY_MISMATCH', 'the owner registry read from chain does not reach a root the program holds; try again');
  }

  /* ---------------------------------------------------------------- notes, locks and witnesses */
  const nullifierOf = (n, nk) => n.nullifier || C.nullifier(n.leaf, n.blinding, nk);
  const tagOf = nf => Z.be32(P([Z.TAG_DOMAIN, Z.toBig(nf)]));
  /* each note's lock: free, ours (the same certificate, revoked or expired: a remake may reuse it), or taken / spent */
  async function locksOf(notes, from, cert) {
    const id = pof.zkIdentity(from);
    const tags = notes.map(n => tagOf(nullifierOf(n, id.nk)));
    const res = tags.length ? (await rpc('getMultipleAccounts', [tags.map(t => lockPda(t).toBase58()), { encoding: 'base64', commitment: 'confirmed' }])).value : [];
    return res.map((a, i) => {
      if (!a || a.owner !== programId) return { tag: tags[i], free: true };
      const l = decodeZkAccount('NoteLock', Uint8Array.from(atob(a.data[0]), c => c.charCodeAt(0)));
      return { tag: tags[i], free: !l.spent && !!cert && l.certificate === cert.toBase58(), spent: l.spent, certificate: l.certificate };
    });
  }
  async function stateWitness(notes, tree) {
    if (opts.stateWitness) return opts.stateWitness(notes, tree);
    if (pof.local) {
      await pof.local.refresh();
      return { root: pof.local.head.root, paths: notes.map(n => pof.local.pathOf(n.leafIndex)) };
    }
    const ix = indexer();
    const r = await ix.getMerkleProofs(C.RINGS.tree, notes.map(n => n.leaf));
    const root = r.proofs[0].root;
    if (r.proofs.some(p => !eqb(p.root, root))) throw zkErr('ZK_ROOT_MOVED', 'the indexer answered paths at two roots; try again');
    return { root, paths: r.proofs.map(p => [...p.path]) };
  }
  async function nullWitness(nullifiers) {
    if (opts.nullWitness) return opts.nullWitness(nullifiers);
    const r = await indexer().getNonInclusionProofs(C.RINGS.tree, nullifiers);
    return r.proofs.map(p => ({ lowElement: p.lowElement, highElement: p.highElement, lowElementIndex: p.lowElementIndex, path: [...p.path], root: p.root }));
  }
  function indexer() {
    if (!pof.config.indexer) throw zkErr('ZK_NO_INDEXER', 'no Rings indexer here for the Merkle and non-inclusion paths (pass stateWitness / nullWitness)');
    const S = C.spr;
    return new S.SprIndexer(new S.SprApi({ url: new URL(pof.config.indexer, typeof location !== 'undefined' ? location.href : 'http://localhost/').href }));
  }
  /* the circuit's inputs for these notes, checked against the tree account the program will read */
  async function witness({ notes, from, pub }) {
    const id = pof.zkIdentity(from);
    const treeAcc = await account(C.RINGS.tree);
    if (!treeAcc || treeAcc.owner !== C.RINGS.spp) throw zkErr('RINGS_TREE', 'the Rings tree account is not readable');
    const tree = C.decodeTree(treeAcc.data);
    const st = await stateWitness(notes, tree);
    if (!tree.history.some(r => eqb(r, st.root))) throw zkErr('ZK_ROOT_MOVED', 'the notes\' state root is not in the tree\'s history; try again');
    notes.forEach((n, i) => { if (!eqb(C.rootFromPath(n.leaf, n.leafIndex, st.paths[i]), st.root)) throw zkErr('ZK_BAD_PATH', `the Merkle path of note ${i} does not reach the root`); });
    const nfs = notes.map(n => nullifierOf(n, id.nk));
    const ni = await nullWitness(nfs);
    ni.forEach((p, i) => {
      if (!eqb(p.root, tree.nullifierRoot)) throw zkErr('ZK_NULL_ROOT', 'the non-inclusion path is not at the tree\'s newest nullifier root (a forester batch landed?); try again');
      const v = Z.toBig(nfs[i]), lo = Z.toBig(p.lowElement), hi = Z.toBig(p.highElement);
      if (!(lo < v && (hi === 0n || v < hi))) throw zkErr('NOTE_SPENT', `note ${i} is already spent or queued`);
    });
    const ring = { ownerKey: C.b58decode(id.owner, 32), nk: id.nk, ownerSecret: id.ownerSecret };
    const zkNotes = notes.map((n, i) => {
      const ringTerm = n.ringDataHash || n.ringProgramId ? Z.ringTerm(P, n.ringDataHash ? C.unhex(C.hex(n.ringDataHash), 32) : null, n.ringProgramId ? C.b58decode(n.ringProgramId, 32) : null) : undefined;
      return { amount: BigInt(n.amount), blinding: n.blinding, ...(n.dataHash ? { dataHash: n.dataHash } : {}), ...(ringTerm !== undefined ? { ringTerm } : {}), leafIndex: BigInt(n.leafIndex), statePath: st.paths[i], lowValue: ni[i].lowElement, nextValue: ni[i].highElement, lowIndex: BigInt(ni[i].lowElementIndex), nullPath: ni[i].path };
    });
    const registry = await registryPath(id.owner);
    const r = Z.ephemeralScalar();
    const built = Z.buildInputs(P, { ring, notes: zkNotes, pub: { ...pub, stateRoot: st.root, nullRoot: tree.nullifierRoot }, r, registry });
    // the circuit's commitments must be the leaves (else the witness generator fails much later, with less to say)
    const leaves = new Set(notes.map(n => C.hex(n.leaf)));
    if (!built.notes.every(x => leaves.has(C.hex(Z.be32(x.commitment))))) throw zkErr('ZK_BAD_NOTE', 'a note does not open to its leaf with this vault\'s keys');
    return built;
  }

  /* ---------------------------------------------------------------- proving */
  let artifacts = null;
  async function loadArtifacts() {
    if (artifacts) return artifacts;
    const base = opts.assetBase || new URL('../zk/', import.meta.url).href;
    let snarkjs = opts.snarkjs || globalThis.snarkjs;
    if (!snarkjs && typeof document !== 'undefined') {
      await new Promise((ok, no) => { const s = document.createElement('script'); s.src = new URL('dist/snarkjs.min.js', base).href; s.onload = ok; s.onerror = () => no(zkErr('ZK_ASSETS', 'could not load the prover')); document.head.appendChild(s); });
      snarkjs = globalThis.snarkjs;
    }
    if (!snarkjs) throw zkErr('ZK_ASSETS', 'no prover (snarkjs) in this environment');
    const show = what => (got, len) => status('load', { what, mb: +(got / 1e6).toFixed(1), totalMb: len ? +(len / 1e6).toFixed(1) : null });
    const wasm = opts.wasm instanceof Uint8Array ? opts.wasm : await fetchBytes(opts.wasm || new URL('setup/pof.wasm', base).href, show('circuit'), false);
    const zkey = opts.zkey instanceof Uint8Array ? opts.zkey : await fetchBytes(opts.zkey || new URL('setup/pof_final.zkey.gz', base).href, show('key'), !(opts.zkey && !/\.gz$/.test(opts.zkey)));
    artifacts = { snarkjs, wasm, zkey };
    return artifacts;
  }
  async function prove(input) {
    if (opts.prover) return opts.prover({ input, onStage: s => status('prove', { stage: s }) });
    const a = await loadArtifacts();
    return Z.prove(a.snarkjs, { input, wasm: a.wasm, zkey: a.zkey, onStage: s => status('prove', { stage: s }) });
  }

  /* ---------------------------------------------------------------- transactions */
  const MAX_TX = 1232;
  function legacySize(ixs, payer, signers) {
    const tx = new Transaction({ feePayer: payer, blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 0 });
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })); for (const ix of ixs) tx.add(ix);
    return tx.serializeMessage().length + 1 + 64 * signers;
  }
  async function lookupTable(address) {
    const a = await account(address);
    if (!a) throw zkErr('ZK_NO_ALT', 'the address lookup table is not on chain');
    const addresses = []; for (let o = 56; o + 32 <= a.data.length; o += 32) addresses.push(new PublicKey(a.data.subarray(o, o + 32)));
    return { key: new PublicKey(address), state: { addresses }, isActive: () => true };
  }
  /* legacy when it fits; otherwise a version 0 message over the lookup table, through the wallet's sendVersioned */
  async function sendFitting(ixs, { cosigners = [], signers }) {
    const payer = new PublicKey(W.state().address);
    const size = legacySize(ixs, payer, signers);
    if (size <= MAX_TX) return { ...(await W.send(ixs, { cosigners })), size, version: 'legacy' };
    if (!opts.lookupTable || !W.sendVersioned) throw zkErr('ZK_TX_TOO_LARGE', `this certificate's transaction is ${size} bytes (over ${MAX_TX}): use fewer notes (merge them in Rings) or a lookup table`, { size });
    const alt = await lookupTable(opts.lookupTable);
    const r = await W.sendVersioned(ixs, { cosigners, lookupTables: [alt] });
    return { ...r, version: 0 };
  }
  const chainCode = e => { const logs = (e && (e.logs || e.transactionLogs || e.data?.logs)) || []; const m = logs.map(l => /Error Code: (\w+)\./.exec(l)).find(Boolean); return m ? m[1] : null; };

  /* ---------------------------------------------------------------- kits (on this device, sealed under the kit key) */
  const KITS = owner => 'pof:zkkits:v1:' + owner;
  async function readKits(from = 'vault') { const id = pof.zkIdentity(from); const raw = id.get(KITS(id.owner)); return raw ? id.unseal(JSON.parse(raw)) : []; }
  async function writeKits(list, from = 'vault') { const id = pof.zkIdentity(from); id.put(KITS(id.owner), JSON.stringify(await id.seal(list))); }

  /* ---------------------------------------------------------------- certify_zk */
  async function certify({ asset = 0, tier = 1, subjectKind = 0, from = 'vault', notes = null, allowWalletPayer = false, allowFourNotes = false, nonce = null } = {}) {
    const st = await needOn();
    const id = pof.zkIdentity(from);
    if (!(await account(ownerRecord(id.owner).toBase58()))) throw zkErr('ZK_NOT_REGISTERED', 'register this vault for zero-knowledge certificates first (one paid transaction)');
    if (subjectKind !== 0 && subjectKind !== 2) throw zkErr('ZK_SUBJECT', 'a zero-knowledge certificate names a wallet or a badge (an X handle needs the Verifier)');
    if (subjectKind === 2 && !allowWalletPayer) throw zkErr('PAYER_LINKS_WALLET', 'The wallet pays this transaction, which links it to the badge in public. Pass allowWalletPayer after showing the holder that.');
    const wallet = W.state().address;
    const payer = new PublicKey(wallet);
    // the subject key: the wallet itself, or a fresh badge key made here (its secret goes into the kit)
    let controller = payer, badge = null;
    if (subjectKind === 2) { const secret = crypto.getRandomValues(new Uint8Array(32)); const k = C.spr.SigningKey.fromEd25519Bytes(secret); badge = { secret, publicKey: C.b58encode(k.publicKey().ed25519()), sign: m => k.sign(new Uint8Array(m)) }; controller = new PublicKey(badge.publicKey); }
    const subjectHash = await C.subjectHash(subjectKind, controller.toBase58());
    const certificate = certPda(subjectHash, asset);
    const cfg = await decoded(K.config, 'Config');
    if (!cfg) throw zkErr('CHAIN_OFF', 'the pof program has no Config here');
    const a = cfg.assets[asset]; if (!a || !a.enabled) throw zkErr('BAD_ASSET', 'that asset is not enabled');
    const minAmount = BigInt(a.mins[tier - 1] ?? 0n); if (!minAmount) throw zkErr('BAD_TIER', `no tier ${tier}`);
    // the notes: the fewest that reach the tier among those no other certificate holds (at most 4, the circuit's slots)
    let pick = notes;
    if (!pick) {
      const list = await pof.notes({ from });
      const locks = await locksOf(list, from, certificate);
      const freeList = list.filter((_, i) => locks[i].free);
      const p = await pof.choose({ asset, tier, from, list: freeList });
      if (!p.ready) throw zkErr(p.waitSlots ? 'NOTE_TOO_NEW' : 'BELOW_TIER', p.waitSlots ? `your newest note needs ${p.waitSlots} more slots` : 'not enough free notes in the vault for that tier', { pick: p });
      pick = p.notes;
    } else if (!opts.skipLockCheck) {   // skipLockCheck: tests only, to see the program's own refusal
      const locks = await locksOf(pick, from, certificate);
      const i = locks.findIndex(l => !l.free); if (i >= 0) throw zkErr('ZK_NOTE_LOCKED', `note ${i} already backs ${locks[i].spent ? 'a certificate revoked by its spend' : 'another zero-knowledge certificate'}`);
    }
    // at most 3 notes by default: a 4-note certify_zk is 1,230 of 1,232 bytes even over a lookup table with two signers, so
    // it has no room for a priority fee; 4 only with allowFourNotes and a lookup table (lead, 2026-11-25)
    const cap = allowFourNotes && opts.lookupTable ? Z.N : 3;
    if (pick.length > cap) throw zkErr('ZK_TOO_MANY_NOTES', pick.length > Z.N ? `this tier needs ${pick.length} notes; a proof takes at most ${Z.N} (merge them in Rings first)` : `this tier needs ${pick.length} notes; a zero-knowledge certificate takes at most 3 here (merge notes in Rings first${pick.length === 4 ? ', or allow four notes with a lookup table' : ''})`, { notes: pick.length });
    const total = pick.reduce((s, n) => s + BigInt(n.amount), 0n);
    if (total < minAmount || pick.some(n => n.asset !== a.mint)) throw zkErr('BELOW_TIER', 'these notes do not reach the tier in that asset');
    const signers = subjectKind === 2 ? 2 : 1;
    const holder = cfg.root_mint && cfg.root_mint !== SYSTEM.toBase58() ? PublicKey.findProgramAddressSync([payer.toBytes(), new PublicKey(cfg.root_token_program).toBytes(), new PublicKey(cfg.root_mint).toBytes()], ATA)[0] : SYSTEM;
    const existing = await decoded(certificate, 'Certificate');
    const prior = existing && existing.payer !== wallet && existing.payer !== SYSTEM.toBase58() ? new PublicKey(existing.payer) : null;
    for (let attempt = 0; ; attempt++) {
      const n16 = nonce || crypto.getRandomValues(new Uint8Array(16));
      const ctx = await Z.context({ programId: PID.toBytes(), subjectKind, subjectHash, asset, tier, controller: controller.toBytes(), payer: payer.toBytes(), nonce: n16 });
      status('witness', { notes: pick.length });
      const built = await witness({ notes: pick, from, pub: { mint: C.b58decode(a.mint, 32), minAmount, ctx, escrow: st.escrow } });
      status('prove', { stage: 'start' });
      const p = await prove(built.input);
      const za = Z.certifyZkArgs(p.proof, p.publicSignals);
      const args = { subject_kind: subjectKind, asset, tier, nonce: n16, proof: za.proof, state_root: za.stateRoot, null_root: za.nullRoot, registry_root: za.registryRoot, eph: za.eph, tags: za.tags.slice(0, za.noteCount), cts: za.cts.slice(0, za.noteCount) };
      const locks = args.tags.map(t => ({ pubkey: lockPda(t), isSigner: false, isWritable: true }));
      const ix = ixOf('certify_zk', { args }, { payer, controller, config: K.config, zk: K.zk, registry: K.registry, treasury: K.treasury, certificate, ...(prior ? { prior_payer: prior } : {}), holder_token: holder, tree: TREE }, locks);
      if (prior) ix.keys[7].isWritable = true;
      status('send', { notes: args.tags.length });
      let sent;
      try { sent = await sendFitting([ix], { cosigners: badge ? [badge] : [], signers }); }
      catch (e) {
        // a forester batch moved the newest nullifier root between the read and the send: prove again (once)
        if (attempt === 0 && !nonce && (chainCode(e) === 'ZkNullRootNotNewest' || chainCode(e) === 'ZkStateRootUnknown')) { status('retry', { reason: chainCode(e) }); continue; }
        const code = chainCode(e); if (code) e.code = code;
        throw e;
      }
      const done = await sent.wait();
      const c = await decoded(certificate, 'Certificate');
      const kit = {
        v: 1, kind: 'zk', network: pof.config.network, programId, certificate: certificate.toBase58(), subject: { kind: subjectKind, value: controller.toBase58() },
        subjectHash: C.hex(subjectHash), asset, tier, nonce: C.hex(n16), tags: args.tags.map(C.hex), nullifiers: built.notes.map(x => C.hex(Z.be32(x.nullifier))),
        lockPayer: wallet, certifiedSlot: String(c.certified_slot), issuedSlot: String(c.issued_slot), expirySlot: String(c.expiry_slot), signature: sent.signature,
        ...(badge ? { badgeSecret: C.hex(badge.secret) } : {}), savedAt: new Date().toISOString(),
      };
      const all = (await readKits(from)).filter(k => k.certificate !== kit.certificate); all.push(kit); await writeKits(all, from);
      status('settling', { issuedSlot: kit.issuedSlot });
      return { signature: sent.signature, slot: done.slot, certificate: certificate.toBase58(), kit, ms: p.ms, notes: args.tags.length, size: sent.size, version: sent.version, settlesAt: BigInt(c.issued_slot) };
    }
  }

  /* ---------------------------------------------------------------- after certify */
  async function certificateState(kit) {
    const c = await decoded(new PublicKey(kit.certificate), 'Certificate');
    if (!c) return { status: 'absent' };
    const s = await chainSlot();
    const names = ['live', 'revoked_spent', 'revoked_by_holder', 'expired', 'voided'];
    let status_ = names[c.status] || 'unknown';
    if (c.status === 0 && s > c.expiry_slot) status_ = 'expired';
    if (status_ === 'live' && s < c.issued_slot) status_ = 'settling';
    return { status: status_, slot: s, issuedSlot: c.issued_slot, expirySlot: c.expiry_slot, settleSlots: status_ === 'settling' ? Number(c.issued_slot - s) : 0, mine: C.hex(c.nonce) === kit.nonce };
  }
  /* the settle window (ZK-02): gates refuse the certificate until its issued slot */
  async function settle(kit, { signal, tickMs = 1000 } = {}) {
    for (;;) {
      if (signal?.aborted) throw zkErr('ABORTED', 'stopped', { silent: true });
      const s = await certificateState(kit);
      if (s.status !== 'settling') { status('settled', { state: s.status }); return s; }
      status('settling', { remainingSlots: s.settleSlots, issuedSlot: String(s.issuedSlot) });
      await new Promise(r => setTimeout(r, Math.min(tickMs, Math.max(300, s.settleSlots * 400))));
    }
  }
  const badgeSigner = kit => { const k = C.spr.SigningKey.fromEd25519Bytes(C.unhex(kit.badgeSecret, 32)); return { publicKey: kit.subject.value, sign: m => k.sign(new Uint8Array(m)) }; };
  async function lockPayers(kit) {
    return Promise.all(kit.tags.map(async t => { const l = await decoded(lockPda(C.unhex(t, 32)), 'NoteLock'); return l ? { tag: t, payer: l.payer, spent: l.spent, certificate: l.certificate } : null; }));
  }
  /* the holder ends it: revoke_by_holder, then each note lock released (its rent back to whoever paid it), one transaction */
  async function revoke(kit) {
    const certificate = new PublicKey(kit.certificate);
    const ctl = kit.subject.kind === 2 ? badgeSigner(kit) : null;
    if (!ctl && kit.subject.value !== W.state().address) throw zkErr('WRONG_WALLET', 'connect the wallet this certificate names');
    const ixs = [ixOf('revoke_by_holder', {}, { controller: new PublicKey(kit.subject.value), config: K.config, treasury: K.treasury, certificate })];
    for (const l of await lockPayers(kit)) if (l && !l.spent && l.certificate === kit.certificate) ixs.push(ixOf('release_note_lock', {}, { config: K.config, lock: lockPda(C.unhex(l.tag, 32)), certificate, payer: new PublicKey(l.payer) }));
    const r = await sendFitting(ixs, { cosigners: ctl ? [ctl] : [], signers: ctl ? 2 : 1 });
    await r.wait();
    status('revoked', { signature: r.signature });
    return { signature: r.signature, released: ixs.length - 1 };
  }
  /* locks of a certificate that is no longer live (revoked, expired): rent back; anyone may send it */
  async function release(kit) {
    const certificate = new PublicKey(kit.certificate);
    const ixs = [];
    for (const l of await lockPayers(kit)) if (l && !l.spent && l.certificate === kit.certificate) ixs.push(ixOf('release_note_lock', {}, { config: K.config, lock: lockPda(C.unhex(l.tag, 32)), certificate, payer: new PublicKey(l.payer) }));
    if (!ixs.length) return { released: 0 };
    const r = await sendFitting(ixs, { signers: 1 }); await r.wait();
    return { signature: r.signature, released: ixs.length };
  }
  /* revoke_spent with the kit's nullifier of note `index` once it is spent (its nullifier PDA exists), the note lock as the
     first remaining account (FZ-18: the program marks it spent). Anyone holding the kit can send this. */
  async function revokeSpent(kit, index) {
    const nf = C.unhex(kit.nullifiers[index], 32);
    const certificate = new PublicKey(kit.certificate);
    const ix = ixOf('revoke_spent', { index, salt: new Uint8Array(32), nullifier: nf, membership: null }, { caller: new PublicKey(W.state().address), config: K.config, treasury: K.treasury, certificate, tree: TREE, nullifier_account: nullifierPda(nf) },
      [{ pubkey: lockPda(C.unhex(kit.tags[index], 32)), isSigner: false, isWritable: true }]);
    const r = await W.send([ix]); await r.wait();
    return { signature: r.signature };
  }

  return {
    state, enabled, registered, register, certify, settle, certificateState, revoke, release, revokeSpent,
    kits: { list: (from = 'vault') => readKits(from) },
    loadArtifacts, witness, prove, locksOf, registryPath,
    addresses: { ...Object.fromEntries(Object.entries(K).map(([k, v]) => [k, v.toBase58()])), lock: t => lockPda(t).toBase58(), ownerRecord: o => ownerRecord(o).toBase58() },
    settleSlotsFallback: SETTLE_FALLBACK,
  };
}
