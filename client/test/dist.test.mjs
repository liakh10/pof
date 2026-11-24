/* client/dist as deployed: every chunk the bundles import exists and is tracked by git (a pathspec commit leaves new
   chunks out; that broke one deploy), blind.mjs is the Verifier's byte for byte, pins.js equals verifier/lib/credit-pins.json
   and every pin's fingerprint is the one the Verifier published. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const dist = new URL('../dist/', import.meta.url);
test('every imported chunk exists and is tracked', () => {
  const tracked = execFileSync('git', ['ls-files', 'dist'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' }).split('\n');
  for (const f of ['spr.js', 'spr-spend.js']) {
    for (const c of new Set(fs.readFileSync(new URL(f, dist), 'utf8').match(/chunk-[A-Z0-9]+\.js/g) || [])) {
      assert.ok(fs.existsSync(new URL(c, dist)), c + ' exists');
      assert.ok(tracked.includes('dist/' + c), c + ' is tracked: git add client/dist');
    }
  }
});
test('blind.mjs and the credit pins are the Verifier\'s', async () => {
  assert.equal(fs.readFileSync(new URL('blind.mjs', dist), 'utf8'), fs.readFileSync(new URL('../../verifier/lib/blind.mjs', import.meta.url), 'utf8'));
  const file = new URL('../../verifier/lib/credit-pins.json', import.meta.url);
  const { CREDIT_PINS } = await import('../dist/pins.js');
  const want = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).networks : {};
  assert.deepEqual(JSON.parse(JSON.stringify(CREDIT_PINS)), want, 'rebuild client/dist after the pins change (npm run build)');
  const sha = async s => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), x => x.toString(16).padStart(2, '0')).join('');
  for (const [net, p] of Object.entries(CREDIT_PINS)) {
    assert.equal(String(p.e).replace(/^0+/, ''), '10001', net + ' e = 65537');
    const fp = (await sha(`pof:credit-key:v1\n${p.kid}\n${String(p.n).toLowerCase()}\n${p.e}\n${p.houseRing}`)).slice(0, 32).match(/.{4}/g).join(' ');
    if (p.fingerprint) assert.equal(fp, p.fingerprint, net + ' fingerprint');
  }
});
