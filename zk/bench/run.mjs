// The proving bench in headless Chrome: serves pof/zk, opens bench/?auto, reads the timings the page reports. Two profiles:
// this machine as it is, and the same with the CPU throttled 4x (Chrome DevTools emulation, roughly a mid-range phone).
// Writes bench/results.json. Needs setup/ (pof.wasm, pof_final.zkey) and bench/input.json (node bench/input.mjs).
// Run: node bench/run.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire('/Users/artem/Desktop/sol/_solkit/onair/');
const { chromium } = require('playwright-core');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm' };
let report = null;
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/result') { let b = ''; req.on('data', d => (b += d)).on('end', () => { report = JSON.parse(b); res.end('ok'); }); return; }
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end(); }
  res.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream');
  res.setHeader('content-length', fs.statSync(f).size);
  fs.createReadStream(f).pipe(res);
}).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const out = { date: new Date().toISOString(), profiles: {} };
try {
  for (const [name, throttle, runs] of [['desktop', 1, 3], ['cpu-4x-throttled', 4, 2]]) {
    report = null;
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    if (throttle > 1) { const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle }); }
    await page.goto(`${base}/bench/?auto&report&runs=${runs}`);
    const t0 = Date.now();
    while (!report && Date.now() - t0 < 600_000 && !errors.length) await new Promise(r => setTimeout(r, 250));
    if (!report) throw Error(`${name}: no result (${errors.join(' | ') || 'timeout'})`);
    if (report.error) throw Error(`${name}: ${report.error}`);
    out.profiles[name] = report;
    const totals = report.runs.map(r => r.total).sort((a, b) => a - b);
    console.log(`${name}: ${report.cores} cores, key ${(report.load.zkeyBytes / 1e6).toFixed(1)} MB, prove ${totals.join(' / ')} ms, all verify: ${report.runs.every(r => r.verified)}`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
fs.writeFileSync(path.join(root, 'bench/results.json'), JSON.stringify(out, null, 1));
