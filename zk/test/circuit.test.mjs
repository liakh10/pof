// The circuit end to end with snarkjs: valid proofs, and every way a proof must fail. Needs the build (scripts/build.sh) and
// the setup (scripts/ceremony.sh, or the committed setup/). Run: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as snarkjs from 'snarkjs';
import * as Z from '../js/zk.js';
import { scenario, WASM, ZKEY, VKEY, ONE_SOL } from './fixtures.mjs';

const vkey = JSON.parse(fs.readFileSync(VKEY, 'utf8'));
const timings = [];

async function witnessFails(input, why) {
  await assert.rejects(snarkjs.wtns.calculate(input, WASM, { type: 'mem' }), /Assert Failed|Error in template|Not enough values|Too many values/, why);
}
async function proveOk(s) {
  const b = Z.buildInputs(s.P, s);
  const t0 = performance.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(b.input, WASM, ZKEY);
  timings.push(performance.now() - t0);
  assert.deepEqual(publicSignals, b.publicSignals, 'the public signals come out in the documented order');
  assert.equal(await snarkjs.groth16.verify(vkey, publicSignals, proof), true);
  return { proof, publicSignals, b };
}

test('one note above the tier: proves and verifies', async () => {
  const s = await scenario({ amounts: [3n * ONE_SOL], minAmount: ONE_SOL });
  const { publicSignals } = await proveOk(s);
  assert.equal(publicSignals.slice(10, 13).join(), '0,0,0', 'unused tags are zero');
});

test('four notes summing exactly to the minimum: proves and verifies', async () => {
  const s = await scenario({ amounts: [4n * ONE_SOL, 3n * ONE_SOL, 2n * ONE_SOL, ONE_SOL], minAmount: 10n * ONE_SOL });
  const { b } = await proveOk(s);
  const tags = b.notes.map(n => n.tag);
  assert.deepEqual([...tags].sort((x, y) => (x < y ? -1 : 1)), tags, 'tags ascending (the program refuses any other order)');
});

test('amount below the tier: no witness', async () => {
  const s = await scenario({ amounts: [ONE_SOL, ONE_SOL / 2n], minAmount: 2n * ONE_SOL });
  await witnessFails(Z.buildInputs(s.P, s).input, 'sum 1.5 SOL against a 2 SOL minimum');
});

test('wrong state root: no witness, and a proof does not verify under another root', async () => {
  const s = await scenario();
  const b = Z.buildInputs(s.P, { ...s, pub: { ...s.pub, stateRoot: s.pub.stateRoot + 1n } });
  await witnessFails(b.input, 'root that the notes are not under');
  const { proof, publicSignals } = await proveOk(await scenario());
  const other = [...publicSignals]; other[0] = (BigInt(other[0]) ^ 1n).toString();
  assert.equal(await snarkjs.groth16.verify(vkey, other, proof), false);
  const otherNull = [...publicSignals]; otherNull[1] = (BigInt(otherNull[1]) ^ 1n).toString();
  assert.equal(await snarkjs.groth16.verify(vkey, otherNull, proof), false);
});

test('wrong nk: the commitments are not the leaves, no witness', async () => {
  const s = await scenario();
  await witnessFails(Z.buildInputs(s.P, { ...s, ring: { ...s.ring, nk: s.ring.nk + 1n } }).input, 'another nullifier key');
  const s2 = await scenario();
  await witnessFails(Z.buildInputs(s2.P, { ...s2, ring: { ...s2.ring, ownerKey: new Uint8Array(32).fill(9) } }).input, 'another owner');
});

test('a spent note (its nullifier is in the nullifier tree): no witness', async () => {
  const s = await scenario({ amounts: [3n * ONE_SOL], spent: [0] });
  await witnessFails(Z.buildInputs(s.P, s).input, 'the low leaf of a present nullifier ends at it, so low < nf < next fails');
});

test('replay to another subject, payer, tier or asset: the context differs and the proof does not verify', async () => {
  const base = { programId: new Uint8Array(32).fill(1), subjectKind: 0, subjectHash: new Uint8Array(32).fill(2), asset: 0, tier: 1,
    controller: new Uint8Array(32).fill(3), payer: new Uint8Array(32).fill(4), nonce: new Uint8Array(16).fill(5) };
  const ctx = await Z.context(base);
  assert.ok(ctx < 1n << 253n);
  const s = await scenario({ ctx });
  const { proof, publicSignals } = await proveOk(s);
  for (const change of [{ subjectHash: new Uint8Array(32).fill(7) }, { payer: new Uint8Array(32).fill(8) }, { tier: 2 }, { asset: 1 }, { controller: new Uint8Array(32).fill(9) }, { nonce: new Uint8Array(16) }]) {
    const other = await Z.context({ ...base, ...change });
    assert.notEqual(other, ctx);
    const ps = [...publicSignals]; ps[4] = other.toString();
    assert.equal(await snarkjs.groth16.verify(vkey, ps, proof), false, JSON.stringify(Object.keys(change)));
  }
  // a higher minimum with the same proof
  const ps = [...publicSignals]; ps[3] = (BigInt(ps[3]) * 10n).toString();
  assert.equal(await snarkjs.groth16.verify(vkey, ps, proof), false);
});

test('malformed inputs: no witness', async () => {
  const s = await scenario({ amounts: [2n * ONE_SOL, 2n * ONE_SOL] });
  const good = Z.buildInputs(s.P, s).input;
  const clone = () => JSON.parse(JSON.stringify(good));
  let x = clone(); x.enabled[0] = '2'; await witnessFails(x, 'enabled not a bit');
  x = clone(); x.enabled = ['0', '1', '0', '0']; await witnessFails(x, 'first slot unused');
  x = clone(); x.enabled = ['1', '0', '1', '0']; [x.amount[2], x.blinding[2], x.leafIndex[2], x.statePath[2], x.lowValue[2], x.nextValue[2], x.lowIndex[2], x.nullPath[2], x.tag[2], x.ct[2], x.ringTerm[2]] =
    [x.amount[1], x.blinding[1], x.leafIndex[1], x.statePath[1], x.lowValue[1], x.nextValue[1], x.lowIndex[1], x.nullPath[1], x.tag[1], x.ct[1], x.ringTerm[1]];
  x.enabled[1] = '0'; x.tag[1] = '0'; x.ct[1] = '0'; await witnessFails(x, 'a gap among the used slots');
  x = clone(); x.tag[2] = '5'; await witnessFails(x, 'an unused slot with a tag');
  x = clone(); x.tag[0] = (BigInt(x.tag[0]) + 1n).toString(); await witnessFails(x, 'a tag that is not the nullifier\'s');
  x = clone(); x.ct[1] = (BigInt(x.ct[1]) + 1n).toString(); await witnessFails(x, 'a ciphertext the revocation key would not open');
  x = clone(); x.ephX = '1'; await witnessFails(x, 'an ephemeral point that is not r·B8');
  x = clone(); x.minAmount = (1n << 64n).toString(); await witnessFails(x, 'a minimum over u64');
  x = clone(); x.leafIndex[0] = (BigInt(x.leafIndex[0]) + (1n << 32n)).toString(); await witnessFails(x, 'a leaf index over 32 bits');
  x = clone(); x.statePath[0][3] = '1'; await witnessFails(x, 'a broken state path');
  x = clone(); x.nullPath[1][0] = '1'; await witnessFails(x, 'a broken nullifier path');
  x = clone(); delete x.nk; await witnessFails(x, 'a missing signal');
  // amounts over u64: the range check refuses them even when the tree really holds such a leaf
  const big = await scenario({ amounts: [1n << 64n], minAmount: ONE_SOL });
  await witnessFails(Z.buildInputs(big.P, big).input, 'amount 2^64');
  assert.throws(() => Z.buildInputs(s.P, { ...s, notes: [s.notes[0], s.notes[0]] }), /the same note twice/);
});

test('a changed proof does not verify', async () => {
  const { proof, publicSignals } = await proveOk(await scenario());
  const p = JSON.parse(JSON.stringify(proof));
  p.pi_a[0] = (BigInt(p.pi_a[0]) + 1n).toString();
  assert.equal(await snarkjs.groth16.verify(vkey, publicSignals, p).catch(() => false), false);
  const q = JSON.parse(JSON.stringify(proof)); [q.pi_c, q.pi_a] = [q.pi_a, q.pi_c];
  assert.equal(await snarkjs.groth16.verify(vkey, publicSignals, q).catch(() => false), false);
});

test('the escrow: the revocation key opens every nullifier; another key does not', async () => {
  const s = await scenario({ amounts: [ONE_SOL, 2n * ONE_SOL, 3n * ONE_SOL] });
  const { publicSignals, b } = await proveOk(s);
  const eph = [BigInt(publicSignals[7]), BigInt(publicSignals[8])];
  const tags = publicSignals.slice(9, 13), cts = publicSignals.slice(13, 17);
  const nfs = Z.openEscrow(s.P, s.escrow.secret, eph, cts, tags);
  assert.deepEqual(nfs.slice(0, 3), b.notes.map(n => n.nullifier));
  assert.equal(nfs[3], null);
  assert.ok(Z.onCurve(Z.escrowKeypair().public));
  assert.throws(() => Z.openEscrow(s.P, s.escrow.secret + 1n, eph, cts, tags), /does not open/);
});

test.after(() => {
  if (timings.length) {
    const t = timings.sort((a, b) => a - b);
    console.log(`# node fullProve: ${t.length} proofs, median ${Math.round(t[t.length >> 1])} ms, min ${Math.round(t[0])} ms, max ${Math.round(t[t.length - 1])} ms`);
  }
  // snarkjs keeps worker threads alive
  setTimeout(() => process.exit(0), 50).unref();
});
