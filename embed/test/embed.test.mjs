// <pof-badge>, the iframe fallback and the SVG in a real headless Chromium (playwright-core), against /v1 on the
// in-memory chain. Set PLAYWRIGHT_CORE to another install if _solkit's is not there.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as sdk from "../../sdk/dist/index.js";
import { makeWorld, rand } from "../../api/v1/_test/fixtures.mjs";
import { handleV1 } from "../../api/v1/_core.js";
import { setClient, clearMemo } from "../../api/v1/_lib.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const embedDir = path.join(here, "..");
const pwPath = process.env.PLAYWRIGHT_CORE || path.resolve(here, "../../../_solkit/onair/node_modules/playwright-core");
let chromium = null;
try {
  chromium = createRequire(import.meta.url)(pwPath).chromium;
} catch {}
const skip = !chromium && "playwright-core not found (set PLAYWRIGHT_CORE)";

let w, server, base, browser;
const nobody = rand();

before(async () => {
  if (skip) return;
  w = await makeWorld();
  setClient(w.client);
  server = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname.startsWith("/v1/")) {
      clearMemo();
      const out = await handleV1({ method: req.method, path: u.pathname.slice(4), query: Object.fromEntries(u.searchParams), env: {} });
      res.writeHead(out.status, out.headers);
      return res.end(out.body);
    }
    if (u.pathname === "/test.html") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><body style="margin:0;padding:16px">
<script type="module" src="/embed/pof-badge.js"></script>
<pof-badge id="live" subject="@anon"></pof-badge>
<pof-badge id="revoked" subject="${w.spent}" refresh="0"></pof-badge>
<pof-badge id="expired" subject="${w.whale}" asset="USDC" refresh="0"></pof-badge>
<pof-badge id="below" subject="${w.whale}" asset="SOL" min-tier="5" refresh="0"></pof-badge>
<pof-badge id="none" subject="${nobody}" refresh="0"></pof-badge>
<pof-badge id="themed" subject="@anon" refresh="0" style="--pof-live: rgb(1, 2, 3); --pof-radius: 0px"></pof-badge>
<pof-badge id="flip" subject="${w.whale}" asset="SOL" refresh="1"></pof-badge>
</body>`);
    }
    const f = path.join(embedDir, u.pathname.replace(/^\/embed\//, ""));
    if (u.pathname.startsWith("/embed/") && f.startsWith(embedDir) && fs.existsSync(f)) {
      res.writeHead(200, { "content-type": f.endsWith(".js") ? "text/javascript" : "text/html" });
      return res.end(fs.readFileSync(f));
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  if (skip) return;
  await browser?.close();
  await new Promise((r) => server.close(r));
  setClient(null);
});

const text = (page, id) => page.evaluate((i) => {
  const el = document.getElementById(i);
  return { state: el.dataset.state, text: el.shadowRoot.querySelector(".card").innerText.replace(/\s+/g, " ").trim() };
}, id);

test("every state renders with its text, the theme variables apply, and a revoke shows within one refresh", { skip }, async () => {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const events = [];
  await page.exposeFunction("onStatus", (d) => events.push(d));
  await page.addInitScript(() => document.addEventListener("pof-status", (e) => window.onStatus({ id: e.target.id, state: e.detail.state })));
  await page.goto(`${base}/test.html`);
  await page.waitForFunction(() => [...document.querySelectorAll("pof-badge")].every((b) => b.dataset.state && b.dataset.state !== "checking"));
  let t = await text(page, "live");
  assert.equal(t.state, "live");
  assert.match(t.text, /PROOF OF FUNDS @anon ≥ 10,000 SOL LIVE as of slot 5000/i);
  t = await text(page, "revoked");
  assert.match(t.text, /REVOKED · slot 4500/);
  assert.equal((await text(page, "expired")).state, "expired");
  assert.equal((await text(page, "below")).state, "below");
  assert.match((await text(page, "below")).text, /BELOW TIER/);
  assert.equal((await text(page, "none")).state, "none");
  const color = await page.evaluate(() => getComputedStyle(document.getElementById("themed").shadowRoot.querySelector(".status")).color);
  assert.equal(color, "rgb(1, 2, 3)");
  const radius = await page.evaluate(() => getComputedStyle(document.getElementById("themed").shadowRoot.querySelector(".card")).borderTopLeftRadius);
  assert.equal(radius, "0px");
  const href = await page.evaluate(() => document.getElementById("live").shadowRoot.querySelector("a").getAttribute("href"));
  assert.equal(href, `${base}/verify?subject=%40anon`);

  // the money moves: the badge with refresh="1" flips to REVOKED with the slot
  assert.equal((await text(page, "flip")).state, "live");
  await w.rpc.putCertificate({ subject: sdk.walletSubject(w.whale), asset: 0, tier: 4, status: 1, revokedSlot: 5002, expirySlot: 9000 });
  await page.waitForFunction(() => document.getElementById("flip").dataset.state === "revoked", null, { timeout: 5000 });
  assert.match((await text(page, "flip")).text, /REVOKED · slot 5002/);
  assert.ok(events.some((e) => e.id === "flip" && e.state === "revoked"));
  assert.deepEqual(errors, []);
  await page.close();
  await w.rpc.putCertificate({ subject: sdk.walletSubject(w.whale), asset: 0, tier: 4, expirySlot: 9000, logIndex: 4 });
});

test("a hostile subject string is rendered as text, never as markup", { skip }, async () => {
  const page = await browser.newPage();
  await page.goto(`${base}/test.html`);
  await page.evaluate(() => {
    const b = document.createElement("pof-badge");
    b.id = "x";
    b.setAttribute("refresh", "0");
    b.setAttribute("subject", '<img src=x onerror="window.pwned=1">');
    document.body.append(b);
  });
  await page.waitForFunction(() => document.getElementById("x").dataset.state && document.getElementById("x").dataset.state !== "checking");
  assert.equal(await page.evaluate(() => window.pwned ?? 0), 0);
  assert.equal(await page.evaluate(() => document.getElementById("x").shadowRoot.querySelector("img")), null);
  await page.close();
});

test("the iframe fallback and the SVG badge; no horizontal scroll at a real 375 px phone width", { skip }, async () => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${base}/embed/frame.html?subject=%40anon&asset=SOL&min-tier=4&theme=dark&refresh=0`);
  await page.waitForFunction(() => document.getElementById("b").dataset.state === "live");
  const bg = await page.evaluate(() => getComputedStyle(document.getElementById("b").shadowRoot.querySelector(".card")).backgroundColor);
  assert.equal(bg, "rgb(20, 21, 24)");
  await page.goto(`${base}/test.html`);
  await page.waitForFunction(() => [...document.querySelectorAll("pof-badge")].every((b) => b.dataset.state && b.dataset.state !== "checking"));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 375));
  await page.goto(`${base}/v1/badge/${encodeURIComponent(w.spent)}.svg`);
  const svgText = await page.evaluate(() => document.querySelector("svg title").textContent);
  assert.match(svgText, /REVOKED · slot 4500/);
  await ctx.close();
});
