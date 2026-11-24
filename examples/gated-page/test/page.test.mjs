// The static gated page in headless Chromium: a mock wallet signs with a real Ed25519 key; the page's @pof/sdk reads an
// in-memory chain through a real JSON-RPC endpoint. Set PLAYWRIGHT_CORE if _solkit's copy is not there.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as sdk from "../../../sdk/dist/index.js";
import { makeWorld, startChainServer } from "../../../api/v1/_test/fixtures.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const pwPath = process.env.PLAYWRIGHT_CORE || path.resolve(root, "../_solkit/onair/node_modules/playwright-core");
let chromium = null;
try {
  chromium = createRequire(import.meta.url)(pwPath).chromium;
} catch {}
const skip = !chromium && "playwright-core not found";

let w, chain, server, base, browser;
const keyOf = () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return { jwk: privateKey.export({ format: "jwk" }), address: sdk.encodeBase58(Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url")) };
};
const whale = keyOf(), small = keyOf(), spent = keyOf();

before(async () => {
  if (skip) return;
  w = await makeWorld();
  await w.rpc.putCertificate({ subject: sdk.walletSubject(whale.address), asset: 0, tier: 4, expirySlot: 9000 });
  await w.rpc.putCertificate({ subject: sdk.walletSubject(small.address), asset: 0, tier: 2, expirySlot: 9000 });
  await w.rpc.putCertificate({ subject: sdk.walletSubject(spent.address), asset: 0, tier: 5, status: 1, revokedSlot: 4900, expirySlot: 9000 });
  chain = await startChainServer(w.rpc);
  server = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/rpc") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const r = await fetch(chain.url, { method: "POST", headers: { "content-type": "application/json" }, body: Buffer.concat(chunks) });
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(await r.text());
    }
    if (u.pathname === "/" || u.pathname === "/index.html") {
      const html = fs.readFileSync(path.join(here, "..", "index.html"), "utf8").replace("https://cdn.jsdelivr.net/gh/liakh10/pof@main/sdk/dist/index.js", "/sdk/dist/index.js");
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(html);
    }
    const f = path.join(root, u.pathname);
    if (u.pathname.startsWith("/sdk/dist/") && fs.existsSync(f)) {
      res.writeHead(200, { "content-type": "text/javascript" });
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
  await chain.close();
});

async function visit(key, { tamper = false } = {}) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(({ jwk, address, rpc, tamper }) => {
    window.POF_RPC = rpc;
    const keyP = crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["sign"]);
    window.phantom = { solana: {
      publicKey: { toString: () => address },
      connect: async () => ({ publicKey: { toString: () => address } }),
      signMessage: async (m) => {
        const sig = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, await keyP, m));
        if (tamper) sig[0] ^= 1;
        return { signature: sig };
      },
    } };
  }, { jwk: key.jwk, address: key.address, rpc: `${base}/rpc`, tamper });
  await page.goto(base + "/");
  await page.click("text=Connect Phantom");
  await page.waitForFunction(() => /slot|match|wallet/.test(document.getElementById("status").textContent) && !/Checking/.test(document.getElementById("status").textContent));
  const out = await page.evaluate(() => ({ status: document.getElementById("status").textContent, open: !document.getElementById("content").hidden }));
  await page.close();
  return { ...out, errors };
}

test("a ≥ 1,000 SOL wallet gets in; ≥ 10 SOL, a revoked certificate, no certificate and a forged signature do not", { skip }, async () => {
  let r = await visit(whale);
  assert.equal(r.open, true, r.status);
  assert.match(r.status, /Certificate ≥ 1,000 SOL, live as of slot 5000/);
  assert.deepEqual(r.errors, []);
  r = await visit(small);
  assert.equal(r.open, false);
  assert.match(r.status, /below the tier/);
  r = await visit(spent);
  assert.equal(r.open, false);
  assert.match(r.status, /funds moved/);
  r = await visit(keyOf());
  assert.equal(r.open, false);
  assert.match(r.status, /no certificate/);
  r = await visit(whale, { tamper: true });
  assert.equal(r.open, false);
  assert.match(r.status, /does not match/);
});
