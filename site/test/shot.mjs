#!/usr/bin/env node
// Screenshots and page checks with headless Chromium (playwright-core): a real 375 px phone (isMobile, dpr 3) and 1440 desktop.
//   node site/test/shot.mjs <url> <out-prefix> [--mobile] [--full] [--wait ms] [--click selector]
// Prints console errors, page errors, horizontal overflow and the scroll width.
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const find = () => {
  for (const p of [process.env.PLAYWRIGHT_CORE, path.join(os.homedir(), 'Desktop/sol/gg/node_modules/playwright-core')]) if (p && fs.existsSync(p)) return p;
  throw Error('playwright-core not found (set PLAYWRIGHT_CORE)');
};
const { chromium } = require(find());
const args = process.argv.slice(2);
const url = args[0], out = args[1];
const mobile = args.includes('--mobile'), full = args.includes('--full');
const wait = Number(args[args.indexOf('--wait') + 1]) || 2500;
const click = args.includes('--click') ? args[args.indexOf('--click') + 1] : null;
const exe = (() => { const base = path.join(os.homedir(), 'Library/Caches/ms-playwright'); const d = fs.readdirSync(base).filter(x => /^chromium-\d+$/.test(x)).sort().pop(); return path.join(base, d, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'); })();
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined });
const ctx = await browser.newContext(mobile ? { viewport: { width: 375, height: 812 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: Number(process.env.VW || 1440), height: Number(process.env.VH || 900) }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', e => errors.push('page: ' + e.message));
page.on('requestfailed', r => errors.push('failed: ' + r.url() + ' ' + (r.failure()?.errorText || '')));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(wait);
if (click) { await page.click(click); await page.waitForTimeout(1500); }
const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, h: document.documentElement.scrollHeight, font: document.fonts.check('800 40px "Mona Sans"') }));
await page.screenshot({ path: `${out}.png`, fullPage: full });
console.log(JSON.stringify({ url, ...m, overflow: m.sw > m.cw, errors }, null, 0));
await browser.close();
