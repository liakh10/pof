// node lab/rings-local/prep.mjs: saves what a local validator needs to run Helius Privacy Rings as on mainnet (RINGS.md §8):
// the Solana Privacy Program and the User Registry (binaries dumped), tree 0, the protocol config, the SOL interface, the
// USDC asset registry, the USDC mint with its mint authority rewritten to a local test key (so the lab can mint test USDC),
// and a warp slot past the tree's last mainnet update (the tree refuses an older slot). Read-only on mainnet.
// Output: lab/rings-local/.run/{accounts/*.json, programs/*.so, warp-slot.txt, usdc-authority.json, cloned-tree.b64}
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const run = path.join(here, '.run'), acc = path.join(run, 'accounts'), progs = path.join(run, 'programs');
fs.mkdirSync(acc, { recursive: true }); fs.mkdirSync(progs, { recursive: true });
const keys = (() => { try { return fs.readFileSync(process.env.HOME + '/.config/helius/site_keys', 'utf8').split('\n').map(s => s.trim()).filter(Boolean); } catch { return []; } })();
const NODES = [...keys.slice(0, 3).map(k => `https://mainnet.helius-rpc.com/?api-key=${k}`), 'https://solana-rpc.publicnode.com', 'https://api.mainnet-beta.solana.com'];
async function rpc(method, params) {
  let last;
  for (const url of NODES) {
    try { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }); const j = await r.json(); if (j.error) throw Error(String(j.error.message).slice(0, 120)); return j.result; }
    catch (e) { last = e; }
  }
  throw Error(`${method}: ${last && last.message}`);
}
const RINGS = { spp: 'ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW', registry: 'regy3WAeRXMYuMYxr5iK3Bf9Arr3PcxGxyzAddbiqDQ' };
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const ACCOUNTS = {
  tree: '777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor',
  protocolConfig: 'EienwBSpsbAetT3RAAMzVA9rB5RHgCF7yTH7FFST6AK5',
  solInterface: 'CiNmas621VuyofiDSrEPfTXHKrdZuB6jMKECyNiMpLXE',
  usdcRegistry: 'J85i28ZES8pHqDa21YsmLSbUh2FR56c9WW5GCfQXUeHB',
  assetCounter: '5Nr5ghJqrQwXZqsQvLTSL23kMsH3kQp2JsUUtiN1DF17',
  usdcMint: USDC,
};
// the USDC vault: PDA ["spl_asset_vault", mint] under SPP, derived by the SDK
const S = await import(new URL('../../client/node_modules/@heliuslabs/spr/dist/interface/pda/index.js', import.meta.url).href);
ACCOUNTS.usdcVault = await S.splAssetVaultAddress(USDC);
// the local USDC mint authority: a throwaway key made here, never used on mainnet
const authFile = path.join(run, 'usdc-authority.json');
if (!fs.existsSync(authFile)) spawnSync('solana-keygen', ['new', '--no-bip39-passphrase', '-s', '-o', authFile], { stdio: 'ignore' });
const authority = spawnSync('solana-keygen', ['pubkey', authFile], { encoding: 'utf8' }).stdout.trim();
const B = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const dec = s => { let x = 0n; for (const c of s) x = x * 58n + BigInt(B.indexOf(c)); const o = []; while (x > 0n) { o.unshift(Number(x & 255n)); x >>= 8n; } for (const c of s) { if (c !== '1') break; o.unshift(0); } return Buffer.from(o); };

const infos = await rpc('getMultipleAccounts', [Object.values(ACCOUNTS), { encoding: 'base64', commitment: 'confirmed' }]);
let saved = 0;
for (const [i, [name, key]] of Object.entries(ACCOUNTS).entries()) {
  const a = infos.value[i];
  if (!a) { console.log(name, key, 'absent on mainnet (skipped)'); continue; }
  let data = Buffer.from(a.data[0], 'base64');
  if (name === 'usdcMint') { data = Buffer.from(data); data.writeUInt32LE(1, 0); dec(authority).copy(data, 4); }
  if (name === 'tree') fs.writeFileSync(path.join(run, 'cloned-tree.b64'), data.toString('base64'));
  fs.writeFileSync(path.join(acc, key + '.json'), JSON.stringify({ pubkey: key, account: { lamports: a.lamports, data: [data.toString('base64'), 'base64'], owner: a.owner, executable: false, rentEpoch: 0, space: data.length } }));
  saved++;
}
for (const p of Object.values(RINGS)) {
  const out = path.join(progs, p + '.so');
  for (const u of ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com']) { if (spawnSync('solana', ['program', 'dump', '-u', u, p, out], { encoding: 'utf8' }).status === 0) break; }
  console.log(p, fs.existsSync(out) ? fs.statSync(out).size + ' bytes' : 'NOT dumped');
}
const treeSlot = Buffer.from(fs.readFileSync(path.join(run, 'cloned-tree.b64'), 'utf8'), 'base64').readBigUInt64LE(120);
const now = BigInt(await rpc('getSlot', [{ commitment: 'confirmed' }]));
fs.writeFileSync(path.join(run, 'warp-slot.txt'), String((now > treeSlot ? now : treeSlot) + 2000n) + '\n');
console.log('accounts saved', saved, '· tree last update slot', String(treeSlot), '· warp', fs.readFileSync(path.join(run, 'warp-slot.txt'), 'utf8').trim(), '· local USDC authority', authority);
