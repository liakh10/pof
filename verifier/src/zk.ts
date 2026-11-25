/* Phase 2 for the keeper (docs-src/zk.md): zero-knowledge certificates carry no salted hashes, only per-note tags
   tag = Poseidon("pof:zk:tag:v1", nf), and each note lock ["znote", tag] holds the nullifier encrypted to the revocation key
   K = k·B8 on Baby Jubjub: ct = nf + Poseidon("pof:zk:esc:v1", S.x, S.y, slot) with S = k·R. With k the keeper opens every
   live zk certificate's nullifiers from chain data alone, watches them, and on a spend calls revoke_spent with the note lock as
   the first remaining account (audit FZ-18: the program marks the lock spent). Nothing here runs on the launch program: it has
   no ZkConfig and no NoteLock accounts, and without POF_ZK_ESCROW_KEYS the keeper does not look.
   The arithmetic is zk/js/zk.js's (the circuit's), checked against it in test/zk.test.mjs. */
import { PofError, hex, sha256, text, unhex } from './codec.js';

export const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const A = 168700n, D = 168696n;
const big = (b: Uint8Array) => BigInt('0x' + (Buffer.from(b).toString('hex') || '0'));
const be32 = (x: bigint) => { const o = new Uint8Array(32); let v = x; for (let i = 31; i >= 0; i--) { o[i] = Number(v & 255n); v >>= 8n; } return o; };
const mod = (a: bigint) => ((a % FIELD) + FIELD) % FIELD;
const TAG_DOMAIN = big(text('pof:zk:tag:v1'));
const ESC_DOMAIN = big(text('pof:zk:esc:v1'));

function inv(a: bigint) { let r0 = mod(a), r1 = FIELD, s0 = 1n, s1 = 0n; while (r1) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; } return mod(s0); }
function addPt([x1, y1]: bigint[], [x2, y2]: bigint[]) {
  const t = mod(D * x1 * x2 % FIELD * y1 % FIELD * y2);
  return [mod((x1 * y2 + y1 * x2) % FIELD * inv(1n + t)), mod((y1 * y2 - A * x1 * x2) % FIELD * inv(1n - t + FIELD))];
}
export function mulPt(p: bigint[], e: bigint) { let r = [0n, 1n], q = p, k = e; while (k > 0n) { if (k & 1n) r = addPt(r, q); q = addPt(q, q); k >>= 1n; } return r; }

type Poseidon = (xs: Uint8Array[]) => Uint8Array;
let poseidonFn: Poseidon | null = null;
async function P(): Promise<(xs: bigint[]) => bigint> {
  if (!poseidonFn) {
    const root: any = await import('@heliuslabs/spr');
    await root.initializePoseidon();
    poseidonFn = ((await import('@heliuslabs/spr/internal')) as any).poseidon;
  }
  const f = poseidonFn!;
  return xs => big(f(xs.map(be32)));
}
export async function zkTag(nf: Uint8Array): Promise<Uint8Array> { return be32((await P())([TAG_DOMAIN, big(nf)])); }

/** the nullifier behind one note lock: its certificate's slot index (the tag's place in null_hashes), the escrow point R
 *  and ciphertext from the lock, the keeper's secret k; checked against the tag, else it throws */
export async function openLock(secret: bigint, lock: { eph: Uint8Array[]; ct: Uint8Array; tag: Uint8Array }, slot: number): Promise<Uint8Array> {
  const p = await P();
  const S = mulPt([big(lock.eph[0]), big(lock.eph[1])], secret);
  const nf = mod(big(lock.ct) - p([ESC_DOMAIN, S[0], S[1], BigInt(slot)]));
  if (p([TAG_DOMAIN, nf]) !== big(lock.tag)) throw new PofError('ZK_ESCROW', 'a note lock does not open to its tag with this revocation key', 500);
  return be32(nf);
}

/** NoteLock (program zk.rs): 8 discriminator, certificate, tag, payer, eph[2], ct, escrow_epoch u32, locked_slot u64, bump, spent */
export const NOTE_LOCK_DISC = sha256(text('account:NoteLock')).slice(0, 8);
export const NOTE_LOCK_SIZE = 8 + 32 + 32 + 32 + 64 + 32 + 4 + 8 + 1 + 1;
export interface ZkLock { address: string; certificate: Uint8Array; tag: Uint8Array; payer: Uint8Array; eph: Uint8Array[]; ct: Uint8Array; epoch: number; lockedSlot: bigint; spent: boolean }
export function decodeNoteLock(address: string, d: Uint8Array): ZkLock {
  if (d.length !== NOTE_LOCK_SIZE || Buffer.compare(Buffer.from(d.subarray(0, 8)), Buffer.from(NOTE_LOCK_DISC))) throw new PofError('BAD_ACCOUNT', 'not a NoteLock account', 502);
  const dv = new DataView(d.buffer, d.byteOffset, d.length);
  return {
    address, certificate: d.slice(8, 40), tag: d.slice(40, 72), payer: d.slice(72, 104), eph: [d.slice(104, 136), d.slice(136, 168)], ct: d.slice(168, 200),
    epoch: dv.getUint32(200, true), lockedSlot: dv.getBigUint64(204, true), spent: d[213] === 1,
  };
}

/** POF_ZK_ESCROW_KEYS = "<epoch>:<hex k>,…" (or one hex key for epoch 0): the revocation secrets by key epoch */
export function escrowKeys(env: string | undefined): Map<number, bigint> {
  const out = new Map<number, bigint>();
  for (const part of String(env || '').split(',').map(s => s.trim()).filter(Boolean)) {
    const [e, k] = part.includes(':') ? part.split(':') : ['0', part];
    const v = big(unhex(k, 32, 'POF_ZK_ESCROW_KEYS'));
    if (!v || v >= FIELD) throw new PofError('KEY_MISSING', 'a POF_ZK_ESCROW_KEYS secret is out of range', 500);
    out.set(Number(e), v);
  }
  return out;
}
export { hex };
