/* core.js through the browser bundle (dist/spr.js) against public mainnet vectors (test/vectors.json, made by
   tools/facts/vectors.mjs): deposit leaves recomputed from public data, a Merkle path to the root, note picking, the §4 shapes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
globalThis.isSecureContext ??= true; // the browser bundle's WebCrypto guard (a page on https or localhost passes it)
const S = await import('../dist/spr.js');
S.setHasherSource(fs.readFileSync(new URL('../dist/hasher-simd.wasm', import.meta.url)));
const C = await import('../core.js');
await C.ready();
const V = JSON.parse(fs.readFileSync(new URL('./vectors.json', import.meta.url)));

test('hasher loads from the bundle and reports ready', () => {
  assert.equal(S.hasherState().phase, 'ready');
  assert.equal(S.isPoseidonInitialized(), true);
});
test('deposit commitments from public mainnet data equal the leaves the indexer holds', () => {
  for (const d of V.deposits) {
    const c = C.commitment({ ownerHash: C.unhex(d.ownerHash, 32), asset: C.ASSETS[0].mint, amount: BigInt(d.amount), blinding: C.depositBlinding(V.tree, d.leafIndex) });
    assert.equal(C.hex(c), d.leaf, d.sig);
  }
});
test('the state-tree path re-hashes to its root', () => {
  const m = V.merkle;
  assert.equal(C.hex(C.rootFromPath(C.unhex(m.leaf), m.leafIndex, m.path.map(p => C.unhex(p)))), m.root);
});
test('owner hash and nullifier: the SDK key objects agree with core', () => {
  const kp = S.ShieldedKeypair.generate();
  const nk = kp.nullifierKey(); const nkBytes = nk.secretBytes();
  const pub = kp.signingPublicKey();
  const owner = pub.ed25519 ? pub.ed25519() : pub.confidentialViewTag();
  assert.equal(C.hex(C.nullifierPublicKey(nkBytes)), C.hex(nk.publicKey()));
  assert.equal(C.hex(C.ownerHash(owner, nk.publicKey())), C.hex(kp.ownerHash()));
  const blinding = C.depositBlinding(V.tree, 5);
  const commit = C.commitment({ ownerHash: kp.ownerHash(), asset: C.ASSETS[0].mint, amount: 7n, blinding });
  const sdkUtxo = new S.Utxo({ owner: pub, asset: C.ASSETS[0].mint, amount: 7n, blinding });
  assert.equal(C.hex(commit), C.hex(sdkUtxo.hash(nk.publicKey(), 0)));
  assert.equal(C.hex(C.nullifier(commit, blinding, nkBytes)), C.hex(nk.nullifier(commit, blinding)));
});
test('pickNotes: fewest notes first, then least excess', () => {
  const n = (a, id) => ({ id, amount: BigInt(a) });
  assert.deepEqual(C.pickNotes([n(5, 'a'), n(60, 'b'), n(120, 'c'), n(101, 'd')], 100).notes.map(x => x.id), ['d']);
  const two = C.pickNotes([n(50, 'a'), n(60, 'b'), n(45, 'c'), n(55, 'd')], 100);
  assert.equal(two.notes.length, 2); assert.equal(two.sum, 100n);
  assert.equal(C.pickNotes([n(1, 'a'), n(1, 'b')], 100), null);
  const many = Array.from({ length: 40 }, (_, i) => n(10 + i, 'n' + i));
  const r = C.pickNotes(many, 300); assert.equal(r.notes.length, 7); assert.equal(r.sum, 300n); // 49+…+43 = 322 is the most 7 can give
  assert.equal(C.pickNotes(many, 400), null);                                                // 8 notes give at most 364
  assert.equal(C.pickNotes(Array.from({ length: 9 }, (_, i) => n(10, 'x' + i)), 90), null); // 9 notes needed, 8 allowed
});
test('the disclosure message is the Verifier\'s, byte for byte', async () => {
  const args = { programId: 'P', kind: 1, value: '@Some_Handle', ring: 'R', controller: 'K', asset: 1, tier: 2, payer: 'Y', slot: 9n };
  const mine = C.disclosureMessage(args);
  assert.equal(new TextDecoder().decode(mine), 'Proof of Funds: disclosure v2\nprogram: P\nsubject: x some_handle\nring: R\ncontroller: K\nasset: USDC tier: 2\npayer: Y\nslot: 9');
  const V = await import('../../verifier/dist/pof-verifier.mjs');
  if (V.disclosureMessage) assert.equal(C.hex(mine), C.hex(V.disclosureMessage(args)));
});
test('units', () => {
  assert.equal(C.parseUnits('1.5', 9), 1_500_000_000n); assert.equal(C.formatUnits(1_500_000_000n, 9), '1.5');
  assert.equal(C.formatUnits(100_000_000n, 6), '100'); assert.throws(() => C.parseUnits('1.1234567', 6));
});
