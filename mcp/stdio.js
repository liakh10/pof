#!/usr/bin/env node
// Proof of Funds MCP server over stdio (newline-delimited JSON-RPC).
//   SOLANA_RPC=<your RPC url> node mcp/stdio.js         reads straight from chain
//   POF_API=https://<site>/v1 node mcp/stdio.js         reads a deployed /v1 instead (no RPC key needed)
import readline from "node:readline";
import { handlePayload, chainBackend, httpBackend } from "./core.js";

const backend = process.env.SOLANA_RPC || process.env.RPC_URL
  ? await chainBackend(process.env)
  : process.env.POF_API
    ? httpBackend(process.env.POF_API)
    : null;

if (!backend) {
  process.stderr.write("pof-mcp: set SOLANA_RPC (read from chain) or POF_API (a deployed /v1 base URL)\n");
  process.exit(1);
}

const write = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let pending = 0;
let closing = false;
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
    return;
  }
  pending++;
  try {
    const out = await handlePayload(msg, backend);
    if (out) write(out);
  } finally {
    pending--;
    if (closing && pending === 0) process.exit(0);
  }
});
rl.on("close", () => {
  closing = true;
  if (pending === 0) process.exit(0);
});
