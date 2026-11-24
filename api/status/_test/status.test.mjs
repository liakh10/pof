// Status checks against a fake chain, a fake Rings indexer and a fake Verifier (no network). Run: node --test api/status/_test/
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import * as sdk from "../../../sdk/dist/index.js";
import { MemoryRpc } from "../../../sdk/dist/testing.js";
import * as S from "../_core.js";
import sampleHandler from "../sample.js";

const ORIGIN = "https://pof.test";
const KEY = "secret-helius-key-123";
const RPC = `https://rpc.test/?api-key=${KEY}`;
const SPR = "https://spr.test/v1/spr";

/* ---------- an ed25519 verifier key (raw 32-byte public key from node's JWK) */
function edKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const raw = Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url");
  return { address: sdk.encodeBase58(raw), sign: (m) => crypto.sign(null, Buffer.from(m), privateKey) };
}

/* ---------- RFC 9162 helpers for the fake log */
const sha = (...p) => crypto.createHash("sha256").update(Buffer.concat(p.map((x) => Buffer.from(x)))).digest();
const lh = (d) => sha([0], d), nh = (l, r) => sha([1], l, r);
const split = (n) => { let k = 1; while (k * 2 < n) k *= 2; return k; };
function mth(h) { if (h.length === 0) return sha(); if (h.length === 1) return h[0]; const k = split(h.length); return nh(mth(h.slice(0, k)), mth(h.slice(k))); }
function subproof(m, h, b) {
  const n = h.length;
  if (m === n) return b ? [] : [mth(h)];
  const k = split(n);
  if (m <= k) return [...subproof(m, h.slice(0, k), b), mth(h.slice(k))];
  return [...subproof(m - k, h.slice(k), false), mth(h.slice(0, k))];
}

/* ---------- the Rings tree account */
function treeAccount({ headSlot, nfRoots }) {
  const b = new Uint8Array(40_080);
  b[0] = 1;
  const dv = new DataView(b.buffer);
  const hist = [1, 2, 3].map((i) => new Uint8Array(32).fill(i));
  dv.setUint16(112, 2, true); // cursor
  dv.setUint16(114, 3, true); // len
  dv.setUint16(116, 500, true); // cap
  hist.forEach((h, i) => b.set(h, 1_152 + i * 32));
  b.set(hist[2], 80);
  dv.setBigUint64(120, BigInt(headSlot), true);
  dv.setBigUint64(72, 64_000n, true);
  nfRoots.forEach((r, i) => b.set(r, 17_232 + i * 32));
  return b;
}

/* ---------- one fake world: chain + indexer + verifier, all behind fetch */
async function world(o = {}) {
  const slot = o.slot ?? 100_000;
  const verifier = edKey();
  const mem = new MemoryRpc();
  const relayer = sdk.encodeBase58(crypto.randomBytes(32));
  if (!o.noProgram) {
    await mem.putConfig({
      admin: verifier.address, verifier: o.programKey ?? verifier.address, relayer, paused: !!o.paused,
      params: { fee_lamports: 10_000_000, holder_min: 1_000_000_000_000n, validity_slots: 6_480_000, max_attest_age: 300, max_root_lag: 9000, rotation_delay: 216000 },
    });
  }
  const leaves = Array.from({ length: o.logSize ?? 7 }, (_, i) => lh(Buffer.from([i, 1, 2, 3])));
  const tamper = o.tamperLog ? leaves.map((x, i) => (i === 1 ? lh(Buffer.from("evil")) : x)) : leaves;
  if (o.anchored !== undefined && !o.noProgram) {
    const k = o.anchored;
    await mem.putTreasury({ live: 2, log_size: k, log_head: mth(leaves.slice(0, k)), log_slot: slot - (o.anchorAge ?? 100) });
  }
  const nfRoot = new Uint8Array(32).fill(9);
  const tree = treeAccount({ headSlot: slot - (o.rootAge ?? 300), nfRoots: [nfRoot] });
  const indexerRoot = o.indexerRootUnknown ? new Uint8Array(32).fill(4) : nfRoot;
  const bundleHash = o.bundleHash ?? S.PUBLISHED.sha256;
  const calls = [];

  const ok = (j, status = 200) => ({ ok: status < 400, status, json: async () => j });
  async function fetchFake(url, init = {}) {
    url = String(url);
    calls.push(url);
    if (url.startsWith("https://rpc.test")) {
      if (o.rpcDown) throw new Error(`connect ECONNREFUSED ${url}`);
      const { method, params } = JSON.parse(init.body);
      const ctx = { slot };
      if (method === "getSlot") return ok({ result: slot });
      if (method === "getBalance") return ok({ result: { context: ctx, value: o.relayerLamports ?? 1_000_000_000 } });
      if (method === "getAccountInfo") {
        const a = params[0];
        if (a === S.RINGS_TREE) return ok({ result: { context: ctx, value: { owner: S.RINGS_PROGRAM, lamports: 1, data: [Buffer.from(tree).toString("base64"), "base64"] } } });
        const acc = mem.accounts.get(a);
        return ok({ result: { context: ctx, value: acc ? { owner: acc.owner, lamports: acc.lamports, executable: false, data: [Buffer.from(acc.data).toString("base64"), "base64"] } : null } });
      }
      if (method === "getMultipleAccounts") {
        return ok({ result: { context: ctx, value: params[0].map((a) => { const acc = mem.accounts.get(a); return acc ? { owner: acc.owner, lamports: acc.lamports, executable: false, data: [Buffer.from(acc.data).toString("base64"), "base64"] } : null; }) } });
      }
      return ok({ error: { message: `no ${method}` } });
    }
    if (url.startsWith(SPR)) {
      if (!url.includes("/getNonInclusionProofs?api-key=")) return ok({ error: { message: "bad path" } }, 404);
      return ok({ jsonrpc: "2.0", id: 1, result: { context: { slot: slot - (o.indexerLag ?? 2) }, proofs: [{ root: sdk.encodeBase58(indexerRoot), rootSeq: slot - 10 }] } });
    }
    if (url.startsWith(ORIGIN)) {
      const u = new URL(url);
      if (o.verifierDown) return ok({ error: { code: "INTERNAL" } }, 500);
      if (u.pathname === "/api/attest") return ok({ verifierKey: verifier.address, bundleHash, version: "0.1.0", relayer });
      if (u.pathname === "/api/attest/log") {
        const n = leaves.length;
        if (u.searchParams.has("head")) {
          const root = mth(tamper);
          const sig = verifier.sign(sdk.treeHeadMessage(sdk.POF_PROGRAM_ID, n, root));
          return ok({ treeSize: n, rootHash: root.toString("hex"), slot, signature: Buffer.from(o.badSig ? Buffer.alloc(64) : sig).toString("hex"), verifierKey: verifier.address });
        }
        if (u.searchParams.has("consistency")) {
          const m = Number(u.searchParams.get("consistency")), s = Number(u.searchParams.get("size"));
          return ok({ first: m, second: s, firstRoot: mth(tamper.slice(0, m)).toString("hex"), secondRoot: mth(tamper.slice(0, s)).toString("hex"), path: subproof(m, tamper.slice(0, s), true).map((x) => x.toString("hex")) });
        }
      }
      return ok({ error: { code: "NOT_FOUND" } }, 404);
    }
    throw new Error(`unexpected fetch ${url}`);
  }

  const d = S.depsFromEnv({ SOLANA_RPC: RPC, HELIUS_API_KEY: KEY, HELIUS_SPR_URL: SPR, POF_KEEPER_LIVE: o.keeperLive ? "1" : "" }, ORIGIN);
  d.fetch = fetchFake;
  d.store = o.store ?? new S.MemoryStatusStore();
  if (o.keeperLast) await d.store.putJson("keeper/last-scan.json", o.keeperLast);
  return { d, calls, slot, leaves, verifier };
}

const byId = (run) => Object.fromEntries(run.checks.map((c) => [c.id, c]));

test("all green: every check ok, keeper off before launch, no secret in the answer", async () => {
  const { d } = await world({ anchored: 4 });
  const run = await S.runChecks(d);
  const c = byId(run);
  for (const id of ["rpc", "program", "rings_tree", "rings_indexer", "verifier", "relayer", "log"]) assert.equal(c[id].state, "ok", `${id}: ${c[id].summary}`);
  assert.equal(c.keeper.state, "off");
  assert.equal(run.overall, "ok");
  assert.equal(c.log.metrics.consistentWithChain, true);
  assert.equal(c.verifier.metrics.bundleMatches, true);
  const text = JSON.stringify(run);
  assert.ok(!text.includes(KEY), "the Helius key never appears");
  assert.ok(!text.includes("rpc.test"), "RPC URLs never appear");
  assert.deepEqual(Object.keys(c.relayer.metrics).sort(), ["band", "range"], "the relayer shows a band only");
});

test("Rings tree: degraded past half of max_root_lag, down past it", async () => {
  let c = byId(await S.runChecks((await world({ rootAge: 5_000 })).d));
  assert.equal(c.rings_tree.state, "degraded");
  c = byId(await S.runChecks((await world({ rootAge: 9_000 })).d));
  assert.equal(c.rings_tree.state, "down");
  assert.match(c.rings_tree.summary, /next Rings transaction/);
});

test("indexer: root not in the on-chain history, or far behind", async () => {
  let c = byId(await S.runChecks((await world({ indexerRootUnknown: true })).d));
  assert.equal(c.rings_indexer.state, "degraded");
  assert.equal(c.rings_indexer.metrics.rootInHistory, false);
  c = byId(await S.runChecks((await world({ indexerLag: 600 })).d));
  assert.equal(c.rings_indexer.state, "degraded");
  c = byId(await S.runChecks((await world({ indexerLag: 5_000 })).d));
  assert.equal(c.rings_indexer.state, "down");
});

test("verifier: key the program does not accept is down; unpublished bundle is degraded", async () => {
  let c = byId(await S.runChecks((await world({ programKey: sdk.encodeBase58(crypto.randomBytes(32)) })).d));
  assert.equal(c.verifier.state, "down");
  c = byId(await S.runChecks((await world({ bundleHash: "00".repeat(32) })).d));
  assert.equal(c.verifier.state, "degraded");
  c = byId(await S.runChecks((await world({ verifierDown: true })).d));
  assert.equal(c.verifier.state, "down");
});

test("relayer bands", async () => {
  assert.equal(S.band(10).band, "empty");
  assert.equal(S.band(100_000_000).band, "low");
  assert.equal(S.band(1_000_000_000).band, "ok");
  assert.equal(S.band(5_000_000_000).band, "ample");
  let c = byId(await S.runChecks((await world({ relayerLamports: 10_000_000 })).d));
  assert.equal(c.relayer.state, "down");
  c = byId(await S.runChecks((await world({ relayerLamports: 200_000_000 })).d));
  assert.equal(c.relayer.state, "degraded");
});

test("program: paused is down, not deployed is unknown", async () => {
  let c = byId(await S.runChecks((await world({ paused: true })).d));
  assert.equal(c.program.state, "down");
  c = byId(await S.runChecks((await world({ noProgram: true })).d));
  assert.equal(c.program.state, "unknown");
  assert.equal(c.verifier.state, "ok", "no Config to compare the key with");
});

test("log: a bad head signature, a rewritten history, a log shorter than its anchor are all down", async () => {
  let c = byId(await S.runChecks((await world({ badSig: true })).d));
  assert.equal(c.log.state, "down");
  c = byId(await S.runChecks((await world({ anchored: 4, tamperLog: true })).d));
  assert.equal(c.log.state, "down");
  assert.match(c.log.summary, /not consistent/);
  c = byId(await S.runChecks((await world({ anchored: 9, logSize: 7 })).d));
  assert.equal(c.log.state, "down");
});

test("log: the next sample must extend the head the last sample stored", async () => {
  const store = new S.MemoryStatusStore();
  const w = await world({ store });
  await S.storeSample(store, await S.runChecks(w.d));
  assert.equal((await store.getJson("status/log-head.json")).treeSize, 7);
  const c = byId(await S.runChecks((await world({ store, logSize: 9 })).d));
  assert.equal(c.log.state, "ok");
  assert.equal(c.log.metrics.consistentWithLastSample, true);
  const bad = byId(await S.runChecks((await world({ store, logSize: 9, tamperLog: true })).d));
  assert.equal(bad.log.state, "down");
});

test("keeper: off, unknown, fresh, stale", async () => {
  let c = byId(await S.runChecks((await world({ keeperLive: true })).d));
  assert.equal(c.keeper.state, "unknown");
  const w = await world({ keeperLive: true, keeperLast: { slot: 100_000 - 300, kits: 3, live: 2, revoked: [], errors: [] } });
  c = byId(await S.runChecks(w.d));
  assert.equal(c.keeper.state, "ok");
  c = byId(await S.runChecks((await world({ keeperLive: true, keeperLast: { slot: 100_000 - 4_000, kits: 3, live: 2, revoked: [], errors: [] } })).d));
  assert.equal(c.keeper.state, "degraded");
  c = byId(await S.runChecks((await world({ keeperLive: true, keeperLast: { slot: 100_000 - 9_000 } })).d));
  assert.equal(c.keeper.state, "down");
});

test("rpc down: every chain check reports down, the overall state is down", async () => {
  const run = await S.runChecks((await world({ rpcDown: true })).d);
  const c = byId(run);
  assert.equal(c.rpc.state, "down");
  assert.equal(run.overall, "down");
  assert.ok(!JSON.stringify(run).includes(KEY));
});

test("history: samples fold into a per-day summary with uptime", () => {
  let s = null;
  const t0 = Date.parse("2026-11-25T10:00:00Z") / 1000;
  for (let i = 0; i < 10; i++) s = S.addToSummary(s, { t: t0 + i * 300, slot: i, o: i === 3 ? "down" : "ok", c: { rpc: i === 3 ? "down" : "ok", keeper: "off" } });
  s = S.addToSummary(s, { t: t0 + 86_400, slot: 99, o: "degraded", c: { rpc: "degraded" } });
  const v = S.historyView(s);
  assert.equal(v.days.length, 2);
  assert.equal(v.days[0].checks.rpc.uptime, 90);
  assert.equal(v.days[0].checks.keeper, undefined, "off is not counted");
  assert.equal(v.days[1].uptime, 100, "degraded counts as up");
  assert.equal(v.uptime.rpc, Math.round((10 / 11) * 10_000) / 100);
  for (let i = 0; i < 100; i++) s = S.addToSummary(s, { t: t0 + (i + 2) * 86_400, slot: i, o: "ok", c: { rpc: "ok" } });
  assert.equal(Object.keys(s.days).length, S.LIMITS.historyDays, "older days drop out");
});

test("sample handler: refuses without the cron secret", async () => {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  const old = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "s3";
  await sampleHandler({ headers: { authorization: "Bearer nope", host: "pof.test" } }, res);
  assert.equal(res.statusCode, 403);
  if (old === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = old;
});

test("the Verifier origin never comes from the Host header on Vercel (POF-20)", () => {
  assert.equal(S.selfOrigin({ VERCEL: "1", VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "pof.example" }, "https://evil.test"), "https://pof.example");
  assert.equal(S.selfOrigin({ VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: "pof-abc.vercel.app" }, "https://evil.test"), "https://pof-abc.vercel.app");
  assert.equal(S.selfOrigin({ VERCEL: "1" }, "https://evil.test"), "");
  assert.equal(S.selfOrigin({ POF_STATUS_ORIGIN: "https://set.test/" }, "https://evil.test"), "https://set.test");
  assert.equal(S.selfOrigin({}, "http://localhost:3000"), "http://localhost:3000");
});

test("GET /api/status with a query string redirects without running a check (POF-14)", async () => {
  const { default: statusHandler } = await import("../index.js");
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  let fetched = false;
  const orig = globalThis.fetch;
  globalThis.fetch = async () => { fetched = true; throw new Error("no"); };
  try { await statusHandler({ method: "GET", url: "/api/status?x=1", headers: { host: "pof.test" } }, res); } finally { globalThis.fetch = orig; }
  assert.equal(res.statusCode, 308);
  assert.equal(res.headers.location, "/api/status");
  assert.equal(fetched, false);
});

test("upstream reads are capped across instances: a fresh shared run is reused, past the cap the last run is served stale", async () => {
  const store = new S.MemoryStatusStore();
  const w = await world({ store });
  let t = 1_000_000_000;
  w.d.now = () => t;
  S.clearCache();
  const a = await S.cachedRun(w.d);
  const n1 = w.calls.length;
  S.clearCache(); // another instance
  const b = await S.cachedRun(w.d);
  assert.equal(w.calls.length, n1, "a shared run younger than 30 s costs no upstream read");
  assert.equal(b.checkedAt, a.checkedAt);
  // force the cap: same minute window, shared run expired
  t = Math.floor(1_000_000_000 / 60_000) * 60_000 + 59_000;
  await store.putJson(`status/runs/${Math.floor(t / 60_000) % 60}.json`, { w: Math.floor(t / 60_000), n: 6 });
  await store.putJson("status/live.json", { at: t - 40_000, run: a });
  S.clearCache();
  const before = w.calls.length;
  const c = await S.cachedRun(w.d);
  assert.equal(w.calls.length, before, "past the cap no check runs");
  assert.equal(c.stale, true);
  S.clearCache();
});
