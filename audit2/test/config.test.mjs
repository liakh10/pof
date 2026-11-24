/* audit2 A2-05 and A2-09: configuration and documentation that disagree with the code. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('A2-05: mainnet and devnet do not share the blind-credit key (devnet SOL must not mint mainnet credits)', () => {
  const pins = JSON.parse(read('verifier/lib/credit-pins.json')).networks;
  assert.notEqual(pins.mainnet.n.toLowerCase(), pins.devnet.n.toLowerCase(),
    'the same RSA modulus (and house ring) is pinned for mainnet and devnet: any devnet relayer holding that key signs credits the mainnet relayer accepts');
});

test('A2-09: the docs state the program\'s real validity bound (lib.rs VALIDITY_MAX)', () => {
  const max = Number(/pub const VALIDITY_MAX: u64 = ([\d_]+);/.exec(read('program/programs/pof/src/lib.rs'))[1].replace(/_/g, ''));
  const bad = [];
  for (const f of ['docs-src/trust.md', 'docs-src/faq.md', 'docs-src/protocol.md']) {
    for (const m of read(f).matchAll(/6,480,000/g)) bad.push(`${f}@${m.index}`);
  }
  assert.deepEqual(bad, [], `the docs say validity_slots can be 6,480,000; the program caps it at ${max}`);
});
