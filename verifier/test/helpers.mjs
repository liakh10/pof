/* Test doubles built from the Helius SDK itself (not from the Verifier's code): a Rings tree of height 32 with the SDK's
   Poseidon, notes made with the SDK's Utxo class, nullifiers from the SDK's NullifierKey. The Verifier must agree with them. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as spr from '@heliuslabs/spr';
import * as internal from '@heliuslabs/spr/internal';
import * as V from '../dist/pof-verifier.mjs';

await spr.initializePoseidon();
export { spr, V };
export const TREE = '777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor';
export const hex = (b) => Buffer.from(b).toString('hex');
export const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pofv-test-'));

export function ring() {
  const seed = new Uint8Array(crypto.randomBytes(32));
  const kp = spr.ShieldedKeypair.fromKeypair(spr.SigningKey.fromEd25519Bytes(seed));
  const addr = kp.shieldedAddress();
  return { seed, kp, owner: addr.solanaAddress(), npk: addr.nullifierPublicKey, nk: kp.nullifierKey().secretBytes(), signing: addr.signingPublicKey, wallet: V.signerFromSeed(seed) };
}

export class MemoryRings {
  constructor() { this.leaves = []; this.slotNow = 1_000_000n; this.created = new Map(); this.spentSet = new Set(); this.records = new Map(); this.history = []; this.headSlot = 0n; this.nfRoot = new Uint8Array(32).fill(7); this.fail = {}; }
  register(r) { this.records.set(r.owner, r.npk); }
  zero(level) { let z = new Uint8Array(32); for (let i = 0; i < level; i++) z = internal.poseidon([z, z]); return z; }
  rootAndPath(index) {
    let level = this.leaves.slice(); const path = []; let idx = index;
    for (let d = 0; d < 32; d++) {
      const sib = idx ^ 1; path.push(sib < level.length ? level[sib] : this.zero(d));
      const next = []; for (let i = 0; i < level.length; i += 2) next.push(internal.poseidon([level[i], i + 1 < level.length ? level[i + 1] : this.zero(d)]));
      level = next.length ? next : [this.zero(d + 1)]; idx >>= 1;
    }
    return { root: level[0], path };
  }
  /** a note made by the SDK's Utxo class; returns the opening the client would disclose */
  note(r, amount, { asset = spr.SOL_MINT, ageSlots = 10_000n } = {}) {
    const blinding = new Uint8Array(32); blinding.set(crypto.randomBytes(31), 1);
    const u = new spr.Utxo({ owner: r.signing, asset, amount: BigInt(amount), blinding });
    const commitment = u.hash(r.npk, 0);
    const leafIndex = this.leaves.length;
    this.leaves.push(commitment);
    const sig = V.toB58(new Uint8Array(crypto.randomBytes(64)));
    this.created.set(sig, { slot: this.slotNow - BigInt(ageSlots), tree: TREE, leafIndex: BigInt(leafIndex), commitment });
    this.history.push(this.rootAndPath(0).root); if (this.history.length > 500) this.history.shift();
    this.headSlot = this.slotNow - 5n;
    const nullifier = r.kp.nullifierKey().nullifier(commitment, blinding);
    return { opening: { tree: TREE, leafIndex: String(leafIndex), asset, amount: String(amount), blinding: hex(blinding), sig }, commitment, nullifier };
  }
  async slot() { return this.slotNow; }
  async treeHead(tree) { if (tree !== TREE) throw new V.PofError('RINGS_TREE', 'not a tree'); return { tree, treeId: 0, head: this.history.at(-1), headSlot: this.headSlot, history: this.history.slice(), nullifierHistory: [this.nfRoot], slot: this.slotNow }; }
  async merklePaths(tree, leaves) {
    return leaves.map(l => { const i = this.leaves.findIndex(x => hex(x) === hex(l)); if (i < 0) throw new V.PofError('NOT_IN_TREE', 'the Rings indexer has no Merkle path for one of the notes'); const { root, path } = this.rootAndPath(i); return { leaf: l, leafIndex: BigInt(i), path, root }; });
  }
  async registryNullifierKey(w) { return this.records.get(w) || null; }
  async spent(tree, nfs) { if (this.fail.spent) throw new V.PofError('INDEXER_UNAVAILABLE', 'down', 503); return nfs.map(n => this.spentSet.has(hex(n))); }
  async creation(sig, commitment) { const c = this.created.get(sig); return c && hex(c.commitment) === hex(commitment) ? { slot: c.slot, tree: c.tree, leafIndex: c.leafIndex } : null; }
  spend(nf) { this.spentSet.add(hex(nf)); }
}

export class FakeChain {
  constructor(rings) { this.rings = rings; this.certs = new Map(); this.sent = []; this.balance = 10_000_000_000n; this.inbox = []; }
  async slot() { return this.rings ? this.rings.slotNow : 1_000_000n; }
  async certificate(sh, asset) { return this.certs.get(hex(sh) + ':' + asset) || null; }
  async certify(x) {
    const a = V.decodeAttestation(x.attestation);
    this.certs.set(hex(a.subjectHash) + ':' + a.asset, { address: 'Cert' + hex(a.subjectHash).slice(0, 8), status: 0, tier: a.tier, expirySlot: a.expirySlot, hashes: x.hashes.map(hex), payer: V.toB58(a.payer) });
    this.sent.push({ kind: 'certify', logIndex: x.logIndex }); this.balance -= 2_500_000n; return { signature: 'sigCertify' + this.sent.length, lamports: 2_500_000n };
  }
  async revokeSpent(x) {
    const c = this.certs.get(hex(x.subjectHash) + ':' + x.asset);
    const h = hex(V.saltedNullifier(x.salt, x.nullifier));
    if (!c || c.hashes[x.index] !== h) throw new Error('revoke: hash mismatch');
    if (!this.rings.spentSet.has(hex(x.nullifier))) throw new Error('revoke: not spent');
    c.status = 1; this.sent.push({ kind: 'revoke', index: x.index }); return { signature: 'sigRevoke' + this.sent.length, lamports: 5000n };
  }
  async anchorLog(size, root) { this.sent.push({ kind: 'anchor', size, root: hex(root) }); return { signature: 'sigAnchor', lamports: 5000n }; }
  async relayerBalance() { return this.balance; }
  async incoming() { return this.inbox; }
  async quoteLamports() { return { fee: 10_000_000n, rent: 3_000_000n, network: 10_000n }; }
}

export function makeCtx({ relayFree = false, env = {} } = {}) {
  const dir = tmpdir();
  const store = new V.FsStore(dir);
  const rings = new MemoryRings();
  const chain = new FakeChain(rings);
  const programSigner = V.signerFromSeed(new Uint8Array(crypto.randomBytes(32)));
  const signer = V.signerFromSeed(new Uint8Array(crypto.randomBytes(32)));
  const relayerSigner = V.signerFromSeed(new Uint8Array(crypto.randomBytes(32)));
  const sealKey = new Uint8Array(crypto.randomBytes(32));
  const programId = programSigner.publicKey;
  const log = new V.TransparencyLog(store, signer, programId);
  const keeper = new V.Keeper(store, sealKey, rings, chain);
  const locks = new V.NoteLocks(store, V.sha256(sealKey), 9000n, chain);
  const verifier = new V.Verifier({ programId, minAgeSlots: 150n, validitySlots: 6_480_000n, subjectProofSlots: 1500n, maxRootAgeSlots: 150n, relayer: relayerSigner.address, mints: { 0: V.ASSETS[0].mint, 1: V.ASSETS[1].mint }, bundleHash: V.bundleHash() }, signer, rings, log, keeper, locks);
  const relayer = new V.Relayer({ address: relayerSigner.address, verifierKey: signer.publicKey, programId, dailyCapLamports: 1_000_000_000n, balanceFloorLamports: 50_000_000n, quoteTtlSec: 1800, free: relayFree, hmacKey: V.sha256(sealKey, Uint8Array.of(1)) }, store, chain, log);
  const linker = new V.Linker(store, (h, exp, ctl) => verifier.linkToken(h, exp, ctl));
  const ctx = { env: { POF_PROGRAM: V.toB58(programId), CRON_SECRET: 'cron-test', ...env }, programId, signer, relayerSigner, store, rings, chain, log, keeper, locks, verifier, relayer, linker, sealKey, dir };
  return ctx;
}

/** a §4 package for these notes, as the client builds it: the ring owner signs the disclosure message; for a wallet or
 *  badge subject the subject key signs it too (`subjectSigner`, default: the ring's own wallet for kind 0); an X subject
 *  carries a link id bound to its controller (an unbound one passed in is re-issued bound, as a client that linked with its
 *  controller would hold) */
export function pkg(ctx, r, notes, { kind = 0, value, asset = 0, tier = 1, relay = false, proof, slot, controller, subjectSigner, ringSigner } = {}) {
  const payer = relay ? ctx.relayerSigner.address : r.owner;
  const v = value ?? (kind === 0 ? r.owner : undefined);
  const s = slot ?? ctx.rings.slotNow - 10n;
  const ctl = kind === 1 ? (controller === null ? undefined : (controller || r.owner)) : v;
  let link = proof;
  if (kind === 1 && typeof link === 'string' && ctl) {
    const parts = link.split('.');
    if (parts.length === 4 && parts[1] === '11111111111111111111111111111111') link = ctx.verifier.linkToken(parts[0], Number(parts[2]), ctl);
  }
  const msg = V.disclosureMessage({ programId: V.toB58(ctx.programId), kind, value: v, ring: r.owner, controller: ctl || '11111111111111111111111111111111', asset, tier, payer, slot: s });
  const ringProof = hex((ringSigner || r.wallet).sign(msg));
  let subjectProof = link;
  if (kind === 0) subjectProof = proof ?? (subjectSigner ? hex(subjectSigner.sign(msg)) : undefined);
  if (kind === 2) subjectProof = proof ?? hex(subjectSigner.sign(msg));
  const out = { v: 1, subject: { kind, value: v, slot: String(s), ...(subjectProof !== undefined ? { proof: subjectProof } : {}) }, asset, tier, ring: { owner: r.owner, nk: hex(r.nk), proof: ringProof }, notes: notes.map(n => n.opening), payer, relay };
  if (kind === 1 && ctl) out.controller = ctl;
  return out;
}
