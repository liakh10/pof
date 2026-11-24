// What the POF suite's and the rehearsal's chains copy from mainnet (read-only): Helius Privacy Rings (the Solana Privacy Program's
// binary, tree 0 with its real nullifier root history, the protocol config and the SOL interface), and pump.fun with every account a
// create_v2, buy and sell reads (the rehearsal creates $ROOT on it), from the SDK's own instructions for a throwaway mint. Data
// accounts go to .run/accounts/*.json (loaded with --account), programs to .run/programs.txt and their binaries to .run/programs/.
// Then what a real spend leaves on chain, made locally: spent-nullifier PDAs ["nullifier", tree, nf] owned by the Privacy Program,
// 11 bytes 0x08 ‖ u64 LE queue index ‖ 0x0000 (.run/spent.json lists their nullifiers), plus two look-alikes that must NOT count
// (a wrong first byte, a wrong length). Checks that the membership fixture's root (test/fixtures/membership.json) is still in the
// cloned tree's nullifier root history. Mainnet reads go to MAINNET_RPC, else a random key of ~/.config/helius/site_keys.
// Run: node test/prep.mjs
import { createRequire } from 'module';
import fs from 'fs';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const spl = require('@solana/spl-token');
const P = require('@pump-fun/pump-sdk');
const S = require('@pump-fun/pump-swap-sdk');
const BN = require('bn.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const run = path.join(here, '.run');
const accDir = path.join(run, 'accounts');
fs.rmSync(accDir, { recursive: true, force: true });
fs.mkdirSync(accDir, { recursive: true });
const keysFile = path.join(process.env.HOME || '', '.config', 'helius', 'site_keys');
const siteKeys = fs.existsSync(keysFile) ? fs.readFileSync(keysFile, 'utf8').split(/\s+/).filter(Boolean) : [];
const conn = new Connection(process.env.MAINNET_RPC || (siteKeys.length ? `https://mainnet.helius-rpc.com/?api-key=${siteKeys[Math.floor(Math.random() * siteKeys.length)]}` : 'https://api.mainnet-beta.solana.com'), 'confirmed');
const T22 = spl.TOKEN_2022_PROGRAM_ID, TOKEN = spl.TOKEN_PROGRAM_ID, WSOL = spl.NATIVE_MINT;
const ata = (m, o, tp) => spl.getAssociatedTokenAddressSync(m, o, true, tp);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function retry(f, n = 6) { for (let i = 0; ; i++) { try { return await f(); } catch (e) { if (i >= n) throw e; await sleep(1500 * (i + 1)); } } }
const PID = new PublicKey(fs.readFileSync(path.join(here, '..', 'PROGRAM_ID.txt'), 'utf8').trim());
const GATE = new PublicKey(fs.readFileSync(path.join(here, '..', 'GATE_ID.txt'), 'utf8').trim());
const online = new P.OnlinePumpSdk(conn), sdk = new P.PumpSdk();
const amm = new S.OnlinePumpAmmSdk(conn), ammOff = new S.PumpAmmSdk();
const global = await retry(() => online.fetchGlobal());

const CURVE_FEE_RECIPIENTS = ['62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV', '7VtfL8fvgNfhz17qKRMjzQEXgbdpnHHHQRh54R9jP2RJ', '7hTckgnGnLQR6sdH7YkqFTAA7VwTfYFaZ6EhEsU3saCX', '9rPYyANsfQZw3DnDmKE3YCQF5E8oD89UXoHn9JFEhJUz', 'AVmoTthdrX6tKt4nDjco2D775W2YK3sDhxPcMmzUAmTY', 'CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM', 'FWsW1xNtWscwNmKv6wVsU1iTzRN6wmmk3MjxRP5tT7hz', 'G5UZAVbAf46s7cKWoyKu8kYTip9DGTpbLZ2qa9Aq69dP'];
const CURVE_BUYBACK_RECIPIENTS = ['5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD', '9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7', 'GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL', '3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR', '5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6', 'EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL', '5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD', 'A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW'];

const keys = new Set();
const add = (...ks) => ks.flat().forEach(k => k && keys.add(new PublicKey(k).toBase58()));
const addIxs = ixs => ixs.forEach(ix => { add(ix.programId); ix.keys.forEach(k => add(k.pubkey)); });

add(CURVE_FEE_RECIPIENTS, CURVE_BUYBACK_RECIPIENTS, global.feeRecipient, global.feeRecipients, global.reservedFeeRecipient, global.reservedFeeRecipients);
// every recipient the Global account itself lists (lib/cola.js picks from these): fee recipients 41 and 162, buyback 741
{
  const g = (await retry(() => conn.getAccountInfo(P.GLOBAL_PDA))).data;
  for (const [at, n] of [[41, 1], [162, 7], [741, 8]]) for (let i = 0; i < n; i++) { const k = new PublicKey(g.subarray(at + 32 * i, at + 32 * i + 32)); if (!k.equals(PublicKey.default)) add(k); }
}
const gc = PublicKey.findProgramAddressSync([Buffer.from('global_config')], S.PUMP_AMM_PROGRAM_ID)[0];
const globalConfig = ammOff.decodeGlobalConfig(await retry(() => conn.getAccountInfo(gc)));
const ammRecipients = [...globalConfig.protocolFeeRecipients, ...(globalConfig.buybackFeeRecipients || []), globalConfig.reservedFeeRecipient, ...(globalConfig.reservedFeeRecipients || [])].filter(Boolean);
add(gc, ammRecipients, ammRecipients.map(r => ata(WSOL, r, TOKEN)));

// create_v2, a buy, migration, and the fee sharing setup and distribution, for a mint that never exists
const throwaway = Keypair.generate().publicKey, who = Keypair.generate().publicKey, other = Keypair.generate().publicKey;
{
  const amount = P.getBuyTokenAmountFromSolAmount({ global, feeConfig: null, mintSupply: null, bondingCurve: null, amount: new BN(1e8) });
  addIxs(await sdk.createV2AndBuyInstructions({ global, mint: throwaway, name: 'x', symbol: 'x', uri: 'x', creator: who, user: who, amount, solAmount: new BN(2e8), mayhemMode: false }));
  // a sell, so the sell path's accounts are there too
  try { const g2 = global; addIxs(await sdk.sellInstructions({ global: g2, bondingCurveAccountInfo: null, bondingCurve: null, mint: throwaway, user: who, amount: new BN(1e9), solAmount: new BN(1), slippage: 1, tokenProgram: T22, mayhemMode: false })); } catch (e) { console.log('no offline sell builder:', String(e.message).slice(0, 80)); }
}


/* ------------------------------------------------------------------ Helius Privacy Rings: the Solana Privacy Program and the User Registry
   (their binaries), the default ring's state tree and its SOL interface, so a ring opening deposits on the clone exactly as on mainnet */
const RINGS = { spp: 'ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW', registry: 'regy3WAeRXMYuMYxr5iK3Bf9Arr3PcxGxyzAddbiqDQ', tree: '777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor', solInterface: 'CiNmas621VuyofiDSrEPfTXHKrdZuB6jMKECyNiMpLXE' };
add(RINGS.tree, RINGS.solInterface);
const protocolConfig = PublicKey.findProgramAddressSync([Buffer.from('protocol_config')], new PublicKey(RINGS.spp))[0];
add(protocolConfig);

/* ------------------------------------------------------------------ save */
const skipOwners = new Set(['Sysvar1111111111111111111111111111111111111', 'NativeLoader1111111111111111111111111111111', 'BPFLoaderUpgradeab1e11111111111111111111111', 'BPFLoader2111111111111111111111111111111111']);
const builtins = new Set(['11111111111111111111111111111111', 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', 'ComputeBudget111111111111111111111111111111', 'SysvarRent111111111111111111111111111111111', 'SysvarC1ock11111111111111111111111111111111', 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo', 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr']);
const skipKeys = new Set([WSOL.toBase58(), throwaway.toBase58(), who.toBase58(), other.toBase58(), PID.toBase58(), GATE.toBase58(), ...builtins]);
const programs = new Set([RINGS.spp, RINGS.registry, '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ', 'MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e', 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA', 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s']);
const plainPrograms = new Set();
let saved = 0;
async function save(list) {
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100).map(k => new PublicKey(k));
    const infos = await retry(() => conn.getMultipleAccountsInfo(chunk));
    chunk.forEach((k, j) => {
      const info = infos[j];
      if (!info) return;
      if (info.executable) { if (info.owner.toBase58() === 'BPFLoaderUpgradeab1e11111111111111111111111') programs.add(k.toBase58()); else if (!skipOwners.has(k.toBase58())) plainPrograms.add(k.toBase58()); return; }
      if (skipOwners.has(info.owner.toBase58())) return;
      const file = { pubkey: k.toBase58(), account: { lamports: info.lamports, data: [Buffer.from(info.data).toString('base64'), 'base64'], owner: info.owner.toBase58(), executable: false, rentEpoch: 0, space: info.data.length } };
      fs.writeFileSync(path.join(accDir, k.toBase58() + '.json'), JSON.stringify(file));
      saved++;
    });
  }
}
await save([...keys].filter(k => !skipKeys.has(k)));
// each route's accounts in one read, so a pool and its vaults agree
fs.writeFileSync(path.join(run, 'programs.txt'), [...programs].join('\n') + '\n');
// and their binaries, so chain.sh starts without asking mainnet (a rate-limited RPC cannot stop a run)
fs.mkdirSync(path.join(run, 'programs'), { recursive: true });
for (const p of programs) {
  const out = path.join(run, 'programs', p + '.so');
  for (const u of ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com', conn.rpcEndpoint]) {
    if (spawnSync('solana', ['program', 'dump', '-u', u, p, out], { encoding: 'utf8' }).status === 0) break;
    await sleep(3000);
  }
  console.log(p, fs.existsSync(out) ? fs.statSync(out).size + ' bytes' : 'NOT dumped (chain.sh clones it)');
}
fs.writeFileSync(path.join(run, 'plain-programs.txt'), [...plainPrograms].join('\n') + (plainPrograms.size ? '\n' : ''));
/* ------------------------------------------------------------------ spent nullifiers, as a real spend leaves them */
const SPP = new PublicKey(RINGS.spp), TREE = new PublicKey(RINGS.tree);
const nfPda = nf => PublicKey.findProgramAddressSync([Buffer.from('nullifier'), TREE.toBuffer(), Buffer.from(nf)], SPP)[0];
const field = () => { const b = crypto.randomBytes(32); b[0] = 0; return b; };   // under the BN254 modulus
const spent = [], fakes = [];
const writeAcc = (addr, data, owner = SPP) => fs.writeFileSync(path.join(accDir, addr.toBase58() + '.json'), JSON.stringify({ pubkey: addr.toBase58(), account: { lamports: 706_120, data: [data.toString('base64'), 'base64'], owner: owner.toBase58(), executable: false, rentEpoch: 0, space: data.length } }));
for (let i = 0; i < 6; i++) {
  const nf = field(), data = Buffer.alloc(11); data[0] = 8; data.writeBigUInt64LE(BigInt(900_000 + i), 1);
  writeAcc(nfPda(nf), data); spent.push(nf.toString('hex'));
}
{ const nf = field(), d = Buffer.alloc(11); d[0] = 7; writeAcc(nfPda(nf), d); fakes.push({ nf: nf.toString('hex'), why: 'first byte 7' }); }
{ const nf = field(), d = Buffer.alloc(12); d[0] = 8; writeAcc(nfPda(nf), d); fakes.push({ nf: nf.toString('hex'), why: '12 bytes' }); }
fs.writeFileSync(path.join(run, 'spent.json'), JSON.stringify({ tree: RINGS.tree, spent, fakes }, null, 1));
/* the membership fixture's root must be in the cloned tree's nullifier root history (100 roots at 17,232) */
{
  const fx = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/membership.json'), 'utf8'));
  const t = JSON.parse(fs.readFileSync(path.join(accDir, RINGS.tree + '.json'), 'utf8'));
  const d = Buffer.from(t.account.data[0], 'base64');
  const at = [...Array(100).keys()].find(i => d.subarray(17232 + i * 32, 17264 + i * 32).toString('hex') === fx.root);
  if (at === undefined) throw Error('the membership fixture root left the nullifier root history: run node test/membership-fixture.mjs');
  console.log('membership fixture root at nullifier history index', at);
}
console.log('accounts saved', saved, '· upgradeable programs', programs.size, '· other programs', plainPrograms.size, '· spent nullifier PDAs', spent.length);
