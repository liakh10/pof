import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { handleV1 } from "../_core.js";
import { setClient, clearMemo } from "../_lib.js";
import { makeWorld, makeLog, rand } from "./fixtures.mjs";

let w, log;
const env = { POF_LOG_URL: "https://pof.test/api/attest/log" };
const get = async (path, query = {}) => {
  const r = await handleV1({ method: "GET", path, query, env, fetch: log.fetch });
  return { ...r, json: r.body ? JSON.parse(r.body) : null };
};

beforeEach(async () => {
  w = await makeWorld();
  log = await makeLog(7);
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
  // a tampered log answer is caught, not passed through as verified
  const evil = async (url) => {
    const res = await log.fetch(url);
    if (!url.includes("proof=")) return res;
    const j = await res.json();
    j.path[0] = "00".repeat(32);
    return new Response(JSON.stringify(j), { status: 200 });
  };
  const t = await handleV1({ method: "GET", path: "log/proof/2", query: {}, env, fetch: evil });
  assert.equal(JSON.parse(t.body).verified, false);
  assert.equal(JSON.parse(t.body).checks.included, false);
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
