// The circuit's hashes are the Rings hashes: circomlib Poseidon equals the Rings SDK hasher (light-poseidon) input for input,
// and the commitment formula the circuit uses reproduces real mainnet deposit leaves (public data, pof/client/test/vectors.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as Z from '../js/zk.js';
import { poseidon, root } from './fixtures.mjs';

const SPR = path.resolve(root, '../client/node_modules/@heliuslabs/spr/dist');
const H = await import(SPR + '/hasher/index.js');
const T = await import(SPR + '/transaction/index.js');
await H.initializePoseidon();
const sdk = Z.fromBytesPoseidon(H.poseidon);

test('Poseidon: circomlib = the Rings SDK for 1, 2, 3, 4 and 7 inputs', async () => {
  const P = await poseidon();
  for (const n of [1, 2, 3, 4, 7]) {
    for (let k = 0; k < 5; k++) {
      const xs = Array.from({ length: n }, (_, i) => (BigInt(i + 1) * 0x9e3779b97f4a7c15n * BigInt(k + 3)) ** 3n % Z.FIELD);
      assert.equal(P(xs), sdk(xs), `${n} inputs`);
    }
  }
});

test('hashBytes, the owner identity and the asset hash = the SDK', async () => {
  const P = await poseidon();
  const key = Uint8Array.from({ length: 32 }, (_, i) => 200 - i);
  assert.equal(Z.ownerId(P, key), Z.toBig(H.solanaOwnerIdentity(key)));
  for (const mint of [new Uint8Array(32), Uint8Array.from({ length: 32 }, (_, i) => i * 7)]) assert.equal(Z.assetHash(P, mint), Z.toBig(H.hashBytes(mint)));
});

test('the commitment formula reproduces real mainnet deposit leaves', async () => {
  const P = await poseidon();
  const v = JSON.parse(fs.readFileSync(path.resolve(root, '../client/test/vectors.json'), 'utf8'));
  const asset = Z.assetHash(P, new Uint8Array(32));
  let checked = 0;
  for (const d of v.deposits) {
    const blinding = Z.toBig(T.depositBlinding(v.tree, BigInt(d.leafIndex)));
    const owner = BigInt('0x' + d.ownerHash);
    const leaf = P([3n, 0n, asset, BigInt(d.amount), 0n, P([0n, 0n]), P([owner, blinding])]);
    assert.equal(leaf.toString(16).padStart(64, '0'), d.leaf, `deposit ${d.sig.slice(0, 8)}`);
    checked++;
  }
  assert.ok(checked >= 3);
});

test('the nullifier and the owner hash match the SDK formula (RINGS §3)', async () => {
  const P = await poseidon();
  const nk = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abn;
  const key = new Uint8Array(32).fill(5);
  const h = Z.noteHashes(P, { ownerId: Z.ownerId(P, key), nk, asset: Z.assetHash(P, new Uint8Array(32)), amount: 5n, blinding: 77n });
  const npk = H.poseidon([Z.be32(nk)]);
  const owner = H.poseidon([H.solanaOwnerIdentity(key), npk]);
  assert.equal(h.owner, Z.toBig(owner));
  assert.equal(h.nullifier, sdk([h.commitment, 77n, nk]));
});
