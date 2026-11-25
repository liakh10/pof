/* Phase 2 end to end on a local validator: the zk build of pof (--features zk,quick: settle window 20 slots), Privacy Rings
   cloned from mainnet with a FRESH tree account (read-only mainnet read), the client's zk flow (client/zk-flow.js) over the
   real client (client/pof-client.js), and the Verifier's keeper (verifier/dist). Nullifier non-inclusion paths come from the
   Helius Rings indexer on mainnet (read-only): the clone's newest nullifier root is mainnet's, and the test checks they agree.
     launch gate: no ZkConfig → ZK_OFF; set_zk waits the rotation delay → still ZK_OFF
     register_zk_owner (paid, one per owner) → shield 9 deposits → certify_zk proven in Node (1 note, wallet subject)
     → settling: require_certificate refused (ZkSettling) → settle → gate passes
     → the note's spend (its nullifier PDA, preloaded at genesis: RINGS §8.3) → keeper scanZk revokes with the NoteLock
     → gate refused → remake refused (client: lock spent; program: Replayed with the same nonce, ZkNoteLocked with a new one)
     → a badge certificate proven in headless Chrome → holder revoke + lock release (rent back)
     → the wallet subject remade from 3 notes (default pick skips the spent note; legacy tx) → a 4-note badge over a lookup table
   Needs: the zk build (zsh zk/onchain/test/run.sh leaves it in $POF_ZK_OUT/program/target/deploy/pof.so, or POF_ZK_SO),
   lab/rings-local/.run (node lab/rings-local/prep.mjs), a Helius key in ~/.config/helius/site_keys, Chrome.
   Ports 44899 (RPC), 45900 (faucet), 44000 (gossip), 44100-44300. At most 3 validators on the machine.
   Run: node lab/test/zk-e2e.mjs          results: lab/test/zk-e2e.json */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const POF = path.resolve(new URL('../..', import.meta.url).pathname);
const SCRATCH = process.env.POF_SCRATCH || '/private/tmp/claude-501/-Users-artem-Desktop-sol/be802bf9-e299-4d83-b38b-bc795e5cbb1e/scratchpad/pof-zkint';
const SO = process.env.POF_ZK_SO || path.join(SCRATCH, 'zkrun/program/target/deploy/pof.so');
const RUN = path.join(SCRATCH, 'lab');
const PORT = 44899, RPC = `http://127.0.0.1:${PORT}`;
const PROGRAM = 'pofP4QRRDXnmDN9CNYiAGHfwMEgM7sLWhVcUMpsbynT';
const TREE = '777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor';
const scrub = s => String(s).replace(/api-key=[^&\s"']+/g, 'api-key=…');

let pass = 0, fail = 0; const results = [], numbers = {};
const ok = (c, name, extra = '') => { if (c) { pass++; results.push(['ok', name]); console.log('  ok   ' + name); } else { fail++; results.push(['FAIL', name, scrub(extra)]); console.log('  FAIL ' + name + (extra ? '  ' + scrub(extra).slice(0, 500) : '')); } };
async function refuses(p, re) { try { await p; return `not refused (wanted ${re})`; } catch (e) { const m = (e.code || '') + ' ' + e.message + ' ' + (e.logs || e.data?.logs || []).join(' '); return re.test(m) ? true : `refused with ${scrub(m).slice(0, 300)}`; } }

if (!fs.existsSync(SO)) { console.log('no zk build at ' + SO + ' (zsh zk/onchain/test/run.sh)'); process.exit(2); }
const nVal = Number(spawnSync('zsh', ['-c', 'pgrep -x solana-test-validator | wc -l']).stdout.toString().trim());
if (nVal >= 3) { console.log(`${nVal} validators already run on this machine: not starting a fourth`); process.exit(2); }
const busy = spawnSync('zsh', ['-c', `lsof -nP -iTCP:${PORT} -iTCP:${PORT + 1} -iTCP:45900 -sTCP:LISTEN`]).stdout.toString().trim();
if (busy) { console.log('the ports of this test are in use:\n' + busy); process.exit(2); }

const web3 = createRequire(path.join(POF, 'client/package.json'))('@solana/web3.js');
const { Keypair, PublicKey, Connection, Transaction, VersionedTransaction, TransactionMessage, ComputeBudgetProgram, AddressLookupTableProgram } = web3;
globalThis.isSecureContext ??= true;
const S = await import(path.join(POF, 'client/dist/spr.js'));
S.setHasherSource(fs.readFileSync(path.join(POF, 'client/dist/hasher-simd.wasm')));
const { createPofClient, core: C, VAULT_MESSAGE } = await import(path.join(POF, 'client/pof-client.js'));
const { createZkFlow, zkIxData, decodeZkAccount } = await import(path.join(POF, 'client/zk-flow.js'));
const { nodeWallet } = await import(path.join(POF, 'client/test/node-wallet.mjs'));
const { LocalRings, jsonRpc } = await import(path.join(POF, 'client/localtree.js'));
const V = await import(path.join(POF, 'verifier/dist/pof-verifier.mjs'));
const Z = await import(path.join(POF, 'zk/js/zk.js'));
const snarkjs = await import(path.join(POF, 'zk/node_modules/snarkjs/main.js'));
const { ed25519 } = await import(path.join(POF, 'client/node_modules/@noble/curves/ed25519.js'));
await C.ready();

/* ------------------------------------------------------------------ the clone: Rings as on mainnet, with today's tree */
const keys = fs.readFileSync(process.env.HOME + '/.config/helius/site_keys', 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
if (!keys.length) { console.log('no Helius key: the non-inclusion paths need the indexer'); process.exit(2); }
const MAIN = `https://mainnet.helius-rpc.com/?api-key=${keys[0]}`;
const mrpc = jsonRpc(MAIN);
fs.rmSync(RUN, { recursive: true, force: true }); fs.mkdirSync(path.join(RUN, 'accounts'), { recursive: true });
const SRC = path.join(POF, 'lab/rings-local/.run');
for (const f of fs.readdirSync(path.join(SRC, 'accounts'))) if (!f.startsWith(TREE)) fs.copyFileSync(path.join(SRC, 'accounts', f), path.join(RUN, 'accounts', f));
const treeInfo = await mrpc('getAccountInfo', [TREE, { encoding: 'base64', commitment: 'finalized' }]);
const cloned = new Uint8Array(Buffer.from(treeInfo.value.data[0], 'base64'));
fs.writeFileSync(path.join(RUN, 'accounts', TREE + '.json'), JSON.stringify({ pubkey: TREE, account: { lamports: treeInfo.value.lamports, data: [treeInfo.value.data[0], 'base64'], owner: treeInfo.value.owner, executable: false, rentEpoch: 0, space: cloned.length } }));
const head0 = C.decodeTree(cloned);
const mainSlot = BigInt(await mrpc('getSlot', [{ commitment: 'confirmed' }]));
const warp = (mainSlot > head0.rootSlot ? mainSlot : head0.rootSlot) + 2000n;
console.log(`clone: tree next leaf ${head0.nextIndex}, newest nullifier root ${C.hex(head0.nullifierRoot).slice(0, 16)}…, warp ${warp}`);

/* ------------------------------------------------------------------ keys, the vault (known before genesis), the spent note */
const admin = Keypair.generate(), relayerKp = Keypair.generate(), verifierKp = Keypair.generate(), dev = Keypair.generate();
const walletKp = Keypair.generate();
fs.writeFileSync(path.join(RUN, 'admin.json'), JSON.stringify([...admin.secretKey]));
const escrow = Z.escrowKeypair();
// the vault the client will derive: the dev wallet signs deterministically (pof-client deriveVault)
const vaultSeed = await C.sha256(C.utf8('pof/vault/v2'), ed25519.sign(C.utf8(VAULT_MESSAGE(walletKp.publicKey.toBase58())), walletKp.secretKey.slice(0, 32)));
const vkp = S.ShieldedKeypair.fromKeypair(S.SigningKey.fromEd25519Bytes(vaultSeed));
const nk = vkp.nullifierKey().secretBytes(), ownerHash = vkp.ownerHash();
const SOL = 1_000_000_000n, SOL_MINT = '11111111111111111111111111111111';
const DEPOSITS = [2n * SOL, 3n * SOL, 4n * SOL, 4n * SOL, 25n * SOL / 10n, 3n * SOL, 3n * SOL, 2n * SOL, 2n * SOL];  // deposit #0 is the note whose spend we simulate
const spendLeaf = head0.nextIndex;
const spendCommit = C.commitment({ ownerHash, asset: SOL_MINT, amount: DEPOSITS[0], blinding: C.depositBlinding(TREE, spendLeaf) });
const spendNf = C.nullifier(spendCommit, C.depositBlinding(TREE, spendLeaf), nk);
const nfPda = await S.nullifierPdaAddress(TREE, spendNf);
{ const d = Buffer.alloc(11); d[0] = 8; d.writeBigUInt64LE(head0.nullifierQueue + 1n, 1); fs.writeFileSync(path.join(RUN, 'accounts', nfPda + '.json'), JSON.stringify({ pubkey: nfPda, account: { lamports: 706_120, data: [d.toString('base64'), 'base64'], owner: C.RINGS.spp, executable: false, rentEpoch: 0, space: 11 } })); }

/* ------------------------------------------------------------------ the validator */
const args = ['--reset', '--quiet', '--ledger', path.join(RUN, 'ledger'), '--rpc-port', String(PORT), '--faucet-port', '45900', '--gossip-port', '44000', '--dynamic-port-range', '44100-44300', '--limit-ledger-size', '5000000', '--warp-slot', String(warp),
  '--upgradeable-program', PROGRAM, SO, path.join(RUN, 'admin.json')];
for (const so of fs.readdirSync(path.join(SRC, 'programs')).filter(f => f.endsWith('.so'))) args.push('--upgradeable-program', so.replace(/\.so$/, ''), path.join(SRC, 'programs', so), 'none');
for (const f of fs.readdirSync(path.join(RUN, 'accounts'))) args.push('--account', f.replace(/\.json$/, ''), path.join(RUN, 'accounts', f));
const val = spawn('solana-test-validator', args, { stdio: ['ignore', fs.openSync(path.join(RUN, 'validator.log'), 'w'), 'inherit'] });
let exited = false; val.on('exit', () => { exited = true; });
const stopAll = () => { try { val.kill('SIGTERM'); } catch {} };
process.on('exit', stopAll); process.on('SIGINT', () => process.exit(130));
const conn = new Connection(RPC, 'confirmed');
for (let i = 0; ; i++) { if (exited) { console.log('validator exited', fs.readFileSync(path.join(RUN, 'validator.log'), 'utf8').slice(-400)); process.exit(1); } try { await conn.getSlot(); break; } catch { if (i > 150) process.exit(1); await new Promise(r => setTimeout(r, 1000)); } }
{ const pd = PublicKey.findProgramAddressSync([new PublicKey(PROGRAM).toBuffer()], new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'))[0]; const a = await conn.getAccountInfo(pd); if (!a || !Buffer.from(a.data.subarray(13, 45)).equals(admin.publicKey.toBuffer())) { console.log('the validator on this port is not ours'); process.exit(1); } }

const W = nodeWallet(RPC, walletKp);
/* a version 0 sender for the node wallet (the browser wallet has the same in client/wallet.js sendVersioned) */
W.sendVersioned = async (instructions, { cosigners = [], lookupTables = [] } = {}) => {
  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  const msg = new TransactionMessage({ payerKey: walletKp.publicKey, recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }), ...instructions] }).compileToV0Message(lookupTables);
  const tx = new VersionedTransaction(msg); tx.sign([walletKp]);
  for (const s of cosigners) tx.addSignature(new PublicKey(s.publicKey), await s.sign(tx.message.serialize()));
  const bytes = tx.serialize();
  const signature = await conn.sendRawTransaction(bytes, { preflightCommitment: 'confirmed' }).catch(e => { e.logs = e.logs || e.transactionLogs; throw e; });
  return { signature, size: bytes.length, wait: async () => { const r = await conn.confirmTransaction(signature, 'confirmed'); if (r.value.err) throw Error('failed ' + JSON.stringify(r.value.err)); return { signature, slot: BigInt((await conn.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })).slot) }; } };
};
const sendKp = async (ixs, signers) => { const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }), ...ixs); return web3.sendAndConfirmTransaction(conn, tx, signers, { commitment: 'confirmed' }); };
const air = async (k, sol) => { const s = await conn.requestAirdrop(k, sol * 1e9); await conn.confirmTransaction(s, 'confirmed'); };
await air(walletKp.publicKey, 100); await air(admin.publicKey, 50); await air(relayerKp.publicKey, 10);
const units = async sig => (await conn.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })).meta.computeUnitsConsumed;

/* ------------------------------------------------------------------ the client and the zk flow */
const pof = await createPofClient({ network: 'local', rpc: [RPC], wallet: W, storage: new Map(), programId: PROGRAM, minAgeSlots: 0, clonedTree: cloned });
const v = await pof.deriveVault();
ok(v.owner === C.b58encode(vkp.signingPublicKey().ed25519()), 'the client derives the vault the test predicted (its nullifier key made the spent note\'s PDA)');
const MAIN_SPR = `https://mainnet.helius-rpc.com/v1/spr?api-key=${keys[0]}`;
const nullIndexer = new S.SprIndexer(new S.SprApi({ url: MAIN_SPR }));
const nullWitness = async nfs => (await nullIndexer.getNonInclusionProofs(TREE, nfs)).proofs.map(p => ({ lowElement: p.lowElement, highElement: p.highElement, lowElementIndex: p.lowElementIndex, path: [...p.path], root: p.root }));
const wasm = fs.readFileSync(path.join(POF, 'zk/setup/pof.wasm')), zkey = fs.readFileSync(path.join(POF, 'zk/setup/pof_final.zkey'));
const steps = [];
const zk = await createZkFlow(pof, { wallet: W, snarkjs, wasm, zkey, nullWitness, onStatus: s => steps.push(s.phase) });
const zkWith = o => createZkFlow(pof, { wallet: W, snarkjs, wasm, zkey, nullWitness, ...o });
const P = Z.fromBytesPoseidon(C.poseidon);

// the launch gate: the zk build without set_zk has no ZkConfig
let st = await zk.state();
ok(!st.deployed && !st.enabled, 'before set_zk the flow sees no ZkConfig (as on the launch program): ' + JSON.stringify(st));
ok(await refuses(zk.certify({ asset: 0, tier: 1 }), /ZK_OFF/) === true, 'certify answers ZK_OFF and sends nothing');
ok(await refuses(zk.register(), /ZK_OFF/) === true, 'register answers ZK_OFF and sends nothing');

// the program: init_config, set_zk (waits the rotation delay)
const PID = new PublicKey(PROGRAM);
const pda = s => PublicKey.findProgramAddressSync(s, PID)[0];
const K = { config: pda([Buffer.from('config')]), treasury: pda([Buffer.from('treasury')]), zk: pda([Buffer.from('zk')]), registry: pda([Buffer.from('zkreg')]) };
const IDL = (await import(path.join(POF, 'client/zk-idl.js'))).default;
const ixOf = (name, a, named, extra = []) => { const ix = IDL.instructions.find(i => i.name === name); return new web3.TransactionInstruction({ programId: PID, data: Buffer.from(zkIxData(name, a)), keys: [...ix.accounts.map(x => ({ pubkey: named[x.name] || (x.address ? new PublicKey(x.address) : PID), isSigner: !!x.signer, isWritable: !!x.writable })), ...extra] }); };
const programData = PublicKey.findProgramAddressSync([PID.toBuffer()], new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'))[0];
await sendKp([ixOf('init_config', { verifier: verifierKp.publicKey, relayer: relayerKp.publicKey, dev: dev.publicKey }, { admin: admin.publicKey, config: K.config, treasury: K.treasury, program_data: programData })], [admin]);
await sendKp([ixOf('set_zk', { enabled: true, escrow: escrow.public.map(Z.be32) }, { admin: admin.publicKey, config: K.config, zk: K.zk, registry: K.registry })], [admin]);
st = await zk.state();
ok(st.deployed && !st.enabled && st.pending?.enabled, 'set_zk on: deployed, still off until the rotation delay (pending at slot ' + st.pending?.atSlot + ')');
ok(await refuses(zk.certify({ asset: 0, tier: 1 }), /ZK_OFF/) === true, 'certify is still ZK_OFF during the delay');

// shield the nine deposits (deposit #0 is the note with the preloaded spend), register the vault in Rings
await pof.register('vault');
for (const amt of DEPOSITS) await pof.shield({ asset: 0, amount: amt, into: 'vault' });
const allNotes = (await pof.local.notesOf({ owner: v.owner, ownerHash })).map(n => ({ ...n, nullifier: C.nullifier(n.leaf, n.blinding, nk) }));
ok(allNotes.length === 9 && C.hex(allNotes[0].leaf) === C.hex(spendCommit), 'nine notes on the clone; the first is the predicted (spent) one');
const visible = await pof.notes({ from: 'vault' });
ok(visible.length === 8, 'the client\'s own sync already hides the spent note (its nullifier PDA): ' + visible.length);

// the owner registry
while ((await conn.getSlot('confirmed')) < Number(st.pending.atSlot)) await new Promise(r => setTimeout(r, 400));
st = await zk.state();
ok(st.enabled && st.escrow[0] === escrow.public[0], 'after the delay: on, with the revocation key set');
ok(await refuses(zk.certify({ asset: 0, tier: 1 }), /ZK_NOT_REGISTERED/) === true, 'certify before register_zk_owner: ZK_NOT_REGISTERED');
const t0 = BigInt(await conn.getBalance(K.treasury));
const reg = await zk.register();
numbers.register_zk_owner_cu = await units(reg.signature);
const fee = BigInt(decodeZkAccount('Config', (await conn.getAccountInfo(K.config)).data).params.fee_lamports);
ok(BigInt(await conn.getBalance(K.treasury)) - t0 === fee, `register_zk_owner paid the fee (${fee} lamports) to the treasury; ${numbers.register_zk_owner_cu} CU`);
ok((await zk.register()).already === true && await zk.registered(), 'a second register is a no-op (one record per owner)');

/* ---------------------------------------------------------------- 1: wallet subject, 1 note (the spent one), proven in Node */
const gateSim = async certificate => { const subj = decodeZkAccount('Certificate', (await conn.getAccountInfo(new PublicKey(certificate))).data); const tx = new Transaction().add(ixOf('require_certificate', { subject_hash: subj.subject_hash, asset: subj.asset, min_tier: 1 }, { certificate: new PublicKey(certificate), config: K.config })); tx.feePayer = walletKp.publicKey; tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash; const s = await conn.simulateTransaction(tx); return s.value.err ? (s.value.logs || []).join(' ') : 'pass'; };
const a = await zk.certify({ asset: 0, tier: 1, notes: [allNotes[0]] });
numbers.node = { notes: 1, proveMs: a.ms, size: a.size, cu: await units(a.signature) };
let s1 = await zk.certificateState(a.kit);
ok(s1.status === 'settling' && s1.settleSlots > 0, `certify_zk landed (1 note, wallet subject, ${a.size} B legacy, ${numbers.node.cu} CU, proof ${a.ms.total} ms in Node); state settling for ${s1.settleSlots} slots`);
ok(/ZkSettling/.test(await gateSim(a.certificate)), 'require_certificate refuses it while it settles (ZkSettling)');
await zk.settle(a.kit);
ok((await gateSim(a.certificate)) === 'pass', 'after the settle window require_certificate passes');

// the keeper: its spend (the preloaded nullifier PDA) is found from the escrow alone, revoked with the note lock
const relaySigner = V.signerFromSeed(relayerKp.secretKey.slice(0, 32));
const chain = await V.makeProgramChain({ web3, rpcUrl: RPC, programId: PROGRAM, relayer: relaySigner, verifier: V.signerFromSeed(verifierKp.secretKey.slice(0, 32)), rings: new LocalRings(jsonRpc(RPC), { cloned }) });
const keeper = new V.Keeper(new V.FsStore(fs.mkdtempSync(path.join(RUN, 'keeper-'))), new Uint8Array(32).fill(9), new LocalRings(jsonRpc(RPC), { cloned }), chain);
const noKey = await keeper.scan();
ok(!noKey.zk, 'without POF_ZK_ESCROW_KEYS the keeper does not look at zk certificates');
keeper.zkKeys = V.zk.escrowKeys(`${st.epoch}:` + C.hex(Z.be32(escrow.secret)));   // the key epoch each lock records (1 after the first set_zk)
const scan = await keeper.scan();
ok(scan.zk && scan.zk.revoked.length === 1 && scan.zk.revoked[0].certificate === a.certificate, 'keeper scanZk opened the lock, saw the spend, revoked it: ' + JSON.stringify(scan.zk));
numbers.keeper_revoke_cu = scan.zk?.revoked[0] ? await units(scan.zk.revoked[0].signature) : null;
s1 = await zk.certificateState(a.kit);
const lockA = decodeZkAccount('NoteLock', (await conn.getAccountInfo(new PublicKey(zk.addresses.lock(C.unhex(a.kit.tags[0], 32))))).data);
ok(s1.status === 'revoked_spent' && lockA.spent === true, `revoked_spent and its NoteLock marked spent (FZ-18); keeper revoke ${numbers.keeper_revoke_cu} CU`);
ok(/Revoked|NotLive|Status|AccountNotInitialized|custom program error/.test(await gateSim(a.certificate)), 'the gate refuses it now');
ok(await refuses(zk.certify({ asset: 0, tier: 1, notes: [allNotes[0]] }), /ZK_NOTE_LOCKED/) === true, 'remake from the spent note: the client refuses (its lock is spent)');
const zkRaw = await zkWith({ skipLockCheck: true });
ok(await refuses(zkRaw.certify({ asset: 0, tier: 1, notes: [allNotes[0]], nonce: C.unhex(a.kit.nonce, 16) }), /Replayed/) === true, 'the program refuses the same nonce over the revoked certificate (Replayed)');
ok(await refuses(zkRaw.certify({ asset: 0, tier: 1, notes: [allNotes[0]] }), /ZkNoteLocked/) === true, 'and a fresh proof of the spent note (ZkNoteLocked)');
const again = await keeper.scan();
ok(again.zk && again.zk.revoked.length === 0, 'a second scan has nothing to do');

/* ---------------------------------------------------------------- 2: a badge, 1 note, proven in headless Chrome */
const files = { '/zk/dist/snarkjs.min.js': 'zk/dist/snarkjs.min.js', '/zk/js/zk.js': 'zk/js/zk.js', '/zk/setup/pof.wasm': 'zk/setup/pof.wasm', '/zk/setup/pof_final.zkey.gz': 'zk/setup/pof_final.zkey.gz' };
const page = `<!doctype html><meta charset="utf-8"><script src="/zk/dist/snarkjs.min.js"></script><script type="module">
import { prove } from '/zk/js/zk.js';
async function bytes(u, gz) { const r = await fetch(u); let b = r.body; if (gz) b = b.pipeThrough(new DecompressionStream('gzip')); return new Uint8Array(await new Response(b).arrayBuffer()); }
window.loaded = (async () => { const t = performance.now(); const [w, k] = await Promise.all([bytes('/zk/setup/pof.wasm'), bytes('/zk/setup/pof_final.zkey.gz', true)]); window.A = { w, k }; return Math.round(performance.now() - t); })();
window.proveIt = async input => { await window.loaded; const r = await prove(window.snarkjs, { input, wasm: window.A.w, zkey: window.A.k }); return { proof: r.proof, publicSignals: r.publicSignals, ms: r.ms }; };
</script>`;
const srv = http.createServer((q, r) => { const f = files[q.url.split('?')[0]]; if (q.url === '/') { r.writeHead(200, { 'content-type': 'text/html' }); return r.end(page); } if (!f) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream' }); fs.createReadStream(path.join(POF, f)).pipe(r); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const { chromium } = createRequire('/Users/artem/Desktop/sol/_solkit/onair/')('playwright-core');
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const tab = await browser.newPage();
  await tab.goto(`http://127.0.0.1:${srv.address().port}/`);
  numbers.chrome_load_ms = await tab.evaluate(() => window.loaded);
  const chromeProver = async ({ input }) => { const r = await tab.evaluate(i => window.proveIt(i), input); return { ...r, args: Z.certifyZkArgs(r.proof, r.publicSignals) }; };
  const zkChrome = await zkWith({ prover: chromeProver });
  const b = await zkChrome.certify({ asset: 0, tier: 1, subjectKind: 2, allowWalletPayer: true, notes: [allNotes[1]] });
  numbers.chrome = { notes: 1, proveMs: b.ms, size: b.size, cu: await units(b.signature), subject: 'badge (2 signers)' };
  ok(b.kit.subject.kind === 2 && (await zk.certificateState(b.kit)).status === 'settling', `a badge certificate proven in headless Chrome (witness ${b.ms.witness} ms, proof ${b.ms.prove} ms; artifacts loaded in ${numbers.chrome_load_ms} ms), ${b.size} B legacy with 2 signers, ${numbers.chrome.cu} CU`);
  ok(await refuses(zk.certify({ asset: 0, tier: 1, subjectKind: 2, notes: [allNotes[2]] }), /PAYER_LINKS_WALLET/) === true, 'a badge paid by the wallet needs allowWalletPayer (it links them in public)');
  await zk.settle(b.kit);
  const lockAddr = zk.addresses.lock(C.unhex(b.kit.tags[0], 32));
  const before = BigInt(await conn.getBalance(walletKp.publicKey));
  const rv = await zk.revoke(b.kit);
  const rent = BigInt(await conn.getBalance(walletKp.publicKey)) - before;
  ok((await zk.certificateState(b.kit)).status === 'revoked_by_holder' && !(await conn.getAccountInfo(new PublicKey(lockAddr))) && rv.released === 1, `the holder revokes (badge key signs) and the lock is released in the same transaction (net ${rent} lamports back after the fee)`);
} finally { await browser.close(); srv.close(); }

/* ---------------------------------------------------------------- 3: the wallet subject remade from 3 notes (default pick) */
const c = await zk.certify({ asset: 0, tier: 2 });
numbers.three = { notes: c.notes, proveMs: c.ms, size: c.size, cu: await units(c.signature), version: c.version };
const pickedLeaves = c.kit.tags.length;
ok(c.notes === 3 && c.version === 'legacy' && c.size <= 1232 && c.certificate === a.certificate, `tier 2 (10 SOL) from 3 notes over the revoked certificate of the same wallet: ${c.size} B legacy, ${numbers.three.cu} CU, proof ${c.ms.total} ms`);
ok(!c.kit.nullifiers.includes(C.hex(spendNf)), 'the default pick skipped the spent note and the notes other certificates hold');
void pickedLeaves;

/* ---------------------------------------------------------------- 4: four notes need a lookup table */
const locked = new Set(c.kit.nullifiers);
const free4 = allNotes.slice(1).filter(n => !locked.has(C.hex(n.nullifier))).sort((x, y) => (y.amount > x.amount ? 1 : -1)).slice(0, 4);
const sum4 = free4.reduce((s, n) => s + n.amount, 0n);
const tier4 = sum4 >= 10n * SOL ? 2 : 1;
ok(await refuses(zk.certify({ asset: 0, tier: tier4, subjectKind: 2, allowWalletPayer: true, allowFourNotes: true, notes: free4 }), /ZK_TOO_MANY_NOTES/) === true, 'four notes without a lookup table: refused even with allowFourNotes');
ok(await refuses(zk.certify({ asset: 0, tier: 1, subjectKind: 2, allowWalletPayer: true, notes: free4.slice(0, 3) }), /ZK_TX_TOO_LARGE/) === true, 'three notes and two signers (a badge) do not fit a legacy transaction: ZK_TX_TOO_LARGE without a lookup table');
const slotNow = await conn.getSlot('confirmed');
const [mk, alt] = AddressLookupTableProgram.createLookupTable({ authority: walletKp.publicKey, payer: walletKp.publicKey, recentSlot: slotNow - 1 });
await sendKp([mk, AddressLookupTableProgram.extendLookupTable({ authority: walletKp.publicKey, payer: walletKp.publicKey, lookupTable: alt, addresses: [K.config, K.treasury, K.zk, K.registry, new PublicKey(TREE), web3.SystemProgram.programId, ComputeBudgetProgram.programId] })], [walletKp]);
for (let i = 0; i < 6; i++) { await new Promise(r => setTimeout(r, 500)); }
const zkAlt = await zkWith({ lookupTable: alt.toBase58() });
ok(await refuses(zkAlt.certify({ asset: 0, tier: tier4, subjectKind: 2, allowWalletPayer: true, notes: free4 }), /ZK_TOO_MANY_NOTES/) === true, 'four notes are refused by default even with a lookup table (3 is the cap: no room for a priority fee at 4)');
const d = await zkAlt.certify({ asset: 0, tier: tier4, subjectKind: 2, allowWalletPayer: true, allowFourNotes: true, notes: free4 });
numbers.four = { notes: d.notes, proveMs: d.ms, size: d.size, cu: await units(d.signature), version: d.version, subject: 'badge (2 signers)' };
ok(d.notes === 4 && d.version === 0 && d.size <= 1232, `4 notes (tier ${tier4}), badge with 2 signers, version 0 over the lookup table: ${d.size} B, ${numbers.four.cu} CU, proof ${d.ms.total} ms`);
const kitsNow = await zk.kits.list();
ok(kitsNow.length === 3 && kitsNow.every(k => k.nullifiers.length === k.tags.length), 'the kits stay on the device, sealed: ' + kitsNow.length + ' certificates (one per subject)');

console.log(`\n${pass} passed, ${fail} failed`);
console.log(JSON.stringify(numbers));
fs.writeFileSync(path.join(POF, 'lab/test/zk-e2e.json'), JSON.stringify({ date: new Date().toISOString(), program: 'pof zk build of ' + (process.env.POF_ZK_COMMIT || spawnSync('git', ['-C', POF, 'log', '-1', '--format=%h', '--', 'program']).stdout.toString().trim()) + ' (--features zk,quick)', pass, fail, results, numbers }, (k, x) => (typeof x === 'bigint' ? String(x) : x), 1));
stopAll();
process.exit(fail ? 1 : 0);
