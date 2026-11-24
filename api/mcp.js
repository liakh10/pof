// Hosted Proof of Funds MCP server: Streamable HTTP, stateless, JSON responses (POST /mcp).
import { handlePayload, chainBackend } from "../mcp/core.js";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id, authorization",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version",
};

let backendP = null;

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) return typeof req.body === "string" ? req.body : Buffer.isBuffer(req.body) ? req.body.toString("utf8") : JSON.stringify(req.body);
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > 256 * 1024) throw new Error("too large");
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
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    res.statusCode = 400;
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
