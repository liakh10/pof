/* Deterministic build of the Verifier bundle.
   node scripts/build.mjs          builds dist/pof-verifier.mjs and writes dist/BUILD.json (the published bundle hash)
   node scripts/build.mjs --check  builds twice into a temp dir and checks both match dist/BUILD.json
   node scripts/build.mjs --verify builds dist/pof-verifier.mjs and fails unless it matches dist/BUILD.json (the Vercel build)
   Reproduce: same Node major, `npm ci` (the lockfile pins every dependency and esbuild), then `npm run build:check`.
   The bundle has no timestamps, no absolute paths (esbuild writes paths relative to this folder) and no source maps. */
import { build, version as esbuildVersion } from 'esbuild';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sha = (b) => createHash('sha256').update(b).digest('hex');

async function once(outfile) {
  await build({
    absWorkingDir: here,
    entryPoints: ['src/index.ts'],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    minify: false,
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'error',
    charset: 'utf8',
    // web3.js and a few dependencies are CommonJS: give them a require that resolves from the bundle
    banner: { js: "import { createRequire as __pofRequire } from 'node:module'; const require = __pofRequire(import.meta.url);" },
  });
  return fs.readFileSync(outfile);
}

const check = process.argv.includes('--check');
if (check) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pofv-'));
  const a = await once(path.join(tmp, 'a.mjs')), b = await once(path.join(tmp, 'b.mjs'));
  const want = JSON.parse(fs.readFileSync(path.join(here, 'dist/BUILD.json'), 'utf8')).sha256;
  fs.rmSync(tmp, { recursive: true, force: true });
  const ok = sha(a) === sha(b) && sha(a) === want;
  console.log(JSON.stringify({ rebuilt: sha(a), again: sha(b), published: want, reproducible: ok }));
  process.exit(ok ? 0 : 1);
}
fs.mkdirSync(path.join(here, 'dist'), { recursive: true });
const out = await once(path.join(here, 'dist/pof-verifier.mjs'));
if (process.argv.includes('--verify')) {
  // the deploy build: writes the bundle, never BUILD.json, and fails unless the bundle is the published one
  const want = JSON.parse(fs.readFileSync(path.join(here, 'dist/BUILD.json'), 'utf8')).sha256;
  const got = sha(out);
  console.log(JSON.stringify({ built: got, published: want, match: got === want }));
  if (got !== want) { console.error('the bundle differs from the published hash in verifier/dist/BUILD.json: refusing to deploy'); process.exit(1); }
  process.exit(0);
}
const lock = fs.readFileSync(path.join(here, 'package-lock.json'));
const sources = Object.fromEntries(fs.readdirSync(path.join(here, 'src')).sort().map(f => [f, sha(fs.readFileSync(path.join(here, 'src', f)))]));
const info = { bundle: 'dist/pof-verifier.mjs', sha256: sha(out), bytes: out.length, esbuild: esbuildVersion, node: process.version.split('.')[0], lockfileSha256: sha(lock), sources };
fs.writeFileSync(path.join(here, 'dist/BUILD.json'), JSON.stringify(info, null, 2) + '\n');
console.log(JSON.stringify({ sha256: info.sha256, bytes: info.bytes }));
