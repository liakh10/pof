/* The lab as a phone sees it: 375 x 812, touch, Chrome CPU throttling 4x and 6x, a fast-3G-like network for the first
   load. Measures, on the local Rings clone: the hasher (cold download + verify + compile, then warm from the Cache API after a
   reload), the vault signature, sync of two notes, and the tier pick. Writes lab/test/mobile-perf.json.
   Needs zsh lab/rings-local/chain.sh start and node lab/serve.mjs. Run: node lab/test/mobile-perf.mjs [base] */
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/Users/artem/Desktop/sol/_solkit/onair/');
const { chromium } = require('playwright-core');
const BASE = process.argv[2] || 'http://localhost:5491';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = [];
try {
  for (const rate of [4, 6]) {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6 * 1024 * 1024 / 8 * 4, uploadThroughput: 750 * 1024 / 8 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    const t = {};
    const boot = async () => {
      await page.goto(BASE + '/lab/');
      const t0 = Date.now();
      await page.click('#boot');
      await page.waitForFunction(() => /hasher: ready/.test(document.getElementById('hstate').textContent), null, { timeout: 180_000 });
      return { ms: Date.now() - t0, text: await page.$eval('#hstate', e => e.textContent) };
    };
    const cold = await boot(); t.hasherColdMs = cold.ms; t.cold = cold.text;
    const warm = await boot(); t.hasherWarmMs = warm.ms; t.warm = warm.text;
    const wait = async re => page.waitForFunction(r => new RegExp(r).test(document.getElementById('log').textContent), re.source, { timeout: 120_000 });
    await page.click('#devw'); await wait(/airdrop 50 SOL \w+/); await page.waitForTimeout(1200);
    let s0 = Date.now(); await page.click('#vault'); await wait(/vault \w{32,44} owner hash/); t.vaultMs = Date.now() - s0;
    await page.click('#register'); await wait(/registered \w{60,}/);
    await page.fill('#amount', '2'); await page.click('#shield'); await wait(/shielded ·/);
    await page.fill('#amount', '3'); await page.click('#shield');
    await page.waitForFunction(() => (document.getElementById('log').textContent.match(/shielded ·/g) || []).length >= 2, null, { timeout: 120_000 });
    s0 = Date.now(); await page.click('#sync'); await page.waitForSelector('#notes table', { timeout: 120_000 }); t.syncMs = Date.now() - s0;
    s0 = Date.now(); await page.click('#pick'); await page.waitForFunction(() => document.getElementById('picked').textContent.length > 0, null, { timeout: 60_000 }); t.pickMs = Date.now() - s0;
    t.picked = await page.$eval('#picked', e => e.textContent);
    t.overflowX = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    // the production path for sync: the Helius indexer through /api/spr (devnet, a fresh vault, so it measures the round
    // trips and the SDK's work, not a note count), with a stand-in wallet that signs in the page
    t.indexerSync = await page.evaluate(async () => {
      const S = await import('/client/dist/spr.js');
      const k = S.SigningKey.fromEd25519Bytes(crypto.getRandomValues(new Uint8Array(32)));
      const { createPofClient, core: C } = await import('/client/pof-client.js');
      const address = C.b58encode(k.publicKey().ed25519());
      const W = { setChain() {}, state: () => ({ address }), signText: async t => k.sign(new TextEncoder().encode(t)), signBytes: async b => k.sign(b) };
      const pof = await createPofClient({ network: 'devnet', rpc: ['/api/rpc?net=devnet'], indexer: '/api/spr?net=devnet', wallet: W, storage: new Map(), programId: 'pofP4QRRDXnmDN9CNYiAGHfwMEgM7sLWhVcUMpsbynT' });
      await pof.ready(); await pof.deriveVault();
      const t0 = performance.now(); const n = await pof.notes({ from: 'vault' });
      return { ms: Math.round(performance.now() - t0), notes: n.length };
    });
    t.errors = errors;
    results.push({ cpu: rate + 'x', viewport: '375x812', network: '150 ms, 6.4 Mbit/s', ...t });
    await ctx.close();
  }
} finally { await browser.close(); }
fs.writeFileSync(new URL('./mobile-perf.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), note: 'syncMs and pickMs read the local clone through LocalRings, which replays every Rings transaction of the local chain (it grows with the test history; not the production path); indexerSync is the production path (Helius indexer through /api/spr, devnet, empty vault)', results }, null, 1));
console.log(JSON.stringify(results, null, 1));
const bad = results.some(r => r.errors.length || !/from cache/.test(r.warm) || !/ready: 1 note/.test(r.picked));
process.exit(bad ? 1 : 0);
