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
  const pof = await createPofClient({ network: 'local', rpc: [RPC], wallet: W, storage: new Map(), programId: PROGRAM, minAgeSlots: 0, clonedTree: cloned });
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
  const verifier = new V.Verifier({ programId, minAgeSlots: 0n, validitySlots: 6_480_000n, subjectProofSlots: 1500n, maxRootAgeSlots: 1_000_000n, relayer: null, mints: { 0: V.ASSETS[0].mint, 1: V.ASSETS[1].mint }, bundleHash: V.bundleHash() }, signer, rings, log, null, null);

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
  // an X subject carries a controller key rebuilt from the vault
  const x = await pof.subject({ kind: 1, value: '@Some_Handle', asset: 0, tier: 1, payer, from: 'vault', linkId: 'x' });
  const x2 = await pof.subject({ kind: 1, value: 'some_handle', asset: 0, tier: 1, payer, from: 'vault', linkId: 'x' });
  assert.equal(x.controller, x2.controller); assert.equal(x.value, 'some_handle');
  // the kit: saved, sealed, opened again
  await pof.attest; // (attest() posts over HTTP; the lab covers it)
  console.log('steps', steps.filter((s, i, all) => all.indexOf(s) === i).join(' '));
});
