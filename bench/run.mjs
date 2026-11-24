// Run every scenario and write bench/results/<stamp>.{json,md}.
//   node bench/run.mjs [--quick] [--only name,name]
// Env: BENCH_RPC_MS (30), BENCH_INDEXER_MS (60), BENCH_BLOB_MS (40), BENCH_CERTS (5000), BENCH_LOG (2000), BENCH_ATTESTS (400)
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { load } from "./load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const quick = args.includes("--quick");
const only = (args[args.indexOf("--only") + 1] ?? "").split(",").filter((x) => args.includes("--only") && x);
const SECS = quick ? 4 : 10;
const RPC_PORT = 46990, H_PORT = 46991;
const seed = crypto.randomBytes(32).toString("hex");

// the Verifier key the mock chain lists = the key the bench log is signed with
const { V } = await import("../verifier/test/helpers.mjs");
const verifierKey = V.signerFromSeed(new Uint8Array(Buffer.from(seed, "hex"))).address;

function start(file, port, env) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(here, file), String(port)], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "inherit"] });
    p.stdout.on("data", (d) => {
      const s = String(d);
      if (s.includes("ready")) resolve({ p, line: s.trim() });
    });
    p.on("exit", (c) => reject(new Error(`${file} exited ${c}`)));
  });
}

const rpc = await start("rpc.mjs", RPC_PORT, { BENCH_VERIFIER: verifierKey });
const RPC = `http://127.0.0.1:${RPC_PORT}`;
const BASE = `http://127.0.0.1:${H_PORT}`;
const harness = await start("harness.mjs", H_PORT, {
  SOLANA_RPC: RPC, POF_LOG_URL: `${BASE}/api/attest/log`, POF_STATUS_ORIGIN: BASE, BENCH_SEED: seed, MCP_RATE_PER_MIN: "1000000", MCP_RATE_BURST: "1000000",
});
console.log(rpc.line, "|", harness.line);
const world = await (await fetch(`${RPC}/__stats`)).json();
const pick = (arr, i) => arr[(i * 7919) % arr.length];

const reset = async (memo = false, memoOff = false) => {
  await fetch(`${RPC}/__reset`);
  await fetch(`${BASE}/__reset?${memo ? "memo&" : ""}memoOff=${memoOff ? 1 : 0}`);
};
const upstream = async () => {
  const r = await (await fetch(`${RPC}/__stats`)).json();
  const h = await (await fetch(`${BASE}/__stats`)).json();
  return { rpc: r.counts, other: h.counts, memo: h.memo, cpuMs: (h.cpu.user + h.cpu.system) / 1000 };
};
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

const mcpCall = (name, args, id) => JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
const ip = (i) => ({ "x-real-ip": `198.51.${(i >> 8) & 255}.${i & 255}`, "content-type": "application/json" });
const scenarios = [
  { name: "v1 certificate by @handle", make: (i) => ({ path: `/v1/certificates/${encodeURIComponent(pick(world.subjects.filter((s) => s.startsWith("@")), i))}` }) },
  { name: "v1 certificate by bare key (wallet+badge)", make: (i) => ({ path: `/v1/certificates/${pick(world.subjects.filter((s) => !s.startsWith("@") && !s.startsWith("badge:")), i)}` }) },
  { name: "v1 certificate with gate check", make: (i) => ({ path: `/v1/certificates/${encodeURIComponent(pick(world.subjects, i))}?asset=SOL&minTier=3` }) },
  { name: "v1 list (memo on)", make: () => ({ path: `/v1/certificates?asset=SOL&status=live&limit=100` }) },
  { name: "v1 list (memo off)", memoOff: true, vus: 4, make: () => ({ path: `/v1/certificates?asset=SOL&status=live&limit=100` }) },
  { name: "v1 room with members (memo on)", make: (i) => ({ path: `/v1/rooms/${pick(world.rooms, i)}` }) },
  { name: "v1 room with members (memo off)", memoOff: true, make: (i) => ({ path: `/v1/rooms/${pick(world.rooms, i)}` }) },
  { name: "v1 stats (memo off)", memoOff: true, vus: 4, make: () => ({ path: `/v1/stats` }) },
  { name: "v1 stats", make: () => ({ path: `/v1/stats` }) },
  { name: "v1 log proof (verified)", make: (i) => ({ path: `/v1/log/proof/${(i * 7919) % 2000}` }) },
  { name: "v1 badge svg", make: (i) => ({ path: `/v1/badge/${encodeURIComponent(pick(world.subjects, i))}.svg` }) },
  { name: "mcp check_proof_of_funds", make: (i) => ({ path: "/mcp", method: "POST", headers: ip(i), body: mcpCall("check_proof_of_funds", { subject: pick(world.subjects, i), asset: "SOL", min_tier: 3 }, i) }) },
  { name: "mcp get_room", make: (i) => ({ path: "/mcp", method: "POST", headers: ip(i), body: mcpCall("get_room", { room: pick(world.rooms, i) }, i) }) },
  { name: "attest (Verifier, fake Rings)", vus: 8, total: 380, make: (i) => ({ path: "/api/attest?next", method: "POST", headers: ip(i), body: "{}" }) },
  { name: "status (cached)", make: () => ({ path: "/api/status" }) },
];

const results = [];
for (const s of scenarios) {
  if (only.length && !only.some((o) => s.name.includes(o))) continue;
  // warm one request (the first call fills per-instance caches), then measure
  await reset(true, !!s.memoOff);
  const warm = s.make(0, 0);
  if (!s.name.startsWith("attest")) {
    // warm until the endpoint answers 200 (the log mirror pages the whole log in on first use)
    for (let t = 0; t < 120; t++) {
      const r = await fetch(BASE + warm.path, { method: warm.method ?? "GET", headers: warm.headers, body: warm.body });
      await r.arrayBuffer();
      if (r.status === 200) break;
      await new Promise((ok) => setTimeout(ok, 1000));
    }
  }
  await reset(false, !!s.memoOff);
  const r = await load({ base: BASE, vus: s.vus ?? 20, seconds: SECS, total: s.total ?? Infinity, make: s.make });
  const u = await upstream();
  results.push({ name: s.name, ...r, cpuMsPerReq: u.cpuMs / r.requests, rpcPerReq: sum(u.rpc) / r.requests, rpcByMethod: u.rpc, otherPerReq: sum(u.other) / r.requests, other: u.other, memo: u.memo });
  console.log(`${s.name.padEnd(44)} ${r.requests.toString().padStart(6)} req ${r.rps.toFixed(0).padStart(5)}/s  p50 ${r.p50.toFixed(1)} p95 ${r.p95.toFixed(1)} p99 ${r.p99.toFixed(1)} ms  cpu/req ${(u.cpuMs / r.requests).toFixed(2)} ms  rpc/req ${(sum(u.rpc) / r.requests).toFixed(2)}  other/req ${(sum(u.other) / r.requests).toFixed(2)}  ${JSON.stringify(r.statuses)}`);
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const meta = {
  at: new Date().toISOString(), node: process.version, cpu: os.cpus()[0].model, cores: os.cpus().length, memGB: os.totalmem() / 2 ** 30,
  loadavg: os.loadavg(), rpcMs: Number(process.env.BENCH_RPC_MS ?? 30), indexerMs: Number(process.env.BENCH_INDEXER_MS ?? 60), blobMs: Number(process.env.BENCH_BLOB_MS ?? 40),
  certs: Number(process.env.BENCH_CERTS ?? 5000), seconds: SECS,
};
fs.mkdirSync(path.join(here, "results"), { recursive: true });
fs.writeFileSync(path.join(here, "results", `${stamp}.json`), JSON.stringify({ meta, results }, null, 2));
console.log(`results/${stamp}.json  loadavg ${meta.loadavg.map((x) => x.toFixed(1)).join(" ")}`);
rpc.p.kill();
harness.p.kill();
process.exit(0);
