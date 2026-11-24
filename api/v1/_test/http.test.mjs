// The Vercel entry points behind a real HTTP server: /v1 (rewritten to /api/v1?path=), /api/bots link page.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { makeWorld, makeLog, startChainServer } from "./fixtures.mjs";

let chain, server, base, w;
before(async () => {
  w = await makeWorld();
  const log = await makeLog(3);
  await w.rpc.putConfig({ verifier: log.verifierKey });
  chain = await startChainServer(w.rpc, log);
  process.env.SOLANA_RPC = chain.url;
  process.env.POF_LOG_URL = chain.logUrl;
  process.env.BOT_LINK_SECRET = "y".repeat(40);
  const v1 = (await import("../index.js")).default;
  const bots = (await import("../../bots.js")).default;
  server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/v1" || u.pathname.startsWith("/v1/")) {
      req.url = `/api/v1?path=${encodeURIComponent(u.pathname.replace(/^\/v1\/?/, ""))}&${u.searchParams}`;
      return v1(req, res);
    }
    if (u.pathname === "/link") {
      req.url = `/api/bots?fn=link&${u.searchParams}`;
      return bots(req, res);
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await chain.close();
});

test("GET /v1/certificates/@anon over HTTP reads the chain through a real JSON-RPC endpoint", async () => {
  const r = await fetch(`${base}/v1/certificates/@anon?asset=SOL&minTier=5`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
  const j = await r.json();
  assert.equal(j.check.ok, true);
  assert.equal(j.certificates[0].tierLabel, "≥ 10,000 SOL");
});

test("GET /v1/stats, /v1/rooms/:room, /v1/log/proof/1 over HTTP", async () => {
  assert.equal((await (await fetch(`${base}/v1/stats`)).json()).live, 3);
  assert.equal((await (await fetch(`${base}/v1/rooms/${w.room}`)).json()).liveMembers, 1);
  const p = await (await fetch(`${base}/v1/log/proof/1`)).json();
  assert.equal(p.verified, true);
  const h = await fetch(`${base}/v1/stats`, { method: "HEAD" });
  assert.equal(h.status, 200);
});

test("GET /link serves the page without a store", async () => {
  const r = await fetch(`${base}/link?p=tg&u=1&e=1&t=x`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Link your certificate/);
  const m = await fetch(`${base}/link?p=tg&u=1&e=1&t=x&message=1`);
  assert.equal(m.status, 400);
});
