/* In headless Chrome: the lazy spend bundle loads and the SDK attests the Helius prover enclave through /api/spr-prover,
   including the signed TEE policy fetch the SDK makes from the page (a CORS question only a browser answers).
   Needs node lab/serve.mjs. Run: node lab/test/prover-browser.mjs [http://localhost:5491] */
import { createRequire } from 'node:module';
const require = createRequire('/Users/artem/Desktop/sol/_solkit/onair/');
const { chromium } = require('playwright-core');
const BASE = process.argv[2] || 'http://localhost:5491';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
let code = 1;
try {
  const page = await browser.newPage();
  await page.goto(BASE + '/lab/');
  const out = await page.evaluate(async () => {
    const res = {};
    for (const net of ['devnet', 'mainnet']) {
      try {
        const t = performance.now();
        const X = await import('/client/dist/spr-spend.js');
        const c = new X.SprClient({ solanaRpcUrl: location.origin + '/api/rpc?net=' + net, indexerUrl: location.origin + '/api/spr?net=' + net, proverUrl: location.origin + '/api/spr-prover?net=' + net, proverTee: X.SignedTeePolicy.forNetwork(net), allowInsecureHttp: true });
        const a = await c.attestProver();
        res[net] = { ok: a.platform === 'aws-nitro', platform: a.platform, ms: Math.round(performance.now() - t) };
      } catch (e) { res[net] = { ok: false, code: e.code, details: JSON.stringify(e.details || {}), message: String(e.message), cause: String(e.cause && (e.cause.message || e.cause)) }; }
    }
    return res;
  });
  console.log(JSON.stringify(out, null, 1));
  code = out.devnet.ok && out.mainnet.ok ? 0 : 1;
} finally { await browser.close(); }
process.exit(code);
