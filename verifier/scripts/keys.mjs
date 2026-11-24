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
function rsaKey(name) {
  const f = path.join(dir, name + '.json');
  // a key from before the full-JWK format (no CRT parts, signing needs them: audit CR-03) is retired, never deleted
  if (fs.existsSync(f) && !JSON.parse(fs.readFileSync(f, 'utf8')).jwk) {
    const old = JSON.parse(fs.readFileSync(f, 'utf8'));
    fs.renameSync(f, path.join(dir, `${name}.retired-${old.kid}.json`));
  }
  if (!fs.existsSync(f)) {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
    const j = privateKey.export({ format: 'jwk' });
    const h = (x) => Buffer.from(x, 'base64url').toString('hex');
    const n = h(j.n);
    fs.writeFileSync(f, JSON.stringify({ kid: crypto.createHash('sha256').update(n).digest('hex').slice(0, 8), n, e: h(j.e), d: h(j.d), jwk: j }), { mode: 0o600, flag: 'wx' });
  }
  fs.chmodSync(f, 0o600);
  const k = JSON.parse(fs.readFileSync(f, 'utf8'));
  return { file: f, kid: k.kid, json: JSON.stringify(k), pub: { kid: k.kid, n: k.n, e: k.e } };
}
const v = keypair('verifier'), r = keypair('relayer'), s = sealKey(), k = x25519Key('keeper'), c = rsaKey('credits-rsa');
console.log(JSON.stringify({ dir, verifier: v.pub, relayer: r.pub, seal: 'present (not shown)', keeperX25519: k.pub, creditKey: c.kid }, null, 2));
// the public credit key and the house ring are pinned in the bundle and in the client (audit CR-01): lib/credit-pins.json,
// public halves only, one entry per network; a rotation moves the old key to `retired` (still honoured, CR-04)
if (process.argv.includes('--pin')) {
  const pinFile = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../lib/credit-pins.json');
  const prev = fs.existsSync(pinFile) ? JSON.parse(fs.readFileSync(pinFile, 'utf8')) : { v: 1, networks: {} };
  const nets = (process.env.POF_PIN_NETWORKS || 'mainnet,devnet').split(',');
  for (const net of nets) {
    const was = prev.networks[net];
    const retired = [...((was && was.retired) || [])];
    if (was && was.kid !== c.kid && !retired.some(x => x.kid === was.kid)) retired.push({ kid: was.kid, n: was.n, e: was.e });
    const entry = { kid: c.kid, n: c.pub.n.toLowerCase(), e: c.pub.e, houseRing: r.pub, retired };
    const fp = crypto.createHash('sha256').update(`pof:credit-key:v1\n${entry.kid}\n${entry.n}\n${entry.e}\n${entry.houseRing}`).digest('hex').slice(0, 32).match(/.{4}/g).join(' ');
    prev.networks[net] = { ...entry, fingerprint: fp };
    console.log(`pinned ${net}: credit key ${c.kid}, house ring ${r.pub}, fingerprint ${fp}`);
  }
  fs.writeFileSync(pinFile, JSON.stringify(prev, null, 2) + '\n');
}
