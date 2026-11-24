/* POF rings facts: writes client/test/vectors.json from public mainnet data: SOL deposits (owner hash, amount, leaf index,
   the leaf hash the indexer holds) and one state-tree Merkle path with its root. Read-only. Uses ~/.config/helius/site_keys (never printed). */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { rpc } from './rpc.mjs';
const req = createRequire(new URL('../../package.json', import.meta.url));
const S = new URL('../../node_modules/@heliuslabs/spr/dist/', import.meta.url).href;
const { SprApi } = await import(S + 'api/index.js'); const { SprIndexer } = await import(S + 'client/indexer.js');
const KEY = fs.readFileSync(process.env.HOME + '/.config/helius/site_keys', 'utf8').split('\n').map(s => s.trim()).filter(Boolean)[3];
const ix = new SprIndexer(new SprApi({ url: 'https://mainnet.helius-rpc.com/v1/spr', apiKey: KEY }));
const T = '777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor', P = 'ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW';
const B = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const dec = s => { let x = 0n; for (const c of s) x = x * 58n + BigInt(B.indexOf(c)); const o = []; while (x > 0n) { o.unshift(Number(x & 255n)); x >>= 8n; } for (const c of s) { if (c !== '1') break; o.unshift(0); } return Uint8Array.from(o); };
const hx = b => Buffer.from(b).toString('hex');
const sigs = await rpc('getSignaturesForAddress', [T, { limit: 300 }]);
const deposits = [];
for (const s of sigs) {
  if (s.err || deposits.length >= 4) continue;
  const tx = await rpc('getTransaction', [s.signature, { encoding: 'json', maxSupportedTransactionVersion: 1 }]);
  const keys = tx.transaction.message.accountKeys;
  for (const ins of tx.transaction.message.instructions) {
    if (keys[ins.programIdIndex] !== P) continue;
    const d = dec(ins.data); if (d[0] !== 15) continue;
    let o = 1; const na = d[o++]; const kinds = []; for (let i = 0; i < na; i++) { const k = d[o++]; kinds.push(k); if (k === 1) o++; }
    const nd = d[o++]; const deps = [];
    for (let i = 0; i < nd; i++) { const ai = d[o++]; const vt = d.slice(o, o + 32); o += 32; const oh = d.slice(o, o + 32); o += 32; const amt = Buffer.from(d.slice(o, o + 8)).readBigUInt64LE(0); o += 8; const m = d[o++]; if (m) { const L = d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24); o += 4 + L; } deps.push({ sol: kinds[ai] === 0, viewTag: vt, ownerHash: oh, amount: amt, memo: !!m }); }
    const r = await ix.getShieldedTransactionsBySignature(s.signature);
    const outs = r.transactions.flatMap(t => t.transaction.outputSlots);
    deps.forEach((dp, i) => { const out = outs[i]; if (out && dp.sol && !dp.memo) deposits.push({ sig: s.signature, slot: s.slot, viewTag: hx(dp.viewTag), ownerHash: hx(dp.ownerHash), amount: String(dp.amount), leafIndex: String(out.outputContext.leafIndex), leaf: hx(out.outputContext.hash) }); });
  }
}
const mp = (await ix.getMerkleProofs(T, [Buffer.from(deposits[0].leaf, 'hex')])).proofs[0];
const out = { note: 'public mainnet data read 2026-11-25; tree ' + T, tree: T, deposits, merkle: { leaf: hx(mp.leaf), leafIndex: String(mp.leafIndex), path: mp.path.map(hx), root: hx(mp.root) } };
fs.writeFileSync(new URL('../../test/vectors.json', import.meta.url), JSON.stringify(out, null, 1));
console.log('deposits', deposits.length, 'merkle path', mp.path.length);
void req;
