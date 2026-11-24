/* audit2 A2-02: "one note backs one live certificate" (verifier/src/locks.ts) holds only while the lock's certify window is
   at least the program's max_attest_age, and only while the Verifier has a chain to read.
   - app.ts sets certifyWindow from POF_CERTIFY_WINDOW_SLOTS (default 300) and never compares it with the Config's
     max_attest_age, which set_params may raise to 9,000 (lib.rs Params::check). With max_attest_age > certifyWindow, a note
     locked for subject A by an attestation not yet landed is free for subject B after certifyWindow slots, and both
     attestations can still land: two live certificates on one note.
   - app.ts builds the chain only when POF_RELAYER_KEY is set; with chain = null a lock binds for certifyWindow slots only,
     even while A's certificate is live on chain. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import * as V from '../../verifier/dist/pof-verifier.mjs';

const store = () => new V.FsStore(fs.mkdtempSync(path.join(os.tmpdir(), 'audit2-locks-')));
const nf = () => new Uint8Array(crypto.randomBytes(32));
const A = 'aa'.repeat(32), B = 'bb'.repeat(32);
const lock = (subjectHash, issued) => ({ subjectHash, asset: 0, issuedSlot: issued, expirySlot: issued + 216_000 });
/** the largest max_attest_age the program accepts (program/programs/pof/src/lib.rs Params::check: 5..=9_000) */
const PROGRAM_MAX_ATTEST_AGE = 9_000;

test('A2-02a: a note stays locked for as long as the program may still accept the first attestation', async () => {
  const chain = { certificate: async () => null };     // A's attestation has not landed yet (it may, until issued + max_attest_age)
  const locks = new V.NoteLocks(store(), new Uint8Array(32).fill(1), 300n, chain);
  const n = nf(), s = 1_000_000;
  await locks.take([n], lock(A, s), BigInt(s));
  // 301 slots later the Config's max_attest_age (admin may set up to 9,000) still lets A land
  const later = s + 301;
  assert.ok(later - s <= PROGRAM_MAX_ATTEST_AGE);
  await assert.rejects(locks.take([n], lock(B, later), BigInt(later)), e => e.code === 'NOTE_IN_USE',
    'the note was handed to subject B while subject A\'s attestation can still be certified: the lock window is not tied to the Config');
});

test('A2-02b: without a chain the lock does not follow the live certificate', async () => {
  const locks = new V.NoteLocks(store(), new Uint8Array(32).fill(2), 300n, null);   // app.ts: chain is null without POF_RELAYER_KEY
  const n = nf(), s = 2_000_000;
  await locks.take([n], lock(A, s), BigInt(s));
  // A certified at s + 10 and is live for 216,000 slots; one hour later B asks for the same note
  const later = s + 9_000;
  await assert.rejects(locks.take([n], lock(B, later), BigInt(later)), e => e.code === 'NOTE_IN_USE',
    'with no chain configured the note backs a second subject while the first certificate is live');
});
