/* Audit proofs for pof/zk (round 3). A malicious prover builds the witness by hand: the circuit is checked by computing the
   witness from the committed wasm (every `===` is an assert in the witness generator, so a computed witness satisfies the
   R1CS). Each test states the SECURE behaviour of the whole certify_zk path; it fails while the finding is open.
   Needs the build ($POF_ZK_OUT/build/pof_js/pof.wasm, zk/scripts/build.sh). Run: node --test audit/zk/ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as snarkjs from '../../zk/node_modules/snarkjs/main.js';
import * as Z from '../../zk/js/zk.js';
import { scenario, WASM, ONE_SOL } from '../../zk/test/fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const zkrs = fs.readFileSync(path.join(here, '../../zk/onchain/src/zk.rs'), 'utf8');
const witnessOk = async (input) => { try { await snarkjs.wtns.calculate(input, WASM, { type: 'mem' }); return true; } catch { return false; } };

/* ZK-01 (Critical): certify_zk accepts any of the 100 nullifier roots the tree account keeps. The nullifier tree only grows,
   so at a root from before a note's nullifier was folded in, that note is absent: a note spent weeks ago proves "unspent". */
test('ZK-01: a note spent after an older nullifier root cannot be certified at that root', async () => {
  const s = await scenario({ amounts: [5n * ONE_SOL], minAmount: ONE_SOL });
  const nf = s.raw[0].h.nullifier;
  const oldRoot = s.nulls.root();
  const old = s.nulls.nonInclusion(nf);                  // the path a prover saved (or rebuilt) before the spend
  s.nulls.insert(nf);                                     // the note is spent and its nullifier folded into the tree
  assert.equal(s.nulls.nonInclusion(nf), null, 'sanity: at the newest root the note is spent');
  const notes = [{ ...s.notes[0], ...old }];
  const exploit = await witnessOk(Z.buildInputs(s.P, { ...s, notes, pub: { ...s.pub, nullRoot: oldRoot } }).input);
  assert.equal(exploit, true, 'sanity: the circuit proves absence at the old root (as it should; the root choice is the program\'s)');
  // the program side: check_roots must accept only the newest nullifier root (the one at cursor - 1, offset 17,224), not
  // `(0..NULL_ROOTS).any(...)` over the whole history
  const anyOf100 = /\(0\.\.NULL_ROOTS\)\.any\(/.test(zkrs.slice(zkrs.indexOf('pub fn check_roots'), zkrs.indexOf('pub fn public_inputs')));
  assert.equal(anyOf100, false, 'check_roots accepts any of the 100 nullifier roots: a spent note proves unspent at an older one');
});

/* ZK-02 (High): even at the newest root, a nullifier spent but still in the Rings input queue (its PDA exists, not yet
   folded: batches of 4,999) is absent from the tree. Nothing on chain can see the nullifier, so certify_zk cannot refuse
   it; only a delay before the certificate counts as live (or the keeper) can. */
test('ZK-02: a zk certificate does not count as live before the keeper could have checked its escrowed nullifiers', async () => {
  const s = await scenario({ amounts: [2n * ONE_SOL], minAmount: ONE_SOL });
  // spent: the nullifier PDA exists, but it is still queued, so the nullifier tree (and its root) are unchanged
  assert.equal(await witnessOk(Z.buildInputs(s.P, s).input), true, 'sanity: the queued-spent note proves at the newest root');
  const live = zkrs.slice(zkrs.indexOf('pub fn handle_certify_zk'), zkrs.indexOf('pub fn handle_release_note_lock'));
  assert.ok(!/cert\.status = STATUS_LIVE;/.test(live) || /settle|pending|live_from|STATUS_PENDING/i.test(live),
    'certify_zk makes the certificate live in the same instruction: a gate called in the same transaction (require_certificate) admits spent funds');
});

/* ZK-04 (High): the proof needs nk and the openings, not the owner's spend key (the zk twin of POF-02): the controller
   signs, the ring owner never does. A whale that hands nk + openings lends a certificate without lending the money. */
test('ZK-04: a prover with only nk and the openings (no ring owner key) cannot certify a subject', async () => {
  const s = await scenario({ amounts: [10n * ONE_SOL], minAmount: ONE_SOL });
  // the renter knows nk, the blindings and the paths; ownerId is a public hash of the owner's public key
  const renter = { ownerId: Z.ownerId(s.P, s.ring.ownerKey), nk: s.ring.nk };
  const ok = await witnessOk(Z.buildInputs(s.P, { ...s, ring: renter }).input);
  assert.equal(ok, false, 'a witness exists without any secret of the ring owner: certify_zk lends the certificate with nk alone');
});
