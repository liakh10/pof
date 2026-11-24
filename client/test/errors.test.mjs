import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { explain, CODES } from '../errors.js';
test('every Verifier refusal a holder can meet has a sentence', () => {
  const src = fs.readdirSync(new URL('../../verifier/src/', import.meta.url)).map(f => fs.readFileSync(new URL('../../verifier/src/' + f, import.meta.url), 'utf8')).join('\n');
  const holderFacing = ['NOT_IN_TREE', 'NOTE_SPENT', 'NOTE_TOO_NEW', 'BELOW_TIER', 'NULLIFIER_KEY_MISMATCH', 'NO_RING', 'SUBJECT_PROOF_STALE', 'BAD_SUBJECT_PROOF', 'LINK_EXPIRED', 'STALE_ROOT', 'RELAY_OFF', 'NOTE_IN_USE', 'BAD_CONTROLLER', 'RATE_LIMITED', 'INDEXER_UNAVAILABLE', 'MIXED_TREES', 'DUPLICATE_NOTES'];
  for (const c of holderFacing) { assert.ok(src.includes(`'${c}'`), c + ' is still a Verifier code'); assert.ok(CODES.includes(c), c + ' is explained'); }
});
test('wallet and chain failures are recognised', () => {
  assert.equal(explain({ silent: true, declined: true, message: 'You declined in the wallet.' }).silent, true);
  assert.equal(explain(Object.assign(Error('simulation failed: {"InstructionError":[0,{"Custom":1}]}'), { logs: ['Transfer: insufficient lamports 5, need 10'] })).code, 'LOW_SOL');
  assert.equal(explain(Error('the transaction expired before it was confirmed')).code, 'EXPIRED_TX');
  assert.match(explain({ code: 'NOTE_TOO_NEW', details: { waitSlots: 100 } }).action, /about 40 s \(100 slots\)/);
  assert.equal(explain({ code: 'SOMETHING_NEW', message: 'odd' }).title, 'odd');
});
