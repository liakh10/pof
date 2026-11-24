// A small, dependency-free MCP server core (JSON-RPC 2.0). Transports call handleMessage() and write what it returns.
import { TOOLS, callTool, ToolError } from "./tools.js";

export const SERVER_INFO = { name: "proof-of-funds", title: "Proof of Funds", version: "0.1.0" };
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS =
  "Proof of Funds certificates prove that a Solana wallet, an X handle or a badge holds at least a tier of SOL or USDC, " +
  "without the amount, and they revoke themselves when the funds move. Use check_proof_of_funds for yes/no questions " +
  "(\"does @anon hold 1,000 SOL?\"). A certificate proves a minimum, never an exact balance. Every answer is read from chain as of a slot.";

const err = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
const ok = (id, result) => ({ jsonrpc: "2.0", id, result });

/**
 * @param {object} msg one JSON-RPC message
 * @param {(path: string, query: object) => Promise<object>} backend
 * @returns {Promise<object|null>} the response, or null for notifications and responses
 */
export async function handleMessage(msg, backend) {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") return err(null, -32600, "invalid request");
  const isRequest = typeof msg.method === "string" && msg.id !== undefined && msg.id !== null;
  if (!isRequest) return null; // notifications (initialized, cancelled) and client responses need no answer
  const { id, method, params = {} } = msg;
  try {
    switch (method) {
      case "initialize": {
        const asked = params.protocolVersion;
        const protocolVersion = PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0];
        return ok(id, { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
      }
      case "ping":
        return ok(id, {});
      case "tools/list":
        return ok(id, { tools: TOOLS });
      case "tools/call": {
        const tool = TOOLS.find((t) => t.name === params.name);
        if (!tool) return err(id, -32602, `unknown tool: ${params.name}`);
        try {
          const r = await callTool(params.name, params.arguments, backend);
          return ok(id, { content: [{ type: "text", text: r.text }], structuredContent: r.data, isError: false });
        } catch (e) {
          const message = e instanceof ToolError || e instanceof Error ? e.message : String(e);
          return ok(id, { content: [{ type: "text", text: `Error: ${message}` }], isError: true });
        }
      }
      case "resources/list":
        return ok(id, { resources: [] });
      case "prompts/list":
        return ok(id, { prompts: [] });
      default:
        return err(id, -32601, `method not found: ${method}`);
    }
  } catch (e) {
    return err(id, -32603, e instanceof Error ? e.message : "internal error");
  }
}

export const MAX_BATCH = 10;

/** Handle a single message or a batch (2025-03-26 and older allow batches; POF-14: at most MAX_BATCH). */
export async function handlePayload(payload, backend) {
  if (Array.isArray(payload)) {
    if (payload.length === 0) return err(null, -32600, "empty batch");
    if (payload.length > MAX_BATCH) return err(null, -32600, `a batch holds at most ${MAX_BATCH} messages`);
    const out = (await Promise.all(payload.map((m) => handleMessage(m, backend)))).filter(Boolean);
    return out.length ? out : null;
  }
  return handleMessage(payload, backend);
}

/** Backends: straight from chain (through the /v1 router in-process) or a deployed /v1 over HTTP. */
export async function chainBackend(env = process.env) {
  const { handleV1 } = await import("../api/v1/_core.js");
  return async (path, query) => JSON.parse((await handleV1({ method: "GET", path, query, env })).body);
}

export function httpBackend(apiBase, f = fetch) {
  const base = apiBase.replace(/\/$/, "");
  return async (path, query) => {
    const qs = new URLSearchParams(query).toString();
    const res = await f(`${base}/${path}${qs ? `?${qs}` : ""}`, { headers: { accept: "application/json" } });
    return res.json();
  };
}
