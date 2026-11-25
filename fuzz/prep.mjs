// The fuzzer's genesis accounts (loaded with --account by fuzz/chain.sh), all made locally and deterministically (seed below):
// - Rings tree 0, its protocol config and SOL interface: the program suite's own read-only mainnet clones (pof/program/test/.run).
// - A synthetic nullifier tree: an indexed tree of height 40 (leaf = Poseidon(value, next)) with nullifiers at the first, a deep
//   and the very last leaf index, built with the SDK's Poseidon. Its root R1 and a later root R2 (one more leaf) are written into
//   the nullifier root history (offset 17,232) of FORGED tree accounts: FT (owned by the Privacy Program, discriminator 1: what
//   the program must accept), and look-alikes FT_disc0 (discriminator 0), FT_short (one byte short of the history), FT_sys
//   (owned by the system program).
// - Nullifier PDAs ["nullifier", tree, nf] owned by the Privacy Program as a spend leaves them (11 bytes, 0x08 ‖ u64 ‖ 0x0000):
//   under tree 0, under FT and under a Privacy Program account that is not a tree (the protocol config); and look-alikes at the
//   right addresses that must not count: first byte 7, 12 bytes, 10 bytes, owned by the system program, owned by the registry.
// Writes $SCRATCH/accounts/*.json and $SCRATCH/fixture.json. Run: node fuzz/prep.mjs
import fs from 'node:fs';
import path from 'node:path';
import { SCRATCH, PROG, PublicKey, Keypair, rng, poseidonReady, sparseTree, foldPath, u64le, loadIdl, builder } from './lib/core.mjs';

const H = await poseidonReady();
const R = rng(0x504f46_46555a5an);   // "POF FUZZ": the prep seed never changes
const SPP = new PublicKey('ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW');
const REGISTRY = new PublicKey('regy3WAeRXMYuMYxr5iK3Bf9Arr3PcxGxyzAddbiqDQ');
const SYS = new PublicKey('11111111111111111111111111111111');
const TREE0 = '777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor', PCONF = 'EienwBSpsbAetT3RAAMzVA9rB5RHgCF7yTH7FFST6AK5', SOLI = 'CiNmas621VuyofiDSrEPfTXHKrdZuB6jMKECyNiMpLXE';
const acc = path.join(SCRATCH, 'accounts');
fs.rmSync(acc, { recursive: true, force: true }); fs.mkdirSync(acc, { recursive: true });
const src = path.join(PROG, 'test/.run/accounts');
for (const k of [TREE0, PCONF, SOLI]) fs.copyFileSync(path.join(src, k + '.json'), path.join(acc, k + '.json'));
const tree0 = Buffer.from(JSON.parse(fs.readFileSync(path.join(acc, TREE0 + '.json'), 'utf8')).account.data[0], 'base64');
const write = (addr, data, owner, lamports = 2_000_000_000) => fs.writeFileSync(path.join(acc, addr.toBase58() + '.json'), JSON.stringify({ pubkey: addr.toBase58(), account: { lamports, data: [Buffer.from(data).toString('base64'), 'base64'], owner: owner.toBase58(), executable: false, rentEpoch: 0, space: data.length } }));
const nfPda = (tree, nf) => PublicKey.findProgramAddressSync([Buffer.from('nullifier'), new PublicKey(tree).toBuffer(), nf], SPP)[0];
const hex = b => Buffer.from(b).toString('hex');

/* the synthetic nullifier tree */
const LAST = (1n << 40n) - 1n;
const at = [0n, 1n, 2n, 3n, 77n, (1n << 39n) + 12345n, LAST];
const leaves = at.map(i => ({ index: i, value: R.field(), next: R.field() }));
const late = { index: 4242n, value: R.field(), next: R.field() };   // only in the later root R2
// R1: the low leaves (short paths, they fit a legacy-size transaction); R2: R1 plus one later leaf; R3: the two deep leaves alone
const deep = l => l.index >= (1n << 30n);
const lows = leaves.filter(l => !deep(l)), deeps = leaves.filter(deep);
const t1 = sparseTree(new Map(lows.map(l => [l.index, H(l.value, l.next)])));
const t2 = sparseTree(new Map([...lows, late].map(l => [l.index, H(l.value, l.next)])));
const t3 = sparseTree(new Map(deeps.map(l => [l.index, H(l.value, l.next)])));
const treeOf = l => deep(l) ? t3 : t1;
for (const l of leaves) if (!foldPath(l.value, l.next, l.index, treeOf(l).pathOf(l.index)).equals(treeOf(l).root)) throw Error('tree self-check');
const ft = Keypair.fromSeed(R.bytes(32)).publicKey, ft0 = Keypair.fromSeed(R.bytes(32)).publicKey, fts = Keypair.fromSeed(R.bytes(32)).publicKey, ftsys = Keypair.fromSeed(R.bytes(32)).publicKey;
const forged = Buffer.from(tree0);
forged.fill(0, 17232, 17232 + 3200);
t1.root.copy(forged, 17232 + 0 * 32);
t2.root.copy(forged, 17232 + 99 * 32);
t3.root.copy(forged, 17232 + 50 * 32);
write(ft, forged, SPP);
const d0 = Buffer.from(forged); d0[0] = 0; write(ft0, d0, SPP);
write(fts, forged.subarray(0, 17232 + 3200 - 1), SPP);
write(ftsys, forged, SYS);

/* nullifier PDAs */
const pdaData = q => { const d = Buffer.alloc(11); d[0] = 8; u64le(q).copy(d, 1); return d; };
const spent0 = Array.from({ length: 8 }, () => R.field());
spent0.forEach((nf, i) => write(nfPda(TREE0, nf), pdaData(990_000 + i), SPP, 706_120));
const spentFT = R.field(); write(nfPda(ft, spentFT), pdaData(1), SPP, 706_120);
const spentConf = R.field(); write(nfPda(PCONF, spentConf), pdaData(2), SPP, 706_120);
const look = [];
const lookAlike = (why, data, owner) => { const nf = R.field(); write(nfPda(TREE0, nf), data, owner, 706_120); look.push({ why, nf: hex(nf) }); };
{ const d = pdaData(3); d[0] = 7; lookAlike('first byte 7', d, SPP); }
lookAlike('12 bytes', Buffer.concat([pdaData(4), Buffer.alloc(1)]), SPP);
lookAlike('10 bytes', pdaData(5).subarray(0, 10), SPP);
lookAlike('owned by the system program', pdaData(6), SYS);
lookAlike('owned by the User Registry', pdaData(7), REGISTRY);

const fixture = {
  tree0: TREE0, protocolConfig: PCONF, ft: ft.toBase58(), ftDisc0: ft0.toBase58(), ftShort: fts.toBase58(), ftSys: ftsys.toBase58(),
  r1: hex(t1.root), r2: hex(t2.root), r3: hex(t3.root), zeros: t1.zeros.map(hex),
  leaves: leaves.map(l => ({ index: String(l.index), value: hex(l.value), next: hex(l.next), deep: deep(l), path: treeOf(l).pathOf(l.index).map(hex) })),
  late: { index: String(late.index), value: hex(late.value), next: hex(late.next), path: t2.pathOf(late.index).map(hex) },
  // a level-1 node presented as a leaf: value = left child hash, next = right child hash (leaves 0 and 1)
  internal: { value: hex(H(leaves[0].value, leaves[0].next)), next: hex(H(leaves[1].value, leaves[1].next)), path: t1.pathOf(0n).slice(1).map(hex) },
  spent0: spent0.map(hex), spentFT: hex(spentFT), spentConf: hex(spentConf), lookAlikes: look,
};
fs.writeFileSync(path.join(SCRATCH, 'fixture.json'), JSON.stringify(fixture, null, 1));
// since 187914b every spent proof names Rings tree 0 itself: the synthetic roots also go into OUR copy of tree 0 (three of its 100
// nullifier root slots, never the one the suite's real mainnet path hashes to), so membership paths can be tested against it
{
  const MF = JSON.parse(fs.readFileSync(path.join(PROG, 'test/fixtures/membership.json'), 'utf8'));
  const f = path.join(acc, TREE0 + '.json');
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  const d = Buffer.from(j.account.data[0], 'base64');
  const real = [...Array(100).keys()].find(i => d.subarray(17232 + i * 32, 17264 + i * 32).toString('hex') === MF.root);
  const slots = [0, 50, 99].map(i => i === real ? (i + 1) % 100 : i);
  [t1.root, t2.root, t3.root].forEach((r, k) => r.copy(d, 17232 + slots[k] * 32));
  j.account.data[0] = d.toString('base64');
  fs.writeFileSync(f, JSON.stringify(j));
  fixture.tree0Slots = slots;
  fs.writeFileSync(path.join(SCRATCH, 'fixture.json'), JSON.stringify(fixture, null, 1));
}

/* phase 2 (certify_zk): the zk agent's own fixture scenarios (pof/zk/test/fixtures.mjs, read-only), one ring owned by a key
   made from the prep seed. Their state roots go into our tree 0's state root history and their (shared) nullifier root becomes the
   NEWEST nullifier root (the cursor moves to a slot none of the other roots uses); one scenario's note gets a spent nullifier PDA. */
const ZKF = path.resolve(PROG, '../zk/test/fixtures.mjs');
if (fs.existsSync(ZKF)) {
  const F = await import(ZKF);
  const Z = await import(path.resolve(PROG, '../zk/js/zk.js'));
  const ringOwner = Keypair.fromSeed(R.bytes(32));
  const ownerKey = ringOwner.publicKey.toBytes();
  const SOL1 = 1_000_000_000n;
  const specs = { one: { amounts: [3n * SOL1], seed: 1n }, four: { amounts: [4n, 3n, 2n, 1n].map(x => x * SOL1), minAmount: 10n * SOL1, seed: 2n }, shared: { amounts: [20n * SOL1], seed: 3n }, spend: { amounts: [2n * SOL1], seed: 4n }, again: { amounts: [6n * SOL1], seed: 7n } };
  const S = {};
  for (const [k, v] of Object.entries(specs)) S[k] = await F.scenario({ ...v, ownerKey });
  const older = await F.scenario({ amounts: [5n * SOL1], seed: 8n, ownerKey, extraNullifiers: 2 });
  const f = path.join(acc, TREE0 + '.json');
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  const d = Buffer.from(j.account.data[0], 'base64');
  const roots = [...Object.values(S), older].map(x => Buffer.from(Z.be32(x.pub.stateRoot)));
  const len = d.readUInt16LE(114);
  roots.forEach((r, i) => r.copy(d, 1152 + ((i * 37) % len) * 32));
  const used = new Set(fixture.tree0Slots);
  const MF = JSON.parse(fs.readFileSync(path.join(PROG, 'test/fixtures/membership.json'), 'utf8'));
  for (let i = 0; i < 100; i++) if (d.subarray(17232 + i * 32, 17264 + i * 32).toString('hex') === MF.root) used.add(i);
  let newest = 20; while (used.has(newest) || used.has(newest - 1)) newest++;
  Buffer.from(Z.be32(older.pub.nullRoot)).copy(d, 17232 + (newest - 1) * 32);
  Buffer.from(Z.be32(S.one.pub.nullRoot)).copy(d, 17232 + newest * 32);
  d.writeBigUInt64LE(BigInt(newest + 1 + 100 * 7), 17224);   // cursor: newest = cursor - 1 (mod 100)
  j.account.data[0] = d.toString('base64');
  fs.writeFileSync(f, JSON.stringify(j));
  const spentNf = Buffer.from(Z.be32(Z.buildInputs(S.spend.P, S.spend).notes[0].nullifier));
  write(nfPda(TREE0, spentNf), pdaData(55_400), SPP, 706_120);
  fixture.zk = { ringOwner: Array.from(ringOwner.secretKey), specs: Object.fromEntries(Object.entries(specs).map(([k, v]) => [k, { ...v, amounts: v.amounts.map(String), minAmount: v.minAmount ? String(v.minAmount) : undefined, seed: String(v.seed) }])), older: { amounts: [String(5n * SOL1)], seed: '8', extraNullifiers: 2 }, newestNullSlot: newest, spentNf: hex(spentNf) };
  fs.writeFileSync(path.join(SCRATCH, 'fixture.json'), JSON.stringify(fixture, null, 1));
  console.log(`zk: ${Object.keys(S).length} scenarios + older, state roots in tree 0, newest nullifier root at slot ${newest}`);
}

/* POF's config and treasury at genesis (fuzz/chain.sh loads them unless FUZZ_BARE=1). init_config writes the launch parameters, and
   since POF-17 a lowered rotation delay is held for the old one (216,000 slots in a build whose launch delay is 216,000): the fuzzer
   starts from a config already at its own parameters instead, encoded with the snapshot IDL, so every field of the snapshot's
   Config layout is present. The genesis keys are test keys made from the prep seed (scratchpad only). */
{
  const { pof } = loadIdl();
  const P = builder(pof);
  const g = { V: Keypair.fromSeed(R.bytes(32)), V2: Keypair.fromSeed(R.bytes(32)), V3: Keypair.fromSeed(R.bytes(32)), relayer: Keypair.fromSeed(R.bytes(32)), dev: Keypair.fromSeed(R.bytes(32)) };
  fs.writeFileSync(path.join(SCRATCH, 'genesis-keys.json'), JSON.stringify(Object.fromEntries(Object.entries(g).map(([k, v]) => [k, Array.from(v.secretKey)]))));
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(SCRATCH, 'authority.json'), 'utf8')))).publicKey;
  const types = Object.fromEntries(pof.types.map(t => [t.name, t]));
  const zero = t => typeof t === 'string' ? (t === 'pubkey' ? PublicKey.default : t === 'bool' ? false : 0n) : t.array ? (t.array[0] === 'u8' ? Buffer.alloc(t.array[1]) : Array.from({ length: t.array[1] }, () => zero(t.array[0]))) : t.defined ? Object.fromEntries(types[t.defined.name].type.fields.map(f => [f.name, zero(f.type)])) : null;
  const [config, cb] = PublicKey.findProgramAddressSync([Buffer.from('config')], P.programId);
  const [treasury, tb] = PublicKey.findProgramAddressSync([Buffer.from('treasury')], P.programId);
  const c = zero({ defined: { name: 'Config' } });
  const S = 1_000_000_000n, U = 1_000_000n;
  Object.assign(c, { admin, dev: g.dev.publicKey, relayer: g.relayer.publicKey, verifier: g.V.publicKey, bump: cb, treasury_bump: tb,
    params: { fee_lamports: 10_000_000n, holder_min: 1_000_000n * 1_000_000n, validity_slots: 600n, max_attest_age: 150n, max_root_lag: 9_000n, rotation_delay: 40n } });
  c.assets[0] = { enabled: true, mint: PublicKey.default, decimals: 9, mins: [S, 10n * S, 100n * S, 1000n * S, 10000n * S] };
  c.assets[1] = { enabled: true, mint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), decimals: 6, mins: [100n * U, 1000n * U, 10000n * U, 100000n * U, 1000000n * U] };
  c.assets[2] = { enabled: true, mint: Keypair.fromSeed(R.bytes(32)).publicKey, decimals: 6, mins: [10n, 20n, 30n, 0n, 0n] };
  const t = zero({ defined: { name: 'Treasury' } }); t.bump = tb;
  const gdir = path.join(SCRATCH, 'accounts-genesis');
  fs.rmSync(gdir, { recursive: true, force: true }); fs.mkdirSync(gdir);
  for (const [addr, name, v] of [[config, 'Config', c], [treasury, 'Treasury', t]]) {
    const data = Buffer.concat([P.accDisc[name], P.codec.encode({ defined: { name } }, v)]);
    const lamports = (data.length + 128) * 6960;
    fs.writeFileSync(path.join(gdir, addr.toBase58() + '.json'), JSON.stringify({ pubkey: addr.toBase58(), account: { lamports, data: [data.toString('base64'), 'base64'], owner: P.programId.toBase58(), executable: false, rentEpoch: 0, space: data.length } }));
  }
  console.log(`genesis config: ${Object.keys(c).length} fields, verifier ${g.V.publicKey.toBase58().slice(0, 8)}…, rotation 40, validity 600`);
}
console.log(`prep: ${fs.readdirSync(acc).length} accounts · synthetic nullifier tree R1 ${fixture.r1.slice(0, 12)}… (${leaves.length} leaves, last index 2^40-1), R2 ${fixture.r2.slice(0, 12)}…`);
