// Bursts: what the rate limits and the caches do when many requests arrive at once.
//   node bench/burst.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { world } from "./procs.mjs";
import { load } from "./load.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
// production MCP limits (no MCP_RATE_* override), a smaller chain for a quick start
const W = await world({ rpcPort: 46992, harnessPort: 46993, env: { BENCH_CERTS: "3000", BENCH_ATTESTS: "120", BENCH_LOG: "1000" } });
const out = [];
const sum = (o) => Object.values(o ?? {}).reduce((a, b) => a + b, 0);
const mcp = (i) => JSON.stringify({ jsonrpc: "2.0", id: i, method: "tools/call", params: { name: "check_proof_of_funds", arguments: { subject: "@user1", asset: "SOL", min_tier: 1 } } });

async function burst(name, opts, { cold = true } = {}) {
  await W.reset(cold);
  const r = await load({ base: W.BASE, seconds: 60, ...opts });
  const u = await W.upstream();
  const row = { name, requests: r.requests, statuses: r.statuses, p50: r.p50, p99: r.p99, rpcCalls: u.rpc, rpcTotal: sum(u.rpc), other: u.harness.counts, memo: u.harness.memo };
  out.push(row);
  console.log(`${name.padEnd(60)} ${JSON.stringify(r.statuses)}  rpc ${sum(u.rpc)} ${JSON.stringify(u.rpc)}  other ${JSON.stringify(u.harness.counts)}`);
}

await burst("mcp: 300 calls from ONE ip, 50 at once", { vus: 50, total: 300, make: (i) => ({ path: "/mcp", method: "POST", headers: { "x-real-ip": "203.0.113.9", "content-type": "application/json" }, body: mcp(i) }) });
await burst("mcp: 300 calls from 300 ips, 50 at once", { vus: 50, total: 300, make: (i) => ({ path: "/mcp", method: "POST", headers: { "x-real-ip": `198.51.100.${i % 250}`, "x-forwarded-for": `10.${i}.0.1`, "content-type": "application/json" }, body: mcp(i) }) });
await burst("attest: 30 from ONE ip, 10 at once", { vus: 10, total: 30, make: () => ({ path: "/api/attest?next", method: "POST", headers: { "x-real-ip": "203.0.113.10", "content-type": "application/json" }, body: "{}" }) });
await burst("v1 list: 200 at once on a cold cache (single-flight)", { vus: 200, total: 200, make: () => ({ path: "/v1/certificates?asset=SOL&limit=50" }) });
await burst("v1 stats: 200 at once on a cold cache", { vus: 200, total: 200, make: () => ({ path: "/v1/stats" }) });
await burst("v1 log proof: 500 random entries, 50 at once", { vus: 50, total: 500, make: (i) => ({ path: `/v1/log/proof/${(i * 7919) % 1000}` }) });
// let the mirror finish paging, then the same burst on a warm instance
for (let t = 0; t < 120; t++) {
  const r = await fetch(`${W.BASE}/v1/log/proof/0`);
  await r.arrayBuffer();
  if (r.status === 200) break;
  await new Promise((ok) => setTimeout(ok, 1000));
}
await burst("v1 log proof: 500 random entries again, warm mirror", { vus: 50, total: 500, make: (i) => ({ path: `/v1/log/proof/${(i * 7919) % 1000}` }) }, { cold: false });
await burst("status: 200 at once on a cold cache", { vus: 200, total: 200, make: () => ({ path: "/api/status" }) });

fs.writeFileSync(path.join(here, "results", `burst-${new Date().toISOString().replace(/[:.]/g, "-")}.json`), JSON.stringify(out, null, 2));
W.stop();
process.exit(0);
