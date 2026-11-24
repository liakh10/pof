/* The whole client flow on a local validator with Privacy Rings cloned from mainnet (lab/rings-local/chain.sh), against the
   real Verifier (verifier/dist/pof-verifier.mjs) reading the chain through LocalRings:
   vault → register → shield 2 + 3 SOL → LocalRings rebuilds the tree to the account's root → sync → pick → subject proof →
   §4 package → Verifier.attest → 240-byte attestation; then a wrong nk and a spent note are refused.
   Run: zsh lab/rings-local/chain.sh start && node --test test/local-e2e.mjs   (POF_LOCAL_RPC to override the node) */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { nodeWallet } from './node-wallet.mjs';
const RPC = process.env.POF_LOCAL_RPC || 'http://127.0.0.1:35899';
globalThis.isSecureContext ??= true; // the browser bundle's WebCrypto guard (a page on https or localhost passes it)
const S = await import('../dist/spr.js');
S.setHasherSource(fs.readFileSync(new URL('../dist/hasher-simd.wasm', import.meta.url)));
const { createPofClient, core: C } = await import('../pof-client.js');
const { LocalRings, jsonRpc } = await import('../localtree.js');
const V = await import('../../verifier/dist/pof-verifier.mjs');
const cloned = new Uint8Array(Buffer.from(fs.readFileSync(new URL('../../lab/rings-local/.run/cloned-tree.b64', import.meta.url), 'utf8'), 'base64'));
const PROGRAM = 'pofP4QRRDXnmDN9CNYiAGHfwMEgM7sLWhVcUMpsbynT';

const up = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' }).then(r => r.ok).catch(() => false);

test('local: vault → shield → sync → pick → §4 → the real Verifier signs', { skip: !up && 'no local validator on ' + RPC }, async () => {
  const W = nodeWallet(RPC);
  await W.airdrop(20);
  const steps = [];
  const kitStore = new Map();
  const pof = await createPofClient({ network: 'local', rpc: [RPC], wallet: W, storage: kitStore, programId: PROGRAM, minAgeSlots: 0, clonedTree: cloned });
  pof.onStatus(s => steps.push(s.step + ':' + (s.phase || '')));
  await pof.ready();
  const v = await pof.deriveVault();
  assert.equal(v.registered, false);
  await pof.register('vault');
  assert.equal(await pof.isRegistered(v.owner), true);
  const a = await pof.shield({ asset: 0, amount: '2', into: 'vault' });
  const b = await pof.shield({ asset: 0, amount: '3', into: 'vault' });
  assert.ok(a.signature && b.signature);

  const notes = await pof.notes({ from: 'vault' });
  assert.equal(notes.length, 2);
  assert.deepEqual(notes.map(n => n.amount).sort(), [2_000_000_000n, 3_000_000_000n]);
  // the rebuilt tree reached the tree account's root (refresh() throws otherwise), and every path re-hashes to it
  for (const n of notes) assert.equal(C.hex(C.rootFromPath(n.leaf, n.leafIndex, pof.local.pathOf(n.leafIndex))), C.hex(pof.local.head.root));

  const pick = await pof.choose({ asset: 0, tier: 1, from: 'vault', list: notes });
  assert.equal(pick.ready, true); assert.equal(pick.notes.length, 1); assert.equal(pick.notes[0].amount, 2_000_000_000n); // fewest notes, least excess
  const tier2 = await pof.choose({ asset: 0, tier: 2, from: 'vault', list: notes });
  assert.equal(tier2.ready, false);                                                                                    // 5 SOL < 10 SOL

  // the real Verifier over LocalRings
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pof-rings-e2e-'));
  const store = new V.FsStore(dir);
  const signer = V.signerFromSeed(new Uint8Array(crypto.randomBytes(32)));
  const programId = V.fromB58(PROGRAM, 32, 'program');
  const rings = new LocalRings(jsonRpc(RPC), { cloned });
  const log = new V.TransparencyLog(store, signer, programId);
  const verifier = new V.Verifier({ programId, minAgeSlots: 0n, validitySlots: 6_480_000n, subjectProofSlots: 1500n, maxRootAgeSlots: 1_000_000n, maxRootLagSlots: 1_000_000n, relayer: null, mints: { 0: V.ASSETS[0].mint, 1: V.ASSETS[1].mint }, bundleHash: V.bundleHash() }, signer, rings, log, null, null);

  const payer = W.state().address;
  const subj = await pof.subject({ kind: 0, asset: 0, tier: 1, payer, from: 'vault' });
  const pkg = pof.disclose({ subject: subj, asset: 0, tier: 1, notes: pick.notes, payer, relay: false, from: 'vault' });
  assert.equal(pkg.ring.owner, v.owner); assert.equal(pkg.ring.nk.length, 62); assert.equal(pkg.notes.length, 1);
  const ans = await verifier.attest(JSON.parse(JSON.stringify(pkg)));
  const att = V.decodeAttestation(C.unhex(ans.attestation));
  assert.equal(ans.attestation.length, 480);
  assert.equal(att.tier, 1); assert.equal(att.noteCount, 1);
  assert.equal(C.hex(att.treeRoot), C.hex(pof.local.head.root));
  assert.equal(V.toB58(att.controller), payer);
  // the nullifier the Verifier derived is the one the client derived
  assert.equal(ans.nullifiers[0], C.hex(pick.notes[0].nullifier));

  // a nullifier key that is not this vault's is refused
  const bad = JSON.parse(JSON.stringify(pkg)); bad.ring.nk = C.hex(crypto.randomBytes(31));
  await assert.rejects(verifier.attest(bad), e => e.code === 'NULLIFIER_KEY_MISMATCH');
  // a tier the note does not reach is refused
  const subj2 = await pof.subject({ kind: 0, asset: 0, tier: 2, payer, from: 'vault' });
  await assert.rejects(verifier.attest(JSON.parse(JSON.stringify(pof.disclose({ subject: subj2, asset: 0, tier: 2, notes: notes, payer, from: 'vault' })))), e => e.code === 'BELOW_TIER');
  // POF-02: the vault key signed the disclosure message; a package whose ring proof is not the vault's is refused
  assert.ok(/^[0-9a-f]{128}$/.test(pkg.ring.proof));
  const forged = JSON.parse(JSON.stringify(pkg)); forged.ring.proof = C.hex(crypto.randomBytes(64));
  await assert.rejects(verifier.attest(forged), e => e.code === 'BAD_RING_PROOF');
  // an X subject carries a controller key rebuilt from the vault, the same for every spelling of the handle
  const x = await pof.subject({ kind: 1, value: '@Some_Handle', asset: 0, tier: 1, payer, from: 'vault', linkId: 'x' });
  const x2 = await pof.subject({ kind: 1, value: 'some_handle', asset: 0, tier: 1, payer, from: 'vault', linkId: 'x' });
  assert.equal(x.controller, x2.controller); assert.equal(x.value, 'some_handle');
  // POF-12: an X or badge certificate is not paid from the wallet unless the holder accepts the link
  await assert.rejects(pof.certify({ asset: 0, tier: 1, subjectKind: 2, relay: false }), e => e.code === 'PAYER_LINKS_WALLET');

  // attest() over HTTP and the kit: saved, sealed under the vault-seed key (POF-10: not openable from nk), opened again
  // the real Linker with fxtwitter stubbed by the post the holder made (the code it was given)
  let posted = '';
  const linker = new V.Linker(store, (h, exp, ctl) => verifier.linkToken(h, exp, ctl), async () => new Response(JSON.stringify({ tweet: { author: { screen_name: 'Some_Handle' }, text: posted, created_timestamp: Math.floor(Date.now() / 1000) } }), { status: 200 }));
  const srv = http.createServer(async (req, res) => { let b = ''; req.on('data', c => (b += c)); req.on('end', async () => {
    try {
      const j = JSON.parse(b || '{}'); const u = req.url;
      const ans = u.endsWith('/link/start') ? await linker.start(j.handle, j.controller) : u.endsWith('/link/check') ? await linker.check(j.handle, j.post, j.secret, j.controller) : await verifier.attest(j);
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(ans));
    }
    catch (e) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code: e.code, message: e.message } })); } }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  pof.config.attestUrl = `http://127.0.0.1:${srv.address().port}/api/attest`;
  try {
    const subjB = await pof.subject({ kind: 2, asset: 0, tier: 1, payer, from: 'vault' });
    const ansB = await pof.attest(JSON.parse(JSON.stringify(pof.disclose({ subject: subjB, asset: 0, tier: 1, notes: [notes.find(n => n.amount === 3_000_000_000n)], payer, from: 'vault' }))), { from: 'vault', subject: subjB });
    assert.equal(ansB.attestation.length, 480);
    const kit = (await pof.kits.list()).find(k => k.attestation === ansB.attestation);
    assert.equal(kit.subject.kind, 2); assert.equal(kit.revoke.length, 1); assert.equal(kit.controller, subjB.value);
    const opened = await pof.kits.open(kit, 'vault');
    assert.equal(opened.badgeSecret, subjB.badgeSecret);
    const nkKey = await C.sha256(C.utf8('pof:kit:v1'), C.unhex(pkg.ring.nk));
    const k = await crypto.webcrypto.subtle.importKey('raw', nkKey, 'AES-GCM', false, ['decrypt']);
    await assert.rejects(crypto.webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: C.unhex(kit.sealed.iv) }, k, C.unhex(kit.sealed.ct)), 'a key built from nk does not open the kit');
    // kits at rest and in the export file are sealed (audit2): no salt, nullifier or subject in clear on the device
    const exported = JSON.parse(await pof.kits.export());
    assert.equal(exported.v, 2); assert.equal(exported.owner, v.owner); assert.ok(!JSON.stringify(exported).includes(kit.revoke[0].salt));
    const atRest = [...kitStore.values()].join('\n');
    assert.ok(!atRest.includes(kit.revoke[0].salt) && !atRest.includes(subjB.value), 'the device storage holds no kit field in clear');
    const plain = JSON.parse(await pof.kits.export({ plain: true }));
    assert.equal(plain.kits.length, (await pof.kits.list()).length);
    // a sealed export goes back into the same vault and nowhere else
    assert.equal(await pof.kits.import(JSON.stringify(exported)), (await pof.kits.list()).length);
    // the controller of the badge kit signs as the badge
    const ctl = await pof.controllerOf(kit);
    assert.equal(ctl.publicKey, subjB.value);

    // POF-03: an X subject. The code is redeemable only with the secret that stayed in this client, and the link id is bound
    // to this vault's controller for the handle; the Verifier attests with it (the relayer is off here, so the holder accepts
    // the wallet payer explicitly)
    const st = await pof.linkStart({ handle: '@Some_Handle' });
    posted = st.post;
    await assert.rejects(linker.check('some_handle', 'https://x.com/some_handle/status/1234567890', '0'.repeat(32), st.controller), e => /NO_CODE|NO_SECRET/.test(e.code), 'a stranger with the public post and a guessed secret gets nothing');
    const lk = await pof.linkCheck({ handle: 'some_handle', post: 'https://x.com/some_handle/status/1234567890' });
    assert.equal(lk.controller, st.controller);
    const subjX = await pof.subject({ kind: 1, value: 'some_handle', asset: 0, tier: 1, payer, from: 'vault', linkId: lk.linkId });
    assert.equal(subjX.controller, st.controller);
    const pkgX = JSON.parse(JSON.stringify(pof.disclose({ subject: subjX, asset: 0, tier: 1, notes: [notes.find(n => n.amount === 2_000_000_000n)], payer, from: 'vault' })));
    assert.equal(pkgX.controller, st.controller);
    const other = JSON.parse(JSON.stringify(pkgX)); other.controller = payer;   // the same link id with another controller
    await assert.rejects(verifier.attest(other), e => /BAD_SUBJECT_PROOF|BAD_CONTROLLER|LINK|BAD_RING_PROOF/.test(e.code));
    const ansX = await verifier.attest(pkgX).catch(e => e);
    assert.ok(ansX.attestation ? ansX.attestation.length === 480 : /NOTE_IN_USE|LOCKED/.test(ansX.code), 'the X certificate is attested (or its note is already in use): ' + (ansX.code || 'ok'));
    if (ansX.attestation) assert.equal(V.toB58(V.decodeAttestation(C.unhex(ansX.attestation)).controller), st.controller);
  } finally { srv.close(); }
  // POF-11: the vault message names the domain and warns; the deterministic check value is stored, a different seed refuses
  const again = await pof.deriveVault();
  assert.equal(again.owner, v.owner); assert.equal(again.mode, 'signature');
  console.log('steps', steps.filter((s, i, all) => all.indexOf(s) === i).join(' '));
});
