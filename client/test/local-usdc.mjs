/* USDC end to end on the local Rings clone (the real USDC mint cloned, its mint authority rewritten to a local test key by
   lab/rings-local/prep.mjs), plus mixed-asset edge cases, against the real Verifier over LocalRings:
   mint 1,234.567891 test USDC to a wallet → shield 150.5 and 1,000 USDC and 2 SOL into the vault → LocalRings rebuilds
   the SPL deposits to the on-chain root → sync shows both assets with their decimals → USDC tier 1 (≥ 100) takes the
   150.5 note, tier 2 (≥ 1,000) the 1,000 note, tier 3 (≥ 10,000) is short → SOL notes never back a USDC tier and USDC
   notes never back a SOL tier → the Verifier attests USDC tier 2 and refuses a SOL note disclosed as USDC.
   Run: zsh lab/rings-local/chain.sh start && node --test test/local-usdc.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { PublicKey, TransactionInstruction, SystemProgram, Keypair } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { nodeWallet } from './node-wallet.mjs';
const RPC = process.env.POF_LOCAL_RPC || 'http://127.0.0.1:35899';
globalThis.isSecureContext ??= true;
const S = await import('../dist/spr.js');
S.setHasherSource(fs.readFileSync(new URL('../dist/hasher-simd.wasm', import.meta.url)));
const { createPofClient, core: C } = await import('../pof-client.js');
const { LocalRings, jsonRpc } = await import('../localtree.js');
const V = await import('../../verifier/dist/pof-verifier.mjs');
const RUN = new URL('../../lab/rings-local/.run/', import.meta.url);
const cloned = new Uint8Array(Buffer.from(fs.readFileSync(new URL('cloned-tree.b64', RUN), 'utf8'), 'base64'));
const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(new URL('usdc-authority.json', RUN), 'utf8'))));
const PROGRAM = 'pofP4QRRDXnmDN9CNYiAGHfwMEgM7sLWhVcUMpsbynT';
const USDC = new PublicKey(C.ASSETS[1].mint), TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), ATA = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const up = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' }).then(r => r.ok).catch(() => false);

test('local: USDC shield, sync, tiers with 6 decimals, attestation; mixed assets', { skip: !up && 'no local validator on ' + RPC }, async () => {
  const W = nodeWallet(RPC);
  await W.airdrop(10);
  const owner = W.keypair.publicKey;
  const [ata] = PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN.toBuffer(), USDC.toBuffer()], ATA);
  const amount = 1_234_567_891n;
  const mintTo = new TransactionInstruction({ programId: TOKEN, keys: [{ pubkey: USDC, isSigner: false, isWritable: true }, { pubkey: ata, isSigner: false, isWritable: true }, { pubkey: authority.publicKey, isSigner: true, isWritable: false }], data: Buffer.concat([Buffer.from([7]), Buffer.from(new BigUint64Array([amount]).buffer)]) });
  const createAta = new TransactionInstruction({ programId: ATA, keys: [{ pubkey: owner, isSigner: true, isWritable: true }, { pubkey: ata, isSigner: false, isWritable: true }, { pubkey: owner, isSigner: false, isWritable: false }, { pubkey: USDC, isSigner: false, isWritable: false }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: TOKEN, isSigner: false, isWritable: false }], data: Buffer.from([1]) });
  await (await W.send([createAta, mintTo], { cosigners: [{ publicKey: authority.publicKey.toBase58(), sign: m => ed25519.sign(m, authority.secretKey.slice(0, 32)) }] })).wait();
  const bal = await W.rpc('getTokenAccountBalance', [ata.toBase58(), { commitment: 'confirmed' }]);
  assert.equal(bal.value.amount, String(amount));

  const pof = await createPofClient({ network: 'local', rpc: [RPC], wallet: W, storage: new Map(), programId: PROGRAM, minAgeSlots: 0, clonedTree: cloned });
  await pof.ready();
  const v = await pof.deriveVault();
  await pof.register('vault');
  await pof.shield({ asset: 1, amount: '150.5', into: 'vault' });
  await pof.shield({ asset: 1, amount: '1000', into: 'vault' });
  await pof.shield({ asset: 0, amount: '2', into: 'vault' });
  await assert.rejects(pof.shield({ asset: 1, amount: '0.0000001', into: 'vault' }), /at most 6 decimals/);
  const after = await W.rpc('getTokenAccountBalance', [ata.toBase58(), { commitment: 'confirmed' }]);
  assert.equal(BigInt(after.value.amount), amount - 1_150_500_000n);

  const notes = await pof.notes({ from: 'vault' });
  assert.equal(notes.length, 3);
  assert.equal(pof.balance(notes, 1), 1_150_500_000n);
  assert.equal(C.formatUnits(pof.balance(notes, 1), 6), '1150.5');
  assert.equal(pof.balance(notes, 0), 2_000_000_000n);
  for (const n of notes) assert.equal(C.hex(C.rootFromPath(n.leaf, n.leafIndex, pof.local.pathOf(n.leafIndex))), C.hex(pof.local.head.root));

  const t1 = await pof.choose({ asset: 1, tier: 1, list: notes });
  assert.equal(t1.ready, true); assert.equal(t1.notes.length, 1); assert.equal(t1.notes[0].amount, 150_500_000n); assert.equal(t1.excess, 50_500_000n);
  const t2 = await pof.choose({ asset: 1, tier: 2, list: notes });
  assert.equal(t2.ready, true); assert.equal(t2.notes.length, 1); assert.equal(t2.notes[0].amount, 1_000_000_000n);
  const t3 = await pof.choose({ asset: 1, tier: 3, list: notes });
  assert.equal(t3.ready, false); assert.equal(t3.short, 10_000_000_000n - 1_150_500_000n);
  // mixed assets: the 2 SOL note never counts toward USDC, and USDC never toward SOL tier 1 (1 SOL)
  assert.ok(t1.notes.concat(t2.notes).every(n => n.asset === C.ASSETS[1].mint));
  const s1 = await pof.choose({ asset: 0, tier: 1, list: notes });
  assert.equal(s1.ready, true); assert.equal(s1.notes[0].asset, C.ASSETS[0].mint);
  const s2 = await pof.choose({ asset: 0, tier: 2, list: notes });
  assert.equal(s2.ready, false); assert.equal(s2.short, 8_000_000_000n);

  // the minimum note age: with a large age every note is too fresh; the countdown names the slot it ends
  const strict = await createPofClient({ network: 'local', rpc: [RPC], wallet: W, storage: new Map(), programId: PROGRAM, minAgeSlots: 100_000, clonedTree: cloned });
  await strict.deriveVault();
  const wait = await strict.choose({ asset: 1, tier: 1, list: notes });
  assert.equal(wait.ready, false); assert.ok(wait.waitSlots > 99_000 && wait.waitSlots <= 100_000); assert.ok(wait.readyAtSlot > wait.nowSlot);
  const pv = await strict.privacy({ subjectKind: 1, pick: wait });
  assert.equal(pv.ok, false); assert.ok(pv.warnings.some(w => w.code === 'NOTE_TOO_NEW' && w.level === 'block'));
  assert.ok(pv.warnings.some(w => w.code === 'WALLET_PAYER' && w.level === 'block'));
  const pw = await pof.privacy({ subjectKind: 0, pick: t2 });
  assert.equal(pw.ok, true); assert.ok(pw.warnings.some(w => w.code === 'SUBJECT_IS_WALLET'));
  assert.ok(pw.warnings.some(w => w.code === 'RECENT_SHIELD' && w.level === 'warn'));

  // the Verifier: USDC tier 2 attested; a SOL note disclosed as USDC refused
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pof-usdc-'));
  const signer = V.signerFromSeed(new Uint8Array(crypto.randomBytes(32)));
  const programId = V.fromB58(PROGRAM, 32, 'program');
  const rings = new LocalRings(jsonRpc(RPC), { cloned });
  const verifier = new V.Verifier({ programId, minAgeSlots: 0n, validitySlots: 6_480_000n, subjectProofSlots: 1500n, maxRootAgeSlots: 1_000_000n, maxRootLagSlots: 1_000_000n, relayer: null, mints: { 0: V.ASSETS[0].mint, 1: V.ASSETS[1].mint }, bundleHash: V.bundleHash() }, signer, rings, new V.TransparencyLog(new V.FsStore(dir), signer, programId), null, null);
  const payer = W.state().address;
  const subj = await pof.subject({ kind: 0, asset: 1, tier: 2, payer });
  const ans = await verifier.attest(JSON.parse(JSON.stringify(pof.disclose({ subject: subj, asset: 1, tier: 2, notes: t2.notes, payer }))));
  const att = V.decodeAttestation(C.unhex(ans.attestation));
  assert.equal(att.asset, 1); assert.equal(att.tier, 2);
  const solNote = notes.find(n => n.asset === C.ASSETS[0].mint);
  const subj1 = await pof.subject({ kind: 0, asset: 1, tier: 1, payer });
  const bad = JSON.parse(JSON.stringify(pof.disclose({ subject: subj1, asset: 1, tier: 1, notes: [solNote], payer })));
  await assert.rejects(verifier.attest(bad), e => e.code === 'WRONG_ASSET');
  const lie = JSON.parse(JSON.stringify(bad)); lie.notes[0].asset = C.ASSETS[1].mint;   // claim the SOL note is USDC
  await assert.rejects(verifier.attest(lie), e => e.code === 'NOT_IN_TREE');

  // relay credits (audit POF-12 round 2): a badge certificate relayed with a prepaid credit, no payment at certify time
  const relayer = V.signerFromSeed(new Uint8Array(crypto.randomBytes(32)));
  const rv = new V.Verifier({ ...verifier.cfg, relayer: relayer.address }, signer, rings, new V.TransparencyLog(new V.FsStore(fs.mkdtempSync(path.join(os.tmpdir(), 'pof-relay-'))), signer, programId), null, null);
  const http = await import('node:http');
  const valid = new Set(); const seen = [];
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', c => (b += c)); req.on('end', async () => {
    const send = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    try {
      if (req.method === 'GET' && req.url.startsWith('/api/attest')) return send(200, { relayer: relayer.address, minAgeSlots: 0 });
      const j = JSON.parse(b || '{}');
      if (req.url.startsWith('/api/attest')) return send(200, await rv.attest(j));
      if (req.url.startsWith('/api/relay/certify')) {
        seen.push(j);
        const h = C.hex(await C.sha256(C.utf8('pof:credit:'), C.unhex(j.credit || '00'.repeat(32), 32)));
        if (!valid.has(h)) return send(402, { error: { code: 'CREDIT_USED', message: 'no such credit' } });
        valid.delete(h);
        const a = V.decodeAttestation(C.unhex(j.attestation));
        assert.equal(V.toB58(a.payer), relayer.address);
        return send(200, { signature: 'stub-certify', certificate: null });
      }
      send(404, { error: { code: 'NOT_FOUND' } });
    } catch (e) { send(400, { error: { code: e.code, message: e.message } }); }
  }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    const R = await createPofClient({ network: 'local', rpc: [RPC], wallet: W, storage: new Map(), programId: PROGRAM, minAgeSlots: 0, clonedTree: cloned, attestUrl: `http://127.0.0.1:${srv.address().port}/api/attest` });
    await R.deriveVault();
    await assert.rejects(R.certify({ asset: 1, tier: 1, subjectKind: 2 }), e => e.code === 'CREDITS_NEEDED');
    const secret = C.hex(crypto.randomBytes(32));
    valid.add(C.hex(await C.sha256(C.utf8('pof:credit:'), C.unhex(secret, 32))));
    await R.credits._add([secret]);
    assert.equal(await R.credits.count(), 1);
    const pv = await R.privacy({ subjectKind: 2, pick: await R.choose({ asset: 1, tier: 1 }) });
    assert.ok(!pv.warnings.some(w => w.code === 'WALLET_PAYER' || w.code === 'NO_CREDIT'));
    const done = await R.certify({ asset: 1, tier: 1, subjectKind: 2 });
    assert.equal(done.relayed.signature, 'stub-certify'); assert.equal(done.payment, null);
    assert.equal(seen[0].quote, undefined); assert.equal(seen[0].credit, secret);
    assert.equal(await R.credits.count(), 0);
    const pv2 = await R.privacy({ subjectKind: 2, pick: await R.choose({ asset: 1, tier: 1 }) });
    assert.ok(pv2.warnings.some(w => w.code === 'NO_CREDIT'));
    // the claim message the vault key signs names the transfer, the vault and the credit hashes
    assert.equal(new TextDecoder().decode(R.credits.claimMessage({ signature: 'S', owner: 'O', hashes: ['a', 'b'] })), 'Proof of Funds: relay credits v1\ntransfer: S\nowner: O\ncredits: a,b');
  } finally { srv.close(); }
  void v;
});
