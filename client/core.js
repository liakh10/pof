/* POF client core: the pure parts, with no wallet and no network. Every hash is the Helius SDK's own (dist/spr.js), so a value
   computed here is the value the Verifier and the Rings program compute. Facts behind each function: pof/RINGS.md. */
import * as S from './dist/spr.js';

export const RINGS = Object.freeze({
  spp: 'ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW',
  registry: 'regy3WAeRXMYuMYxr5iK3Bf9Arr3PcxGxyzAddbiqDQ',
  tree: '777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor',
  solInterface: 'CiNmas621VuyofiDSrEPfTXHKrdZuB6jMKECyNiMpLXE',
});
/* CONTRACT §2 (the program's Config is the source of truth; these equal it) */
export const ASSETS = Object.freeze({
  0: { key: 'SOL', name: 'SOL', decimals: 9, mint: '11111111111111111111111111111111', tiers: [1n, 10n, 100n, 1_000n, 10_000n].map(x => x * 1_000_000_000n) },
  1: { key: 'USDC', name: 'USDC', decimals: 6, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', tiers: [100n, 1_000n, 10_000n, 100_000n, 1_000_000n].map(x => x * 1_000_000n) },
});
export const assetIndex = keyOrMint => Number(Object.entries(ASSETS).find(([, a]) => a.key === keyOrMint || a.mint === keyOrMint)?.[0] ?? -1);
export function tierMinimum(asset, tier) {
  const a = ASSETS[asset];
  if (!a || !Number.isInteger(tier) || tier < 1 || tier > a.tiers.length) throw Error(`no tier ${tier} for asset ${asset}`);
  return a.tiers[tier - 1];
}
export function formatUnits(v, decimals) {
  const s = BigInt(v).toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, -decimals), frac = s.slice(-decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}
export function parseUnits(text, decimals) {
  const t = String(text).trim();
  if (!/^\d+(\.\d+)?$/.test(t)) throw Error('enter an amount like 12.5');
  const [w, f = ''] = t.split('.');
  if (f.length > decimals) throw Error(`at most ${decimals} decimals`);
  return BigInt(w) * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0');
}

/* ------------------------------------------------------------------ bytes */
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function b58encode(bytes) { let x = 0n; for (const b of bytes) x = (x << 8n) + BigInt(b); let s = ''; while (x > 0n) { s = B58[Number(x % 58n)] + s; x /= 58n; } for (const b of bytes) { if (b) break; s = '1' + s; } return s; }
export function b58decode(s, len) {
  let x = 0n; for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw Error('not base58'); x = x * 58n + BigInt(i); }
  const out = []; while (x > 0n) { out.unshift(Number(x & 255n)); x >>= 8n; }
  for (const c of s) { if (c !== '1') break; out.unshift(0); }
  const b = Uint8Array.from(out);
  if (len !== undefined && b.length !== len) throw Error(`expected ${len} bytes`);
  return b;
}
export const hex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
export function unhex(s, len) {
  const t = String(s).replace(/^0x/, '');
  if (!/^[0-9a-fA-F]*$/.test(t) || t.length % 2) throw Error('not hex');
  const b = new Uint8Array(t.length / 2); for (let i = 0; i < b.length; i++) b[i] = parseInt(t.slice(2 * i, 2 * i + 2), 16);
  if (len !== undefined && b.length !== len) throw Error(`expected ${len} bytes`);
  return b;
}
export const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const right = (bytes, n = 32) => { const o = new Uint8Array(n); o.set(bytes, n - bytes.length); return o; };
const u64be = v => { const o = new Uint8Array(8); new DataView(o.buffer).setBigUint64(0, BigInt(v), false); return o; };
export async function sha256(...parts) {
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
  return new Uint8Array(await crypto.subtle.digest('SHA-256', all));
}
export const utf8 = s => new TextEncoder().encode(s);

/* ------------------------------------------------------------------ the hasher */
export const ready = () => S.initializePoseidon();
export const poseidon = inputs => S.poseidon(inputs);
export { S as spr };

/* ------------------------------------------------------------------ RINGS §2: owner hash, commitment, nullifier */
export const nullifierPublicKey = nk => S.poseidon([right(nk)]);
export const ownerHash = (ownerPubkey, npk) => S.poseidon([S.solanaOwnerIdentity(ownerPubkey), npk]);
export function commitment({ ownerHash: oh, asset, amount, blinding, treeId = 0, dataHash, ringDataHash, ringProgramId }) {
  const z = new Uint8Array(32);
  const ringHash = S.poseidon([ringDataHash || z, ringProgramId ? S.hashBytes(b58decode(ringProgramId, 32)) : z]);
  return S.poseidon([right(Uint8Array.of(3)), right(Uint8Array.of(treeId >> 8, treeId & 255)), S.hashBytes(b58decode(asset, 32)), right(u64be(amount)), dataHash || z, ringHash, S.poseidon([oh, blinding])]);
}
export const nullifier = (commit, blinding, nk) => S.poseidon([commit, blinding, right(nk)]);
export const depositBlinding = (tree, leafIndex) => S.depositBlinding(tree, BigInt(leafIndex));

/* ------------------------------------------------------------------ Merkle (RINGS §1, §3) */
export function zeroHashes(height) { const z = [new Uint8Array(32)]; for (let i = 0; i < height; i++) z.push(S.poseidon([z[i], z[i]])); return z; }
export function rootFromPath(leaf, leafIndex, path) {
  let h = leaf, idx = BigInt(leafIndex);
  for (const sib of path) { h = (idx & 1n) ? S.poseidon([sib, h]) : S.poseidon([h, sib]); idx >>= 1n; }
  return h;
}
/* the tree account (40,080 bytes) as RINGS §1 lays it out */
export function decodeTree(b) {
  if (b.length !== 40_080 || b[0] !== 1) throw Error('not a Rings tree account');
  const dv = new DataView(b.buffer, b.byteOffset, b.length);
  const cursor = dv.getUint16(112, true), len = dv.getUint16(114, true);
  const history = Array.from({ length: len }, (_, i) => b.slice(1152 + i * 32, 1184 + i * 32));
  const nfCursor = Number(dv.getBigUint64(17224, true));
  const nullifierHistory = Array.from({ length: 100 }, (_, i) => b.slice(17232 + i * 32, 17264 + i * 32)).filter(r => r.some(x => x));
  return {
    treeId: dv.getUint16(2, true), nullifierQueue: dv.getBigUint64(40, true), nextIndex: dv.getBigUint64(72, true),
    root: b.slice(80, 112), rootSlot: dv.getBigUint64(120, true), cursor, history,
    frontier: Array.from({ length: 32 }, (_, i) => b.slice(128 + i * 32, 160 + i * 32)),
    nullifierRoot: b.slice(17232 + ((nfCursor + 99) % 100) * 32, 17264 + ((nfCursor + 99) % 100) * 32), nullifierHistory,
  };
}

/* ------------------------------------------------------------------ picking notes for a tier */
/* The smallest set of notes that reaches `minimum`: the fewest notes first (each disclosed note shows the Verifier one more
   amount), then the least excess over the tier. Exact for up to 40 candidates (the largest 40 are kept); at most `max` notes
   (CONTRACT §3 note_count 1..=8). Returns null when no set reaches it. */
export function pickNotes(notes, minimum, max = 8) {
  const min = BigInt(minimum);
  const pool = [...notes].filter(n => BigInt(n.amount) > 0n).sort((a, b) => (BigInt(b.amount) > BigInt(a.amount) ? 1 : BigInt(b.amount) < BigInt(a.amount) ? -1 : 0)).slice(0, 40);
  const amt = pool.map(n => BigInt(n.amount));
  let budget = 2_000_000; // search steps; past it the best set found so far stands (still valid, maybe not the least excess)
  for (let k = 1; k <= max; k++) {
    let top = 0n; for (let i = 0; i < Math.min(k, amt.length); i++) top += amt[i];
    if (top < min) continue;
    let best = null, bestSum = 0n;
    const take = [];
    const walk = (start, left, sum) => {
      if (left === 0) { if (sum >= min && (best === null || sum < bestSum)) { best = [...take]; bestSum = sum; } return; }
      for (let i = start; i <= amt.length - left; i++) {
        let reach = sum; for (let j = i; j < i + left; j++) reach += amt[j];
        if (reach < min) return;                         // later notes are smaller: nothing from here reaches it
        const lowest = sum + amt.slice(amt.length - left).reduce((x, y) => x + y, 0n);
        if (best !== null && lowest >= bestSum) return;   // nothing left here beats the best found
        if (--budget < 0) return;
        take.push(i); walk(i + 1, left - 1, sum + amt[i]); take.pop();
      }
    };
    walk(0, k, 0n);
    if (best) return { notes: best.map(i => pool[i]), sum: bestSum, excess: bestSum - min };
  }
  return null;
}

/* ------------------------------------------------------------------ CONTRACT §1 subjects and the §4 subject message */
export async function subjectHash(kind, value) {
  if (kind === 0) return sha256(utf8('pof:wallet:' + value));
  if (kind === 1) return sha256(utf8('pof:x:' + normalHandle(value)));
  if (kind === 2) return sha256(utf8('pof:badge:' + value));
  throw Error('subject kind is 0, 1 or 2');
}
export function normalHandle(v) {
  const h = String(v || '').trim().replace(/^@/, '').toLowerCase();
  if (!/^[a-z0-9_]{1,15}$/.test(h)) throw Error('an X handle is 1 to 15 letters, digits or underscores');
  return h;
}
/* CONTRACT §4 v2 (audit POF-02): the message the ring owner signs (ring.proof) and, for a wallet or badge, the subject key
   signs too (subject.proof). Byte for byte the Verifier's disclosureMessage (verifier/src/contract.ts). */
export function disclosureMessage({ programId, kind, value, ring, controller, asset, tier, payer, slot }) {
  return utf8([
    'Proof of Funds: disclosure v2',
    `program: ${programId}`,
    `subject: ${['wallet', 'x', 'badge'][kind]} ${kind === 1 ? normalHandle(value) : value}`,
    `ring: ${ring}`,
    `controller: ${controller}`,
    `asset: ${ASSETS[asset]?.name} tier: ${tier}`,
    `payer: ${payer}`,
    `slot: ${String(slot)}`,
  ].join('\n'));
}
/* CONTRACT §5: what a holder checks in a kit before revoking with it */
export async function saltedNullifier(salt, nf) { return sha256(utf8('pof:null:'), salt, nf); }

/* ------------------------------------------------------------------ CONTRACT §4: the disclosure package */
export function disclosurePackage({ subject, asset, tier, ring, notes, payer, relay, controller }) {
  if (!notes.length || notes.length > 8) throw Error('disclose 1 to 8 notes');
  const tree = notes[0].tree;
  return {
    v: 1,
    subject: { kind: subject.kind, value: subject.value, proof: subject.proof, ...(subject.slot !== undefined ? { slot: String(subject.slot) } : {}), ...(subject.controllerProof ? { controllerProof: subject.controllerProof } : {}) },
    asset, tier,
    ring: { owner: ring.owner, nk: hex(ring.nk), ...(ring.proof ? { proof: ring.proof } : {}) },
    notes: notes.map(n => {
      if (n.tree !== tree) throw Error('all notes of one certificate come from one tree');
      return {
        tree: n.tree, leafIndex: String(n.leafIndex), asset: n.asset, amount: String(n.amount), blinding: hex(n.blinding), sig: n.sig,
        ...(n.dataHash ? { dataHash: hex(n.dataHash) } : {}), ...(n.ringDataHash ? { ringDataHash: hex(n.ringDataHash) } : {}),
        ...(n.ringProgramId ? { ringProgramId: n.ringProgramId } : {}),
      };
    }),
    payer, relay: !!relay,
    // CONTRACT §3 controller: the subject key itself for kinds 0 and 2; a key the client keeps for an X handle (kind 1)
    ...(controller ? { controller } : {}),
  };
}
