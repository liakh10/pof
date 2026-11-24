/* What the Verifier reads from Solana Privacy Rings. Two sources implement it:
   - HeliusRings: the chain over JSON-RPC (the tree account's root history, the User Registry record, the nullifier PDAs)
     and the Helius Rings indexer through the SDK's own client (Merkle paths, note creation, nullifier lookups);
   - MemoryRings (test/mem-rings.mjs): the same answers from a tree the tests build with the SDK's hashing.
   The Verifier never trusts the indexer alone for membership: it re-hashes the path with the SDK's Poseidon and requires the
   resulting root to be in the tree account's on-chain root history. */
import { PofError, fromB58 } from './codec.js';

export const RINGS_PROGRAM = 'ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW';
export const REGISTRY_PROGRAM = 'regy3WAeRXMYuMYxr5iK3Bf9Arr3PcxGxyzAddbiqDQ';

export interface TreeHead { tree: string; treeId: number; head: Uint8Array; headSlot: bigint; history: Uint8Array[]; nullifierHistory: Uint8Array[]; slot: bigint }
export interface MerklePath { leaf: Uint8Array; leafIndex: bigint; path: Uint8Array[]; root: Uint8Array }
export interface Creation { slot: bigint; tree: string; leafIndex: bigint }

export interface RingsSource {
  slot(): Promise<bigint>;
  treeHead(tree: string): Promise<TreeHead>;
  merklePaths(tree: string, leaves: Uint8Array[]): Promise<MerklePath[]>;
  /** the nullifier public key of the wallet's registered Ring, or null when it has none */
  registryNullifierKey(wallet: string): Promise<Uint8Array | null>;
  /** spent[i] for each nullifier: true when a nullifier PDA exists (CONTRACT §5); for the rest, unless `pdaOnly`, the
   *  indexer's non-inclusion path is re-hashed and must reach a nullifier root the tree account holds, else it throws */
  spent(tree: string, nullifiers: Uint8Array[], opts?: { pdaOnly?: boolean; nullifierHistory?: Uint8Array[] }): Promise<boolean[]>;
  /** the slot of the transaction `sig` and the output it created with this commitment, or null */
  creation(sig: string, commitment: Uint8Array): Promise<Creation | null>;
}

/* tree account layout, pinned in the SDK (interface/state.js) */
const TREE_ACCOUNT_SIZE = 40_080, ROOT = 80, CURSOR = 112, LEN = 114, CAP = 116, ROOT_SLOT = 120, HISTORY = 1_152, NF_HISTORY = 17_232, NF_CAP = 100;

export function decodeTreeAccount(b: Uint8Array): { treeId: number; head: Uint8Array; headSlot: bigint; history: Uint8Array[]; nullifierHistory: Uint8Array[] } {
  if (b.length !== TREE_ACCOUNT_SIZE || b[0] !== 1) throw new PofError('RINGS_TREE', 'that account is not a Rings tree', 502);
  const dv = new DataView(b.buffer, b.byteOffset, b.length);
  const treeId = dv.getUint16(2, true), cursor = dv.getUint16(CURSOR, true), len = dv.getUint16(LEN, true), cap = dv.getUint16(CAP, true);
  if (!len || len > cap || cursor >= cap) throw new PofError('RINGS_TREE', 'the tree has no root history', 502);
  const history = Array.from({ length: len }, (_, i) => b.slice(HISTORY + i * 32, HISTORY + i * 32 + 32));
  const nullifierHistory = Array.from({ length: NF_CAP }, (_, i) => b.slice(NF_HISTORY + i * 32, NF_HISTORY + i * 32 + 32)).filter(r => r.some(x => x));
  const head = b.slice(ROOT, ROOT + 32);
  if (Buffer.compare(Buffer.from(head), Buffer.from(history[cursor]))) throw new PofError('RINGS_TREE', 'the tree head and its history disagree', 502);
  return { treeId, head, headSlot: dv.getBigUint64(ROOT_SLOT, true), history, nullifierHistory };
}

type Rpc = (method: string, params: unknown[]) => Promise<any>;

export function jsonRpc(urls: string[], timeoutMs = 12_000): Rpc {
  let first = 0, id = 0;
  const scrub = (s: string) => String(s).replace(/https?:\/\/[^\s"'|)]+/g, '<node>').slice(0, 200);
  return async (method, params) => {
    let last: any;
    for (let a = 0; a < Math.max(2, urls.length); a++) {
      const url = urls[(first + a) % urls.length];
      try {
        const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }), signal: AbortSignal.timeout(timeoutMs) });
        if (r.status === 429 || r.status >= 500) throw Object.assign(new Error(`node answered ${r.status}`), { rotate: true });
        const j: any = await r.json();
        if (j.error) throw Object.assign(new Error(scrub(j.error.message)), { code: j.error.code, rotate: /rate|limit|busy/i.test(j.error.message) });
        if (a) first = (first + a) % urls.length;
        return j.result;
      } catch (e: any) { last = e; if (!e.rotate && e.code !== undefined) break; }
    }
    throw new PofError('RPC_UNAVAILABLE', `the Solana RPC did not answer ${method}: ${scrub(last?.message || 'no node')}`, 503);
  };
}

export class HeliusRings implements RingsSource {
  private spr: any = null; private pda: any = null; private reg: any = null;
  constructor(private rpc: Rpc, private indexer: { url: string; apiKey?: string }, private solanaRpcUrl: string) {}

  private async client() {
    if (this.spr) return this.spr;
    const root: any = await import('@heliuslabs/spr');
    await root.initializePoseidon();
    const C: any = await import('@heliuslabs/spr/client');
    this.pda = await import('@heliuslabs/spr/addresses');
    this.reg = await import('@heliuslabs/spr/wallet');
    this.spr = new C.SprClient({ solanaRpcUrl: this.solanaRpcUrl, indexerUrl: this.indexer.url, proverUrl: this.indexer.url, ...(this.indexer.apiKey ? { apiKey: this.indexer.apiKey } : {}) });
    return this.spr;
  }

  async slot() { return BigInt(await this.rpc('getSlot', [{ commitment: 'confirmed' }])); }

  async treeHead(tree: string) {
    const r = await this.rpc('getAccountInfo', [tree, { encoding: 'base64', commitment: 'confirmed' }]);
    if (!r?.value || r.value.owner !== RINGS_PROGRAM) throw new PofError('RINGS_TREE', `${tree} is not a Rings tree account`, 400);
    return { tree, ...decodeTreeAccount(new Uint8Array(Buffer.from(r.value.data[0], 'base64'))), slot: BigInt(r.context.slot) };
  }

  async merklePaths(tree: string, leaves: Uint8Array[]) {
    const c = await this.client();
    try {
      const r = await c.getMerkleProofs(tree, leaves);
      return r.proofs.map((p: any) => ({ leaf: p.leaf, leafIndex: BigInt(p.leafIndex), path: [...p.path], root: p.root }));
    } catch (e: any) {
      throw new PofError('NOT_IN_TREE', 'the Rings indexer has no Merkle path for one of the notes (not in the tree, or not indexed yet)', 400, { cause: String(e?.code || e?.message).slice(0, 80) });
    }
  }

  async registryNullifierKey(wallet: string) {
    await this.client();
    const pdaAddr = await registryRecordAddress(wallet);
    const r = await this.rpc('getAccountInfo', [pdaAddr, { encoding: 'base64', commitment: 'confirmed' }]);
    if (!r?.value) return null;
    if (r.value.owner !== REGISTRY_PROGRAM) return null;
    const rec = this.reg.decodeUserRecordAccount({ owner: r.value.owner, data: new Uint8Array(Buffer.from(r.value.data[0], 'base64')) });
    if (rec.owner !== wallet) return null;
    return new Uint8Array(rec.nullifierPublicKey);
  }

  async spent(tree: string, nullifiers: Uint8Array[], opts: { pdaOnly?: boolean; nullifierHistory?: Uint8Array[] } = {}) {
    const c = await this.client();
    const pdas = await Promise.all(nullifiers.map(n => this.pda.getNullifierPdaAddress(tree, n)));
    const r = await this.rpc('getMultipleAccounts', [pdas, { encoding: 'base64', commitment: 'confirmed' }]);
    const out: boolean[] = r.value.map((a: any) => isNullifierPda(a));
    const todo = nullifiers.map((n, i) => ({ n, i })).filter(x => !out[x.i]);
    if (!todo.length || opts.pdaOnly) return out;
    const roots = new Set((opts.nullifierHistory || (await this.treeHead(tree)).nullifierHistory).map(x => Buffer.from(x).toString('hex')));
    let proofs: any;
    try { proofs = (await c.getNonInclusionProofs(tree, todo.map(x => x.n))).proofs; }
    catch (e: any) {
      const m = String(e?.cause?.message || e?.message || '') + ' ' + JSON.stringify(e?.details || {});
      if (/already used|queued/i.test(m)) { for (const x of todo) out[x.i] = true; return out; }
      throw new PofError('INDEXER_UNAVAILABLE', 'the Rings indexer did not answer the nullifier check; nothing was signed, try again', 503, { cause: String(e?.code || e?.message).slice(0, 80) });
    }
    const { poseidon } = await import('@heliuslabs/spr/internal') as any;
    todo.forEach((x, k) => {
      const p = proofs[k];
      if (!p) throw new PofError('INDEXER_UNAVAILABLE', 'the indexer returned no non-inclusion path', 503);
      if (!checkNonInclusion(poseidon, x.n, p, roots)) throw new PofError('NULLIFIER_UNPROVEN', 'the indexer\'s non-inclusion path for a nullifier does not reach an on-chain nullifier root; nothing was signed', 503);
    });
    return out;
  }

  async creation(sig: string, commitment: Uint8Array) {
    const c = await this.client();
    let r: any;
    try { r = await c.getShieldedTransactionsBySignature(sig); }
    catch (e: any) { throw new PofError('INDEXER_UNAVAILABLE', 'the Rings indexer did not answer for the note\'s transaction', 503, { cause: String(e?.code || e?.message).slice(0, 80) }); }
    const h = Buffer.from(commitment).toString('hex');
    for (const x of r.transactions) for (const o of x.transaction.outputSlots) {
      if (Buffer.from(o.outputContext.hash).toString('hex') === h) return { slot: BigInt(x.transaction.slot), tree: o.outputContext.tree, leafIndex: BigInt(o.outputContext.leafIndex) };
    }
    return null;
  }
}

export async function registryRecordAddress(wallet: string): Promise<string> {
  fromB58(wallet, 32, 'wallet');
  const A: any = await import('@heliuslabs/spr/addresses');
  return A.getUserRecordAddress(wallet);
}

/** CONTRACT §5: a spent nullifier's PDA is owned by the Rings program, 11 bytes, first byte 8 */
export function isNullifierPda(a: any): boolean {
  if (!a || a.owner !== RINGS_PROGRAM) return false;
  const d = Buffer.from(a.data?.[0] || '', 'base64');
  return d.length === 11 && d[0] === 8;
}

const big = (b: Uint8Array) => BigInt('0x' + (Buffer.from(b).toString('hex') || '0'));
/** the indexed nullifier tree (height 40): leaf = Poseidon(low, next); low < nf < next (next = 0 means the end) and the
 *  low leaf's path reaches one of the on-chain nullifier roots */
export function checkNonInclusion(poseidon: (x: Uint8Array[]) => Uint8Array, nf: Uint8Array, p: any, roots: Set<string>): boolean {
  const v = big(nf), lo = big(p.lowElement), hi = big(p.highElement);
  if (!(lo < v) || !(hi === 0n || v < hi)) return false;
  let h = poseidon([p.lowElement, p.highElement]); let idx = BigInt(p.lowElementIndex);
  if (p.path.length !== 40) return false;
  for (const sib of p.path) { h = (idx & 1n) ? poseidon([sib, h]) : poseidon([h, sib]); idx >>= 1n; }
  const r = Buffer.from(h).toString('hex');
  return r === Buffer.from(p.root).toString('hex') && roots.has(r);
}
