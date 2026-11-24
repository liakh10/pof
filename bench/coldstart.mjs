// Cold start: a fresh Node process per run; time to import each function module, and to answer its first request.
//   node bench/coldstart.mjs [runs]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { start } from "./procs.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const RUNS = Number(process.argv[2] || 5);
const rpc = await start("rpc.mjs", 46994, { BENCH_CERTS: "200", BENCH_ROOMS: "2", BENCH_MEMBERS: "2", BENCH_RPC_MS: "0" });
const RPC = "http://127.0.0.1:46994";

const cases = [
  { name: "@pof/sdk (import only)", mod: "sdk/dist/index.js" },
  { name: "/v1 (api/v1/index.js)", mod: "api/v1/index.js", url: "/api/v1?path=certificates/%40user1" },
  { name: "/mcp (api/mcp.js)", mod: "api/mcp.js", method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "c", version: "1" } } }) },
  { name: "/api/bots (link page)", mod: "api/bots.js", url: "/api/bots?fn=link" },
  { name: "/api/status", mod: "api/status/index.js", url: "/api/status" },
  { name: "/api/witness (import only)", mod: "api/witness.js" },
  { name: "Verifier bundle (import only)", mod: "verifier/dist/pof-verifier.mjs" },
  { name: "Helius SDK + Poseidon WASM init", script: `const t0=performance.now(); const spr = await import(${JSON.stringify(path.join(root, "verifier/node_modules/@heliuslabs/spr/dist/index.js"))}).catch(()=>import("@heliuslabs/spr")); const t1=performance.now(); await spr.initializePoseidon(); const t2=performance.now(); console.log(JSON.stringify({importMs:t1-t0, firstMs:t2-t1}));` },
];

function child(c) {
  const script = c.script ?? `
    import http from "node:http";
    const t0 = performance.now();
    const m = await import(${JSON.stringify(path.join(root, c.mod))});
    const t1 = performance.now();
    let firstMs = null;
    if (${JSON.stringify(!!(c.url || c.method))}) {
      const s = http.createServer((req, res) => m.default(req, res));
      await new Promise((r) => s.listen(0, "127.0.0.1", r));
      const a = performance.now();
      const r = await fetch("http://127.0.0.1:" + s.address().port + ${JSON.stringify(c.url ?? "/")}, { method: ${JSON.stringify(c.method ?? "GET")}, headers: { "content-type": "application/json" }, body: ${c.body ? JSON.stringify(c.body) : "undefined"} });
      await r.text();
      firstMs = performance.now() - a;
      s.close();
    }
    console.log(JSON.stringify({ importMs: t1 - t0, firstMs, rss: process.memoryUsage().rss }));
    process.exit(0);`;
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ["--input-type=module", "-e", script], { cwd: path.join(root, "verifier"), env: { ...process.env, SOLANA_RPC: RPC, POF_LOG_URL: "http://127.0.0.1:9/none", BOT_LINK_SECRET: "x".repeat(40), POF_STATUS_ORIGIN: "http://127.0.0.1:9" }, stdio: ["ignore", "pipe", "pipe"] });
    let o = "";
    p.stdout.on("data", (d) => (o += d));
    p.on("exit", () => {
      try {
        resolve(JSON.parse(o.trim().split("\n").pop()));
      } catch {
        resolve({ error: o.slice(0, 200) });
      }
    });
  });
}
const med = (a) => {
  const s = a.filter((x) => typeof x === "number").sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const rows = [];
for (const c of cases) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await child(c));
  const row = { name: c.name, importMs: med(runs.map((r) => r.importMs)), firstMs: med(runs.map((r) => r.firstMs)), rssMB: med(runs.map((r) => r.rss)) / 2 ** 20 || null, errors: runs.filter((r) => r.error).map((r) => r.error) };
  rows.push(row);
  console.log(`${c.name.padEnd(36)} import ${row.importMs?.toFixed(0)} ms  first request ${row.firstMs === null ? "-" : row.firstMs.toFixed(0) + " ms"}  rss ${row.rssMB ? row.rssMB.toFixed(0) + " MB" : "-"} ${row.errors.length ? "ERR " + row.errors[0] : ""}`);
}
fs.writeFileSync(path.join(here, "results", `coldstart-${new Date().toISOString().replace(/[:.]/g, "-")}.json`), JSON.stringify(rows, null, 2));
rpc.p.kill();
process.exit(0);
