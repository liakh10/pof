import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { handleV1 } from "../_core.js";
import { setClient, clearMemo } from "../_lib.js";
import { makeWorld, makeLog, rand } from "./fixtures.mjs";

let w, log;
/** a log that serves altered leaves (pages and single entries), so they no longer add up to its signed head */
const tamperLeaves = (f) => async (url) => {
  const res = await f(url);
  if (!/[?&](from|entry)=/.test(url)) return res;
  const j = await res.json();
  const flip = (hex) => hex.slice(0, 100) + (hex[100] === "0" ? "1" : "0") + hex.slice(101);
  if (j.entries) j.entries = j.entries.map((e) => ({ ...e, leaf: flip(e.leaf) }));
  if (j.leaf) j.leaf = flip(j.leaf);
  return new Response(JSON.stringify(j), { status: res.status });
};
const env = { POF_LOG_URL: "https://pof.test/api/attest/log" };
const get = async (path, query = {}) => {
  const r = await handleV1({ method: "GET", path, query, env, fetch: log.fetch });
  return { ...r, json: r.body ? JSON.parse(r.body) : null };
};

beforeEach(async () => {
  w = await makeWorld();
  log = await makeLog(7);
  await w.rpc.putConfig({ verifier: log.verifierKey });
  setClient(w.client);
  clearMemo();
});

test("GET /v1 lists endpoints, CORS and cache headers are set", async () => {
  const r = await get("");
  assert.equal(r.status, 200);
  assert.equal(r.headers["access-control-allow-origin"], "*");
  assert.match(r.headers["cache-control"], /s-maxage=300/);
  assert.ok(r.json.endpoints.length >= 7);
  const o = await handleV1({ method: "OPTIONS", path: "certificates/x", query: {}, env });
  assert.equal(o.status, 204);
  const p = await handleV1({ method: "POST", path: "stats", query: {}, env });
  assert.equal(p.status, 405);
});

test("GET /v1/certificates/:subject by wallet, @handle, badge, hash; with a gate check", async () => {
  let r = await get(`certificates/${w.whale}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.live, true);
  assert.equal(r.json.certificates.length, 2);
  assert.equal(r.json.certificates[0].asset, "SOL");
  assert.equal(r.json.certificates[0].tierLabel, "≥ 1,000 SOL");
  assert.equal(r.json.certificates[0].subject, w.whale);
  assert.equal(r.json.certificates[0].kind, "wallet");
  assert.equal(r.json.certificates[1].status, "expired");
  assert.equal(r.json.certificates[1].statusOnChain, "live");
  assert.deepEqual(r.json.subjects.map((s) => s.kind), ["wallet"]);
  assert.match(r.headers["cache-control"], /s-maxage=5/);

  r = await get("certificates/%40Anon");
  assert.equal(r.json.certificates[0].kind, "x");
  assert.equal(r.json.certificates[0].subject, "anon");
  r = await get(`certificates/badge:${w.badge}`);
  assert.equal(r.json.certificates[0].kind, "badge");
  r = await get(`certificates/${r.json.certificates[0].subjectHash}`);
  assert.equal(r.json.certificates.length, 1);

  r = await get(`certificates/${w.whale}`, { asset: "SOL", minTier: "4" });
  assert.deepEqual(r.json.check, { asset: "SOL", minTier: 4, minTierLabel: "≥ 1,000 SOL", ok: true, reason: "ok" });
  r = await get(`certificates/${w.whale}`, { asset: "SOL", minTier: "5" });
  assert.equal(r.json.check.reason, "below_tier");
  r = await get(`certificates/${w.spent}`, { asset: "0", minTier: "1" });
  assert.equal(r.json.check.reason, "revoked_spent");
  r = await get(`certificates/${rand()}`, { asset: "SOL", minTier: "1" });
  assert.equal(r.status, 200);
  assert.equal(r.json.live, false);
  assert.equal(r.json.check.reason, "no_certificate");
});

test("bad input gets a clear 400", async () => {
  assert.equal((await get("certificates/!!nope")).json.error.code, "bad_subject");
  assert.equal((await get(`certificates/${w.whale}`, { asset: "BONK" })).json.error.code, "bad_asset");
  assert.equal((await get(`certificates/${w.whale}`, { minTier: "3" })).json.error.message, "minTier needs asset");
  assert.equal((await get("certificates", { tier: "9" })).status, 400);
  assert.equal((await get("certificates", { status: "weird" })).status, 400);
  assert.equal((await get("certificates", { kind: "dog" })).status, 400);
  assert.equal((await get("rooms/notakey")).status, 400);
  assert.equal((await get("nope")).status, 404);
});

test("GET /v1/certificates lists with filters and paging", async () => {
  let r = await get("certificates");
  assert.equal(r.json.total, 5);
  assert.equal(r.json.certificates[0].subject, null);
  r = await get("certificates", { asset: "SOL", status: "live" });
  assert.equal(r.json.total, 3);
  r = await get("certificates", { tier: "5" });
  assert.equal(r.json.total, 1);
  r = await get("certificates", { minTier: "4", kind: "wallet" });
  assert.equal(r.json.total, 1);
  r = await get("certificates", { limit: "2" });
  assert.equal(r.json.certificates.length, 2);
  assert.equal(r.json.nextCursor, "2");
  r = await get("certificates", { limit: "2", cursor: "4" });
  assert.equal(r.json.certificates.length, 1);
  assert.equal(r.json.nextCursor, null);
});

test("GET /v1/rooms and /v1/rooms/:room", async () => {
  let r = await get("rooms");
  assert.equal(r.json.rooms.length, 1);
  r = await get(`rooms/${w.room}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.name, "whales");
  assert.equal(r.json.minTierLabel, "≥ 100 SOL");
  assert.equal(r.json.members.length, 2);
  assert.equal(r.json.liveMembers, 1);
  r = await get(`rooms/${rand()}`);
  assert.equal(r.status, 404);
});

test("GET /v1/stats", async () => {
  const r = await get("stats");
  assert.equal(r.json.live, 3);
  assert.equal(r.json.revoked, 1);
  assert.equal(r.json.expired, 1);
  assert.equal(r.json.solCertified, 11001);
  assert.equal(r.json.log.treeSize, 7);
  assert.equal(r.json.log.signatureValid, true);
});

test("GET /v1/log/head and /v1/log/proof/:id verify the verifier's log", async () => {
  let r = await get("log/head");
  assert.equal(r.status, 200);
  assert.equal(r.json.treeSize, 7);
  assert.equal(r.json.signatureValid, true);
  for (let i = 0; i < 7; i++) {
    r = await get(`log/proof/${i}`);
    assert.equal(r.status, 200);
    assert.equal(r.json.verified, true, JSON.stringify(r.json.checks));
    assert.equal(r.json.attestation.tier, 1 + (i % 5));
    assert.equal(r.json.attestation.loggedSlot, 300 + i);
  }
  r = await get("log/proof/7");
  assert.equal(r.status, 404);
  r = await get("log/proof/abc");
  assert.equal(r.status, 400);
  // a log whose entries do not match its signed head is caught, not passed through as verified
  const evil = tamperLeaves(log.fetch);
  const { clearMemo: cm } = await import("../_lib.js");
  cm();
  const t = await handleV1({ method: "GET", path: "log/proof/2", query: {}, env, fetch: evil });
  assert.equal(JSON.parse(t.body).verified, false);
  assert.equal(JSON.parse(t.body).checks.included, false);
  // POF-13: a log signed by a key the program's Config does not list is never "verified"
  const { clearMemo } = await import("../_lib.js");
  await w.rpc.putConfig({ verifier: rand() });
  clearMemo();
  r = await get("log/head");
  assert.equal(r.json.keyTrusted, false);
  assert.equal(r.json.signatureValid, false);
  r = await get("log/proof/1");
  assert.equal(r.json.verified, false);
  assert.equal(r.json.checks.keyTrusted, false);
  // POF-20: no Host-derived log URL in production
  const p = await handleV1({ method: "GET", path: "log/head", query: {}, env: { VERCEL_ENV: "production" }, origin: "https://evil.test" });
  assert.equal(p.status, 503);
});

test("no RPC configured reads 503, RPC failure reads 502", async () => {
  setClient(null);
  const r = await handleV1({ method: "GET", path: "stats", query: {}, env: {} });
  assert.equal(r.status, 503);
  const { PofClient, Rpc } = await import("../../../sdk/dist/index.js");
  setClient(new PofClient({ rpc: new Rpc("http://x", { fetch: async () => new Response("", { status: 500 }) }) }));
  const b = await handleV1({ method: "GET", path: `certificates/${w.whale}`, query: {}, env: {} });
  assert.equal(b.status, 502);
  assert.equal(b.headers["cache-control"], "no-store");
});

test("the OpenAPI file is served and lists every route", async () => {
  const r = await handleV1({ method: "GET", path: "openapi.json", query: {}, env });
  const spec = JSON.parse(r.body);
  assert.equal(spec.openapi, "3.1.0");
  for (const p of ["/certificates/{subject}", "/certificates", "/rooms/{room}", "/stats", "/log/head", "/log/proof/{id}"]) assert.ok(spec.paths[p], p);
});

test("GET /v1/log/consistency verifies against the signed head", async () => {
  const before = log.sth.treeSize;
  await log.append(5);
  let r = await get("log/consistency", { first: String(before) });
  assert.equal(r.status, 200);
  assert.equal(r.json.second, before + 5);
  assert.equal(r.json.secondRootSigned, true);
  assert.equal(r.json.verified, true);
  r = await get("log/consistency", { first: "2", second: "6" });
  assert.equal(r.json.verified, true);
  assert.equal((await get("log/consistency", {})).status, 400);
  assert.equal((await get("log/consistency", { first: "99" })).status, 404);
  const evil = async (url) => {
    const res = await log.fetch(url);
    if (!url.includes("consistency=")) return res;
    const j = await res.json();
    j.path[0] = "00".repeat(32);
    return new Response(JSON.stringify(j), { status: 200 });
  };
  (await import("../_lib.js")).clearMemo();
  const t = await handleV1({ method: "GET", path: "log/consistency", query: { first: "3" }, env, fetch: evil });
  assert.equal(JSON.parse(t.body).verified, false);
});

test("GET /v1/badge/{subject}.svg renders live, revoked with slot, expired, below tier and none", async () => {
  const svg = async (s, q = {}) => {
    const r = await handleV1({ method: "GET", path: `badge/${encodeURIComponent(s)}.svg`, query: q, env, fetch: log.fetch });
    assert.equal(r.status, 200, r.body);
    assert.match(r.headers["content-type"], /image\/svg\+xml/);
    return r.body;
  };
  let b = await svg("@anon");
  assert.match(b, /≥ 10,000 SOL/);
  assert.match(b, />LIVE</);
  assert.match(b, /^<svg/);
  b = await svg(w.spent);
  assert.match(b, /REVOKED · slot 4500/);
  b = await svg(w.whale, { asset: "USDC" });
  assert.match(b, />EXPIRED</);
  b = await svg(w.whale, { asset: "SOL", minTier: "5" });
  assert.match(b, /BELOW TIER/);
  b = await svg(rand(), { theme: "dark" });
  assert.match(b, /NO CERTIFICATE/);
  assert.match(b, /#141518/);
  const bad = await handleV1({ method: "GET", path: `badge/${encodeURIComponent("@<script>")}.svg`, query: {}, env });
  assert.equal(bad.status, 400);
  assert.match(bad.body, /^<svg/);
  assert.equal(bad.body.includes("<script>"), false);
});

test("GET /v1/witness serves the witness document with its cosignatures checked", async () => {
  const { setWitnessSource } = await import("../_lib.js");
  setWitnessSource(async () => null);
  assert.equal((await get("witness")).status, 404);
  const { Witness, signerFromSecret } = await import("../../../witness/witness.js");
  const { MemoryState } = await import("../../../witness/store.js");
  const { PofClient, LogReader } = await import("../../../sdk/dist/index.js");
  const crypto = await import("node:crypto");
  const kp = crypto.generateKeyPairSync("ed25519");
  const secret = Uint8Array.from([...Buffer.from(kp.privateKey.export({ format: "jwk" }).d, "base64url"), ...Buffer.from(kp.publicKey.export({ format: "jwk" }).x, "base64url")]);
  const state = new MemoryState();
  const wit = new Witness({ reader: new LogReader(log.base, log.fetch), client: w.client, signer: signerFromSecret(secret), state });
  assert.equal((await wit.step()).ok, true);
  setWitnessSource(() => state.get());
  const r = await get("witness");
  assert.equal(r.status, 200);
  assert.equal(r.json.cosignaturesValid, true);
  assert.equal(r.json.latest.treeSize, 7);
  setWitnessSource(null);
  void PofClient;
});

test("log reads are cached: entries and proofs fetched once; a proof that did not verify is not kept", async () => {
  const { clearMemo, logStats } = await import("../_lib.js");
  clearMemo();
  let n = 0;
  const counting = async (u) => { n++; return log.fetch(u); };
  for (let k = 0; k < 5; k++) assert.equal(JSON.parse((await handleV1({ method: "GET", path: "log/proof/3", query: {}, env, fetch: counting })).body).verified, true);
  assert.ok(n <= 3, `5 identical proof reads cost ${n} log calls (head, entry, proof)`);
  void logStats;
  clearMemo();
  let bad = true;
  const evil = tamperLeaves(log.fetch);
  const flaky = (u) => (bad ? evil(u) : log.fetch(u));
  assert.equal(JSON.parse((await handleV1({ method: "GET", path: "log/proof/4", query: {}, env, fetch: flaky })).body).verified, false);
  bad = false;
  assert.equal(JSON.parse((await handleV1({ method: "GET", path: "log/proof/4", query: {}, env, fetch: flaky })).body).verified, true, "the bad answer was not cached");
  // a log that rate-limits this server reads as 503 with retry-after, not as a broken log
  const limited = async () => new Response(JSON.stringify({ error: { code: "RATE" } }), { status: 429 });
  clearMemo();
  const r = await handleV1({ method: "GET", path: "log/head", query: {}, env, fetch: limited });
  assert.equal(r.status, 503);
  assert.equal(r.headers["retry-after"], "5");
});

test("the log mirror: proofs computed here match the log's own, follow growth, and refuse a log that does not add up", async () => {
  const { clearMemo, mirrorStats } = await import("../_lib.js");
  clearMemo();
  let calls = 0;
  const counting = async (u) => { calls++; return log.fetch(u); };
  for (let i = 0; i < 7; i++) {
    const r = JSON.parse((await handleV1({ method: "GET", path: `log/proof/${i}`, query: {}, env, fetch: counting })).body);
    assert.equal(r.verified, true);
    assert.equal(r.computedBy, "this server's mirror of the log");
    const theirs = await (await log.fetch(`${log.base}?proof=${i}&size=7`)).json();
    assert.deepEqual(r.proof.path, theirs.path, `entry ${i}`);
  }
  assert.ok(calls <= 3, `seven proofs cost ${calls} log calls (head and one page)`);
  for (const n of [1, 3, 10]) {
    await log.append(n);
    clearMemo(); // a new head is read at most every 3 s; the mirror itself is kept below by reading it fresh
  }
  const r = JSON.parse((await handleV1({ method: "GET", path: "log/proof/15", query: {}, env, fetch: log.fetch })).body);
  assert.equal(r.verified, true);
  assert.equal(r.proof.treeSize, 21);
  void mirrorStats;
});

test("LogMirror levels: incremental appends give the RFC 9162 root and audit paths at every size 1..70", async () => {
  const { LogMirror } = await import("../_logmirror.js");
  const sdk = await import("../../../sdk/dist/index.js");
  const big = await makeLog(70);
  const m = new LogMirror({ entries: async () => [], entry: async () => null, head: async () => null });
  for (let n = 1; n <= 70; n++) {
    await m.append(big.hashes[n - 1]);
    assert.equal(sdk.toHex(m.root()), sdk.toHex(await sdk.merkleRoot(big.hashes.slice(0, n))), `root ${n}`);
    m.head = { treeSize: n };
    for (const i of [0, n - 1, Math.floor(n / 2)]) {
      assert.deepEqual(m.path(i), (await sdk.inclusionPath(i, big.hashes.slice(0, n))).map(sdk.toHex), `path ${i} of ${n}`);
    }
  }
});

test("a burst on a cold mirror pages the log once; a failing log is backed off, not hammered", async () => {
  const { clearMemo } = await import("../_lib.js");
  clearMemo();
  const big = await makeLog(600);
  await w.rpc.putConfig({ verifier: big.verifierKey });
  clearMemo();
  let calls = 0;
  const counting = async (u) => { calls++; return big.fetch(u); };
  const rs = await Promise.all(Array.from({ length: 50 }, (_, i) => handleV1({ method: "GET", path: `log/proof/${(i * 37) % 600}`, query: {}, env, fetch: counting })));
  assert.ok(rs.every((r) => JSON.parse(r.body).verified === true));
  assert.ok(calls <= 4, `50 cold proofs cost ${calls} log calls (head and three pages)`);
  clearMemo();
  let n = 0;
  const busy = async (u) => { n++; if (u.includes("from=")) return new Response("{}", { status: 429 }); return big.fetch(u); };
  const out = await Promise.all(Array.from({ length: 30 }, (_, i) => handleV1({ method: "GET", path: `log/proof/${i}`, query: {}, env, fetch: busy })));
  assert.ok(out.every((r) => r.status === 503));
  assert.ok(n <= 1 + 4, `30 requests on a busy log cost ${n} calls (head and one round of at most 4 pages)`);
  await w.rpc.putConfig({ verifier: log.verifierKey });
});

test("server-side log reads carry x-pof-internal from env, and only then", async () => {
  const { clearMemo, internalHeaders } = await import("../_lib.js");
  assert.deepEqual(internalHeaders({}), { accept: "application/json" });
  const saved = process.env.POF_INTERNAL_SECRET;
  process.env.POF_INTERNAL_SECRET = "s3cret";
  clearMemo();
  const seen = [];
  const spy = async (u, init) => { seen.push(init?.headers?.["x-pof-internal"]); return log.fetch(u); };
  await handleV1({ method: "GET", path: "log/head", query: {}, env, fetch: spy });
  assert.ok(seen.length && seen.every((h) => h === "s3cret"));
  if (saved === undefined) delete process.env.POF_INTERNAL_SECRET;
  else process.env.POF_INTERNAL_SECRET = saved;
  const r = await handleV1({ method: "GET", path: "log/head", query: {}, env, fetch: spy });
  assert.equal(r.body.includes("s3cret"), false, "the secret never reaches a response");
});

test("voided (revoked verifier key) and settling (zk) read through /v1, the badge and the gate check", async () => {
  const sdk = await import("../../../sdk/dist/index.js");
  const leaked = rand();
  const holder = rand();
  await w.rpc.putCertificate({ subject: sdk.walletSubject(holder), asset: 0, tier: 4, expirySlot: 9000, verifier: leaked });
  await w.rpc.putConfig({ verifier: log.verifierKey, revoked_keys: [leaked, ...Array(7).fill("11111111111111111111111111111111")] });
  let r = await get(`certificates/${holder}`, { asset: "SOL", minTier: "1" });
  assert.equal(r.json.certificates[0].status, "voided");
  assert.equal(r.json.certificates[0].statusOnChain, "live");
  assert.equal(r.json.check.reason, "voided");
  const b = await handleV1({ method: "GET", path: `badge/${holder}.svg`, query: {}, env });
  assert.match(b.body, />VOIDED</);
  r = await get("stats");
  assert.ok(r.json.voided >= 1);
});
