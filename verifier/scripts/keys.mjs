/* The Verifier's and the relayer's keys, made for this project only.
     node scripts/keys.mjs            make the missing ones in ~/.config/pof/ (dir 700, files 600); print public keys only
     node scripts/keys.mjs --vercel   also push them to the linked Vercel project's env (production + preview), values via stdin
   Files: verifier.json and relayer.json (Solana keypair JSON: 64 numbers), seal.hex (32 bytes: the keeper's AES key and the
   note-lock / quote HMAC root), keeper.x25519 (our keeper's escrow key; its public half goes into keepers.json). An existing file is never overwritten; rotating the verifier is set_verifier on chain. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { getBase58Decoder } from '@solana/kit';

const dir = path.join(os.homedir(), '.config', 'pof');
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
fs.chmodSync(dir, 0o700);
const b58 = (b) => getBase58Decoder().decode(b);

function keypair(name) {
  const f = path.join(dir, name + '.json');
  if (!fs.existsSync(f)) {
    const seed = crypto.randomBytes(32);
    const pub = ed25519.getPublicKey(seed);
    fs.writeFileSync(f, JSON.stringify([...seed, ...pub]), { mode: 0o600, flag: 'wx' });
    seed.fill(0);
  }
  fs.chmodSync(f, 0o600);
  const arr = JSON.parse(fs.readFileSync(f, 'utf8'));
  return { file: f, pub: b58(Uint8Array.from(arr.slice(32))), json: JSON.stringify(arr) };
}
function sealKey() {
  const f = path.join(dir, 'seal.hex');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
  fs.chmodSync(f, 0o600);
  return { file: f, value: fs.readFileSync(f, 'utf8').trim() };
}

function x25519Key(name) {
  const f = path.join(dir, name + '.x25519');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
  fs.chmodSync(f, 0o600);
  const sk = Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'hex');
  return { file: f, pub: Buffer.from(x25519.getPublicKey(sk)).toString('hex'), value: sk.toString('hex') };
}
const v = keypair('verifier'), r = keypair('relayer'), s = sealKey(), k = x25519Key('keeper');
console.log(JSON.stringify({ dir, verifier: v.pub, relayer: r.pub, seal: 'present (not shown)', keeperX25519: k.pub }, null, 2));

if (process.argv.includes('--vercel')) {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
  for (const [name, value] of [['POF_VERIFIER_KEY', v.json], ['POF_RELAYER_KEY', r.json], ['POF_SEAL_KEY', s.value]]) {
    for (const target of ['production', 'preview']) {
      const p = spawnSync('vercel', ['env', 'add', name, target, '--force'], { cwd: root, input: value, stdio: ['pipe', 'ignore', 'pipe'] });
      console.log(`${name} → ${target}: ${p.status === 0 ? 'set' : 'failed: ' + String(p.stderr).replace(/[A-Za-z0-9+/=]{40,}/g, '***').slice(0, 160)}`);
    }
  }
}
