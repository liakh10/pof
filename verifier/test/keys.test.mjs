/* The key script makes keys into a fresh home (600), prints only public halves, and --vercel replaces each variable in both
   environments through stdin (a stub vercel binary records what it was asked, and how long each value was, never the value). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('keys.mjs: keys in ~/.config/pof (600), public output only, --vercel replaces every variable via stdin', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pofkeys-'));
  const bin = path.join(home, 'vercel-stub.sh'), log = path.join(home, 'calls.txt');
  fs.writeFileSync(bin, `#!/bin/sh\nn=$(cat | wc -c | tr -d ' ')\necho "$* stdin=$n" >> ${log}\n`, { mode: 0o755 });
  const out = execFileSync(process.execPath, ['scripts/keys.mjs', '--vercel'], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, HOME: home, VERCEL_BIN: bin }, encoding: 'utf8' });
  const dir = path.join(home, '.config', 'pof');
  for (const f of ['verifier.json', 'relayer.json', 'seal.hex', 'keeper.x25519', 'credits-rsa.json']) assert.equal(fs.statSync(path.join(dir, f)).mode & 0o777, 0o600, f);
  const seal = fs.readFileSync(path.join(dir, 'seal.hex'), 'utf8').trim();
  const secret = JSON.parse(fs.readFileSync(path.join(dir, 'verifier.json'), 'utf8'));
  assert.ok(!out.includes(seal) && !out.includes(JSON.stringify(secret)) && !out.includes(JSON.parse(fs.readFileSync(path.join(dir, 'credits-rsa.json'), 'utf8')).d), 'no secret printed');
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n');
  for (const name of ['POF_VERIFIER_KEY', 'POF_RELAYER_KEY', 'POF_SEAL_KEY', 'POF_CREDIT_KEY']) for (const target of ['production', 'preview']) {
    const rm = calls.findIndex(l => l.startsWith(`env rm ${name} ${target}`)), add = calls.findIndex(l => l.startsWith(`env add ${name} ${target} `));
    assert.ok(rm >= 0 && add > rm, `${name} ${target}: rm then add`);
    assert.ok(Number(calls[add].match(/stdin=(\d+)/)[1]) > 30, `${name} ${target}: the value goes through stdin`);
    assert.ok(!calls[add].includes(seal), 'no value on the command line');
  }
  fs.rmSync(home, { recursive: true, force: true });
});
