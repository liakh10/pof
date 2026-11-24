/* The full Rings flow on devnet, where Helius runs the whole stack (RPC, indexer, prover; RINGS §8), real spend included:
   vault → register → shield 1.2 SOL → the indexer sees the note (SDK sync through the same code the page runs) → pick
   tier 1 → the real Verifier over HeliusRings (devnet) signs → fund the vault's fees → withdraw 0.3 SOL through the attested
   prover (a real spend) → the nullifier PDA of the spent note exists (CONTRACT §5 path a) and the Verifier now refuses it.
   Needs devnet SOL on ~/.config/pof/devnet-lab.json (about 1.5; the owner step in _x/pof/OWNER-STEPS.md). Never mainnet.
   Run: node client/test/devnet-e2e.mjs */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { nodeWallet } from './node-wallet.mjs';
globalThis.isSecureContext ??= true;
const S = await import('../dist/spr.js');
S.setHasherSource(fs.readFileSync(new URL('../dist/hasher-simd.wasm', import.meta.url)));
const { createPofClient, core: C } = await import('../pof-client.js');
const V = await import('../../verifier/dist/pof-verifier.mjs');
const KEY = fs.readFileSync(os.homedir() + '/.config/helius/site_keys', 'utf8').split('\n').map(s => s.trim()).filter(Boolean)[3];
const RPC = `https://devnet.helius-rpc.com/?api-key=${KEY}`, SPR = `https://devnet.helius-rpc.com/v1/spr?api-key=${KEY}`;
const scrub = s => String(s).replace(/api-key=[^&\s"']+/g, 'api-key=…');
const lab = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(os.homedir() + '/.config/pof/devnet-lab.json', 'utf8'))));
const W = nodeWallet(RPC, lab);
const bal = Number((await W.rpc('getBalance', [lab.publicKey.toBase58()])).value) / 1e9;
console.log('devnet lab wallet', lab.publicKey.toBase58(), bal, 'SOL');
if (bal < 1.4) { console.log('SKIP: fund it with about 1.5 devnet SOL first (OWNER-STEPS)'); process.exit(0); }
let pass = 0, total = 0;
const ok = (c, n, x = '') => { total++; if (c) { pass++; console.log('  ok   ' + n); } else console.log('  FAIL ' + n + (x ? '  ' + scrub(x).slice(0, 300) : '')); };
const PROGRAM = 'pofP4QRRDXnmDN9CNYiAGHfwMEgM7sLWhVcUMpsbynT';
try {
  const pof = await createPofClient({ network: 'devnet', rpc: [RPC], indexer: SPR, prover: SPR, wallet: W, storage: new Map(), programId: PROGRAM, minAgeSlots: 0 });
  pof.onStatus(s => s.step !== 'hasher' && console.log('   ·', s.step, s.phase || '', s.signature || ''));
  await pof.ready();
  const v = await pof.deriveVault();
  if (!v.registered) await pof.register('vault');
  ok(await pof.isRegistered(v.owner), 'the vault is registered on devnet');
  const before = await pof.notes({ from: 'vault' });
  const sh = await pof.shield({ asset: 0, amount: '1.2', into: 'vault' });
  let notes = [];
  for (let i = 0; i < 30; i++) { notes = await pof.notes({ from: 'vault' }); if (notes.length > before.length) break; await new Promise(r => setTimeout(r, 2000)); }
  const mine = notes.find(n => n.sig === sh.signature);
  ok(!!mine && mine.amount === 1_200_000_000n, 'the Helius indexer serves the new note to the SDK sync, with its creating transaction');
  const pick = await pof.choose({ asset: 0, tier: 1, from: 'vault', list: notes });
  ok(pick.ready, 'tier 1 is reachable');
  const rings = new V.HeliusRings(V.jsonRpc([RPC]), { url: 'https://devnet.helius-rpc.com/v1/spr', apiKey: KEY }, RPC);
  const signer = V.signerFromSeed(new Uint8Array(crypto.randomBytes(32)));
  const programId = V.fromB58(PROGRAM, 32, 'program');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pof-devnet-'));
  const verifier = new V.Verifier({ programId, minAgeSlots: 0n, validitySlots: 6_480_000n, subjectProofSlots: 1500n, maxRootAgeSlots: 1_000_000n, relayer: null, mints: { 0: V.ASSETS[0].mint, 1: V.ASSETS[1].mint }, bundleHash: V.bundleHash() }, signer, rings, new V.TransparencyLog(new V.FsStore(dir), signer, programId), null, null);
  const payer = lab.publicKey.toBase58();
  const subj = await pof.subject({ kind: 0, asset: 0, tier: 1, payer, from: 'vault' });
  const pkg = JSON.parse(JSON.stringify(pof.disclose({ subject: subj, asset: 0, tier: 1, notes: pick.notes, payer, from: 'vault' })));
  const ans = await verifier.attest(pkg);
  ok(ans.attestation.length === 480, 'the real Verifier over the devnet indexer signs the attestation');
  // a real spend: withdraw part of the vault through the attested prover
  await pof.fundVault(10_000_000);
  const wd = await pof.withdraw({ asset: 0, amount: '0.3', to: payer });
  ok(!!wd.signature, 'a withdrawal proven by the Helius prover lands: ' + wd.signature);
  const spentNotes = pick.notes.concat(notes).filter((n, i, a) => a.indexOf(n) === i);
  const pdas = await Promise.all(spentNotes.map(n => S.nullifierPdaAddress(n.tree, n.nullifier)));
  const accs = (await W.rpc('getMultipleAccounts', [pdas, { encoding: 'base64' }])).value;
  const spent = accs.map(a => !!a && a.owner === C.RINGS.spp && Buffer.from(a.data[0], 'base64')[0] === 8);
  ok(spent.some(Boolean), 'the spent note left a nullifier PDA ["nullifier", tree, nf] (11 bytes, first byte 8): CONTRACT §5 path (a) on a real spend');
  const st = await rings.spent(C.RINGS.tree, spentNotes.map(n => n.nullifier));
  ok(st.some(Boolean), 'the Verifier source reads the same note as spent');
  await new Promise(r => setTimeout(r, 4000));
  const again = await verifier.attest(pkg).then(() => null, e => e.code);
  ok(again === 'NOTE_SPENT' || again === 'NOT_IN_TREE' || again === 'SUBJECT_PROOF_STALE', 'the same package is refused after the spend: ' + again);
  fs.writeFileSync(new URL('../../lab/devnet-run.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), vault: v.owner, shield: sh.signature, withdraw: wd.signature, spentPdas: pdas.filter((_, i) => spent[i]) }, null, 1));
} catch (e) { ok(false, 'run', e.stack || e.message); }
console.log(`${pass}/${total} passed`);
process.exit(pass === total ? 0 : 1);
