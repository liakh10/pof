/* The published bundle hash must be the hash of the bundle these committed sources build to. Fails when a source, the
   vendored IDL, keepers.json or the lockfile changed without `npm run build` (BUILD.json stale), and when the bundle in
   dist/ is not the one BUILD.json names. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';

const here = new URL('..', import.meta.url).pathname;
test('dist/BUILD.json is the hash of a fresh build of the committed inputs (two builds, no input outside verifier/)', () => {
  const out = execFileSync(process.execPath, ['scripts/build.mjs', '--check'], { cwd: here, encoding: 'utf8' });
  const r = JSON.parse(out.trim().split('\n').pop());
  assert.equal(r.reproducible, true, `rebuilt ${r.rebuilt} but BUILD.json says ${r.published}: run npm run build and commit dist/BUILD.json`);
});
test('the bundle in dist/ is the published one, and BUILD.json lists every own input with its hash', () => {
  const b = JSON.parse(fs.readFileSync(here + 'dist/BUILD.json', 'utf8'));
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(here + 'dist/pof-verifier.mjs')).digest('hex'), b.sha256);
  for (const [f, h] of Object.entries(b.sources)) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(here + f)).digest('hex'), h, f);
  assert.ok(Object.keys(b.sources).some(f => f.startsWith('idl/')), 'the IDL is a listed input');
});
