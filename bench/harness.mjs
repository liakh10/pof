// The functions under test, served from one Node process the way Vercel runs them (one handler per request):
//   /v1/*          api/v1/index.js           (devx)
//   /mcp           api/mcp.js                (devx)
//   /api/status    api/status/index.js       (docs)
//   /api/attest    the Verifier bundle       (verifier), on a fake Rings data source built with the Helius SDK itself
//   /api/attest/log  the Verifier's real transparency log, pre-filled with BENCH_LOG signed entries
// Upstreams get injected latency: RPC in bench/rpc.mjs, the Rings indexer BENCH_INDEXER_MS (default 60), Blob
// BENCH_BLOB_MS per operation (default 40). Every upstream call is counted: GET /__stats.
//   node bench/harness.mjs <port>   (env: SOLANA_RPC, BENCH_SEED, BENCH_ATTESTS, BENCH_LOG)
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as sdk from "../sdk/dist/index.js";

const PORT = Number(process.argv[2] || 46991);
const T0 = performance.now();
const { V, makeCtx, ring, pkg, spr } = await import("../verifier/test/helpers.mjs");
const v1 = (await import("../api/v1/index.js")).default;
const mcp = (await import("../api/mcp.js")).default;
const status = (await import("../api/status/index.js")).default;
const lib = await import("../api/v1/_lib.js");
const loadMs = performance.now() - T0;

const IDX_MS = Number(process.env.BENCH_INDEXER_MS ?? 60);
const BLOB_MS = Number(process.env.BENCH_BLOB_MS ?? 40);
const ATTESTS = Number(process.env.BENCH_ATTESTS ?? 400);
const LOG_N = Number(process.env.BENCH_LOG ?? 2000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const counts = {};
const count = (k) => (counts[k] = (counts[k] ?? 0) + 1);

/** a store with Blob-like latency, counting operations */
function slowStore(inner, name) {
  const wrap = (op) => async (...a) => {
    count(`${name}.${op}`);
    await sleep(BLOB_MS);
    return inner[op](...a);
  };
  return { get: wrap("get"), create: wrap("create"), put: wrap("put"), del: wrap("del"), list: wrap("list") };
}

// ---- the Verifier's context, with fast fake Rings (the tree is built once) and slow upstreams ----
const ctx = makeCtx();
const rings = ctx.rings;
const realRootAndPath = rings.rootAndPath.bind(rings);
rings.rootAndPath = () => ({ root: new Uint8Array(32), path: [] }); // cheap while notes are made; rebuilt below
const SOL = 1_000_000_000n;
const packages = [];
const ringsMade = [];
for (let i = 0; i < ATTESTS; i++) {
  const r = ring();
  rings.register(r);
  ringsMade.push([r, rings.note(r, 150n * SOL)]);
}
rings.rootAndPath = realRootAndPath;
// cache paths: compute each note's path once (a real indexer serves them from storage)
const pathCache = new Map();
const hex = (b) => Buffer.from(b).toString("hex");
const fullRoot = realRootAndPath(0).root;
rings.history = [fullRoot];
const origPaths = rings.merklePaths.bind(rings);
rings.merklePaths = async (tree, leaves) => {
  const key = leaves.map(hex).join();
  if (!pathCache.has(key)) pathCache.set(key, await origPaths(tree, leaves));
  return pathCache.get(key);
};
for (const [r, n] of ringsMade) packages.push(pkg(ctx, r, [n], { tier: 3 }));
// warm the path cache so the benchmark measures the Verifier, not the fake indexer's tree rebuilds
const warmT = performance.now();
for (const [, n] of ringsMade) await rings.merklePaths("777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor", [n.commitment]);
const warmMs = performance.now() - warmT;
for (const m of ["slot", "treeHead", "merklePaths", "registryNullifierKey", "spent", "creation"]) {
  const f = rings[m].bind(rings);
  rings[m] = async (...a) => {
    count(`indexer.${m}`);
    await sleep(IDX_MS);
    return f(...a);
  };
}
ctx.store = slowStore(ctx.store, "blob");
// rebuild the parts that hold the store
ctx.log = new V.TransparencyLog(ctx.store, ctx.signer, ctx.programId);
ctx.keeper = new V.Keeper(ctx.store, ctx.sealKey, rings, ctx.chain);
ctx.locks = new V.NoteLocks(ctx.store, V.sha256(ctx.sealKey), 9000n, ctx.chain);
ctx.verifier = new V.Verifier({ programId: ctx.programId, minAgeSlots: 150n, validitySlots: 6_480_000n, subjectProofSlots: 1500n, maxRootAgeSlots: 150n, relayer: ctx.relayerSigner.address, mints: { 0: V.ASSETS[0].mint, 1: V.ASSETS[1].mint }, bundleHash: V.bundleHash() }, ctx.signer, rings, ctx.log, ctx.keeper, ctx.locks, ctx.escrow);
V.setContext(ctx);

// ---- a second, separate log for /v1/log: BENCH_LOG entries signed by the key the mock chain's Config names ----
const seed = Buffer.from(process.env.BENCH_SEED || "00".repeat(32), "hex");
const logSigner = V.signerFromSeed(new Uint8Array(seed));
const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "pof-bench-log-"));
const logStoreRaw = new V.FsStore(logDir);
const pid = sdk.decodeBase58(sdk.POF_PROGRAM_ID);
const fillLog = new V.TransparencyLog(logStoreRaw, logSigner, pid);
const fillT = performance.now();
for (let i = 0; i < LOG_N; i++) {
  const att = sdk.buildAttestation({
    programId: sdk.POF_PROGRAM_ID, subjectKind: 0, subjectHash: crypto.randomBytes(32).toString("hex"), asset: 0, tier: 1 + (i % 5), treeRoot: "bb".repeat(32),
    rootSlot: 100 + i, noteCount: 1, nullsetHash: crypto.randomBytes(32).toString("hex"), issuedSlot: 200 + i, expirySlot: 16_000_000,
    payer: logSigner.address, controller: logSigner.address, nonce: crypto.randomBytes(16).toString("hex"),
  });
  const slot = Buffer.alloc(8); slot.writeBigUInt64LE(BigInt(300 + i));
  await fillLog.append(new Uint8Array(Buffer.concat([Buffer.from([1]), att, Buffer.from(logSigner.sign(att)), Buffer.from(logSigner.publicKey), Buffer.alloc(32, 9), slot])));
}
const fillMs = performance.now() - fillT;
const benchLog = new V.TransparencyLog(slowStore(logStoreRaw, "logblob"), logSigner, pid);
const head = await benchLog.head();
await fetch(`${process.env.SOLANA_RPC.replace(/\/$/, "")}/__treasury`, { method: "POST", body: JSON.stringify({ size: head.treeSize, root: head.rootHash }) });
const logCtx = { ...ctx, log: benchLog, programId: pid, signer: logSigner };
const logRoute = V.node(async (req) => {
  V.setContext(logCtx);
  try {
    return await V.areas.log()(req);
  } finally {
    V.setContext(ctx);
  }
});
const attestRoute = V.node(V.areas.attest());

let next = 0;
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  try {
    if (u.pathname === "/__stats") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ counts, memo: lib.memoStats, mirror: lib.mirrorStats?.(), logReads: lib.logStats, packages: packages.length, nextPackage: next, loadMs, warmMs, fillMs, mem: process.memoryUsage() }));
    }
    if (u.pathname === "/__reset") {
      for (const k of Object.keys(counts)) delete counts[k];
      lib.memoStats.hits = lib.memoStats.misses = 0;
      if (u.searchParams.has("memo")) lib.clearMemo();
      process.env.POF_MEMO_OFF = u.searchParams.get("memoOff") === "1" ? "1" : "";
      res.writeHead(204);
      return res.end();
    }
    if (u.pathname === "/v1" || u.pathname.startsWith("/v1/")) {
      req.url = `/api/v1?path=${encodeURIComponent(u.pathname.replace(/^\/v1\/?/, ""))}&${u.searchParams}`;
      return await v1(req, res);
    }
    if (u.pathname === "/mcp") return await mcp(req, res);
    if (u.pathname === "/api/status") return await status(req, res);
    if (u.pathname === "/api/attest/log") return await logRoute(req, res);
    if (u.pathname === "/api/attest") {
      if (req.method === "POST" && u.searchParams.has("next")) {
        // the bench asks for the next unused package (each can be signed only once: note locks)
        const p = packages[next++ % packages.length];
        req.body = JSON.stringify(p);
      }
      return await attestRoute(req, res);
    }
    res.writeHead(404);
    res.end();
  } catch (e) {
    res.writeHead(500);
    res.end(String(e?.stack ?? e));
  }
});
server.listen(PORT, "127.0.0.1", () => process.stdout.write(`harness ready ${PORT} load=${loadMs.toFixed(0)}ms log=${LOG_N} attests=${ATTESTS}\n`));
