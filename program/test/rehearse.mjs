// Launch day and a first session of Proof of Funds, rehearsed on a fresh chain with pump.fun and Helius Privacy Rings cloned and no
// program loaded, with the dev key as a BASE58 STRING file (the real key path): launch.mjs deploys both launch binaries through sol-ops,
// runs init_config(verifier, relayer, dev), writes the root coin's CA first, creates the coin with all its creator fees to the dev,
// writes START, sets the $ROOT holder rule, builds the site's lookup table and opens the site (LIVE); a second run finds everything
// done. Then day one through that lookup table: a payer certifies (the 0.01 SOL fee to the treasury), a $ROOT holder certifies free
// (a real pump.fun buy of 1,000,000+), the relayer certifies an X handle, a Room is made and joined through the require_certificate
// CPI, a disclosed note is spent and the certificate revoked by anyone, the member evicted; the dev withdraws the fees. wind-down.mjs
// then closes everything in one run from that live state, every rent back to whoever paid it.
// Run: zsh test/rehearse.sh
import fs from 'fs';
import path from 'path';
import { execFileSync, spawn } from 'child_process';
import { createRequire } from 'module';
import { setup, run, SOL, Keypair, PublicKey, P, web3, spl, keyOf, field } from './kit.mjs';
const m = createRequire(import.meta.url)('bs58'); const bs58 = m.default || m;

const RPC = 'http://127.0.0.1:50899';
const k = setup(RPC);
const { conn, q, send, lam } = k;
const here = path.dirname(new URL(import.meta.url).pathname);
const progDir = path.join(here, '..'), siteDir = path.join(progDir, '..');
let pass = 0, total = 0;
const ok = (cond, name, extra = '') => { total++; if (cond) { pass++; console.log('  ok   ' + name); } else console.log('  FAIL ' + name + (extra ? '  ' + String(extra).slice(0, 700) : '')); };
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...opts });

const dev = keyOf('authority');
const devFile = path.join(run, 'dev-b58.txt');
fs.writeFileSync(devFile, bs58.encode(dev.secretKey) + '\n', { mode: 0o600 });
ok(!fs.readFileSync(devFile, 'utf8').trim().startsWith('['), 'the dev key file for this rehearsal is a base58 string');
const V = Keypair.generate(), relayer = Keypair.generate();
const people = Array.from({ length: 6 }, () => Keypair.generate());
await k.fund([dev], 30);
await k.fund([relayer], 5);
await k.fund(people, 10);
const SPENT = JSON.parse(fs.readFileSync(path.join(run, 'spent.json'), 'utf8')).spent.map(h => Buffer.from(h, 'hex'));

/* the site's files on a local port (the coin's image must answer 200 before the create); until the art exists a stand-in coin.png */
const spare = path.join(run, 'spare');
fs.mkdirSync(spare, { recursive: true });
if (!fs.existsSync(path.join(siteDir, 'coin.png'))) fs.writeFileSync(path.join(spare, 'coin.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
const server = spawn('node', [path.join(here, 'static-site.mjs'), siteDir, spare], { stdio: ['ignore', 'pipe', 'inherit'] });
const port = await new Promise((res, rej) => { server.stdout.once('data', d => res(String(d).trim())); server.once('exit', () => rej(Error('static server died'))); });
const HOSTARG = ['--host', `http://127.0.0.1:${port}`];
const KEYS = ['--verifier', V.publicKey.toBase58(), '--relayer', relayer.publicKey.toBase58()];
process.on('exit', () => { try { server.kill(); } catch {} });

/* launch day: launch.mjs on a scratch copy of the site's config.js, from nothing */
const cfgFile = path.join(run, 'config.js');
fs.writeFileSync(cfgFile, fs.readFileSync(path.join(siteDir, 'config.js'), 'utf8').replace(/LIVE:\s*true/, 'LIVE: false').replace(/CA:\s*"[^"]*"/, 'CA: "SOON"').replace(/ALT:\s*"[^"]*"/, 'ALT: ""').replace(/START:\s*"[^"]*"/, 'START: ""'));
const NAME = /NAME:\s*"([^"]*)"/.exec(fs.readFileSync(cfgFile, 'utf8'))[1], TICKER = /TICKER:\s*"([^"]*)"/.exec(fs.readFileSync(cfgFile, 'utf8'))[1];
const mintFile = path.join(run, 'root-mint.json');
fs.rmSync(mintFile, { force: true });
let ROOT, table, spentLaunch = 0n;
try {
  const cfg0 = fs.readFileSync(cfgFile, 'utf8');
  const dry = sh('node', ['launch.mjs', '--dry', '--as', dev.publicKey.toBase58(), '--url', RPC, '--config', cfgFile, '--mint-key', mintFile, ...KEYS, ...HOSTARG], { cwd: progDir });
  ok(/pof_gate: would be deployed/.test(dry) && /pof: would be deployed/.test(dry) && /init_config.*would run/.test(dry) && /would be created/.test(dry) && fs.readFileSync(cfgFile, 'utf8') === cfg0 && !fs.existsSync(mintFile), 'launch.mjs --dry says what it would do and changes nothing', dry.slice(-600));
  const b0 = await lam(dev.publicKey);
  let out;
  try { out = sh('node', ['launch.mjs', '--keypair', devFile, '--url', RPC, '--config', cfgFile, '--mint-key', mintFile, '--grind-secs', process.env.GRIND_SECS || '15', ...KEYS, ...HOSTARG], { cwd: progDir, timeout: 1_200_000 }); }
  catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); throw Object.assign(Error('launch.mjs failed'), { stdout: out }); }
  spentLaunch = b0 - (await lam(dev.publicKey));
  console.log(out.split('\n').map(l => '#   ' + l).join('\n'));
  ok(!out.includes(bs58.encode(dev.secretKey)) && !out.includes(JSON.stringify(Array.from(dev.secretKey)).slice(1, 40)), 'launch.mjs never prints the dev key');
  const auth = async id => { const p = await conn.getAccountInfo(id); const pd = await conn.getAccountInfo(new PublicKey(p.data.subarray(4, 36))); return new PublicKey(pd.data.subarray(13, 45)); };
  ok((await auth(q.PID)).equals(dev.publicKey) && (await auth(q.GATE)).equals(dev.publicKey), 'both programs deployed through sol-ops, the dev their upgrade authority');
  const c = await k.config();
  ok(c && c.admin === dev.publicKey.toBase58() && c.dev === dev.publicKey.toBase58() && c.verifier === V.publicKey.toBase58() && c.relayer === relayer.publicKey.toBase58() && c.params.fee_lamports === 10_000_000n && c.params.validity_slots === 216_000n && c.params.rotation_delay === 216_000n, 'init_config: the Verifier and relayer public keys, fees to the dev, the launch parameters (0.01 SOL, validity 216,000 slots, rotation 216,000)');
  ROOT = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(mintFile, 'utf8')))).publicKey;
  const cfg = fs.readFileSync(cfgFile, 'utf8');
  ok(/the coin's image is live: https?:\/\/\S+\/coin\.png/.test(out) && out.indexOf("the coin's image is live") < out.indexOf('created on pump.fun'), "launch.mjs checks the coin's image answers 200 before the create");
  ok(cfg.includes(`CA: "${ROOT.toBase58()}"`) && cfg.includes(`GATE: "${q.GATE.toBase58()}"`) && out.indexOf('CA, PROGRAM, GATE written') >= 0 && out.indexOf('CA, PROGRAM, GATE written') < out.indexOf('created on pump.fun'), 'launch.mjs: the CA (and both program ids) written into the site before the coin exists', ROOT.toBase58());
  const st = /START:\s*"(\d+)"/.exec(cfg);
  const chainNow = await conn.getBlockTime(await conn.getSlot('confirmed'));
  ok(cfg.includes(`PROGRAM: "${q.PID.toBase58()}"`) && /LIVE:\s*true/.test(cfg) && /window\.POF\s*=/.test(cfg) && /X_URL/.test(cfg) && /DOMAIN/.test(cfg) && st && Math.abs(Number(st[1]) - chainNow) < 900, `launch.mjs: config.js keeps its keys; PROGRAM, START (${st && st[1]}) set; LIVE: true`);
  const meta = JSON.parse(fs.readFileSync(path.join(run, 'coin.json'), 'utf8'));
  ok(meta.name === NAME && meta.symbol === TICKER && meta.name.length <= 32, `launch.mjs: coin.json with NAME and TICKER from config.js (${NAME}, ${TICKER})`);
  const curve = await conn.getAccountInfo(P.bondingCurvePda(ROOT));
  ok(curve && new PublicKey(curve.data.subarray(49, 81)).equals(dev.publicKey), 'the root coin: a plain pump.fun create, its creator (100% of creator fees) is the dev');
  ok((await k.config()).root_mint === ROOT.toBase58(), 'set_roles: $' + TICKER + ' is the holder rule');
  const alt = /ALT:\s*"([^"]+)"/.exec(cfg);
  ok(alt && !!(table = (await conn.getAddressLookupTable(new PublicKey(alt[1]))).value) && table.state.addresses.length >= 14, `launch.mjs: the site's lookup table is built and stored in config.js (${table ? table.state.addresses.length : 0} accounts)`);
  const again = sh('node', ['launch.mjs', '--keypair', devFile, '--url', RPC, '--config', cfgFile, '--mint-key', mintFile, ...KEYS, ...HOSTARG], { cwd: progDir });
  ok(!/created on pump\.fun/.test(again) && !/set_roles: a payer/.test(again) && /already/.test(again) && !/sol-ops deploy/.test(again) && !/init_config:/.test(again), 'launch.mjs: a second run finds everything done', again.slice(-400));
} catch (e) { ok(false, 'launch.mjs', (e.stdout || '') + (e.stderr || e.message)); }

/* day one, through the site's lookup table */
const tables = table ? [table] : [];
k.root.mint = ROOT; k.root.tp = spl.TOKEN_2022_PROGRAM_ID;
const certify = async (payer, a) => send(k.certifyIxs(payer, a, { verifier: V }), [payer], 400_000, tables);
try {
  const [alice, whale, ctlX, creator, other] = people;
  const t0 = await lam(q.K.treasury);
  const n = k.notes(2, [SPENT[0], field()]);
  const a = await k.attestation({ kind: 0, controller: alice.publicKey, tier: 3, null_hashes: n.hashes, valid: 200_000 });
  await certify(alice, a);
  ok((await lam(q.K.treasury)) - t0 === 10_000_000n && (await k.cert(a.subject_hash)).tier === 3, 'a wallet certifies ≥ 100 SOL through the lookup table: the 0.01 SOL fee into the treasury');
  await k.curveBuy(ROOT, whale, 0.1 * SOL);
  const held = await k.tokenAt(q.ata(whale.publicKey, ROOT, spl.TOKEN_2022_PROGRAM_ID));
  const w = await k.attestation({ kind: 2, controller: Keypair.generate().publicKey, tier: 5, valid: 200_000 });
  const t1 = await lam(q.K.treasury);
  await certify(whale, w);
  ok(held >= 1_000_000_000_000n && (await lam(q.K.treasury)) === t1, `a payer holding ${(Number(held) / 1e6).toFixed(0)} $${TICKER} (a real pump.fun buy) certifies a badge with no fee`);
  const x = await k.attestation({ kind: 1, handle: 'someanon', controller: ctlX.publicKey, tier: 2, valid: 200_000 });
  const t2 = await lam(q.K.treasury);
  await certify(relayer, x);
  ok((await lam(q.K.treasury)) === t2 && (await k.cert(x.subject_hash)).payer === relayer.publicKey.toBase58(), 'the relayer certifies an X handle: no on-chain fee, the handle\'s own controller key');
  const room = q.roomPda(creator.publicKey, 1n), nm = Buffer.alloc(32); Buffer.from('100+ SOL').copy(nm);
  await send([q.G.ix('create_room', { id: 1n, asset: 0, min_tier: 3, name: nm }, { creator: creator.publicKey, room, pof_config: q.K.config })], [creator], 200_000, tables);
  await send([q.G.ix('join', { subject_hash: a.subject_hash }, { controller: alice.publicKey, payer: alice.publicKey, room, member: q.memberPda(room, a.subject_hash), certificate: q.certPda(a.subject_hash, 0), pof_config: q.K.config })], [alice], 300_000, tables);
  let low = '';
  try { await send([q.G.ix('join', { subject_hash: x.subject_hash }, { controller: ctlX.publicKey, payer: ctlX.publicKey, room, member: q.memberPda(room, x.subject_hash), certificate: q.certPda(x.subject_hash, 0), pof_config: q.K.config })], [ctlX], 300_000, tables); } catch (e) { low = e.why || ''; }
  ok((await k.decode('Room', room, true)).members === 1 && /below/.test(low), 'a Room for ≥ 100 SOL: the tier-3 wallet joins through the CPI, the tier-2 handle is refused', low);
  const spentNote = n.list.find(z => z.nf.equals(SPENT[0]));
  await send([q.P.ix('revoke_spent', { index: n.indexOf(SPENT[0]), salt: spentNote.salt, nullifier: SPENT[0], membership: null }, { caller: other.publicKey, certificate: q.certPda(a.subject_hash, 0), tree: q.K.TREE, nullifier_account: q.nullifierPda(q.K.TREE, SPENT[0]) })], [other], 200_000, tables);
  ok((await k.cert(a.subject_hash)).status === 1, 'one disclosed note is spent: a stranger revokes the certificate with its salt and nullifier');
  await send([q.G.ix('evict', {}, { caller: other.publicKey, room, member: q.memberPda(room, a.subject_hash), payer: alice.publicKey, certificate: q.certPda(a.subject_hash, 0), pof_config: q.K.config })], [other], 200_000, tables);
  ok((await k.decode('Room', room, true)).members === 0, 'and evicts it from the Room');
  const t = await k.treasury();
  ok(t.certified === 3n && t.live === 2n && t.revoked_spent === 1n && t.relayed === 1n && t.exempt === 1n, 'the counters: 3 certified, 2 live, 1 revoked spent, 1 relayed, 1 holder exempt');
  const d0 = await lam(dev.publicKey);
  await send([q.P.ix('withdraw_fees', { lamports: 0n }, { admin: dev.publicKey, dev: dev.publicKey })], [dev], 100_000, tables);
  ok((await lam(dev.publicKey)) - d0 === 10_000_000n - 5000n, 'withdraw_fees: the day\'s fee to the dev');
} catch (e) { ok(false, 'day one', e.message + (e.logs ? '\n' + e.logs.slice(-10).join('\n') : '')); }

/* wind-down in one run from that live state */
try {
  const owners = new Map();
  for (const x of await conn.getProgramAccounts(q.PID, { commitment: 'confirmed' })) { try { const c = q.P.decodeAccount('Certificate', x.account.data); owners.set(c.payer, (owners.get(c.payer) || 0n) + BigInt(x.account.lamports)); } catch {} }
  for (const x of await conn.getProgramAccounts(q.GATE, { commitment: 'confirmed' })) { try { const r = q.G.decodeAccount('Room', x.account.data); owners.set(r.creator, (owners.get(r.creator) || 0n) + BigInt(x.account.lamports)); } catch {} }
  const bal = {}; for (const s of owners.keys()) bal[s] = await lam(s);
  const out = sh('node', ['wind-down.mjs', '--keypair', devFile, '--url', RPC], { cwd: progDir, timeout: 600_000 });
  console.log(out.split('\n').map(l => '#   ' + l).join('\n'));
  ok(!(await k.config()) && !(await conn.getAccountInfo(q.K.programData)) && !(await conn.getAccountInfo(q.K.gateData)), 'wind-down in one run: certificates expired, room released, config closed, both programs closed');
  const bad = [];
  for (const [s, x] of owners) { const dd = (await lam(s)) - bal[s]; if (s !== dev.publicKey.toBase58() && dd !== x) bad.push(`${s.slice(0, 6)} ${dd} vs ${x}`); }
  ok(!bad.length, 'every payer and room creator got exactly its rent back', bad.join('; '));
} catch (x) { ok(false, 'wind-down', (x.stdout || '') + (x.stderr || x.message)); }

console.log(`\n  launch SOL on this chain (local rent, no priority fees): launch.mjs from nothing ${(Number(spentLaunch) / SOL).toFixed(4)}`);
fs.writeFileSync(path.join(run, 'rh-launch-cost.txt'), String(spentLaunch));
fs.rmSync(devFile, { force: true });
server.kill();
console.log(`\npof rehearsal ${pass}/${total}`);
fs.writeFileSync(path.join(run, 'rehearse.txt'), `${pass}/${total}`);
void web3;
process.exit(0);
