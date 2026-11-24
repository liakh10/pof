/* Launch day for Proof of Funds, run with the dev wallet (the upgrade authority of both programs, the config's admin and the wallet
   withdraw_fees pays, the creator of the root coin). In one run, every step skipped when already done (a second run finishes a
   half-done launch and changes nothing on a finished one):
     0. crons parked in vercel.crons.json go back into vercel.json as {path, schedule} (the keeper, the bot sweep, the status
        sampler), pushed and deployed before anything else
     1. the programs: pof_gate and pof deployed through sol-ops when missing (each from its own staging folder), then
        init_config(verifier, relayer, dev) with the Verifier's and the relayer's PUBLIC keys (read from ~/.config/pof/verifier.json
        and relayer.json, made by verifier/scripts/keys.mjs; or --verifier / --relayer); this wallet must be the upgrade authority of
        both and the config's admin. The launch parameters are in the program (fee 0.01 SOL, validity 6,480,000 slots, rotation
        delay 216,000 slots). Nothing is certified by the dev
     2. the coin's address first: a mint key ending in "pump" (made once into --mint-key, or taken from there), or the owner's own CA
        (in config.js or --ca): CA, PROGRAM and GATE into config.js, coin.json written, pushed, the live site checked until it shows the CA
     3. the root coin on pump.fun (NAME and TICKER from config.js): a plain create_v2 from this wallet, 100% of its creator fees to this
        wallet, no fee sharing, no buy unless --buy <SOL>; with the owner's own CA the script waits for his create and checks its creator;
        START (the create's block time, unix seconds) into config.js in both cases
     4. set_roles(root mint): a payer holding 1,000,000 of it pays no certify or renew fee
     5. the site's lookup table (both programs, the config, the treasury, the Rings program and tree 0, the instructions sysvar, the
        Ed25519 program, the system and token programs, the relayer, the root mint), made at a free recent slot about 20 back
        (retried), its address into config.js ALT
     5b. the relayer's float topped up to 0.05 SOL (it pays the rent of the X-handle and badge certificates it submits; each comes back
        to it at expire; the holders pay it back privately)
     6. LIVE: true pushed; a commit is pushed even when nothing changed, so production always redeploys
   Nothing optional is spent: no dev buy, no certificate, no room from the dev.

     node program/launch.mjs --keypair ~/keys/pof-dev.json [--mint-key ~/keys/pof-mint.json] [--ca <CA>] [--buy 0]
     node program/launch.mjs --dry --as <dev pubkey>        what it would do, nothing sent
     --url http://127.0.0.1:50899 [--config <file>] [--host http://127.0.0.1:<port>] [--verifier <pubkey>] [--relayer <pubkey>] is a
     rehearsal on the local clone: nothing pushed, Vercel untouched.
   Needs `npm ci` in program/ once (pump.fun's SDK for the create; run-launch.sh does it when node_modules is missing). */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { makePof } from './js/pof.mjs';
import { solOps } from './ops.mjs';
const require = createRequire(import.meta.url);
const P = require('@pump-fun/pump-sdk');
const BN = require('bn.js');
const web3 = require('@solana/web3.js');
const bs58m = require('bs58'), bs58 = bs58m.default || bs58m;
const { Connection, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, ComputeBudgetProgram, AddressLookupTableProgram, LAMPORTS_PER_SOL } = web3;

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(here, '..');
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };
const has = n => argv.includes('--' + n);
const home = p => String(p).replace(/^~(?=$|\/)/, os.homedir());
const DRY = has('dry');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const t = () => new Date().toLocaleTimeString();
const sol = l => (Number(l) / 1e9).toFixed(4);

const siteKeys = (() => { try { return fs.readFileSync(path.join(os.homedir(), '.config/helius/site_keys'), 'utf8').split(/\s+/).filter(Boolean); } catch { return []; } })();
// a key that answers, tried in random order, the public node last
const url = flag('url', '') || await (async () => { for (const k of [...siteKeys].sort(() => Math.random() - 0.5)) { try { const r = await fetch(`https://mainnet.helius-rpc.com/?api-key=${k}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"getSlot"}', signal: AbortSignal.timeout(8000) }); if (r.ok && !(await r.json()).error) return `https://mainnet.helius-rpc.com/?api-key=${k}`; } catch {} } return 'https://solana-rpc.publicnode.com'; })();
const conn = new Connection(url, 'confirmed');
const LOCAL = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url);
const NO_PUSH = LOCAL || has('no-push');
const cfgFile = path.resolve(home(flag('config', path.join(SITE, 'config.js'))));
const coinFile = path.join(path.dirname(cfgFile), 'coin.json');
const cfgText0 = fs.readFileSync(cfgFile, 'utf8');
const cfgField = k => (new RegExp(`\\b${k}\\s*:\\s*"([^"]*)"`).exec(cfgText0) || [])[1] || '';
const NAME = cfgField('NAME') || 'Proof of Funds', TICKER = cfgField('TICKER') || 'POF';
const SITE_URL = `https://${(cfgField('DOMAIN') || 'pof.vercel.app').replace(/^https?:\/\//, '')}`;
const BUY = Math.round(Number(flag('buy', '0')) * LAMPORTS_PER_SOL);
const q = makePof(web3);
const sdk = new P.PumpSdk();
const curveOf = m => P.bondingCurvePda(new PublicKey(m));
const rpc = async (method, params) => { const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }); const j = await r.json(); if (j.error) throw Error(`${method}: ${JSON.stringify(j.error).slice(0, 200)}`); return j.result; };

function loadKey(file) {
  const raw = fs.readFileSync(home(file), 'utf8').trim();
  return Keypair.fromSecretKey(raw.startsWith('[') ? Uint8Array.from(JSON.parse(raw)) : bs58.decode(raw));
}
let signer = null, dev;
const devFile = home(flag('keypair', '~/keys/pof-dev.json'));
if (DRY) dev = new PublicKey(flag('as'));
else { try { signer = loadKey(devFile); } catch { console.log('\n  could not read the dev key file (pass --keypair)\n'); process.exit(1); } dev = signer.publicKey; }

// launch step 0: crons parked until launch (vercel.crons.json) go back into vercel.json, pushed and deployed before anything else
// POF parks its crons as { note, crons: [{ path, schedule, owner, what }] }; Vercel takes { path, schedule } only, restoreCrons a list
{
  const parkedFile = path.join(SITE, 'vercel.crons.json');
  if (!DRY && !NO_PUSH && fs.existsSync(parkedFile)) {
    const j = JSON.parse(fs.readFileSync(parkedFile, 'utf8'));
    const list = (Array.isArray(j) ? j : j.crons || []).map(c => ({ path: c.path, schedule: c.schedule }));
    if (!Array.isArray(j) || JSON.stringify(j) !== JSON.stringify(list)) fs.writeFileSync(parkedFile, JSON.stringify(list, null, 1) + '\n');
  }
  const { restoreCrons } = await import(new URL('../../_solkit/ops/keeper-cron.mjs', import.meta.url));
  await restoreCrons(new URL('..', import.meta.url));
}

const start = DRY ? 0 : await conn.getBalance(dev, 'confirmed');
console.log(`\n  ${NAME} · program ${q.PID.toBase58()}\n  dev ${dev.toBase58()} (${sol(start)} SOL)${DRY ? ' (simulation)' : ''}${LOCAL ? ' · local rehearsal' : ''}`);
const spentSoFar = async () => (DRY ? '' : ` · dev spent ${sol(start - (await conn.getBalance(dev, 'confirmed')))} SOL so far`);

async function send(ixs, label, { extra = [], units = 400_000 } = {}) {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: dev, recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: LOCAL ? 0 : 200_000 }), ...ixs] }).compileToV0Message());
  if (!DRY) tx.sign([signer, ...extra]);
  const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: DRY });
  if (sim.value.err) { console.log(`  ${label} REFUSED ${JSON.stringify(sim.value.err)}\n    ${(sim.value.logs || []).slice(-8).join('\n    ')}`); process.exit(1); }
  if (DRY) { console.log(`  ${label}: simulation ok (${sim.value.unitsConsumed} CU)`); return null; }
  const raw = tx.serialize();
  const sig = await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 5 });
  for (let i = 0; ; i++) {
    await sleep(LOCAL ? 500 : 1500);
    const st = (await conn.getSignatureStatuses([sig])).value[0];
    if (st && st.confirmationStatus && st.confirmationStatus !== 'processed') { if (st.err) { console.log(`  ${label} FAILED ${JSON.stringify(st.err)}`); process.exit(1); } break; }
    if ((await conn.getBlockHeight('confirmed')) > lastValidBlockHeight) { console.log(`  ${label}: expired, sending it again`); return send(ixs, label, { extra, units }); }
    if (i % 2 === 1) await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
  }
  console.log(`  ${t()}  ${label}  ${sig}${await spentSoFar()}`);
  return sig;
}
const readCfg = () => fs.readFileSync(cfgFile, 'utf8');
const field = (k, text = readCfg()) => (new RegExp(`\\b${k}\\s*:\\s*"([^"]*)"`).exec(text) || [])[1] || '';
const setBool = (k, v) => { const b = readCfg(); const a = b.replace(new RegExp(`(\\b${k}\\s*:\\s*)(true|false)`), `$1${v}`); if (a !== b) fs.writeFileSync(cfgFile, a); return a !== b; };
const setField = (k, v) => { const b = readCfg(); const a = b.replace(new RegExp(`(\\b${k}\\s*:\\s*")[^"]*(")`), `$1${v}$2`); if (a !== b) fs.writeFileSync(cfgFile, a); return a !== b; };
const git = (...a) => spawnSync('git', ['-C', SITE, ...a], { encoding: 'utf8' });
function push(files, message) {
  if (NO_PUSH || cfgFile !== path.join(SITE, 'config.js')) { console.log(`  (not pushed: ${LOCAL ? 'local rehearsal' : '--no-push or a scratch config'})`); return; }
  git('add', ...files);
  const dirty = git('diff', '--cached', '--name-only').stdout.trim();
  // an empty commit when nothing changed: production redeploys
  const c = dirty ? git('commit', '-m', message, ...files) : git('commit', '--allow-empty', '-m', message);
  const p = git('push', 'origin', 'HEAD');
  console.log(c.status === 0 && p.status === 0 ? `  pushed: ${message}` : `  git: ${(c.stderr + p.stderr).trim().slice(0, 200)}`);
}

/* 1. the programs and init_config */
const pubOf = file => { try { return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(home(file), 'utf8')))).publicKey; } catch { return null; } };
const VERIFIER = flag('verifier', '') ? new PublicKey(flag('verifier')) : pubOf('~/.config/pof/verifier.json');
const RELAYER = flag('relayer', '') ? new PublicKey(flag('relayer')) : pubOf('~/.config/pof/relayer.json');
if (!VERIFIER || !RELAYER) { console.log('  no Verifier or relayer key: run node verifier/scripts/keys.mjs (or pass --verifier and --relayer)\n'); process.exit(1); }
console.log(`  verifier ${VERIFIER.toBase58()} · relayer ${RELAYER.toBase58()}`);
const authorityOf = async id => { const p = await conn.getAccountInfo(id); if (!p) return undefined; const pd = await conn.getAccountInfo(new PublicKey(p.data.subarray(4, 36))); return pd && pd.data[12] === 1 ? new PublicKey(pd.data.subarray(13, 45)) : null; };
for (const [name, id] of [['pof_gate', q.GATE], ['pof', q.PID]]) {
  let auth = await authorityOf(id);
  if (auth === undefined) {
    const so = fs.statSync(path.join(here, `target/deploy/${name}.so`)).size;
    const rent = await conn.getMinimumBalanceForRentExemption(so + 45) + await conn.getMinimumBalanceForRentExemption(36);
    if (DRY) { console.log(`  ${name}: would be deployed by sol-ops (${(so / 1024).toFixed(0)} KB, ${sol(rent)} SOL rent)`); continue; }
    console.log(`  ${t()}  sol-ops deploy ${name} (${(so / 1024).toFixed(0)} KB, ${sol(rent)} SOL rent)…`);
    const r = solOps('deploy', name, devFile, url);
    console.log(r.tail);
    auth = await authorityOf(id);
    if (r.status !== 0 || auth === undefined) { console.log(`  the deploy of ${name} did not finish: run the same command again (it resumes)\n`); process.exit(1); }
    // a program becomes callable from the slot after its deployment
    const pd = await conn.getAccountInfo(new PublicKey((await conn.getAccountInfo(id)).data.subarray(4, 36)));
    const at = Number(Buffer.from(pd.data).readBigUInt64LE(4));
    for (let i = 0; i < 60 && (await conn.getSlot('confirmed')) <= at + 1; i++) await sleep(500);
    console.log(`  ${name} deployed${await spentSoFar()}`);
  }
  if (!auth || !auth.equals(dev)) { console.log(`  this wallet is not ${name}'s upgrade authority (${auth ? auth.toBase58() : 'none'}): stopped\n`); process.exit(1); }
}
const readConfig = async () => { const a = await conn.getAccountInfo(q.K.config, 'confirmed'); return a ? q.P.decodeAccount('Config', a.data) : null; };
let h = await readConfig();
if (!h) {
  if (DRY) console.log(`  init_config(verifier, relayer, dev = this wallet) would run`);
  else { await send([q.P.ix('init_config', { verifier: VERIFIER, relayer: RELAYER, dev }, { admin: dev })], 'init_config: the Verifier and relayer keys, fees to the dev, the launch parameters', { units: 200_000 }); h = await readConfig(); }
}
if (h) {
  if (h.admin !== dev.toBase58()) { console.log(`  the admin is ${h.admin}, not this wallet: stopped\n`); process.exit(1); }
  if (h.verifier !== VERIFIER.toBase58()) console.log(`  NOTE: the config's verifier is ${h.verifier}, not ${VERIFIER.toBase58()} (rotate with set_verifier: it takes the rotation delay)`);
  console.log(`  config: verifier ${h.verifier.slice(0, 8)}…, relayer ${h.relayer.slice(0, 8)}…, fee ${sol(h.params.fee_lamports)} SOL, fees to ${h.dev === dev.toBase58() ? 'the dev' : h.dev}`);
}
const prog = h;

/* 2. the CA first */
const rootSet = h && h.root_mint !== PublicKey.default.toBase58();
const mintFile = home(flag('mint-key', LOCAL ? path.join(here, 'test/.run/root-mint.json') : '~/keys/pof-mint.json'));
let mintKp = null, MINT;
// the owner's own CA (the address pump.fun's create form offers): in config.js before this run, or --ca; then no key is ground here and
// the coin is created by him on pump.fun from this same wallet
const ownCa = flag('ca', !fs.existsSync(mintFile) && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(field('CA')) ? field('CA') : '');
if (rootSet) MINT = new PublicKey(h.root_mint);
else if (ownCa) MINT = new PublicKey(ownCa);
else if (DRY && !fs.existsSync(mintFile)) MINT = Keypair.generate().publicKey;
else {
  if (!fs.existsSync(mintFile)) {
    const secs = Number(flag('grind-secs', LOCAL ? '20' : '300'));
    console.log(`  ${t()}  making the coin's address: a key ending in "pump" (up to ${Math.round(secs / 60) || 1} min, a plain key after that)…`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pof-grind-'));
    const made = await new Promise(res => {
      const g = spawn('solana-keygen', ['grind', '--ends-with', 'pump:1'], { cwd: dir, stdio: 'ignore' });
      const stop = setTimeout(() => g.kill('SIGKILL'), secs * 1000);
      g.on('exit', () => { clearTimeout(stop); res(fs.readdirSync(dir).find(f => f.endsWith('pump.json')) || null); });
    });
    fs.mkdirSync(path.dirname(mintFile), { recursive: true });
    if (made) { fs.copyFileSync(path.join(dir, made), mintFile); fs.unlinkSync(path.join(dir, made)); }
    else fs.writeFileSync(mintFile, JSON.stringify(Array.from(Keypair.generate().secretKey)));
    fs.chmodSync(mintFile, 0o600);
    for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));
    fs.rmdirSync(dir);
    console.log(made ? '  a "pump" address found' : '  no "pump" address in time: a plain address instead');
  }
  mintKp = loadKey(mintFile);
  MINT = mintKp.publicKey;
}
console.log(`  $${TICKER} ${MINT.toBase58()}`);
// the owner's own CA: he can create it from now on, the steps below run while he does; the create step just waits
if (ownCa && !DRY && !rootSet && !(await conn.getAccountInfo(curveOf(MINT)).catch(() => null))) console.log(`  ${t()}  waiting for ${MINT.toBase58()} to be created on pump.fun from ${dev.toBase58()}…: create it NOW (a plain create: name ${NAME}, ticker ${TICKER}, no fee sharing)`);
const xUrl = field('X_URL'), domain = field('DOMAIN');
/* The site's build renames files on prod (config.js is served as e.g. /scripts/vars.js): the public path of a source file comes from the
   build's own map (`node build.mjs --map --json`, identical names are left out of it), else from the home page's script tags. */
function servedPath(file) {
  const r = spawnSync('node', ['build.mjs', '--map', '--json'], { cwd: SITE, encoding: 'utf8' });
  try { const j = JSON.parse(r.stdout); return '/' + ((j.files || {})[file] || file); } catch { return null; }
}
async function servedConfig(host) {
  const fromMap = servedPath('config.js');
  if (fromMap) return fromMap;
  const html = await fetch(`${host}/?t=${Date.now()}`, { cache: 'no-store' }).then(r => r.text()).catch(() => '');
  const src = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(x => x[1]).find(x => /config|vars|env|conf/i.test(x));
  return src ? (src.startsWith('/') ? src : '/' + src).replace(/\?.*$/, '') : '/config.js';
}
const statusOf = u => fetch(u, { cache: 'no-store', redirect: 'follow' }).then(r => r.status).catch(() => 0);
// --host serves the local rehearsal only (a local copy of the site's files): on mainnet the live domain is always the one checked
const HOST = LOCAL && flag('host', '') ? flag('host', '') : domain ? `https://${domain.replace(/^https?:\/\//, '')}` : SITE_URL;
// what the coin's metadata points at must be live before the coin is created (its image is fixed in the metadata for good)
async function siteCheck(host) {
  const cfgPath = await servedConfig(host), coinPath = servedPath('coin.json') || '/coin.json', imgPath = servedPath('coin.png') || '/coin.png';
  const [cfgStatus, imgStatus] = await Promise.all([statusOf(`${host}${cfgPath}?t=${Date.now()}`), statusOf(`${host}${imgPath}`)]);
  return { cfgPath, coinPath, imgPath, cfgStatus, imgStatus };
}
if (DRY) {
  const c = await siteCheck(HOST);
  console.log(`  site: config.js is served as ${c.cfgPath} (${HOST}${c.cfgPath}: ${c.cfgStatus}); coin.json at ${c.coinPath}; coin.png at ${HOST}${c.imgPath}: ${c.imgStatus}${c.imgStatus === 200 ? '' : ' (the create would be REFUSED until it is 200)'}`);
}
if (!DRY) {
  const host = domain ? `https://${domain.replace(/^https?:\/\//, '')}` : flag('site', SITE_URL);
  const posts = (() => { try { return JSON.parse(fs.readFileSync(path.resolve(SITE, '../_x/pof/x/posts.json'), 'utf8')); } catch { return null; } })();
  const bio = posts && posts.bios && posts.bios[0] ? String(posts.bios[0]).split('\n')[0].trim() : 'Post proof, not wallet: a live on-chain certificate that you hold at least a tier of SOL or USDC in a Privacy Ring, revoked the moment the money moves';
  const meta = { name: NAME, symbol: TICKER, description: bio, image: `${host}/coin.png`, showName: true, createdOn: 'https://pump.fun', ...(xUrl ? { twitter: xUrl } : {}), website: host };
  const before = fs.existsSync(coinFile) ? fs.readFileSync(coinFile, 'utf8') : '';
  const next = JSON.stringify(meta, null, 1) + '\n';
  if (before !== next) fs.writeFileSync(coinFile, next);
  const changed = [setField('CA', MINT.toBase58()), setField('PROGRAM', q.PID.toBase58()), setField('GATE', q.GATE.toBase58())].some(Boolean);
  if (changed || before !== next) { console.log('  config.js: CA, PROGRAM, GATE written · coin.json written'); push(['config.js', 'coin.json'], `CA ${MINT.toBase58()}`); }
  else console.log('  config.js: CA already there');
  if (!NO_PUSH) {
    const cfgPath = await servedConfig(host), coinPath = servedPath('coin.json') || '/coin.json';
    const cfgUrl = `${host}${cfgPath}`, coinUrl = `${host}${coinPath}`;
    process.stdout.write(`  ${t()}  waiting for the live site to show the CA (${cfgUrl}, ${coinUrl})`);
    let live = false, last = {};
    for (let i = 0; i < 90 && !live; i++) {
      const r1 = await fetch(`${cfgUrl}?t=${Date.now()}`, { cache: 'no-store' }).catch(() => null);
      const text = r1 && r1.ok ? await r1.text() : '';
      const r2 = await fetch(`${coinUrl}?t=${Date.now()}`, { cache: 'no-store' }).catch(() => null);
      last = { cfg: r1 ? r1.status : 0, coin: r2 ? r2.status : 0 };
      if (text.includes(MINT.toBase58()) && r2 && r2.ok) { live = true; process.stdout.write(' · live\n'); break; }
      process.stdout.write('.'); await sleep(4000);
    }
    if (!live) { console.log(`\n  STOPPED: after 6 minutes the live site still does not show the CA: ${cfgUrl} answered ${last.cfg}, ${coinUrl} answered ${last.coin}.\n  Nothing was created; check the deploy, then run the same command again.\n`); process.exit(1); }
  }
}
const uri = (() => { try { const w = JSON.parse(fs.readFileSync(coinFile, 'utf8')).website; return `${w}/coin.json`; } catch { return SITE_URL + '/coin.json'; } })();

/* 3. the root coin, a plain create: its creator fees are this wallet's (no fee sharing for the main coin) */
if (!(await conn.getAccountInfo(curveOf(MINT)))) {
  if (DRY) console.log(`  $${TICKER}: would be created by ${dev.toBase58().slice(0, 6)}…, creator fees 100% to it${BUY ? `, first buy ${BUY / LAMPORTS_PER_SOL} SOL` : ''}`);
  else if (!mintKp) {
    console.log(`  ${t()}  waiting for ${MINT.toBase58()} to be created on pump.fun from ${dev.toBase58()}… (a plain create: name ${NAME}, ticker ${TICKER}, no fee sharing)`);
    while (!(await conn.getAccountInfo(curveOf(MINT)).catch(() => null))) await sleep(4000);
    console.log(`  ${t()}  $${TICKER} is on pump.fun`);
  } else {
    const img = `${HOST}${servedPath('coin.png') || '/coin.png'}`;
    const st = await statusOf(img);
    if (st !== 200) { console.log(`  STOPPED before the create: the coin's image ${img} answers ${st}, and pump.fun keeps the metadata for good. Publish it, then run the same command again.\n`); process.exit(1); }
    console.log(`  the coin's image is live: ${img}`);
    let ixs;
    if (BUY > 0) {
      const global = await new P.OnlinePumpSdk(conn).fetchGlobal();
      const amount = P.getBuyTokenAmountFromSolAmount({ global, feeConfig: null, mintSupply: null, bondingCurve: null, amount: new BN(BUY) });
      ixs = await sdk.createV2AndBuyInstructions({ global, mint: MINT, name: NAME, symbol: TICKER, uri, creator: dev, user: dev, amount, solAmount: new BN(Math.floor(BUY * 1.05)), mayhemMode: false });
    } else ixs = [await sdk.createV2Instruction({ mint: MINT, name: NAME, symbol: TICKER, uri, creator: dev, user: dev, mayhemMode: false })];
    // create_v2 under-pays the Token-2022 mint's rent for some metadata lengths: a small top-up rides along
    ixs.splice(1, 0, SystemProgram.transfer({ fromPubkey: dev, toPubkey: MINT, lamports: 20_000 }));
    await send(ixs, `$${TICKER} created on pump.fun, creator fees 100% to the dev${BUY ? `, first buy ${BUY / LAMPORTS_PER_SOL} SOL` : ''}`, { extra: [mintKp], units: 400_000 });
  }
}
const curve = await conn.getAccountInfo(curveOf(MINT));
if (curve) {
  const creator = new PublicKey(curve.data.subarray(49, 81));
  if (!creator.equals(dev)) { console.log(`  $${TICKER}'s creator is ${creator.toBase58()}, not this wallet: stopped\n`); process.exit(1); }
  console.log(`  $${TICKER}: creator fees 100% to the dev, no sharing config`);
  // START: the create's block time (the oldest transaction of the curve); "since launch" on the site counts from it
  if (!DRY && !field('START')) {
    let before = null, oldest = null;
    for (let i = 0; i < 20; i++) { const page = await conn.getSignaturesForAddress(curveOf(MINT), { limit: 1000, ...(before ? { before } : {}) }, 'confirmed'); if (!page.length) break; oldest = page[page.length - 1]; before = oldest.signature; if (page.length < 1000) break; }
    const bt = oldest && (oldest.blockTime || (await conn.getBlockTime(oldest.slot).catch(() => null)));
    if (bt && setField('START', String(bt))) { console.log(`  config.js: START ${bt} (the create's block time)`); push(['config.js'], 'START: the coin create time'); }
  }
}

/* 4. the holder perk */
h = DRY ? h : await readConfig();
if (h && h.root_mint === PublicKey.default.toBase58() && !DRY) await send([q.P.ix('set_roles', { dev: null, relayer: null }, { admin: dev, root_mint: MINT })], `set_roles: a payer holding 1,000,000 $${TICKER} pays no certify or renew fee`, { units: 60_000 });
else if (!DRY) console.log(`  set_roles: $${TICKER} already set`);

/* 5. the site's lookup table */
{
  const have = field('ALT');
  const t0 = have ? (await conn.getAddressLookupTable(new PublicKey(have)).catch(() => ({ value: null }))).value : null;
  const c5 = DRY ? null : await readConfig();
  const want = DRY ? [] : [q.PID, q.GATE, q.K.config, q.K.treasury, q.K.SPP, q.K.TREE, web3.SYSVAR_INSTRUCTIONS_PUBKEY, web3.Ed25519Program.programId, SystemProgram.programId,
    new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'), ComputeBudgetProgram.programId, new PublicKey(c5.relayer), new PublicKey(c5.root_mint)].map(String);
  const missing = want.filter(k => !(t0 ? t0.state.addresses.map(String) : []).includes(k));
  if (t0 && !missing.length) console.log(`  lookup table ${have}: ${t0.state.addresses.length} accounts, complete`);
  else if (DRY) console.log('  lookup table: would be made at the finalized slot - 20 with the accounts every wrap and opening names');
  else {
    let key = t0 ? new PublicKey(have) : null;
    if (!key) {
      // the table's address comes from (authority, recentSlot) and a create on an address that already holds a table is a no-op (the
      // extend would then append the same addresses twice): so a slot about 20 back whose table address is still free, retried
      let mk = null;
      for (let tries = 0; !mk; tries++) {
        if (tries) { if (tries > 30) { console.log('  no free lookup table address among the recent slots: run again'); process.exit(1); } await sleep(1000); }
        const fin = Number(await conn.getSlot('finalized'));
        const slots = [...new Set([...Array(40).keys()].map(k => fin - 20 - k).concat([...Array(21).keys()].map(k => fin - k)))].filter(x => x >= 0);
        for (const sl of slots) { const [ix, k2] = AddressLookupTableProgram.createLookupTable({ authority: dev, payer: dev, recentSlot: sl }); if (!(await conn.getAccountInfo(k2))) { mk = ix; key = k2; break; } }
      }
      await send([mk], 'lookup table created', { units: 40_000 });
    }
    for (let i = 0; i < missing.length; i += 25) await send([AddressLookupTableProgram.extendLookupTable({ lookupTable: key, authority: dev, payer: dev, addresses: missing.slice(i, i + 25).map(x => new PublicKey(x)) })], `lookup table: ${Math.min(i + 25, missing.length)}/${missing.length} accounts`, { units: 60_000 });
    if (setField('ALT', key.toBase58())) { console.log(`  config.js: ALT ${key.toBase58()}`); push(['config.js'], 'The site lookup table'); }
  }
}

/* 5b. the relayer's float: it pays the rent of the X-handle and badge certificates it submits (each rent comes back to it at expire)
   and its fees; the holders pay it back privately. Topped up to --relayer-float SOL (default 0.05) when below. */
{
  const want = BigInt(Math.round(Number(flag('relayer-float', '0.05')) * LAMPORTS_PER_SOL));
  const have = DRY ? 0n : BigInt(await conn.getBalance(RELAYER, 'confirmed'));
  if (want > 0n && have < want) {
    if (DRY) console.log(`  relayer float: would top ${RELAYER.toBase58().slice(0, 8)}… up to ${sol(want)} SOL`);
    else await send([SystemProgram.transfer({ fromPubkey: dev, toPubkey: RELAYER, lamports: want - have })], `relayer float: ${sol(want - have)} SOL to ${RELAYER.toBase58().slice(0, 8)}… (now ${sol(want)} SOL)`, { units: 1000 });
  } else if (!DRY) console.log(`  relayer float: ${sol(have)} SOL, enough`);
}

/* 6. open */
if (!DRY) { console.log(setBool('LIVE', true) ? '  config.js: LIVE: true' : '  config.js: LIVE already true (an empty commit redeploys production with the new env)'); push(['config.js'], 'Open: certificates can be issued'); }
const done = DRY ? '' : ` · the launch cost the dev ${sol(start - (await conn.getBalance(dev, 'confirmed')))} SOL in all`;
console.log(`\n  done. ${NAME} is open: certificates can be issued now${done}\n`);
process.exit(0);
