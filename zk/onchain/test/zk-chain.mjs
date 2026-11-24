// certify_zk on a local validator: the patched pof program (onchain/apply.py over a copy of pof/program, quick build), a
// Rings tree 0 account whose root histories hold the test trees' roots, and one spent-nullifier PDA. Real Groth16 proofs from
// the development setup. Measures CU and transaction size. Run by onchain/test/run.sh (it copies this file into the copy's test/).
//   node test/zk-chain.mjs        (from the patched copy; POF_ZK = pof/zk)
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
const ZK = process.env.POF_ZK;
const snarkjs = await import(ZK + '/node_modules/snarkjs/main.js');
const Z = await import(ZK + '/js/zk.js');
const F = await import(ZK + '/test/fixtures.mjs');
const OUT = process.env.POF_ZK_OUT || '/Users/artem/Desktop/sol/scratchpad/pof-zk';
const PORT = Number(process.env.ZK_PORT || 46899);
process.env.RPC_URL = `http://127.0.0.1:${PORT}`;
const kit = await import('./kit.mjs');
const { web3, Keypair, PublicKey, subjectHash, SOL } = kit;
const here = path.dirname(new URL(import.meta.url).pathname);
const run = path.join(OUT, 'chain');
fs.rmSync(run, { recursive: true, force: true });
fs.mkdirSync(path.join(run, 'accounts'), { recursive: true });

let pass = 0, fail = 0;
const results = [];
async function check(name, f) {
  try { await f(); pass++; results.push(['ok', name]); console.log('ok  ', name); }
  catch (e) { fail++; results.push(['FAIL', name, e.message]); console.log('FAIL', name, '\n     ', e.message, (e.logs || []).slice(-6).join('\n      ')); }
}
const ok = (c, m) => { if (!c) throw Error(m || 'assertion'); };
async function refuses(p, re) { try { await p; } catch (e) { if (re.test(e.message)) return e; throw Error(`refused, but not with ${re}: ${e.message}`); } throw Error(`not refused (wanted ${re})`); }

// ------------------------------------------------------------------ the scenarios (their roots go into the tree account)
// the ring owner (the vault key): it signs register_zk_owner; every scenario's notes belong to it
const ringOwner = Keypair.generate();
const ownerKey = ringOwner.publicKey.toBytes();
const S = {
  one: await F.scenario({ amounts: [3n * SOL_(1)], seed: 1n, ownerKey }),
  four: await F.scenario({ amounts: [4n, 3n, 2n, 1n].map(x => x * SOL_(1)), minAmount: 10n * SOL_(1), seed: 2n, ownerKey }),
  shared: await F.scenario({ amounts: [20n * SOL_(1)], seed: 3n, ownerKey }),
  spend: await F.scenario({ amounts: [2n * SOL_(1)], seed: 4n, ownerKey }),
  usdc: await F.scenario({ amounts: [150_000_000n], mint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v').toBytes(), seed: 5n, ownerKey }),
  settle: await F.scenario({ amounts: [7n * SOL_(1)], seed: 6n, ownerKey }),
};
function SOL_(n) { return BigInt(n) * 1_000_000_000n; }
const unknown = await F.scenario({ amounts: [5n * SOL_(1)], seed: 9n, ownerKey }); // its roots stay out of the tree account
// ZK-01: the same kind of note proven against an OLDER nullifier root (one nullifier fewer): that root is in the tree's history
// but not the newest, so certify_zk must refuse it
const older = await F.scenario({ amounts: [5n * SOL_(1)], seed: 8n, ownerKey, extraNullifiers: 2 });
const TREE = new PublicKey('777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor');
const SPP = new PublicKey('ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW');
{
  const b = Buffer.alloc(40_080);
  b[0] = 1;
  const roots = [...Object.values(S), older].map(s => Z.be32(s.pub.stateRoot));
  const newest = Z.be32(S.one.pub.nullRoot);
  for (const s of Object.values(S)) ok(Buffer.from(Z.be32(s.pub.nullRoot)).equals(Buffer.from(newest)), 'scenarios share the newest nullifier root');
  const nulls = [Z.be32(older.pub.nullRoot), newest]; // older first, the newest at cursor - 1
  // some unrelated history first, ours at the end (cursor on the last)
  const hist = [...Array.from({ length: 20 }, (_, i) => Buffer.alloc(32, i + 1)), ...roots];
  hist.forEach((r, i) => Buffer.from(r).copy(b, 1152 + i * 32));
  b.writeUInt16LE(hist.length - 1, 112); b.writeUInt16LE(hist.length, 114); b.writeUInt16LE(500, 116);
  Buffer.from(roots[roots.length - 1]).copy(b, 80);
  b.writeBigUInt64LE(5n, 120);
  [...Array.from({ length: 10 }, (_, i) => Buffer.alloc(32, 0x40 + i)), ...nulls].forEach((r, i) => Buffer.from(r).copy(b, 17232 + i * 32));
  b.writeBigUInt64LE(BigInt(10 + nulls.length), 17224);
  fs.writeFileSync(path.join(run, 'accounts', TREE.toBase58() + '.json'), JSON.stringify({ pubkey: TREE.toBase58(), account: { lamports: 279_841_920, data: [b.toString('base64'), 'base64'], owner: SPP.toBase58(), executable: false, rentEpoch: 0, space: b.length } }));
}
// what a real spend of S.spend's note leaves on chain: the nullifier PDA (spent after the nullifier root it proves against)
const spentNf = Z.be32(Z.buildInputs(S.spend.P, S.spend).notes[0].nullifier);
{
  const pda = PublicKey.findProgramAddressSync([Buffer.from('nullifier'), TREE.toBuffer(), Buffer.from(spentNf)], SPP)[0];
  const d = Buffer.alloc(11); d[0] = 8; d.writeBigUInt64LE(55_400n, 1);
  fs.writeFileSync(path.join(run, 'accounts', pda.toBase58() + '.json'), JSON.stringify({ pubkey: pda.toBase58(), account: { lamports: 706_120, data: [d.toString('base64'), 'base64'], owner: SPP.toBase58(), executable: false, rentEpoch: 0, space: 11 } }));
}

// ------------------------------------------------------------------ the validator (own ports, own ledger; at most 3 on the machine)
const count = Number(spawnSync('zsh', ['-c', 'pgrep -x solana-test-validator | wc -l']).stdout.toString().trim());
if (count >= 3) { console.log(`${count} validators already run on this machine: not starting a fourth`); process.exit(2); }
const authority = Keypair.generate();
fs.writeFileSync(path.join(run, 'authority.json'), JSON.stringify([...authority.secretKey]));
const so = path.resolve(here, '../target/deploy/pof.so');
const args = ['--reset', '--quiet', '--ledger', path.join(run, 'ledger'), '--rpc-port', String(PORT), '--faucet-port', String(PORT + 1001), '--gossip-port', String(PORT - 899),
  '--dynamic-port-range', `${PORT - 799}-${PORT - 599}`, '--ticks-per-slot', '16', '--upgradeable-program', 'pofP4QRRDXnmDN9CNYiAGHfwMEgM7sLWhVcUMpsbynT', so, path.join(run, 'authority.json')];
for (const f of fs.readdirSync(path.join(run, 'accounts'))) args.push('--account', f.replace(/\.json$/, ''), path.join(run, 'accounts', f));
{
  const busy = spawnSync('zsh', ['-c', `lsof -nP -iTCP:${PORT} -iTCP:${PORT + 1} -iTCP:${PORT + 1001} -sTCP:LISTEN; lsof -nP -iUDP:${PORT - 899}`]).stdout.toString().trim();
  if (busy) { console.log(`ports of this suite are in use by something else: not starting\n${busy}`); process.exit(2); }
}
const val = spawn('solana-test-validator', args, { stdio: ['ignore', fs.openSync(path.join(run, 'validator.log'), 'w'), 'inherit'] });
let valExited = false;
val.on('exit', () => { valExited = true; });
const stop = () => { try { val.kill('SIGTERM'); } catch {} };
process.on('exit', stop);
const t = kit.setup(process.env.RPC_URL);
const { conn, q, send, fund, makeTable, slotNow, info } = t;
for (let i = 0; ; i++) {
  if (valExited) { console.log('our validator exited:', fs.readFileSync(path.join(run, 'validator.log'), 'utf8').slice(-400)); process.exit(1); }
  try { await conn.getSlot(); break; } catch { if (i > 120) { console.log('validator did not start'); process.exit(1); } await kit.sleep(1000); }
}
// it must be ours: our upgrade authority on the program
{
  const pd = await conn.getAccountInfo(new PublicKey('ETKHHhmbAD2AJbeDd961pDaet2Gnnv1DFg8x49ibbiHH'));
  if (!pd || !Buffer.from(pd.data.subarray(13, 45)).equals(authority.publicKey.toBuffer())) { console.log('the validator on this port is not ours'); process.exit(1); }
}

// ------------------------------------------------------------------ program setup
const admin = authority, relayer = Keypair.generate(), dev = Keypair.generate(), verifier = Keypair.generate();
const [w1, w2, w3, w4, w5, badge, badge2, payer] = Array.from({ length: 8 }, () => Keypair.generate());
await fund([admin, w1, w2, w3, w4, w5, badge, payer], 50);
const SETTLE = 20; // ZK_SETTLE_SLOTS of the quick build
await send([q.P.ix('init_config', { verifier: verifier.publicKey, relayer: relayer.publicKey, dev: dev.publicKey }, { admin: admin.publicKey })], [admin], 200_000);
const ZKP = q.pda([Buffer.from('zk')]);
const REG = q.pda([Buffer.from('zkreg')]);
const escrowKey = S.one.escrow; // every scenario shares the fixture's revocation key
const escrowArg = [Z.be32(escrowKey.public[0]), Z.be32(escrowKey.public[1])];
const table = await makeTable(admin, [q.K.config, q.K.treasury, ZKP, REG, TREE, web3.SystemProgram.programId]);
// the owner registry as the chain built it: leaves from the ZkOwnerRegistered events, in order
const regLeaves = [];
async function registerOwner(kp, secret) {
  const commitment = Z.be32(Z.ownerCommitment(S.one.P, secret));
  const sig = await send([q.P.ix('register_zk_owner', { commitment }, { owner: kp.publicKey })], [w1, kp], 200_000);
  const e = await t.ev(sig, 'ZkOwnerRegistered');
  regLeaves[Number(e.index)] = Z.toBig(e.leaf);
  const mine = registryNow().root();
  if (mine !== Z.toBig(e.root)) {
    const alt = (m) => { const tr = new F.Sparse(S.one.P, Z.REG_H); for (const [i, l] of m) tr.set(i, l); return tr.root(); };
    const l0 = regLeaves[0], l1 = regLeaves[1], chain = Z.toBig(e.root);
    const acc = await info(REG); const d = acc.data;
    console.log('DEBUG', { only1at0: alt([[0, l1]]) === chain, only1at1: alt([[1, l1]]) === chain, swapped: alt([[0, l1], [1, l0]]) === chain,
      filled0: d.subarray(16, 48).toString('hex'), l0: l0.toString(16), next: d.readBigUInt64LE(8) });
    throw Error(`registry root: chain ${Buffer.from(e.root).toString('hex')} js ${mine.toString(16)} (index ${e.index}, leaves ${regLeaves.length})`);
  }
  return e;
}
function registryNow() {
  const tree = new F.Sparse(S.one.P, Z.REG_H);
  regLeaves.forEach((l, i) => tree.set(i, l));
  return tree;
}
function withRegistry(s) {
  const tree = registryNow();
  const index = regLeaves.findIndex(l => l === Z.registryLeaf(s.P, Z.ownerId(s.P, ownerKey), s.ring.ownerSecret));
  if (index < 0) throw Error('the ring owner is not registered');
  return { ...s, registry: { root: tree.root(), index, path: tree.path(index) } };
}
const vkey = JSON.parse(fs.readFileSync(F.VKEY, 'utf8'));
const lockPda = tag => q.pda([Buffer.from('znote'), Buffer.from(tag)]);
const sizes = [], units = [];

/* a proof for `s` bound to (controller, payer, asset, tier, nonce), and its certify_zk instruction */
async function zkIx(s, { controller, payer: pay = controller, kind = 0, asset = 0, tier = 1, nonce = kit.rand(16), override = {}, proofFor = null, locks = null } = {}) {
  const subject = subjectHash(kind, controller.publicKey.toBase58());
  const bind = proofFor || { controller: controller.publicKey, payer: pay.publicKey, kind, asset, tier, nonce };
  const ctx = await Z.context({ programId: q.PID.toBytes(), subjectKind: bind.kind, subjectHash: subjectHash(bind.kind, bind.controller.toBase58()), asset: bind.asset, tier: bind.tier, controller: bind.controller.toBytes(), payer: bind.payer.toBytes(), nonce: bind.nonce });
  const minAmount = (await t.config()).assets[bind.asset].mins[bind.tier - 1];
  const sr = withRegistry(s);
  const b = Z.buildInputs(s.P, { ...sr, pub: { ...s.pub, ctx, minAmount } });
  const t0 = performance.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(b.input, F.WASM, F.ZKEY);
  const ms = performance.now() - t0;
  ok(await snarkjs.groth16.verify(vkey, publicSignals, proof), 'snarkjs verifies');
  const a = Z.certifyZkArgs(proof, publicSignals);
  const zargs = { subject_kind: kind, asset, tier, nonce, proof: a.proof, state_root: a.stateRoot, null_root: a.nullRoot, registry_root: a.registryRoot, eph: a.eph, tags: a.tags.slice(0, a.noteCount), cts: a.cts.slice(0, a.noteCount), ...override };
  const ix = q.P.ix('certify_zk', { args: zargs }, { payer: pay.publicKey, controller: controller.publicKey, certificate: q.certPda(subject, asset), holder_token: pay.publicKey, tree: TREE });
  for (const tag of locks || zargs.tags) ix.keys.push({ pubkey: lockPda(tag), isSigner: false, isWritable: true });
  return { ix, subject, zargs, b, ms, signers: pay === controller ? [pay] : [pay, controller] };
}
async function certifyZk(s, o = {}) {
  const z = await zkIx(s, o);
  await send([z.ix], z.signers, 400_000, [table]);
  sizes.push(send.last.size); units.push({ notes: z.zargs.tags.length, units: send.last.units, size: send.last.size, proveMs: Math.round(z.ms) });
  return z;
}
const cert = (h, asset = 0) => t.cert(h, asset);

await check('set_zk: admin only; the key must be on Baby Jubjub; turning on waits the rotation delay; turning off is immediate', async () => {
  await refuses(send([q.P.ix('set_zk', { enabled: true, escrow: escrowArg }, { admin: w1.publicKey })], [w1], 400_000), /NotAdmin|ConstraintHasOne|has one|ConstraintSeeds/i);
  await refuses(send([q.P.ix('set_zk', { enabled: true, escrow: [escrowArg[0], Z.be32(Z.toBig(escrowArg[1]) ^ 1n)] }, { admin: admin.publicKey })], [admin], 400_000), /ZkBadEscrowKey/);
  const sig = await send([q.P.ix('set_zk', { enabled: true, escrow: escrowArg }, { admin: admin.publicKey })], [admin], 600_000);
  units.push({ ix: 'set_zk', units: send.last.units });
  const e = await t.ev(sig, 'ZkConfigSet');
  await registerOwner(Keypair.generate(), 111n); // two other owners first: the registry is a shared anonymity set
  await registerOwner(Keypair.generate(), 222n);
  await registerOwner(ringOwner, S.one.ring.ownerSecret);
  units.push({ ix: 'register_zk_owner', units: send.last.units });
  await t.waitSlot(Number(e.takes_over_slot));
  const z = q.P.decodeAccount('ZkConfig', (await info(ZKP)).data);
  const vkHash = fs.readFileSync(path.join(ZK, 'onchain/src/vk.rs'), 'utf8').match(/VK_HASH = sha256\(.*\) = ([0-9a-f]{64})/)[1];
  ok(z.vk_hash.toString('hex') === vkHash, 'vk hash recorded');
  // a ready certify_zk, held back: off is immediate; on again waits the delay
  const held = await zkIx(S.one, { controller: w1 });
  await send([q.P.ix('set_zk', { enabled: false, escrow: escrowArg }, { admin: admin.publicKey })], [admin], 400_000);
  await refuses(send([held.ix], held.signers, 400_000, [table]), /ZkDisabled/);
  const e2 = await t.ev(await send([q.P.ix('set_zk', { enabled: true, escrow: escrowArg }, { admin: admin.publicKey })], [admin], 600_000), 'ZkConfigSet');
  ok((await slotNow()) < Number(e2.takes_over_slot), 'the delay is running');
  await refuses(send([held.ix], held.signers, 400_000, [table]), /ZkDisabled/);
  await t.waitSlot(Number(e2.takes_over_slot));
});

await check('certify_zk, one note, wallet subject: a live certificate whose verifier is the ZkConfig, tags stored, locks hold the escrow', async () => {
  const z = await certifyZk(S.one, { controller: w1, tier: 1 });
  const c = await cert(z.subject);
  ok(c.status === 0 && c.tier === 1 && c.note_count === 1 && c.verifier === ZKP.toBase58() && c.controller === w1.publicKey.toBase58(), JSON.stringify({ s: c.status, v: c.verifier }));
  ok(Buffer.from(c.null_hashes[0]).equals(Buffer.from(z.zargs.tags[0])), 'tag stored');
  const lock = q.P.decodeAccount('NoteLock', (await info(lockPda(z.zargs.tags[0]))).data);
  ok(lock.certificate === q.certPda(z.subject, 0).toBase58(), 'the lock names the certificate');
  // the keeper's side: the escrow opens from chain data alone, to the nullifier behind the tag
  const nf = Z.openEscrow(S.one.P, escrowKey.secret, [Z.toBig(lock.eph[0]), Z.toBig(lock.eph[1])], [Z.toBig(lock.ct), 0n, 0n, 0n], [Z.toBig(lock.tag), 0n, 0n, 0n])[0];
  ok(nf === z.b.notes[0].nullifier, 'escrow opens');
});

await check('certify_zk, four notes, tier 2 (10 SOL exactly), a badge subject signed by the badge key, relayed by another payer', async () => {
  const z = await certifyZk(S.four, { controller: badge, payer, kind: 2, tier: 2 });
  const c = await cert(z.subject);
  ok(c.status === 0 && c.tier === 2 && c.note_count === 4 && c.payer === payer.publicKey.toBase58() && c.subject_kind === 2);
});

await check('certify_zk, USDC tier 1 (150 USDC against 100), with its lock address pre-funded by someone (ZK-07)', async () => {
  const tag = Z.be32(Z.buildInputs(S.usdc.P, S.usdc).notes[0].tag);
  // the smallest balance the runtime lets a stranger leave at an empty address (rent-exempt for 0 bytes)
  const min0 = await conn.getMinimumBalanceForRentExemption(0);
  await send([web3.SystemProgram.transfer({ fromPubkey: w1.publicKey, toPubkey: lockPda(tag), lamports: min0 })], [w1], 0);
  const z = await certifyZk(S.usdc, { controller: w5, asset: 1, tier: 1 });
  ok(Buffer.from(z.zargs.tags[0]).equals(Buffer.from(tag)), 'the pre-funded tag');
  ok((await cert(z.subject, 1)).status === 0);
});

await check('wrong root: a state root the tree account does not hold, an older nullifier root (ZK-01), an unknown registry root', async () => {
  await refuses(certifyZk(unknown, { controller: w2 }), /ZkStateRootUnknown/);
  // a valid proof against the older nullifier root: the program takes only the newest one
  await refuses(certifyZk(older, { controller: w2 }), /ZkNullRootNotNewest/);
  const z = await zkIx(S.shared, { controller: w2, override: { null_root: Buffer.alloc(32, 7) } });
  await refuses(send([z.ix], z.signers, 400_000, [table]), /ZkNullRootNotNewest/);
  const zr = await zkIx(S.shared, { controller: w2, override: { registry_root: Buffer.alloc(32, 9) } });
  await refuses(send([zr.ix], zr.signers, 400_000, [table]), /ZkRegistryRootUnknown/);
});

await check('a higher tier than the proof reached: refused (the minimum is a public input the program sets)', async () => {
  const z = await zkIx(S.shared, { controller: w2, tier: 2, proofFor: { controller: w2.publicKey, payer: w2.publicKey, kind: 0, asset: 0, tier: 2, nonce: Buffer.alloc(16) } , nonce: Buffer.alloc(16) });
  await send([z.ix], z.signers, 400_000, [table]); // 20 SOL reaches tier 2: fine
  await send([q.P.ix('revoke_by_holder', {}, { controller: w2.publicKey, certificate: q.certPda(z.subject, 0) })], [w2], 200_000);
  await send([q.P.ix('release_note_lock', {}, { lock: lockPda(z.zargs.tags[0]), certificate: q.certPda(z.subject, 0), payer: w2.publicKey })], [w2], 200_000);
  // a proof made against the tier 1 minimum, submitted as tier 3: the program puts tier 3's minimum in, the pairing fails
  const z3 = await zkIx(S.shared, { controller: w2, tier: 3, proofFor: { controller: w2.publicKey, payer: w2.publicKey, kind: 0, asset: 0, tier: 1, nonce: Buffer.alloc(16) }, nonce: Buffer.alloc(16) });
  await refuses(send([z3.ix], z3.signers, 400_000, [table]), /ZkProofInvalid/);
});

await check('replay to another subject: a proof bound to wallet 3 submitted for wallet 4 (and with another payer or nonce) is refused', async () => {
  const nonce = kit.rand(16);
  const bound = { controller: w3.publicKey, payer: w3.publicKey, kind: 0, asset: 0, tier: 1, nonce };
  const other = await zkIx(S.shared, { controller: w4, proofFor: bound, nonce });
  await refuses(send([other.ix], other.signers, 400_000, [table]), /ZkProofInvalid/);
  const otherPayer = await zkIx(S.shared, { controller: w3, payer, proofFor: bound, nonce });
  await refuses(send([otherPayer.ix], otherPayer.signers, 400_000, [table]), /ZkProofInvalid/);
  const otherNonce = await zkIx(S.shared, { controller: w3, proofFor: bound, nonce: kit.rand(16) });
  await refuses(send([otherNonce.ix], otherNonce.signers, 400_000, [table]), /ZkProofInvalid/);
  const asX = await zkIx(S.shared, { controller: w3, nonce, kind: 1 });
  await refuses(send([asX.ix], asX.signers, 400_000, [table]), /ZkSubjectKind|BadSubjectKind|ConstraintSeeds/);
});

await check('malformed: a changed proof, a non-canonical tag (tag + r), unsorted or duplicate tags, missing or wrong locks', async () => {
  const z = await zkIx(S.four, { controller: w4, tier: 1 });
  const bad = Buffer.from(z.zargs.proof); bad[100] ^= 1;
  const zb = await zkIx(S.four, { controller: w4, tier: 1, override: { proof: bad } });
  await refuses(send([zb.ix], zb.signers, 400_000, [table]), /ZkProofInvalid/);
  // the largest tag + r: the same proof, other bytes, still ascending; refused as not canonical (else it would dodge the note lock)
  const last = Z.toBig(z.zargs.tags[3]);
  ok(last + Z.FIELD < 1n << 256n, 'r + tag fits in 32 bytes');
  const zn = await zkIx(S.four, { controller: w4, tier: 1, override: { tags: [...z.zargs.tags.slice(0, 3), Z.be32(last + Z.FIELD)] } });
  await refuses(send([zn.ix], zn.signers, 400_000, [table]), /ZkInputNotInField/);
  const rev = await zkIx(S.four, { controller: w4, tier: 1, override: { tags: [...z.zargs.tags].reverse(), cts: [...z.zargs.cts].reverse() } });
  await refuses(send([rev.ix], rev.signers, 400_000, [table]), /NullHashesUnsorted/);
  const dup = await zkIx(S.four, { controller: w4, tier: 1, override: { tags: [z.zargs.tags[0], z.zargs.tags[0]], cts: [z.zargs.cts[0], z.zargs.cts[0]] } });
  await refuses(send([dup.ix], dup.signers, 400_000, [table]), /NullHashesUnsorted/);
  const fewer = await zkIx(S.four, { controller: w4, tier: 1, locks: z.zargs.tags.slice(0, 3) });
  await refuses(send([fewer.ix], fewer.signers, 400_000, [table]), /ZkLockMissing/);
  const wrong = await zkIx(S.four, { controller: w4, tier: 1, locks: [z.zargs.tags[1], z.zargs.tags[0], z.zargs.tags[2], z.zargs.tags[3]] });
  await refuses(send([wrong.ix], wrong.signers, 400_000, [table]), /ZkLockMissing/);
  const mism = await zkIx(S.four, { controller: w4, tier: 1, override: { cts: z.zargs.cts.slice(0, 3) } });
  await refuses(send([mism.ix], mism.signers, 400_000, [table]), /BadNoteCount/);
});

await check('one note backs one live certificate: the same note for another wallet is refused until the first is revoked and its lock released', async () => {
  const a = await certifyZk(S.shared, { controller: w3 });
  await refuses(certifyZk(S.shared, { controller: w4 }), /ZkNoteLocked/);
  await refuses(send([q.P.ix('release_note_lock', {}, { lock: lockPda(a.zargs.tags[0]), certificate: q.certPda(a.subject, 0), payer: w3.publicKey })], [w4], 200_000), /ZkNoteStillLive/);
  await send([q.P.ix('revoke_by_holder', {}, { controller: w3.publicKey, certificate: q.certPda(a.subject, 0) })], [w3], 200_000);
  const before = await t.lam(w3.publicKey);
  await send([q.P.ix('release_note_lock', {}, { lock: lockPda(a.zargs.tags[0]), certificate: q.certPda(a.subject, 0), payer: w3.publicKey })], [w4], 200_000);
  ok((await t.lam(w3.publicKey)) > before, 'the lock rent went back to its payer');
  const b = await certifyZk(S.shared, { controller: w4 });
  ok((await cert(b.subject)).status === 0);
});

await check('revoke_spent on a zk certificate: the keeper opens the escrow from the lock, shows the nullifier, the PDA proves the spend', async () => {
  const z = await certifyZk(S.spend, { controller: w5 });
  const lock = q.P.decodeAccount('NoteLock', (await info(lockPda(z.zargs.tags[0]))).data);
  const nf = Z.openEscrow(S.spend.P, escrowKey.secret, [Z.toBig(lock.eph[0]), Z.toBig(lock.eph[1])], [Z.toBig(lock.ct), 0n, 0n, 0n], [Z.toBig(lock.tag), 0n, 0n, 0n])[0];
  ok(Buffer.from(Z.be32(nf)).equals(Buffer.from(spentNf)), 'the escrow gives the spent nullifier');
  const nfPda = q.nullifierPda(TREE, Z.be32(nf));
  // a wrong nullifier is refused (its tag differs)
  const other = Z.be32(nf + 1n);
  await refuses(send([q.P.ix('revoke_spent', { index: 0, salt: Buffer.alloc(32), nullifier: other, membership: null }, { caller: w1.publicKey, certificate: q.certPda(z.subject, 0), tree: TREE, nullifier_account: q.nullifierPda(TREE, other) })], [w1], 300_000), /NotSpent|NullifierMismatch/);
  await send([q.P.ix('revoke_spent', { index: 0, salt: Buffer.alloc(32), nullifier: Z.be32(nf), membership: null }, { caller: w1.publicKey, certificate: q.certPda(z.subject, 0), tree: TREE, nullifier_account: nfPda })], [w1], 300_000);
  const c = await cert(z.subject);
  ok(c.status === 1 && c.revealed_index === 0, 'revoked spent');
  await send([q.P.ix('release_note_lock', {}, { lock: lockPda(z.zargs.tags[0]), certificate: q.certPda(z.subject, 0), payer: w5.publicKey })], [w5], 200_000);
});

await check('settle window (ZK-02): a gate in the same transaction as certify_zk refuses; after the settle slots it passes', async () => {
  const z = await zkIx(S.settle, { controller: badge2, kind: 2, payer });
  const gateIx = q.P.ix('require_certificate', { subject_hash: z.subject, asset: 0, min_tier: 1 }, { certificate: q.certPda(z.subject, 0) });
  await refuses(send([z.ix, gateIx], z.signers, 600_000, [table]), /ZkSettling/);
  await send([z.ix], z.signers, 400_000, [table]);
  const c = await cert(z.subject);
  ok(Number(c.issued_slot) === Number(c.certified_slot) + SETTLE, `settles ${SETTLE} slots after certify`);
  await refuses(send([gateIx], [payer], 200_000), /ZkSettling/);
  await t.waitSlot(Number(c.issued_slot));
  await send([gateIx], [payer], 200_000);
});

await check('the CPI gate reads a settled zk certificate like any other (require_certificate)', async () => {
  const c0 = await cert(subjectHash(0, w1.publicKey.toBase58()));
  await t.waitSlot(Number(c0.issued_slot));
  const subject = subjectHash(0, w1.publicKey.toBase58());
  const sim = await conn.simulateTransaction((await t.build([q.P.ix('require_certificate', { subject_hash: subject, asset: 0, min_tier: 1 }, { certificate: q.certPda(subject, 0) })], [w1], 200_000)).tx, { sigVerify: false });
  ok(!sim.value.err, JSON.stringify(sim.value.err));
  const sim2 = await conn.simulateTransaction((await t.build([q.P.ix('require_certificate', { subject_hash: subject, asset: 0, min_tier: 2 }, { certificate: q.certPda(subject, 0) })], [w1], 200_000)).tx, { sigVerify: false });
  ok(sim2.value.err, 'tier 2 refused for a tier 1 certificate');
});

console.log(`\n${pass} passed, ${fail} failed`);
console.log('certify_zk measured:', JSON.stringify(units));
fs.writeFileSync(path.join(ZK, 'onchain/test/last-run.json'), JSON.stringify({ date: new Date().toISOString(), pass, fail, results, certify_zk: units }, null, 1));
stop();
process.exit(fail ? 1 : 0);
