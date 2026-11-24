// node tools/build.mjs: bundles src/spr-entry.js and src/web3-entry.js for the browser into dist/ (ESM, minified), copies
// the Poseidon WASM next to them, and fails when a file passes its gzip budget.
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
const shim = path.join(root, 'src/hasher-shim.js');
const hasherAlias = { name: 'hasher-shim', setup(b) { b.onResolve({ filter: /^@lightprotocol\/hasher\.rs$/ }, a => (a.importer === shim ? undefined : { path: shim })); } };
const common = { bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, legalComments: 'none', define: { global: 'globalThis', 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning' };
for (const f of fs.readdirSync(dist)) if (/^chunk-.*\.js$/.test(f)) fs.rmSync(path.join(dist, f));
const spr = await esbuild.build({ ...common, entryPoints: { spr: path.join(root, 'src/spr-entry.js'), 'spr-spend': path.join(root, 'src/spend-entry.js') }, outdir: dist, splitting: true, chunkNames: 'chunk-[hash]', plugins: [hasherAlias], metafile: true });
await esbuild.build({ ...common, entryPoints: [path.join(root, 'src/web3-entry.js')], outfile: path.join(dist, 'web3.js') });
const H = path.join(root, 'node_modules/@lightprotocol/hasher.rs/dist');
fs.copyFileSync(path.join(H, 'hasher_wasm_simd_bg.wasm'), path.join(dist, 'hasher-simd.wasm'));
fs.copyFileSync(path.join(H, 'light_wasm_hasher_bg.wasm'), path.join(dist, 'hasher.wasm'));
// budgets in gzip bytes: what a first visit downloads
const chunks = fs.readdirSync(dist).filter(f => /^chunk-.*\.js$/.test(f));
const BUDGET = { 'spr.js': 200_000, 'spr-spend.js': 260_000, ...Object.fromEntries(chunks.map(c => [c, 200_000])), 'web3.js': 110_000, 'hasher-simd.wasm': 440_000, 'hasher.wasm': 580_000 };
let over = false;
const rows = [];
for (const [f, max] of Object.entries(BUDGET)) {
  const b = fs.readFileSync(path.join(dist, f)); const gz = zlib.gzipSync(b, { level: 9 }).length;
  rows.push(`${f.padEnd(18)} ${String(b.length).padStart(9)} B  gzip ${String(gz).padStart(8)} B  budget ${max}`);
  if (gz > max) over = true;
}
fs.writeFileSync(path.join(dist, 'SIZES.txt'), rows.join('\n') + '\n');
console.log(rows.join('\n'));
if (process.argv.includes('--why')) { const ins = Object.entries(spr.metafile.outputs).find(([k]) => k.endsWith('spr.js'))[1].inputs; const by = {}; for (const [k, v] of Object.entries(ins)) { const m = k.match(/node_modules\/((@[^/]+\/)?[^/]+)/); const key = m ? m[1] : k; by[key] = (by[key] || 0) + v.bytesInOutput; } console.log(Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 25)); }
if (over) { console.error('a file is over its budget'); process.exit(1); }
