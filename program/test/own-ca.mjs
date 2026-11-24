// The owner's own CA on a fresh local clone (no program loaded): launch.mjs deploys both launch builds through sol-ops and runs
// init_config; it gets the CA from --ca with no mint key, keeps it, asks for the create right away, then WAITS; the "owner" creates the coin
// from the dev wallet (a plain create_v2, like pump.fun's form), launch.mjs sees it, checks the creator, runs set_roles and finishes;
// a second run finds it all done. A coin under the given CA made by another wallet stops the script first. The dev key file here is a
// base58 string, as a wallet exports it.
// Run: zsh test/own-ca.sh
import fs from 'fs';
import path from 'path';
import { execFileSync, spawn } from 'child_process';
import { createRequire } from 'module';
import { setup, run, keyOf, sleep } from './kit.mjs';
const require = createRequire(import.meta.url);
const { Keypair, PublicKey, SystemProgram } = require('@solana/web3.js');
const psdk = new (require('@pump-fun/pump-sdk').PumpSdk)();
const m = require('bs58'), bs58 = m.default || m;

const RPC = 'http://127.0.0.1:50899';
const k = setup(RPC);
let pass = 0, total = 0;
const ok = (cond, name, extra = '') => { total++; if (cond) { pass++; console.log('  ok   ' + name); } else console.log('  FAIL ' + name + (extra ? '  ' + String(extra).slice(0, 400) : '')); };
const here = path.dirname(new URL(import.meta.url).pathname);
const progDir = path.join(here, '..'), siteDir = path.join(progDir, '..'), ops = path.join(siteDir, '..', '_solkit', 'ops');
const dev = keyOf('authority');
const devFile = path.join(run, 'oc-dev-b58.txt');
fs.writeFileSync(devFile, bs58.encode(dev.secretKey) + '\n', { mode: 0o600 });
const stranger = Keypair.generate();
const cfgText = fs.readFileSync(path.join(siteDir, 'config.js'), 'utf8');
const NAME = /NAME:\s*"([^"]*)"/.exec(cfgText)[1], TICKER = /TICKER:\s*"([^"]*)"/.exec(cfgText)[1];

await k.fund([dev], 30);
await k.fund([stranger], 3);
const coinOf = async () => new PublicKey((await k.config()).root_mint);
const KEYS = ['--verifier', Keypair.generate().publicKey.toBase58(), '--relayer', Keypair.generate().publicKey.toBase58()];
const plainCreate = async (creator, mintKp) => k.send([await psdk.createV2Instruction({ mint: mintKp.publicKey, name: NAME, symbol: TICKER, uri: 'https://example.com/coin.json', creator: creator.publicKey, user: creator.publicKey, mayhemMode: false }), SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: mintKp.publicKey, lamports: 5_000_000 })], [creator, mintKp], 1_000_000);

const noKey = path.join(run, 'oc-no-mint.json');
const cfgOf = (name, ca) => { const f = path.join(run, `oc-${name}`, 'config.js'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, cfgText.replace(/LIVE:\s*true/, 'LIVE: false').replace(/CA:\s*"[^"]*"/, `CA: "${ca}"`)); return f; };
const L = (cfg, ca) => ['launch.mjs', '--keypair', devFile, '--url', RPC, '--config', cfg, '--mint-key', noKey, '--ca', ca, ...KEYS];

/* a coin under the given CA made by another wallet: stopped before set_roles */
const otherKp = Keypair.generate();
await plainCreate(stranger, otherKp);
let r0;
try { r0 = { code: 0, out: execFileSync('node', L(cfgOf('stranger', otherKp.publicKey.toBase58()), otherKp.publicKey.toBase58()), { cwd: progDir, encoding: 'utf8' }) }; } catch (e) { r0 = { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') }; }
ok(r0.code === 1 && /not this wallet: stopped/.test(r0.out) && (await coinOf()).equals(PublicKey.default), 'launch.mjs (from nothing: both programs deployed, init_config run): a coin whose creator is not the dev stops it before set_roles', r0.out.slice(-300));
{ const c = await k.config(); ok(c && c.admin === dev.publicKey.toBase58() && c.root_mint === PublicKey.default.toBase58(), 'the programs are up and the config made, no root set'); }

/* the same with the CA only in config.js, no --ca: it is taken from there, nothing ground */
let r1;
try { r1 = { code: 0, out: execFileSync('node', ['launch.mjs', '--keypair', devFile, '--url', RPC, '--config', cfgOf('stranger', otherKp.publicKey.toBase58()), '--mint-key', noKey, ...KEYS], { cwd: progDir, encoding: 'utf8' }) }; } catch (e) { r1 = { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') }; }
ok(r1.code === 1 && r1.out.includes(`$${TICKER} ${otherKp.publicKey.toBase58()}`) && /not this wallet: stopped/.test(r1.out) && !/making the coin's address/.test(r1.out) && !fs.existsSync(noKey), 'launch.mjs: a real CA in config.js with no key file is taken as the owner\'s, nothing ground', r1.out.slice(-300));

/* the owner's CA */
const mintKp = Keypair.generate();
const CA = mintKp.publicKey.toBase58();
const cfgFile = cfgOf('own', CA);
let out = '';
const p = spawn('node', L(cfgFile, CA), { cwd: progDir });
p.stdout.on('data', x => { out += x; }); p.stderr.on('data', x => { out += x; });
const done = new Promise(r => p.on('exit', c => r(c)));
for (let i = 0; i < 300 && !/waiting for .* to be created on pump\.fun/.test(out); i++) await sleep(1000);
const ask = new RegExp(`waiting for .* to be created on pump\\.fun.*create it NOW \\(a plain create: name ${NAME}, ticker ${TICKER}, no fee sharing\\)`);
ok(ask.test(out) && out.includes(CA) && out.includes(dev.publicKey.toBase58() + '…') && !/making the coin's address/.test(out), "launch.mjs: takes the CA given, makes no key, asks for the owner's create right away", out.slice(-300));
ok(fs.readFileSync(cfgFile, 'utf8').includes(`CA: "${CA}"`) && !fs.existsSync(noKey), 'launch.mjs: the CA kept in config.js, no mint key written');

await sleep(6000);
await plainCreate(dev, mintKp);

const code = await Promise.race([done, sleep(120000).then(() => 'timeout')]);
console.log(out.split('\n').map(l => '#   ' + l).join('\n'));
ok(code === 0, 'launch.mjs: finished after the create', `exit ${code}`);
ok((await coinOf()).equals(mintKp.publicKey), "set_roles: the owner's CA is the root coin");
ok(new RegExp(`\\$${TICKER} is on pump\\.fun`).test(out) && /creator fees 100% to the dev, no sharing/.test(out) && !/created on pump\.fun, creator fees/.test(out), "launch.mjs: saw the owner's create, created nothing itself");
ok(/LIVE:\s*true/.test(fs.readFileSync(cfgFile, 'utf8')), 'launch.mjs: LIVE: true in config.js');
{ const st = /START:\s*"(\d+)"/.exec(fs.readFileSync(cfgFile, 'utf8')); const now = await k.conn.getBlockTime(await k.conn.getSlot('confirmed')); ok(st && Math.abs(Number(st[1]) - now) < 900, `launch.mjs: START is the owner's create time, in config.js (${st && st[1]})`); }

const again = execFileSync('node', L(cfgFile, CA), { cwd: progDir, encoding: 'utf8' });
ok(/already set/.test(again) && !/waiting for .* pump\.fun/.test(again) && !/set_roles: a payer/.test(again), 'launch.mjs: a second run finds everything done', again.slice(-300));
ok(fs.readFileSync(cfgFile, 'utf8').includes(`PROGRAM: "${k.q.PID.toBase58()}"`), 'launch.mjs: config.js names the program');

for (const d of ['oc-own', 'oc-stranger']) fs.rmSync(path.join(run, d), { recursive: true, force: true });
fs.rmSync(devFile, { force: true });
fs.writeFileSync(path.join(run, 'own-ca.txt'), `${pass}/${total}`);
console.log(`pof own-ca ${pass}/${total}`);
process.exit(0);
