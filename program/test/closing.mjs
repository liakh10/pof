// The wind-down on the suite's live state (zsh test/all.sh runs it after test.mjs, on the same chain): wind-down.mjs itself, with the
// test upgrade authority as the dev. Before: every certificate, member and room and who paid its rent. After: POF and pof_gate own no
// account, each payer got exactly its rents back, the dev got the fees and the config rent, both programs are closed; a second run
// finds nothing to do. Writes .run/result-closing.txt.
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { setup, PublicKey, run, keyOf, web3 } from './kit.mjs';

const k = setup();
const { conn, q } = k;
let passed = 0, total = 0;
const check = async (name, fn) => { total++; try { await fn(); passed++; console.log('  ok   ' + name); } catch (e) { console.log('  FAIL ' + name + '\n       ' + String(e.message || e).slice(0, 600)); } };
const eq = (a, b, w = '') => { if (String(a) !== String(b)) throw Error(`${w} expected ${b}, got ${a}`); };
const admin = keyOf('authority');
const owned = async prog => (await conn.getProgramAccounts(prog, { commitment: 'confirmed' })).map(x => ({ address: x.pubkey, lamports: BigInt(x.account.lamports), data: x.account.data }));
const decodeAll = (list, codec, name) => list.map(x => { try { return { ...x, ...codec.decodeAccount(name, x.data) }; } catch { return null; } }).filter(Boolean);
const wind = () => spawnSync('node', ['wind-down.mjs', '--url', k.conn.rpcEndpoint, '--keypair', path.join(run, 'authority.json')], { cwd: path.resolve(run, '../..'), encoding: 'utf8', timeout: 600_000 });

const pofAccs = await owned(q.PID), gateAccs = await owned(q.GATE);
const certs = decodeAll(pofAccs, q.P, 'Certificate'), members = decodeAll(gateAccs, q.G, 'Member'), rooms = decodeAll(gateAccs, q.G, 'Room');
const cfg = await k.config();
const owed = new Map();
const owe = (who, l) => owed.set(who, (owed.get(who) || 0n) + l);
for (const c of certs) owe(c.payer, c.lamports);
for (const m of members) owe(m.payer, m.lamports);
for (const r of rooms) owe(r.creator, r.lamports);
for (const b of decodeAll(pofAccs, q.P, 'PathBuffer')) owe(b.revoker, b.lamports);
const before = new Map();
for (const w of owed.keys()) before.set(w, BigInt(await conn.getBalance(new PublicKey(w), 'confirmed')));
const ti = await k.info(q.K.treasury), ci = await k.info(q.K.config);
const fees = BigInt(ti.lamports) - await k.rentOf(ti.data.length);
const dev0 = BigInt(await conn.getBalance(new PublicKey(cfg.dev), 'confirmed'));
const progRent = BigInt((await k.info(q.K.programData)).lamports) + BigInt((await k.info(q.K.gateData)).lamports);
console.log(`  live state: ${certs.length} certificates (${certs.filter(c => c.status === 0).length} live), ${members.length} members, ${rooms.length} rooms, ${owed.size} payers, fees ${fees}`);

await check('the live state is there to wind down (certificates live and revoked, a room with a member, fees in the treasury)', async () => {
  if (!(certs.some(c => c.status === 0) && certs.some(c => c.status !== 0) && members.length && rooms.length && fees > 0n)) throw Error('not enough state');
});
const a0 = BigInt(await conn.getBalance(admin.publicKey, 'confirmed'));
const r1 = wind();
console.log((r1.stdout + r1.stderr).split('\n').filter(l => l.trim()).map(l => '    | ' + l.trim()).slice(-14).join('\n'));
await check('wind-down.mjs ran through', async () => { eq(r1.status, 0, 'exit'); });
await check('POF and pof_gate own no account any more', async () => {
  eq((await owned(q.PID)).length, 0, 'pof accounts'); eq((await owned(q.GATE)).length, 0, 'pof_gate accounts');
});
await check('every payer got exactly its rents back (certificates to their payers, members to theirs, rooms to their creators)', async () => {
  for (const [w, l] of owed) {
    if (w === admin.publicKey.toBase58() || w === cfg.dev) continue;
    eq(BigInt(await conn.getBalance(new PublicKey(w), 'confirmed')) - before.get(w), l, `payer ${w.slice(0, 8)}`);
  }
});
await check('the dev wallet got every fee; the admin got the config and treasury rent and both programs\' rent (less its fees)', async () => {
  eq(BigInt(await conn.getBalance(new PublicKey(cfg.dev), 'confirmed')) - dev0, fees, 'fees to the dev');
  const back = BigInt(await conn.getBalance(admin.publicKey, 'confirmed')) - a0;
  const want = BigInt(ci.lamports) + (await k.rentOf(ti.data.length)) + progRent;
  if (back > want || back < want - 200_000n) throw Error(`admin got ${back}, want about ${want} less fees`);
});
await check('both programs are closed', async () => {
  for (const pd of [q.K.programData, q.K.gateData]) if (await k.exists(pd)) throw Error('program data still there: ' + pd.toBase58());
});
await check('a second run finds nothing to do', async () => {
  const r2 = wind();
  eq(r2.status, 0, 'exit');
  if (!/no POF state on chain/.test(r2.stdout)) throw Error(r2.stdout.slice(-400));
});
fs.writeFileSync(path.join(run, 'result-closing.txt'), `${passed}/${total}\n`);
console.log(`\n  closing ${passed}/${total}`);
process.exit(0);
