/* LocalRings: Privacy Rings state on a local validator that has the Rings programs and tree 0 cloned from mainnet, where no
   Helius indexer exists (RINGS.md §8). It replays every Rings deposit made on the local chain since the clone, rebuilds those
   leaves on top of the cloned frontier (tree offset 128), and checks the rebuilt root against the tree account before it
   answers anything. It runs in the browser (the lab) and in Node (the Verifier's and the program's local tests), and it
   implements the Verifier's RingsSource (verifier/src/rings.ts): slot, treeHead, merklePaths, registryNullifierKey, spent,
   creation; plus notesOf(owner) for the client's sync.
   Only proofless deposits (tag 15) can happen on the clone (spends need the Helius prover); a spend is simulated by loading a
   nullifier PDA with --account (lab/rings-local). */
import * as C from './core.js';

const SPP = C.RINGS.spp;
const B64 = s => (typeof atob === 'function' ? Uint8Array.from(atob(s), c => c.charCodeAt(0)) : new Uint8Array(Buffer.from(s, 'base64')));

export function jsonRpc(url) {
  let id = 0;
  return async (method, params) => {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
    const j = await r.json();
    if (j.error) throw Object.assign(Error(j.error.message), { code: j.error.code });
    return j.result;
  };
}

/* the deposits of one SPP instruction (data, account keys): RINGS §2 "deposit notes" */
export function decodeDeposit(data, keys) {
  if (data[0] !== 15) return null;
  let o = 1;
  const na = data[o++], assets = [];
  for (let i = 0; i < na; i++) { const kind = data[o++]; if (kind === 1) o++; assets.push(kind); }
  // accounts: tree, depositor, SPP, then the asset groups in the data's order: SOL (system, SOL interface), each SPL
  // (token program, mint, source, vault). The asset index of a deposit points into that same order (SDK depositLayout).
  let k = 3; const table = [];
  for (const kind of assets) { if (kind === 0) { table.push(C.ASSETS[0].mint); k += 2; } else { table.push(keys[k + 1]); k += 4; } }
  const nd = data[o++], deps = [];
  for (let i = 0; i < nd; i++) {
    const ai = data[o++];
    const viewTag = data.slice(o, o + 32); o += 32;
    const ownerHash = data.slice(o, o + 32); o += 32;
    const amount = new DataView(data.buffer, data.byteOffset + o, 8).getBigUint64(0, true); o += 8;
    const hasMemo = data[o++];
    if (hasMemo) { const L = new DataView(data.buffer, data.byteOffset + o, 4).getUint32(0, true); o += 4 + L; }
    deps.push({ asset: table[ai], viewTag, ownerHash, amount, memo: !!hasMemo });
  }
  return { tree: keys[0], depositor: keys[1], deposits: deps };
}

export class LocalRings {
  /* rpc: (method, params) => result, against the local validator */
  constructor(rpc, { tree = C.RINGS.tree, cloned = null } = {}) { this.rpc = rpc; this.tree = tree; this.cloned = cloned; this.base = null; this.leaves = []; this.seen = new Set(); this.memo = new Map(); }

  async slot() { return BigInt(await this.rpc('getSlot', [{ commitment: 'confirmed' }])); }
  async treeAccount() {
    const r = await this.rpc('getAccountInfo', [this.tree, { encoding: 'base64', commitment: 'confirmed' }]);
    if (!r.value || r.value.owner !== SPP) throw Error('no Rings tree on this validator (start it with lab/rings-local/chain.sh)');
    return C.decodeTree(B64(r.value.data[0]));
  }

  /* replay every local Rings write since the clone and check the rebuilt root against the tree account */
  async refresh() {
    // a deposit can land between the signature list and the tree read: replay again (the seen set keeps the earlier work)
    for (let i = 0; ; i++) {
      try { return await this.refreshOnce(); }
      catch (e) { if (i >= 5 || !e.racing) throw e; await new Promise(r => setTimeout(r, 300)); }
    }
  }
  async refreshOnce() {
    await C.ready();
    const head = await this.treeAccount();
    if (!this.base) {
      // the cloned account as loaded at genesis (the bytes lab/rings-local/prep.mjs saved and the validator loaded with
      // --account): its frontier and next index are the tree before any local append. Without them, a chain with no
      // local Rings write yet is its own base.
      if (this.cloned) this.base = C.decodeTree(this.cloned);
      else this.base = head;
    }
    const sigs = [];
    let before;
    for (;;) {
      const page = await this.rpc('getSignaturesForAddress', [this.tree, { limit: 1000, commitment: 'confirmed', ...(before ? { before } : {}) }]);
      const fresh = page.filter(s => !this.seen.has(s.signature));
      sigs.push(...fresh);
      if (page.length < 1000 || fresh.length < page.length) break;
      before = page[page.length - 1].signature;
    }
    sigs.reverse();
    for (const s of sigs) {
      this.seen.add(s.signature);
      if (s.err) continue;
      const tx = await this.rpc('getTransaction', [s.signature, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
      if (!tx) continue;
      const keys = [...tx.transaction.message.accountKeys, ...((tx.meta.loadedAddresses && [...tx.meta.loadedAddresses.writable, ...tx.meta.loadedAddresses.readonly]) || [])];
      const all = [];
      tx.transaction.message.instructions.forEach((ins, i) => {
        all.push(ins);
        const inner = (tx.meta.innerInstructions || []).find(x => x.index === i);
        if (inner) all.push(...inner.instructions);
      });
      for (const ins of all) {
        if (keys[ins.programIdIndex] !== SPP) continue;
        const data = C.b58decode(ins.data);
        if (data[0] === 16 || data[0] === 17 || data[0] === 19) throw Error('a spend on the local chain: LocalRings only replays deposits');
        const d = decodeDeposit(data, ins.accounts.map(a => keys[a]));
        if (!d || d.tree !== this.tree) continue;
        for (const dep of d.deposits) {
          if (dep.memo) throw Error('a deposit with a memo: LocalRings does not hash memos');
          const leafIndex = this.base.nextIndex + BigInt(this.leaves.length);
          const blinding = C.depositBlinding(this.tree, leafIndex);
          const leaf = C.commitment({ ownerHash: dep.ownerHash, asset: dep.asset, amount: dep.amount, blinding });
          this.leaves.push({ leaf, leafIndex, slot: BigInt(s.slot), sig: s.signature, viewTag: C.b58encode(dep.viewTag), ownerHash: dep.ownerHash, asset: dep.asset, amount: dep.amount, blinding, depositor: d.depositor });
        }
      }
    }
    this.memo.clear();
    const root = this.node(32, 0n);
    const fresh = await this.treeAccount();
    if (fresh.nextIndex !== head.nextIndex) throw Object.assign(Error('the tree moved during the replay'), { racing: true });
    if (head.nextIndex > this.base.nextIndex + BigInt(this.leaves.length)) throw Object.assign(Error('a deposit landed after the signature list was read'), { racing: true });
    if (!C.eq(root, head.root)) throw Error('the rebuilt tree does not reach the tree account root: the local chain has a Rings write LocalRings did not replay');
    if (head.nextIndex !== this.base.nextIndex + BigInt(this.leaves.length)) throw Error('leaf count mismatch');
    this.head = head;
    return head;
  }

  /* node(level, index) of the tree: frontier nodes for the cloned part, our leaves above it, zero hashes past the end */
  node(level, index) {
    const key = level + ':' + index;
    if (this.memo.has(key)) return this.memo.get(key);
    const N0 = this.base.nextIndex, N = N0 + BigInt(this.leaves.length);
    const lo = index << BigInt(level), hi = (index + 1n) << BigInt(level);
    this.zeros ||= C.zeroHashes(32);
    let v;
    if (lo >= N) v = this.zeros[level];
    else if (hi <= N0) {
      if (((N0 >> BigInt(level)) & 1n) === 1n && index === (N0 >> BigInt(level)) - 1n) v = this.base.frontier[level];
      else throw Error(`node ${key} lies wholly in the cloned part and is not on the frontier`);
    } else if (level === 0) v = this.leaves[Number(index - N0)].leaf;
    else v = C.poseidon([this.node(level - 1, 2n * index), this.node(level - 1, 2n * index + 1n)]);
    this.memo.set(key, v);
    return v;
  }
  pathOf(leafIndex) {
    const path = []; let idx = BigInt(leafIndex);
    for (let l = 0; l < 32; l++) { path.push(this.node(l, idx ^ 1n)); idx >>= 1n; }
    return path;
  }

  /* ---------------------------------------------------------------- the Verifier's RingsSource */
  async treeHead(tree) {
    if (tree !== this.tree) throw Error('LocalRings serves tree 0 only');
    const h = await this.refresh();
    return { tree, treeId: h.treeId, head: h.root, headSlot: h.rootSlot, history: h.history, nullifierHistory: h.nullifierHistory, slot: await this.slot() };
  }
  async merklePaths(tree, leaves) {
    await this.refresh();
    return leaves.map(leaf => {
      const n = this.leaves.find(x => C.eq(x.leaf, leaf));
      if (!n) return null;
      return { leaf: n.leaf, leafIndex: n.leafIndex, path: this.pathOf(n.leafIndex), root: this.head.root };
    });
  }
  async registryNullifierKey(wallet) {
    const C2 = C.spr;
    const addr = await C2.internalUserRecordAddress(wallet);
    const r = await this.rpc('getAccountInfo', [addr, { encoding: 'base64', commitment: 'confirmed' }]);
    if (!r.value) return null;
    const rec = C2.decodeUserRecordAccount({ owner: r.value.owner, data: B64(r.value.data[0]) });
    return new Uint8Array(rec.nullifierPublicKey);
  }
  /* spent: the nullifier PDA exists, owned by SPP, 11 bytes, data[0] = 8 (CONTRACT §5 as proposed in RINGS §9) */
  async spent(tree, nullifiers) {
    const pdas = await Promise.all(nullifiers.map(nf => C.spr.nullifierPdaAddress(tree, nf)));
    const r = await this.rpc('getMultipleAccounts', [pdas, { encoding: 'base64', commitment: 'confirmed' }]);
    return r.value.map(a => !!a && a.owner === SPP && B64(a.data[0]).length === 11 && B64(a.data[0])[0] === 8);
  }
  async creation(sig, commitment) {
    await this.refresh();
    const n = this.leaves.find(x => x.sig === sig && C.eq(x.leaf, commitment));
    return n ? { slot: n.slot, tree: this.tree, leafIndex: n.leafIndex } : null;
  }

  /* ---------------------------------------------------------------- the client's sync: every deposit note of one ring */
  async notesOf({ owner, ownerHash }) {
    await this.refresh();
    return this.leaves.filter(n => n.viewTag === owner && C.eq(n.ownerHash, ownerHash)).map(n => ({
      tree: this.tree, leafIndex: n.leafIndex, asset: n.asset, amount: n.amount, blinding: n.blinding, leaf: n.leaf, sig: n.sig, slot: n.slot, kind: 'deposit',
    }));
  }
}
