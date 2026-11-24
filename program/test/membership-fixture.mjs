// A real spent nullifier of Privacy Rings tree 0 with its 40-level membership path in the folded nullifier tree, read from
// mainnet (read-only: one tree read and the Helius Rings indexer's non-inclusion proof for nf + 1, whose low element is nf).
// The tree account is saved with it, so the local chain loads the same nullifier root history the path hashes to.
// Writes test/fixtures/membership.json and test/.run/accounts/<tree>.json. Never prints a key. Run: node test/membership-fixture.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const S = path.resolve(here, '../node_modules/@heliuslabs/spr/dist/');
const { SprApi } = await import(S + '/api/index.js');
const { SprIndexer } = await import(S + '/client/indexer.js');
const H = await import(S + '/hasher/index.js'); await H.initializePoseidon();
const keys = fs.readFileSync(process.env.HOME + '/.config/helius/site_keys', 'utf8').split(/\s+/).filter(Boolean);
const KEY = keys[Math.floor(Math.random() * keys.length)];
const T = '777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor';
const URL = `https://mainnet.helius-rpc.com/?api-key=${KEY}`;
async function rpc(method, params) { const r = await fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }); const j = await r.json(); if (j.error) throw Error(method + ' ' + JSON.stringify(j.error).slice(0, 200)); return j.result; }
const hx = b => Buffer.from(b).toString('hex');
const ix = new SprIndexer(new SprApi({ url: 'https://mainnet.helius-rpc.com/v1/spr', apiKey: KEY }));
// an old nullifier (from transactions well before the latest batch), so it is folded into the nullifier tree
let before, sigs;
for (let i = 0; i < 5; i++) { const q = await rpc('getSignaturesForAddress', [T, { limit: 1000, ...(before ? { before } : {}) }]); if (!q.length) break; sigs = q; before = q[q.length - 1].signature; }
let nf;
for (const x of sigs.slice(-80)) { const r = await ix.getShieldedTransactionsBySignature(x.signature); for (const t of r.transactions) if (t.transaction.nullifiers.length) { nf = t.transaction.nullifiers[0]; break; } if (nf) break; }
if (!nf) throw Error('no nullifier found');
const v = BigInt('0x' + hx(nf)) + 1n;
const r = await ix.getNonInclusionProofs(T, [new Uint8Array(Buffer.from(v.toString(16).padStart(64, '0'), 'hex'))]);
const p = r.proofs[0];
if (hx(p.lowElement) !== hx(nf)) throw Error('low element is not nf');
let cur = H.poseidon([p.lowElement, p.highElement]), idx = BigInt(p.lowElementIndex);
for (const s of p.path) { cur = (idx & 1n) ? H.poseidon([s, cur]) : H.poseidon([cur, s]); idx >>= 1n; }
if (hx(cur) !== hx(p.root)) throw Error('path does not hash to the root');
const acc = await rpc('getAccountInfo', [T, { encoding: 'base64', commitment: 'confirmed' }]);
const tb = Buffer.from(acc.value.data[0], 'base64');
const at = [...Array(100).keys()].find(i => hx(tb.subarray(17232 + i * 32, 17264 + i * 32)) === hx(p.root));
if (at === undefined) throw Error('root not in the on-chain nullifier history of this read');
// the zero subtree hashes of the indexed tree (empty leaf = 0), to show which upper siblings are empty
const zeros = [new Uint8Array(32)]; for (let i = 0; i < 40; i++) zeros.push(H.poseidon([zeros[i], zeros[i]]));
const emptyFrom = p.path.findIndex((s, i) => p.path.slice(i).every((x, j) => hx(x) === hx(zeros[i + j])));
const out = { tree: T, nullifier: hx(nf), next: hx(p.highElement), leafIndex: String(p.lowElementIndex), path: p.path.map(hx), root: hx(p.root), rootHistoryIndex: at, emptyFrom, zeros: zeros.map(hx), slot: acc.context.slot };
fs.writeFileSync(path.join(here, 'fixtures/membership.json'), JSON.stringify(out, null, 1));
const accDir = path.join(here, '.run/accounts'); fs.mkdirSync(accDir, { recursive: true });
fs.writeFileSync(path.join(accDir, T + '.json'), JSON.stringify({ pubkey: T, account: { lamports: acc.value.lamports, data: [acc.value.data[0], 'base64'], owner: acc.value.owner, executable: false, rentEpoch: 0, space: tb.length } }));
console.log('nullifier', out.nullifier.slice(0, 16), '… leaf', out.leafIndex, 'path', p.path.length, 'levels, empty siblings from level', emptyFrom, '· root at history index', at, '· tree read at slot', out.slot);
