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

  // relay credits (audit POF-12): blind RSA tokens against the Verifier's own Credits (verifier/src/credits.ts) with a fake
  // house ring, then a badge certificate relayed with one; and the relayed revoke bytes against the Verifier's revokeBytes
  const relayer = V.signerFromSeed(new Uint8Array(crypto.randomBytes(32)));
  const rv = new V.Verifier({ ...verifier.cfg, relayer: relayer.address }, signer, rings, new V.TransparencyLog(new V.FsStore(fs.mkdtempSync(path.join(os.tmpdir(), 'pof-relay-'))), signer, programId), null, null);
  const jwk = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'jwk' });
  const h = x => Buffer.from(x, 'base64url').toString('hex');
  const creditKey = V.creditKeyFromJson(JSON.stringify({ n: h(jwk.n), e: h(jwk.e), d: h(jwk.d) }));
  const paid = new Map();   // transfer signature → { lamports, signers }: what the house ring "received"
  const houseRing = 'HouseRing1111111111111111111111111111111111';
  const credits = new V.Credits(new V.FsStore(fs.mkdtempSync(path.join(os.tmpdir(), 'pof-credits-'))), creditKey, { received: async sig => paid.get(sig) || null }, houseRing, 10_000_000n, [5, 20]);
  const http = await import('node:http');
  const seen = { certify: [], claims: [], revoke: [] };
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', c => (b += c)); req.on('end', async () => {
    const send = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    try {
      if (req.method === 'GET' && req.url.startsWith('/api/attest')) return send(200, { relayer: relayer.address, minAgeSlots: 0 });
      if (req.method === 'GET' && req.url.startsWith('/api/relay/credits')) return send(200, credits.offer());
      const j = JSON.parse(b || '{}');
      if (req.url.startsWith('/api/attest')) return send(200, await rv.attest(j));
      if (req.url.startsWith('/api/relay/credits')) { seen.claims.push(j); return send(200, await credits.claim(j)); }
      if (req.url.startsWith('/api/relay/certify')) { seen.certify.push(j); await credits.spend(j.credit, j.attestation); return send(200, { signature: 'stub-certify', certificate: null }); }
      if (req.url.startsWith('/api/relay/revoke')) { seen.revoke.push(j); return send(200, { signature: 'stub-revoke' }); }
      send(404, { error: { code: 'NOT_FOUND' } });
    } catch (e) { send(e.status || 400, { error: { code: e.code, message: e.message } }); }
  }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    const pins = { kid: creditKey.kid, n: creditKey.n, e: creditKey.e, houseRing };
    // CR-01: an offer whose key or house ring differs from the pinned one is refused before anything is paid
    const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'jwk' });
    for (const bad of [{ ...pins, n: h(other.n) }, { ...pins, houseRing: 'Other1111111111111111111111111111111111111' }, { ...pins, kid: 'deadbeef' }]) {
      const X = await createPofClient({ network: 'local', rpc: [RPC], wallet: W, storage: new Map(), programId: PROGRAM, minAgeSlots: 0, clonedTree: cloned, attestUrl: `http://127.0.0.1:${srv.address().port}/api/attest`, creditPins: bad });
      await X.deriveVault();
      await assert.rejects(X.credits.prepare({ count: 5 }), e => e.code === 'CREDIT_KEY_MISMATCH');
    }
    // the devnet pin in this build is the production relayer's key: this test relayer's key is refused against it
    const D = await createPofClient({ network: 'devnet', rpc: [RPC], wallet: W, storage: new Map(), programId: PROGRAM, attestUrl: `http://127.0.0.1:${srv.address().port}/api/attest` });
    await D.deriveVault();
    await assert.rejects(D.credits.prepare({ count: 5 }), e => e.code === 'CREDIT_KEY_MISMATCH');
    // a network with no pin (local without lab pins) cannot buy credits at all
    const N = await createPofClient({ network: 'local', rpc: [RPC], wallet: W, storage: new Map(), programId: PROGRAM, clonedTree: cloned, attestUrl: `http://127.0.0.1:${srv.address().port}/api/attest` });
    await N.deriveVault();
    await assert.rejects(N.credits.prepare({ count: 5 }), e => e.code === 'NO_CREDIT_PIN');
    const R = await createPofClient({ network: 'local', rpc: [RPC], wallet: W, storage: new Map(), programId: PROGRAM, minAgeSlots: 0, clonedTree: cloned, attestUrl: `http://127.0.0.1:${srv.address().port}/api/attest`, creditPins: pins });
    assert.match(await R.credits.fingerprint(), /^([0-9a-f]{4} ){7}[0-9a-f]{4}$/);
    const rvault = await R.deriveVault();
    await assert.rejects(R.certify({ asset: 1, tier: 1, subjectKind: 2 }), e => e.code === 'CREDITS_NEEDED');
    await assert.rejects(R.credits.prepare({ count: 3 }), e => e.code === 'BAD_BUNDLE');
    const pend = await R.credits.prepare({ count: 5 });
    // the private transfer is what devnet proves; here the house ring "received" it from the vault
    const transferSig = V.toB58(new Uint8Array(crypto.randomBytes(64)));
    await assert.rejects(R.credits.claim({ id: pend.id, signature: transferSig }), e => e.code === 'NOT_RECEIVED');
    paid.set(transferSig, { lamports: 40_000_000n, signers: [rvault.owner] });
    await assert.rejects(R.credits.claim({ id: pend.id }), e => e.code === 'WRONG_AMOUNT');
    paid.set(transferSig, { lamports: 50_000_000n, signers: [rvault.owner] });
    assert.equal((await R.credits.claim({ id: pend.id })).count, 5);
    assert.equal(await R.credits.count(), 5);
    // CR-02: the same claim again (a lost answer) is answered again with signatures for the same set; another set for the
    // same transfer is refused
    const again = await credits.claim(seen.claims.at(-1));
    assert.equal(again.signatures.length, 5);
    const B0 = await import('../dist/blind.mjs');
    const otherSet = { ...seen.claims.at(-1), blinded: await Promise.all(Array.from({ length: 5 }, async () => (await B0.blind(creditKey, C.hex(crypto.randomBytes(32)))).blinded)) };
    await assert.rejects(credits.claim(otherSet), e => e.code === 'ALREADY_CLAIMED' || e.code === 'BAD_CLAIM_PROOF');
    // what the relayer saw at the claim are blinded values, none equal to a token or its FDH image
    const B = await import('../dist/blind.mjs');
    assert.equal(fs.readFileSync(new URL('../dist/blind.mjs', import.meta.url), 'utf8'), fs.readFileSync(new URL('../../verifier/lib/blind.mjs', import.meta.url), 'utf8'));
    const done = await R.certify({ asset: 1, tier: 1, subjectKind: 2 });
    assert.equal(done.relayed.signature, 'stub-certify'); assert.equal(done.payment, null);
    const spent = seen.certify[0].credit;
    assert.equal(seen.certify[0].quote, undefined); assert.ok(/^[0-9a-f]{64}$/.test(spent.token));
    const fd = (await B.fdh(creditKey, spent.token)).toString(16);
    assert.ok(!seen.claims[0].blinded.some(x => BigInt('0x' + x).toString(16) === fd), 'the claim never showed the spent token or its hash image');
    assert.equal(await R.credits.count(), 4);
    await assert.rejects(credits.spend(spent, 'another attestation'), e => e.code === 'CREDIT_USED');
    const pv2 = await R.privacy({ subjectKind: 2, pick: await R.choose({ asset: 1, tier: 1 }) });
    assert.ok(!pv2.warnings.some(w => w.code === 'NO_CREDIT'));
    // the relayed revoke: the client's 148 bytes equal the Verifier's revokeBytes, signed by the badge key
    const kit = (await R.kits.list()).find(k => k.attestation === done.attestation);
    const rb = await R.revokeBytesOf(kit);
    const a = V.decodeAttestation(C.unhex(kit.attestation));
    assert.equal(rb.bytes.length, 156);
    assert.equal(C.hex(rb.bytes), C.hex(V.revokeBytesV2(programId, V.fromB58(rb.certificate, 32, 'cert'), a.subjectHash, a.asset, a.nullsetHash, a.issuedSlot, rb.validUntil)));
    const rr = await R.revokeRelayed(kit);
    assert.equal(rr.signature, 'stub-revoke');
    const sent = seen.revoke[0];
    assert.ok(/^\d+$/.test(sent.validUntil), 'validUntil is sent');
    const sentBytes = (await R.revokeBytesOf(kit, { validUntil: BigInt(sent.validUntil) })).bytes;
    assert.ok(V.verifySig(C.unhex(sent.signature), sentBytes, V.fromB58(kit.controller, 32, 'controller')), 'the controller (badge key) signed the 156 bytes with that validUntil');
    await assert.rejects(R.revokeRelayed({ ...kit, subject: { kind: 0, value: 'x' } }), e => e.code === 'RELAY_NOT_FOR_WALLETS');
  } finally { srv.close(); }
  void v;
});
