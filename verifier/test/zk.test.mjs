/* Phase 2 in the keeper: the escrow arithmetic equals zk/js/zk.js (the circuit's), the NoteLock layout equals the zk build's
   IDL, and a scan over zk certificates revokes the spent one with its note lock as the first remaining account (FZ-18),
   skips the rest, and does nothing without a revocation key. The on-chain run is lab/test/zk-e2e.mjs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as internal from '@heliuslabs/spr/internal';
import { V, tmpdir, hex } from './helpers.mjs';

const Z = await import('../../zk/js/zk.js');
const P = Z.fromBytesPoseidon(internal.poseidon);
const IDL = JSON.parse(fs.readFileSync(new URL('../../program/idl/pof-zk.json', import.meta.url), 'utf8'));

/* one lock as certify_zk writes it, for a nullifier at slot `slot` of a certificate */
function makeLock(K, nf, slot, certificate) {
  const r = Z.ephemeralScalar();
  const R = Z.mulPt(Z.B8, r), S = Z.mulPt(K.public, r);
  const ct = (nf + Z.pads(P, S)[slot]) % Z.FIELD;
  const d = new Uint8Array(V.zk.NOTE_LOCK_SIZE);
  d.set(V.zk.NOTE_LOCK_DISC, 0); d.set(certificate, 8); d.set(Z.be32(P([Z.TAG_DOMAIN, nf])), 40); d.set(crypto.randomBytes(32), 72);
  d.set(Z.be32(R[0]), 104); d.set(Z.be32(R[1]), 136); d.set(Z.be32(ct), 168);
  return d;
}

test('openLock equals zk.js openEscrow and refuses another key', async () => {
  const K = Z.escrowKeypair();
  const nf = 12345678901234567890123456789n;
  const lock = V.zk.decodeNoteLock('x', makeLock(K, nf, 2, new Uint8Array(32)));
  assert.equal(hex(await V.zk.openLock(K.secret, lock, 2)), hex(Z.be32(nf)));
  assert.equal(Z.openEscrow(P, K.secret, lock.eph.map(Z.toBig), [0n, 0n, Z.toBig(lock.ct), 0n], [0n, 0n, Z.toBig(lock.tag), 0n])[2], nf);
  await assert.rejects(V.zk.openLock(Z.escrowKeypair().secret, lock, 2), /does not open/);
  await assert.rejects(V.zk.openLock(K.secret, lock, 1), /does not open/);     // the pad index is the tag's slot
  assert.equal(hex(await V.zk.zkTag(Z.be32(nf))), hex(lock.tag));
});

test('the NoteLock layout and discriminator are the zk build IDL\'s', () => {
  const a = IDL.accounts.find(x => x.name === 'NoteLock');
  assert.deepEqual([...V.zk.NOTE_LOCK_DISC], a.discriminator);
  const f = IDL.types.find(x => x.name === 'NoteLock').type.fields.map(x => x.name);
  assert.deepEqual(f, ['certificate', 'tag', 'payer', 'eph', 'ct', 'escrow_epoch', 'locked_slot', 'bump', 'spent']);
  assert.equal(V.zk.NOTE_LOCK_SIZE, 214);
  const d = makeLock(Z.escrowKeypair(), 5n, 0, new Uint8Array(32).fill(3)); d[213] = 1; new DataView(d.buffer).setUint32(200, 7, true);
  const l = V.zk.decodeNoteLock('y', d);
  assert.equal(l.spent, true); assert.equal(l.epoch, 7); assert.equal(hex(l.certificate), '03'.repeat(32));
});

test('POF_ZK_ESCROW_KEYS: epochs, a bare key is epoch 0, out-of-range keys refused', () => {
  const k = V.zk.escrowKeys('0:' + '00'.repeat(31) + '05,3:' + '00'.repeat(31) + '09');
  assert.equal(k.get(0), 5n); assert.equal(k.get(3), 9n);
  assert.equal(V.zk.escrowKeys('00'.repeat(31) + '02').get(0), 2n);
  assert.equal(V.zk.escrowKeys(undefined).size, 0);
  assert.throws(() => V.zk.escrowKeys('ff'.repeat(32)), /out of range/);
});

test('scanZk: opens every live zk certificate, revokes the spent note with its lock, skips dead ones and other verifiers', async () => {
  const K = Z.escrowKeypair();
  const ZKC = 'ZkConfig1111111111111111111111111111111111';
  const certA = crypto.randomBytes(32), certB = crypto.randomBytes(32), certC = crypto.randomBytes(32);
  const nfA = [11n, 22n], nfB = [33n], nfC = [44n];
  const tagsOf = nfs => nfs.map(n => Z.be32(P([Z.TAG_DOMAIN, n]))).sort(Buffer.compare);
  const sortedNf = nfs => nfs.slice().sort((x, y) => Buffer.compare(Buffer.from(Z.be32(P([Z.TAG_DOMAIN, x]))), Buffer.from(Z.be32(P([Z.TAG_DOMAIN, y])))));
  const lockRows = [];
  const add = (cert, nfs) => sortedNf(nfs).forEach((n, slot) => lockRows.push(V.zk.decodeNoteLock('lock' + lockRows.length, makeLock(K, n, slot, cert))));
  add(certA, nfA); add(certB, nfB); add(certC, nfC);
  const view = (cert, nfs, o = {}) => ({ address: V.toB58(cert), status: 0, tier: 1, expirySlot: 10_000n, hashes: tagsOf(nfs).map(hex), payer: 'p', verifier: ZKC, subjectHash: hex(crypto.randomBytes(32)), asset: 0, ...o });
  const certs = { [V.toB58(certA)]: view(certA, nfA), [V.toB58(certB)]: view(certB, nfB, { status: 2 }), [V.toB58(certC)]: view(certC, nfC, { verifier: 'someVerifierKey' }) };
  const spentSet = new Set([hex(Z.be32(22n)), hex(Z.be32(33n)), hex(Z.be32(44n))]);
  const revoked = [];
  const chain = {
    zkConfig: ZKC, slot: async () => 100n, zkLocks: async () => lockRows, certificatesAt: async a => a.map(x => certs[x] || null),
    revokeSpent: async x => { revoked.push(x); return { signature: 'sig' + revoked.length, lamports: 0n }; },
  };
  const rings = { spent: async (_t, nfs) => nfs.map(n => spentSet.has(hex(n))) };
  const keeper = new V.Keeper(new V.FsStore(tmpdir()), new Uint8Array(32).fill(1), rings, chain);
  keeper.zkKeys = new Map([[0, K.secret]]);
  const out = await keeper.scanZk();
  assert.equal(out.locks, 4); assert.equal(out.live, 0); assert.equal(out.revoked.length, 1, JSON.stringify(out));
  const x = revoked[0];
  const idx22 = sortedNf(nfA).indexOf(22n);
  assert.equal(x.index, idx22); assert.equal(hex(x.nullifier), hex(Z.be32(22n))); assert.equal(hex(x.salt), '00'.repeat(32));
  assert.equal(x.zkLock, lockRows.find(l => hex(l.tag) === hex(Z.be32(P([Z.TAG_DOMAIN, 22n])))).address, 'the spent note\'s own lock rides as the first remaining account');
  // a spent lock is never read again (the program marked it); an epoch without a key is reported, not guessed
  lockRows.forEach(l => { if (l.address === x.zkLock) l.spent = true; });
  keeper.zkKeys = new Map([[1, K.secret]]);
  const again = await keeper.scanZk();
  assert.equal(again.revoked.length, 0); assert.ok(again.errors.some(e => /no revocation key for epoch 0/.test(e)));
});
