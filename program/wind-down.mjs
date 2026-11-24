/* Closing Proof of Funds, run with the dev wallet (the admin and upgrade authority of both programs). One run, at any moment, no
   waiting on anyone; a second run says nothing to do:
     1. close_begin: no certify or renew from now on (revocations still work)
     2. every certificate account expired at once (expire is open to anyone during the wind-down): each rent back to its payer
     3. every Room member evicted (their certificates are gone): each rent back to whoever paid it
     4. every Room released: each rent back to its creator
     5. withdraw_fees: the treasury's fees to the dev wallet
     6. close_config: the treasury's and the config's rent to the dev
     7. both programs closed through sol-ops (their rent back to the dev); --keep-programs skips this
   Nobody's money is held by POF: a certificate holds only its own rent, which goes back to the account that paid it.

     node program/wind-down.mjs --keypair ~/keys/pof-dev.json
     node program/wind-down.mjs --dry --as <dev pubkey>       what it would do, nothing sent
     --url http://127.0.0.1:50899 for the local chain (test/closing.mjs) */
import { web3, flag, has, home, sol, t, pickUrl, isLocal, loadKey, makeSender, solOps, connOf } from './ops.mjs';
import { makePof } from './js/pof.mjs';
const { PublicKey } = web3;

const DRY = has('dry');
const url = await pickUrl();
const LOCAL = isLocal(url);
const conn = connOf(url);
const q = makePof(web3);
const keyFile = home(flag('keypair', '~/keys/pof-dev.json'));
let signer = null, dev;
if (DRY) dev = new PublicKey(flag('as'));
else { try { signer = loadKey(keyFile); } catch { console.log('\n  could not read the dev key file (pass --keypair)\n'); process.exit(1); } dev = signer.publicKey; }
const send = makeSender(conn, dev, { local: LOCAL, dry: DRY, signer });
const start = DRY ? 0 : await conn.getBalance(dev, 'confirmed');
console.log(`\n  Proof of Funds wind-down · pof ${q.PID.toBase58()} · pof_gate ${q.GATE.toBase58()}\n  dev ${dev.toBase58()}${DRY ? ' (simulation)' : ''}${LOCAL ? ' · local' : ''}`);

const cfgInfo = await conn.getAccountInfo(q.K.config);
const cfg = cfgInfo ? q.P.decodeAccount('Config', cfgInfo.data) : null;
if (cfg && cfg.admin !== dev.toBase58()) { console.log(`  the admin is ${cfg.admin}, not this wallet: stopped\n`); process.exit(1); }
const list = async (prog, codec, name) => (await conn.getProgramAccounts(prog, { commitment: 'confirmed' }).catch(() => [])).map(x => { try { return { address: x.pubkey, ...codec.decodeAccount(name, x.account.data) }; } catch { return null; } }).filter(Boolean);
const run = async (ixs, label) => { try { return await send(ixs, label, { units: 200_000 }); } catch (e) { console.log('  ' + String(e.message).split('\n')[0]); throw e; } };

/* 1 */
if (cfg && !cfg.closing) await run([q.P.ix('close_begin', {}, { admin: dev })], 'close_begin: no certify or renew from now on');
else if (cfg) console.log('  close_begin: already winding down');
/* 2 */
if (cfg) {
  const certs = await list(q.PID, q.P, 'Certificate');
  if (certs.length) console.log(`  ${certs.length} certificate account(s) to close`);
  for (const c of certs) await run([q.P.ix('expire', {}, { caller: dev, certificate: c.address, payer: new PublicKey(c.payer) })], `expire ${c.address.toBase58().slice(0, 8)}… (${['live', 'revoked spent', 'revoked by holder'][c.status] || c.status}, tier ${c.tier}): rent back to ${c.payer.slice(0, 8)}…`);
}
/* 3, 4 */
const members = await list(q.GATE, q.G, 'Member');
for (const m of members) await run([q.G.ix('evict', {}, { caller: dev, room: new PublicKey(m.room), member: m.address, payer: new PublicKey(m.payer), certificate: new PublicKey(m.certificate) })], `evict member ${m.address.toBase58().slice(0, 8)}…: rent back to ${m.payer.slice(0, 8)}…`);
const rooms = await list(q.GATE, q.G, 'Room');
for (const r of rooms) await run([q.G.ix('release_room', {}, { caller: dev, room: r.address, creator: new PublicKey(r.creator), pof_config: q.K.config })], `release room ${r.address.toBase58().slice(0, 8)}…: rent back to its creator ${r.creator.slice(0, 8)}…`);
/* 5, 6 */
if (cfg) {
  const ti = await conn.getAccountInfo(q.K.treasury);
  const free = ti ? BigInt(ti.lamports) - BigInt(await conn.getMinimumBalanceForRentExemption(ti.data.length)) : 0n;
  if (free > 0n) await run([q.P.ix('withdraw_fees', { lamports: 0n }, { admin: dev, dev: new PublicKey(cfg.dev) })], `withdraw_fees: ${sol(free)} SOL to the dev wallet ${cfg.dev.slice(0, 8)}…`);
  await run([q.P.ix('close_config', {}, { admin: dev })], 'close_config: the treasury and the config closed, their rent to the dev');
}
if (!cfg && !members.length && !rooms.length) console.log('  no POF state on chain');
/* 7 */
if (!has('keep-programs')) {
  for (const name of ['pof_gate', 'pof']) {
    const id = name === 'pof' ? q.PID : q.GATE;
    const p = await conn.getAccountInfo(id);
    const pd = p ? await conn.getAccountInfo(new PublicKey(p.data.subarray(4, 36))) : null;
    if (!pd) { console.log(`  ${name}: not deployed (or already closed)`); continue; }
    if (DRY) { console.log(`  ${name}: would be closed by sol-ops, ${sol(pd.lamports)} SOL back`); continue; }
    console.log(`  ${t()}  sol-ops close ${name}…`);
    const r = solOps('close', name, keyFile, url);
    console.log(r.tail);
    if (r.status !== 0) { console.log(`  ${name} did not close: run the same command again\n`); process.exit(1); }
  }
}
if (!DRY) console.log(`\n  done · the dev ${dev.toBase58()} got back ${sol((await conn.getBalance(dev, 'confirmed')) - start)} SOL in this run\n`);
process.exit(0);
