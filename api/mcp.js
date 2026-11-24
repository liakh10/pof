// Hosted Proof of Funds MCP server: Streamable HTTP, stateless, JSON responses (POST /mcp).
import { handlePayload, chainBackend } from "../mcp/core.js";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id, authorization",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
};

let backendP = null;

// POF-14: bound what one caller can make this endpoint spend. Per instance; the Vercel Firewall rate rule on /mcp
// (OWNER-STEPS) bounds the fleet.
const MAX_BODY = 64 * 1024;
const buckets = new Map();
const RATE = { perMinute: Number(process.env.MCP_RATE_PER_MIN || 120), burst: Number(process.env.MCP_RATE_BURST || 40) };
export function setRate(r) {
  Object.assign(RATE, r);
  buckets.clear();
}
function allow(ip, now = Date.now()) {
  const b = buckets.get(ip) ?? { tokens: RATE.burst, at: now };
  b.tokens = Math.min(RATE.burst, b.tokens + ((now - b.at) / 60_000) * RATE.perMinute);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(ip, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(ip, b);
  if (buckets.size > 5000) buckets.delete(buckets.keys().next().value);
  return true;
}
export function resetRate() {
  buckets.clear();
}
const clientIp = (req) => String(req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "?").split(",")[0].trim();

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) return typeof req.body === "string" ? req.body : Buffer.isBuffer(req.body) ? req.body.toString("utf8") : JSON.stringify(req.body);
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > MAX_BODY) throw Object.assign(new Error("too large"), { tooLarge: true });
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function mcpHttp(req, res, backendOverride) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== "POST") {
    // stateless server: no server-initiated SSE stream and no sessions to delete
    res.statusCode = 405;
    res.setHeader("allow", "POST, OPTIONS");
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "use POST (Streamable HTTP, stateless)" } }));
  }
  if (!allow(clientIp(req))) {
    res.statusCode = 429;
    res.setHeader("retry-after", "5");
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "rate limited: slow down" } }));
  }
  if (Number(req.headers["content-length"] || 0) > MAX_BODY) {
    res.statusCode = 413;
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "request too large" } }));
  }
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (e) {
    res.statusCode = e?.tooLarge ? 413 : 400;
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }));
  }
  const backend = backendOverride ?? (await (backendP ??= chainBackend(process.env)));
  const out = await handlePayload(payload, backend);
  if (!out) {
    res.statusCode = 202;
    return res.end();
  }
  res.statusCode = 200;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(out));
}

export default function handler(req, res) {
  return mcpHttp(req, res);
}
