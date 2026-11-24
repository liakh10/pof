import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { V, hex, tmpdir } from './helpers.mjs';

test('§1 subject hashes', () => {
  assert.equal(hex(V.subjectHash(1, '@Some_Anon')), hex(V.sha256(Buffer.from('pof:x:some_anon'))));
  const w = '11111111111111111111111111111111';
  assert.equal(hex(V.subjectHash(0, w)), crypto.createHash('sha256').update('pof:wallet:' + w).digest('hex'));
  assert.equal(hex(V.subjectHash(2, w)), crypto.createHash('sha256').update('pof:badge:' + w).digest('hex'));
  assert.throws(() => V.subjectHash(1, 'bad handle!'), { code: 'BAD_HANDLE' });
  assert.throws(() => V.subjectHash(3, w), { code: 'BAD_SUBJECT_KIND' });
});

test('§2 tier table', () => {
  assert.equal(V.tierMinimum(0, 1), 1_000_000_000n); assert.equal(V.tierMinimum(0, 5), 10_000n * 1_000_000_000n);
  assert.equal(V.tierMinimum(1, 1), 100_000_000n); assert.equal(V.tierMinimum(1, 5), 1_000_000_000_000n);
});

test('§3 bytes: every field at its offset, round trip', () => {
  const r = (n) => new Uint8Array(crypto.randomBytes(n));
  const a = { programId: r(32), subjectKind: 1, subjectHash: r(32), asset: 1, tier: 4, treeRoot: r(32), rootSlot: 473505086n, noteCount: 3, nullsetHash: r(32), issuedSlot: 473505100n, expirySlot: 479985100n, payer: r(32), controller: r(32), nonce: r(16) };
  const b = V.encodeAttestation(a);
  assert.equal(b.length, 240);
  assert.equal(Buffer.from(b.subarray(0, 4)).toString(), 'POF1');
  assert.equal(hex(b.subarray(4, 36)), hex(a.programId)); assert.equal(b[36], 1); assert.equal(hex(b.subarray(37, 69)), hex(a.subjectHash));
  assert.equal(b[69], 1); assert.equal(b[70], 4); assert.equal(hex(b.subarray(71, 103)), hex(a.treeRoot));
  assert.equal(Buffer.from(b).readBigUInt64LE(103), a.rootSlot); assert.equal(b[111], 3); assert.equal(hex(b.subarray(112, 144)), hex(a.nullsetHash));
  assert.equal(Buffer.from(b).readBigUInt64LE(144), a.issuedSlot); assert.equal(Buffer.from(b).readBigUInt64LE(152), a.expirySlot);
  assert.equal(hex(b.subarray(160, 192)), hex(a.payer)); assert.equal(hex(b.subarray(192, 224)), hex(a.controller)); assert.equal(hex(b.subarray(224, 240)), hex(a.nonce));
  assert.deepEqual(V.decodeAttestation(b), a);
  assert.throws(() => V.decodeAttestation(b.subarray(1)), { code: 'BAD_ATTESTATION' });
});

test('§5 salted nullifiers and the nullset hash', () => {
  const salt = new Uint8Array(32).fill(1), nf = new Uint8Array(32).fill(2);
  assert.equal(hex(V.saltedNullifier(salt, nf)), crypto.createHash('sha256').update(Buffer.concat([Buffer.from('pof:null:'), salt, nf])).digest('hex'));
  const hs = [new Uint8Array(32).fill(9), new Uint8Array(32).fill(3), new Uint8Array(32).fill(5)];
  const s = V.sortHashes(hs);
  assert.deepEqual(s.map(x => x[0]), [3, 5, 9]);
  assert.equal(hex(V.nullsetHash(s)), crypto.createHash('sha256').update(Buffer.concat(s)).digest('hex'));
});

test('§7 leaf, signed tree head, memo', () => {
  const l = V.logLeaf(new Uint8Array(240).fill(1), new Uint8Array(64).fill(2), new Uint8Array(32).fill(3), new Uint8Array(32).fill(4), 77n);
  assert.equal(l.length, 377); assert.equal(l[0], 1); assert.equal(l[241], 2); assert.equal(l[305], 3); assert.equal(l[337], 4); assert.equal(Buffer.from(l).readBigUInt64LE(369), 77n);
  assert.equal(V.sthBytes(new Uint8Array(32), 5, new Uint8Array(32)).length, 80);
  assert.equal(V.anchorMemo(5, new Uint8Array(32).fill(0xab)), 'pof:log:5:' + 'ab'.repeat(32));
});

test('RFC 9162 Merkle: every inclusion and consistency proof for sizes 1..33 verifies, tampering fails', () => {
  const leaves = Array.from({ length: 33 }, (_, i) => V.merkle.leafHash(Buffer.from('leaf' + i)));
  for (let n = 1; n <= 33; n++) {
    const h = leaves.slice(0, n), root = V.merkle.root(h);
    for (let i = 0; i < n; i++) {
      const p = V.merkle.inclusionPath(h, i);
      assert.ok(V.merkle.verifyInclusion(h[i], i, n, p, root), `incl ${i}/${n}`);
      assert.ok(!V.merkle.verifyInclusion(h[(i + 1) % n === i ? 0 : (i + 1) % n], i, n, p, root) || n === 1);
    }
    for (let m = 1; m <= n; m++) {
      const p = V.merkle.consistencyProof(h, m);
      assert.ok(V.merkle.verifyConsistency(m, n, V.merkle.root(h.slice(0, m)), root, p), `cons ${m}/${n}`);
      if (m < n) assert.ok(!V.merkle.verifyConsistency(m, n, V.merkle.root(h.slice(0, m)), V.merkle.leafHash(Buffer.from('x')), p));
    }
  }
  // the RFC 6962/9162 empty-tree root
  assert.equal(hex(V.merkle.root([])), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('log: 40 concurrent appends from 4 instances land at 40 distinct, gap-free indexes; the head is signed', async () => {
  const dir = tmpdir();
  const signer = V.signerFromSeed(new Uint8Array(crypto.randomBytes(32)));
  const pid = new Uint8Array(32).fill(5);
  const logs = Array.from({ length: 4 }, () => new V.TransparencyLog(new V.FsStore(dir), signer, pid));
  const leaf = (i) => V.logLeaf(new Uint8Array(240).fill(i), new Uint8Array(64), signer.publicKey, new Uint8Array(32), BigInt(i));
  const idx = await Promise.all(Array.from({ length: 40 }, (_, i) => logs[i % 4].append(leaf(i))));
  assert.deepEqual([...idx].sort((a, b) => a - b), Array.from({ length: 40 }, (_, i) => i));
  const fresh = new V.TransparencyLog(new V.FsStore(dir), signer, pid);
  const h = await fresh.head();
  assert.equal(h.treeSize, 40);
  assert.ok(V.verifySig(Buffer.from(h.signature, 'hex'), V.sthBytes(pid, 40, Buffer.from(h.rootHash, 'hex')), signer.publicKey));
  const p = await fresh.proof(17, 30);
  const e = await fresh.entry(17);
  assert.ok(V.merkle.verifyInclusion(Buffer.from(e.leafHash, 'hex'), 17, 30, p.path.map(x => Buffer.from(x, 'hex')), Buffer.from(p.rootHash, 'hex')));
  const c = await fresh.consistency(30);
  assert.ok(V.merkle.verifyConsistency(30, 40, Buffer.from(c.firstRoot, 'hex'), Buffer.from(c.secondRoot, 'hex'), c.path.map(x => Buffer.from(x, 'hex'))));
  // a stale hash cache is caught up by probing
  await new V.FsStore(dir).put('log/hashes', new Uint8Array(0));
  assert.equal((await new V.TransparencyLog(new V.FsStore(dir), signer, pid).head()).rootHash, h.rootHash);
  await assert.rejects(fresh.proof(40), { code: 'BAD_RANGE' });
  await assert.rejects(fresh.entry(99), { code: 'NOT_FOUND' });
});

test('the bundle hash is the published BUILD.json hash', async () => {
  const fs = await import('node:fs');
  const b = JSON.parse(fs.readFileSync(new URL('../dist/BUILD.json', import.meta.url)));
  assert.equal(hex(V.bundleHash()), b.sha256);
});

test('signatures in §4 pass as base58 (up to 88 chars) or hex', async () => {
  const s = V.signerFromSeed(new Uint8Array(crypto.randomBytes(32)));
  for (let i = 0; i < 20; i++) {
    const sig = s.sign(new Uint8Array(crypto.randomBytes(16)));
    const b58 = V.toB58(sig);
    assert.equal(hex(V.fromB58(b58, 64, 'sig')), hex(sig));
  }
  const tiny = new Uint8Array(64); tiny[63] = 1;
  assert.equal(hex(V.fromB58(V.toB58(tiny), 64)), hex(tiny));
  assert.throws(() => V.fromB58('1'.repeat(129), 64), { code: 'BAD_BASE58' });
  assert.throws(() => V.fromB58(V.toB58(new Uint8Array(32).fill(1)), 64), { code: 'BAD_LENGTH' });
});
