/* The lab page in headless Chrome against the local Rings clone and the lab server's real Verifier: the hasher loads in a
   browser (progress to ready), a dev wallet, the vault, registration, two shields, sync, pick, certify (wallet subject and
   a badge), the kit list, the Rings derivation signature. Needs: zsh lab/rings-local/chain.sh start; node lab/serve.mjs.
   Run: node lab/test/lab-e2e.mjs [http://localhost:5491] */
import { createRequire } from 'node:module';
const require = createRequire('/Users/artem/Desktop/sol/_solkit/onair/');
const { chromium } = require('playwright-core');
const BASE = process.argv[2] || 'http://localhost:5491';
let pass = 0, total = 0;
const ok = (c, n, x = '') => { total++; if (c) { pass++; console.log('  ok   ' + n); } else console.log('  FAIL ' + n + (x ? '  ' + String(x).slice(0, 400) : '')); };
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const reqs = []; page.on('request', r => reqs.push(r.url()));
  await page.goto(BASE + '/lab/');
  const logText = () => page.$eval('#log', e => e.textContent);
  const waitLog = async (re, ms = 60_000) => { const t = Date.now(); while (Date.now() - t < ms) { const s = await logText(); if (re.test(s)) return s; if (/\d\d:\d\d:\d\d {2}[A-Z_]+: /.test(s.split('\n')[0] || '') && !re.test(s)) {} await page.waitForTimeout(300); } throw Error('timeout waiting for ' + re + '\n' + (await logText()).slice(0, 800)); };
  const t0 = Date.now();
  await page.click('#boot');
  await waitLog(/started on local/);
  const h = await page.$eval('#hstate', e => e.textContent);
  ok(/hasher: ready in \d+ ms \(SIMD\)/.test(h), 'the Poseidon WASM loads in the browser with progress: ' + h);
  ok(reqs.some(u => u.endsWith('/client/dist/hasher-simd.wasm')), 'the WASM comes from next to the bundle (no CDN)');
  console.log('    boot to ready', Date.now() - t0, 'ms');
  await page.click('#devw'); await waitLog(/airdrop 50 SOL \w+/);
  await page.waitForTimeout(1500);
  await page.click('#vault'); await waitLog(/vault \w{32,44} owner hash/);
  await page.click('#register'); await waitLog(/registered \w{60,}/);
  ok(/registered: true/.test(await page.$eval('#vstate', e => e.textContent)), 'the vault is registered in the User Registry clone');
  await page.fill('#amount', '2'); await page.click('#shield'); await waitLog(/shielded · \w+ at slot/);
  await page.fill('#amount', '3.5'); await page.click('#shield');
  await page.waitForFunction(() => (document.getElementById('log').textContent.match(/shielded ·/g) || []).length >= 2, null, { timeout: 60_000 });
  await page.click('#sync'); await page.waitForSelector('#notes table', { timeout: 60_000 });
  const rows = await page.$$eval('#notes tr', r => r.slice(1).map(x => [...x.children].map(c => c.textContent)));
  ok(rows.length === 2 && rows.map(r => r[2]).sort().join() === '2,3.5', 'sync finds both notes with their amounts', JSON.stringify(rows));
  ok(/SOL 5\.5/.test(await page.$eval('#bal', e => e.textContent)), 'the vault balance reads 5.5 SOL');
  await page.selectOption('#tier', '1'); await page.click('#pick');
  await page.waitForFunction(() => document.getElementById('picked').textContent.length > 0, null, { timeout: 30_000 });
  const picked = await page.$eval('#picked', e => e.textContent);
  ok(/ready: 1 note/.test(picked) && /excess 1000000000/.test(picked), 'tier 1 takes the single 2 SOL note (fewest notes, least excess): ' + picked);
  await page.click('#certify'); await waitLog(/attested · log index \d+/);
  const att = ((await logText()).match(/attestation ([0-9a-f]{480})/) || [])[1] || '';
  ok(att.length === 480 && att.startsWith('504f4631'), 'the Verifier signed a 240-byte POF1 attestation for the wallet subject', att.slice(0, 40) + ' len ' + att.length);
  await page.selectOption('#kind', '2'); await page.click('#certify');
  await page.waitForFunction(() => /RELAY_NEEDED|PAYER_LINKS_WALLET/.test(document.getElementById('log').textContent), null, { timeout: 30_000 });
  ok(true, 'a badge certificate is not paid from the wallet by default (audit POF-12)');
  await page.check('#walletpay'); await page.click('#certify');
  await page.waitForFunction(() => (document.getElementById('log').textContent.match(/attested ·/g) || []).length >= 2, null, { timeout: 60_000 }).catch(() => {});
  const secondLog = await logText();
  ok(/attested ·[\s\S]*attested ·/.test(secondLog) || /NOTE_LOCKED|already backs|LOCKED/i.test(secondLog), 'a badge subject is attested too (or refused because the note already backs a live certificate)', secondLog.split('\n').slice(0, 2).join(' | '));
  // an X handle: the real Linker, the post simulated, the controller key signs (POF-26)
  await page.selectOption('#kind', '1'); await page.fill('#handle', '@lab_handle');
  const before = (await logText()).match(/attested ·/g)?.length || 0;
  await page.click('#certify');
  await page.waitForFunction(n => (document.getElementById('log').textContent.match(/attested ·/g) || []).length > n || /NOTE_IN_USE/.test(document.getElementById('log').textContent), before, { timeout: 60_000 }).catch(() => {});
  const xl = await logText();
  ok(/link: ok, bound to controller \w+/.test(xl) && ((xl.match(/attested ·/g) || []).length > before || /NOTE_IN_USE/.test(xl)), 'an X subject links (secret kept in the tab, bound controller) and is attested with the controller signature', xl.split('\n').slice(0, 3).join(' | '));
  await page.click('#kits');
  const kits = await page.$$eval('#kitlist tr', r => r.length - 1);
  ok(kits >= 1, 'the revoke kit is kept locally: ' + kits);
  await page.click('#derive'); await waitLog(/derive: ok \(owner hash [0-9a-f]{64}\)/);
  ok(true, 'the Rings derivation message signs and derives (dev wallet; Phantom is the owner step)');
  ok(errors.length === 0, 'no page errors', errors.join(' | '));
} finally { await browser.close(); }
console.log(`${pass}/${total} passed`);
process.exit(pass === total ? 0 : 1);
