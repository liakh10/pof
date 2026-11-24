// POST /api/rpc[?net=devnet]: the site's Solana JSON-RPC proxy. The pages (the wall, /c, /get through pof/client) read the
// chain through it so the RPC key stays on the server. It passes only the methods the site uses; getProgramAccounts only
// for the pof and pof_gate programs; signed transactions from a visitor's own wallet are relayed as they are (the proxy
// cannot sign anything). Limits per caller address and warm instance. The upstream URL (with its key) is never echoed.
//   upstream: SOLANA_RPC (mainnet) / SOLANA_RPC_DEVNET, else HELIUS_KEYS / HELIUS_API_KEY, else the public endpoint.

const POF = process.env.POF_PROGRAM_ID || "pofP4QRRDXnmDN9CNYiAGHfwMEgM7sLWhVcUMpsbynT";
const GATE = process.env.POF_GATE_PROGRAM_ID || "gatSToJMD8ZPLa85fKj6seYHUtYx4ah3ptZvLkisLPU";

export const READ = new Set([
  "getSlot", "getBlockHeight", "getLatestBlockhash", "getAccountInfo", "getMultipleAccounts", "getBalance", "getSignatureStatuses",
  "getSignaturesForAddress", "getTransaction", "getMinimumBalanceForRentExemption", "getEpochInfo", "getVersion", "getHealth",
  "getFeeForMessage", "getRecentPrioritizationFees", "getTokenAccountBalance", "getTokenAccountsByOwner", "isBlockhashValid",
]);
export const WRITE = new Set(["simulateTransaction", "sendTransaction"]);
const GPA = "getProgramAccounts";
const PER_MIN = { read: 240, write: 20, gpa: 12 };
const MAX_BODY = 64 * 1024;
const MAX_BATCH = 8;

function keys(env) {
  return String(env.HELIUS_KEYS || env.HELIUS_API_KEY || "").split(",").map(s => s.trim()).filter(Boolean);
}
export function upstreams(env, net) {
  if (net === "devnet") {
    if (env.SOLANA_RPC_DEVNET) return [env.SOLANA_RPC_DEVNET];
    const k = keys(env);
    return k.length ? k.map(x => `https://devnet.helius-rpc.com/?api-key=${x}`) : ["https://api.devnet.solana.com"];
  }
  const list = [];
  if (env.SOLANA_RPC) list.push(...String(env.SOLANA_RPC).split(",").map(s => s.trim()).filter(Boolean));
  list.push(...keys(env).map(x => `https://mainnet.helius-rpc.com/?api-key=${x}`));
  if (!list.length) list.push("https://api.mainnet-beta.solana.com");
  return list;
}
export const scrub = s => String(s).replace(/api-key=[^&\s"']+/gi, "api-key=…").replace(/https?:\/\/[^\s"']*helius[^\s"']*/gi, "the RPC");

/** checks one call; returns an error string or null */
export function refuse(call) {
  if (!call || call.jsonrpc !== "2.0" || typeof call.method !== "string") return "not a JSON-RPC 2.0 call";
  if (READ.has(call.method) || WRITE.has(call.method)) return null;
  if (call.method === GPA) {
    const p = Array.isArray(call.params) ? call.params : [];
    if (p[0] !== POF && p[0] !== GATE) return "getProgramAccounts is open only for the pof and pof_gate programs";
    const cfg = p[1] || {};
    if (!Array.isArray(cfg.filters) || !cfg.filters.length) return "getProgramAccounts needs filters";
    return null;
  }
  return `method ${call.method} is not served here`;
}

const windows = new Map();
function allow(who, kind) {
  const k = `${who}:${kind}`, now = Date.now();
  let w = windows.get(k);
  if (!w || now - w.t > 60_000) { w = { t: now, n: 0 }; windows.set(k, w); }
  if (windows.size > 5000) windows.clear();
  return ++w.n <= PER_MIN[kind];
}
const kindOf = m => (WRITE.has(m) ? "write" : m === GPA ? "gpa" : "read");

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) return typeof req.body === "string" ? req.body : Buffer.isBuffer(req.body) ? req.body.toString("utf8") : JSON.stringify(req.body);
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > MAX_BODY) throw Object.assign(Error("body too large"), { status: 413 }); chunks.push(c); }
  return Buffer.concat(chunks).toString("utf8");
}

function out(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

export async function forward(text, env, net, fetchImpl = fetch) {
  const ups = upstreams(env, net);
  let last = null;
  for (let i = 0; i < ups.length; i++) {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20_000);
      const r = await fetchImpl(ups[i], { method: "POST", headers: { "content-type": "application/json" }, body: text, signal: ctl.signal });
      clearTimeout(t);
      if (r.status === 429 || r.status >= 500) { last = `upstream ${r.status}`; continue; }
      return { status: r.status, text: scrub(await r.text()) };
    } catch (e) { last = scrub(e.message || e); }
  }
  return { status: 502, text: JSON.stringify(rpcError(null, -32000, `the Solana RPC did not answer (${last})`)) };
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") return out(res, 405, rpcError(null, -32600, "POST a JSON-RPC call"));
  const url = new URL(req.url, "http://x");
  const net = url.searchParams.get("net") === "devnet" ? "devnet" : "mainnet";
  const who = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "?").split(",")[0].trim();
  let text, calls;
  try { text = await readBody(req); calls = JSON.parse(text); }
  catch (e) { return out(res, e.status || 400, rpcError(null, -32700, e.status ? "body too large" : "not JSON")); }
  const batch = Array.isArray(calls);
  const list = batch ? calls : [calls];
  if (!list.length || list.length > MAX_BATCH) return out(res, 400, rpcError(null, -32600, `send 1 to ${MAX_BATCH} calls`));
  for (const c of list) {
    const why = refuse(c);
    if (why) return out(res, 403, rpcError(c?.id, -32601, why));
    if (!allow(who, kindOf(c.method))) return out(res, 429, rpcError(c.id, -32005, "too many requests from this address; wait a little"));
  }
  const r = await forward(JSON.stringify(calls), process.env, net);
  return out(res, r.status, r.text);
}
