/* The Verifier's end-to-end on local validators with Privacy Rings cloned from mainnet (RINGS.md §8) and this build of pof:
     phase A: init_config → a vault ring registers and shields 2 SOL (the rings client) → an X-handle link → §4 → the Verifier
              (LocalRings, note locks, keeper, log) → the relayer certifies on chain → the keeper sees it live, nothing spent →
              anchor_log puts the log's signed head on chain
     phase B: the same chain state one spend later: a fresh validator loads the Config, the Treasury and the Certificate from A
              plus the nullifier PDA a real spend of that note leaves (11 bytes, 0x08 ‖ queue index ‖ 0000, owned by the Rings
              program); the keeper finds the spent nullifier and revoke_spent lands; the certificate shows revoked, spent.
   Local spends cannot be proven (they need the Helius prover against mainnet state), so the spend is the PDA it leaves, loaded
   at genesis of B: the program checks the same bytes either way.
   Run: node test/e2e/local-e2e.mjs   (needs lab/rings-local/.run from node lab/rings-local/prep.mjs, and the client's dist) */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const POF = path.resolve(here, '../../..');
const SCR = process.env.POF_E2E_DIR || '/Users/artem/Desktop/sol/scratchpad/pof-verifier/e2e';
const RUN = path.join(POF, 'lab/rings-local/.run');
const PORT = 37899, RPC = `http://127.0.0.1:${PORT}`;
const PROGRAM = 'pofP4QRRDXnmDN9CNYiAGHfwMEgM7sLWhVcUMpsbynT';
const SPP = 'ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW';
const TREE = '777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor';
fs.mkdirSync(SCR, { recursive: true });
const report = [];
const ok = (cond, what, extra = '') => { assert.ok(cond, what); report.push(`PASS ${what}${extra ? ' · ' + extra : ''}`); console.log(`  ✓ ${what}${extra ? ' · ' + extra : ''}`); };

const web3 = await import(path.join(POF, 'verifier/node_modules/@solana/web3.js/lib/index.esm.js')).catch(async () => (await import('@solana/web3.js')));
const { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram, LAMPORTS_PER_SOL } = web3;
const V = await import(path.join(POF, 'verifier/dist/pof-verifier.mjs'));
globalThis.isSecureContext ??= true;
const S = await import(path.join(POF, 'client/dist/spr.js'));
S.setHasherSource(fs.readFileSync(path.join(POF, 'client/dist/hasher-simd.wasm')));
const { createPofClient } = await import(path.join(POF, 'client/pof-client.js'));
const { LocalRings, jsonRpc } = await import(path.join(POF, 'client/localtree.js'));
const { nodeWallet } = await import(path.join(POF, 'client/test/node-wallet.mjs'));
const cloned = new Uint8Array(Buffer.from(fs.readFileSync(path.join(RUN, 'cloned-tree.b64'), 'utf8'), 'base64'));
const so = path.join(POF, 'program/target/deploy/pof.so');

/* ---------------------------------------------------------------- a validator of our own (ports 37899…, own ledger) */
let child = null;
async function startValidator(extraAccounts = []) {
  const n = Number(execSync('pgrep -x solana-test-validator | wc -l').toString().trim());
  if (n >= 3) throw new Error('3 validators already run on this machine: not starting');
  const authority = path.join(SCR, 'authority.json');
  if (!fs.existsSync(authority)) fs.writeFileSync(authority, JSON.stringify([...Keypair.generate().secretKey]), { mode: 0o600 });
  const args = ['--reset', '--quiet', '--ledger', path.join(SCR, 'ledger'), '--rpc-port', String(PORT), '--faucet-port', '38900', '--gossip-port', '37000', '--dynamic-port-range', '37100-37300', '--limit-ledger-size', '5000000'];
  const warp = path.join(RUN, 'warp-slot.txt');
  if (fs.existsSync(warp)) args.push('--warp-slot', fs.readFileSync(warp, 'utf8').trim());
  for (const f of fs.readdirSync(path.join(RUN, 'programs'))) args.push('--upgradeable-program', f.replace(/\.so$/, ''), path.join(RUN, 'programs', f), 'none');
  for (const f of fs.readdirSync(path.join(RUN, 'accounts'))) args.push('--account', f.replace(/\.json$/, ''), path.join(RUN, 'accounts', f));
  for (const f of extraAccounts) args.push('--account', JSON.parse(fs.readFileSync(f, 'utf8')).pubkey, f);
  args.push('--upgradeable-program', PROGRAM, so, authority);
  child = spawn('solana-test-validator', args, { stdio: ['ignore', fs.openSync(path.join(SCR, 'validator.log'), 'w'), 'inherit'] });
  for (let i = 0; i < 180; i++) {
    const up = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' }).then(r => r.ok).catch(() => false);
    if (up) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(authority, 'utf8'))));
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('validator did not start: ' + fs.readFileSync(path.join(SCR, 'validator.log'), 'utf8').slice(-800));
}
async function stopValidator() {
  if (!child) return;
  const p = child; child = null;
  p.kill('SIGTERM');
  await new Promise(r => { p.once('exit', r); setTimeout(() => { try { p.kill('SIGKILL'); } catch {} r(); }, 15000); });
}
process.on('exit', () => { try { child?.kill('SIGKILL'); } catch {} });

const conn = new Connection(RPC, 'confirmed');
async function airdrop(pk, sol) { const s = await conn.requestAirdrop(pk, sol * LAMPORTS_PER_SOL); await conn.confirmTransaction(s, 'confirmed'); }
async function dump(pubkey, file) {
  const a = await conn.getAccountInfo(new PublicKey(pubkey));
  fs.writeFileSync(file, JSON.stringify({ pubkey, account: { lamports: a.lamports, data: [Buffer.from(a.data).toString('base64'), 'base64'], owner: a.owner.toBase58(), executable: false, rentEpoch: 0, space: a.data.length } }));
  return file;
}

/* ---------------------------------------------------------------- the Verifier side, as on Vercel but over a folder */
const keys = { verifier: V.signerFromSeed(new Uint8Array(crypto.randomBytes(32))), relayer: V.signerFromSeed(new Uint8Array(crypto.randomBytes(32))) };
const sealKey = new Uint8Array(crypto.randomBytes(32));
const store = new V.FsStore(fs.mkdtempSync(path.join(os.tmpdir(), 'pof-e2e-store-')));
const programId = V.fromB58(PROGRAM, 32, 'program');

try {
  console.log('phase A: certify');
  const admin = await startValidator();
  await airdrop(admin.publicKey, 10); await airdrop(new PublicKey(keys.relayer.address), 10);
  // init_config(verifier, relayer, dev) by the upgrade authority
  const PID = new PublicKey(PROGRAM);
  const pda = (s, p = PID) => PublicKey.findProgramAddressSync(s.map(x => Buffer.from(x)), p)[0];
  const CONFIG = pda(['config']), TREASURY = pda(['treasury']);
  const programData = pda([PID.toBuffer()], new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'));
  const init = new TransactionInstruction({ programId: PID, data: V.ixData('init_config', { verifier: keys.verifier.publicKey, relayer: keys.relayer.publicKey, dev: admin.publicKey.toBytes() }), keys: [
    { pubkey: admin.publicKey, isSigner: true, isWritable: true }, { pubkey: CONFIG, isSigner: false, isWritable: true }, { pubkey: TREASURY, isSigner: false, isWritable: true },
    { pubkey: programData, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }] });
  await web3.sendAndConfirmTransaction(conn, new Transaction().add(init), [admin], { commitment: 'confirmed' });
  const cfg = V.decodeAccount('Config', (await conn.getAccountInfo(CONFIG)).data);
  ok(cfg.verifier === keys.verifier.address && cfg.relayer === keys.relayer.address, 'init_config: the Verifier and relayer keys are in Config', `validity ${cfg.params.validity_slots} slots, max attest age ${cfg.params.max_attest_age}`);

  // the holder: a vault ring, registered, 2 SOL shielded (the rings client, unchanged)
  const W = nodeWallet(RPC); await W.airdrop(20);
  const pof = await createPofClient({ network: 'local', rpc: [RPC], wallet: W, storage: new Map(), programId: PROGRAM, minAgeSlots: 0, clonedTree: cloned });
  await pof.ready();
  const vault = await pof.deriveVault();
  await pof.register('vault');
  const dep = await pof.shield({ asset: 0, amount: '2', into: 'vault' });
  const notes = await pof.notes({ from: 'vault' });
  ok(notes.length === 1 && notes[0].amount === 2_000_000_000n, 'a vault ring registered and shielded 2 SOL on the clone', `deposit ${dep.signature.slice(0, 12)}…, leaf ${notes[0].leafIndex}`);

  // the services over the local chain
  const rings = new LocalRings(jsonRpc(RPC), { cloned });
  const chain = await V.makeProgramChain({ web3, rpcUrl: RPC, programId: PROGRAM, relayer: keys.relayer, verifier: keys.verifier, rings });
  const log = new V.TransparencyLog(store, keys.verifier, programId);
  const keeper = new V.Keeper(store, sealKey, rings, chain);
  const locks = new V.NoteLocks(store, V.sha256(sealKey), 300n, chain);
  const verifier = new V.Verifier({ programId, minAgeSlots: 2n, validitySlots: BigInt(cfg.params.validity_slots), subjectProofSlots: 1500n, maxRootAgeSlots: 150n, maxRootLagSlots: BigInt(cfg.params.max_root_lag), relayer: keys.relayer.address, mints: { 0: V.ASSETS[0].mint, 1: V.ASSETS[1].mint }, bundleHash: V.bundleHash() }, keys.verifier, rings, log, keeper, locks);
  const relayer = new V.Relayer({ address: keys.relayer.address, verifierKey: keys.verifier.publicKey, programId, dailyCapLamports: 2_000_000_000n, balanceFloorLamports: 50_000_000n, quoteTtlSec: 1800, free: true, hmacKey: V.sha256(sealKey, Uint8Array.of(1)) }, store, chain, log);

  // an X handle linked (the link id is what /api/link/check returns), then the package the client builds
  // the link id /api/link/check gives (bound to the vault's controller for this handle; the linker's own flow is unit-tested)
  const ctlOf = async (h) => (await pof.subject({ kind: 1, value: h, asset: 0, tier: 1, payer: keys.relayer.address, from: 'vault', linkId: 'x' })).controller;
  const linkId = verifier.linkToken('e2e_anon', Math.floor(Date.now() / 1000) + 600, await ctlOf('e2e_anon'));
  for (let i = 0; i < 20 && (await conn.getSlot('confirmed')) < Number(notes[0].slot ?? 0) + 3; i++) await new Promise(r => setTimeout(r, 400));
  await new Promise(r => setTimeout(r, 1500));
  const pick = await pof.choose({ asset: 0, tier: 1, from: 'vault', list: notes });
  const subj = await pof.subject({ kind: 1, value: '@E2E_Anon', asset: 0, tier: 1, payer: keys.relayer.address, from: 'vault', linkId });
  const pkg = JSON.parse(JSON.stringify(pof.disclose({ subject: subj, asset: 0, tier: 1, notes: pick.notes, payer: keys.relayer.address, relay: true, from: 'vault' })));
  const ans = await verifier.attest(pkg);
  const att = V.decodeAttestation(Buffer.from(ans.attestation, 'hex'));
  ok(ans.attestation.length === 480 && att.subjectKind === 1 && V.toB58(att.payer) === keys.relayer.address, 'the Verifier signed a 240-byte attestation for @e2e_anon, payer = the relayer', `log index ${ans.logIndex}, controller ${ans.controller.slice(0, 8)}…`);

  // the relayer certifies on chain
  const rel = await relayer.certify({ attestation: ans.attestation, signature: ans.signature, logIndex: ans.logIndex, hashes: ans.hashes });
  const cert = await chain.certificate(att.subjectHash, 0);
  ok(cert && cert.status === 0 && cert.tier === 1 && JSON.stringify(cert.hashes) === JSON.stringify(ans.hashes), 'certify landed through the relayer: the certificate is live, tier 1, with the salted hashes', `tx ${rel.signature.slice(0, 12)}…, ${cert.address}`);
  const raw = V.decodeAccount('Certificate', (await conn.getAccountInfo(new PublicKey(cert.address))).data);
  ok(raw.controller === ans.controller && BigInt(raw.log_index) === BigInt(ans.logIndex), 'the certificate carries the controller key and the log index');

  // the keeper: live, nothing spent
  let rep = await keeper.scan();
  ok(rep.live === 1 && rep.revoked.length === 0, 'the keeper holds the sealed kit and sees the certificate live, nothing spent');

  // the same note cannot back a second handle
  const link2 = verifier.linkToken('second_anon', Math.floor(Date.now() / 1000) + 600, await ctlOf('second_anon'));
  const subj2 = await pof.subject({ kind: 1, value: 'second_anon', asset: 0, tier: 1, payer: keys.relayer.address, from: 'vault', linkId: link2 });
  await assert.rejects(verifier.attest(JSON.parse(JSON.stringify(pof.disclose({ subject: subj2, asset: 0, tier: 1, notes: pick.notes, payer: keys.relayer.address, relay: true, from: 'vault' })))), e => e.code === 'NOTE_IN_USE');
  ok(true, 'the same note is refused for a second handle (NOTE_IN_USE)');

  // the log head anchored on chain
  const head = await log.head();
  await chain.anchorLog(head.treeSize, Buffer.from(head.rootHash, 'hex'));
  const tr = await chain.treasury();
  ok(Number(tr.log_size) === head.treeSize && Buffer.from(tr.log_head).toString('hex') === head.rootHash, 'anchor_log: the treasury holds the signed log head', `size ${head.treeSize}`);
  const proof = await log.proof(ans.logIndex);
  const entry = await log.entry(ans.logIndex);
  ok(V.merkle.verifyInclusion(Buffer.from(entry.leafHash, 'hex'), proof.index, proof.treeSize, proof.path.map(x => Buffer.from(x, 'hex')), Buffer.from(tr.log_head)) && entry.attestation === ans.attestation, 'the attestation is provably in the anchored log (RFC 9162 inclusion against the on-chain head)');

  // carry the state to B
  const nf = Buffer.from(ans.nullifiers[0], 'hex');
  const files = [await dump(CONFIG.toBase58(), path.join(SCR, 'config.json')), await dump(TREASURY.toBase58(), path.join(SCR, 'treasury.json')), await dump(cert.address, path.join(SCR, 'certificate.json'))];
  const nfPda = PublicKey.findProgramAddressSync([Buffer.from('nullifier'), new PublicKey(TREE).toBuffer(), nf], new PublicKey(SPP))[0];
  const spentData = Buffer.alloc(11); spentData[0] = 8; spentData.writeBigUInt64LE(55_400n, 1);
  fs.writeFileSync(path.join(SCR, 'spent.json'), JSON.stringify({ pubkey: nfPda.toBase58(), account: { lamports: 706_120, data: [spentData.toString('base64'), 'base64'], owner: SPP, executable: false, rentEpoch: 0, space: 11 } }));
  files.push(path.join(SCR, 'spent.json'));
  await stopValidator();

  console.log('phase B: the note is spent');
  await startValidator(files);
  await airdrop(new PublicKey(keys.relayer.address), 2);
  const ringsB = new LocalRings(jsonRpc(RPC), { cloned });
  const chainB = await V.makeProgramChain({ web3, rpcUrl: RPC, programId: PROGRAM, relayer: keys.relayer, verifier: keys.verifier, rings: ringsB });
  const keeperB = new V.Keeper(store, sealKey, ringsB, chainB);
  const before = await chainB.certificate(att.subjectHash, 0);
  ok(before.status === 0, 'on B the certificate is still live before the keeper runs');
  rep = await keeperB.scan();
  ok(rep.revoked.length === 1 && rep.errors.length === 0, 'the keeper found the spent nullifier and called revoke_spent', `tx ${rep.revoked[0]?.signature.slice(0, 12)}…, index ${rep.revoked[0]?.index}`);
  const after = V.decodeAccount('Certificate', (await conn.getAccountInfo(new PublicKey(cert.address))).data);
  ok(after.status === 1 && Buffer.from(after.revealed_nullifier).toString('hex') === ans.nullifiers[0] && Buffer.from(after.revealed_salt).toString('hex') === ans.salts[0], 'the certificate reads revoked (spent), with the salt and nullifier now public', `revoked at slot ${after.revoked_slot}`);
  ok((await keeperB.names()).length === 0, 'the keeper dropped the kit after the revoke');
  // a holder with the kit could have done the same without us: revoke_spent is permissionless (the program checks the PDA)
  await stopValidator();
  fs.writeFileSync(path.join(SCR, 'e2e-report.txt'), report.join('\n') + '\n');
  console.log(`\nall ${report.length} checks passed`);
  process.exit(0); // web3's websocket keeps reconnecting to the stopped node otherwise
} catch (e) {
  console.error('FAILED:', e?.message || e, e?.details ? JSON.stringify(e.details) : '');
  await stopValidator();
  process.exit(1);
}
