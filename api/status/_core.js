// The POF status checks (docs-src/status.md describes each one). Every check reads public state only: the Solana RPC, the
// Rings tree account, the Helius Rings indexer (the same calls the Verifier makes), the Verifier's own public endpoints, and
// the pof program's Config and Treasury through @pof/sdk. Nothing here signs, and nothing secret is returned: RPC and indexer
// URLs (which carry the Helius key) are never echoed, and the relayer shows as a balance band, never a number or an address.
//
// GET /api/status          the checks, run now (CDN-cached for a few seconds), plus the stored uptime history
// GET /api/status/history  the stored history alone
// GET /api/status/sample   cron only (Bearer CRON_SECRET): run the checks and store one sample in Vercel Blob
import { createRequire } from "node:module";
import * as sdk from "../../sdk/dist/index.js";

const require = createRequire(import.meta.url);
/** The published Verifier build (its sha256 is the bundle hash every attestation and log entry carries). */
export const PUBLISHED = (() => {
  try {
    return require("../../verifier/dist/BUILD.json");
  } catch {
    return null;
  }
})();

export const RINGS_PROGRAM = "ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW";
export const RINGS_TREE = "777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor";
const TREE_SIZE = 40_080;
const T = { nullQueue: 40, nextLeaf: 72, root: 80, cursor: 112, len: 114, cap: 116, rootSlot: 120, history: 1_152, nfCursor: 17_224, nfHistory: 17_232 };

/** Defaults; each is documented in docs-src/status.md. */
export const LIMITS = {
  rpcSlowMs: 1_500,
  nodeSpreadSlots: 150,
  maxRootLag: 9_000, // the program's max_root_lag when Config cannot be read
  indexerLagOk: 150,
  indexerLagDegraded: 1_500,
  keeperEverySlots: 1_500, // the keeper cron interval in slots (about every ten minutes)
  anchorStaleSlots: 9_000,
  relayFloorLamports: 50_000_000,
  bands: [
    { band: "empty", below: 50_000_000, range: "below 0.05 SOL" },
    { band: "low", below: 500_000_000, range: "0.05 to 0.5 SOL" },
    { band: "ok", below: 2_000_000_000, range: "0.5 to 2 SOL" },
    { band: "ample", below: Infinity, range: "2 SOL or more" },
  ],
  checkTimeoutMs: 9_000,
  historyDays: 90,
};

export const STATES = ["ok", "degraded", "down", "off", "unknown"];
const RANK = { ok: 0, off: 0, unknown: 0, degraded: 1, down: 2 };

/** Removes anything that could carry a key: URLs, api-key parameters, long base58 or hex runs are left (they are public). */
export function scrub(s) {
  return String(s ?? "")
    .replace(/https?:\/\/[^\s"'|)]+/g, "<url>")
    .replace(/api-key=[^&\s"']+/gi, "api-key=***")
    .slice(0, 180);
}

function withTimeout(p, ms, what) {
  let t;
  return Promise.race([p, new Promise((_, rej) => (t = setTimeout(() => rej(new Error(`${what} did not answer within ${ms} ms`)), ms)))]).finally(() => clearTimeout(t));
}

async function rpcCall(f, url, method, params, timeoutMs = 8_000) {
  const t0 = Date.now();
  const res = await withTimeout(
    f(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }),
    timeoutMs,
    method,
  );
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return { result: j.result, ms: Date.now() - t0 };
}

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u64 = (b, o) => Number(new DataView(b.buffer, b.byteOffset + o, 8).getBigUint64(0, true));
const hex = (b) => Buffer.from(b).toString("hex");

/** The Rings tree account: head root, its slot, the state-root history and the nullifier-root history (RINGS.md §1). */
export function decodeTree(b) {
  if (b.length !== TREE_SIZE || b[0] !== 1) throw new Error("the account is not a Rings tree");
  const cursor = u16(b, T.cursor), len = u16(b, T.len), cap = u16(b, T.cap);
  if (!len || len > cap || cursor >= cap) throw new Error("the tree has no root history");
  const history = [];
  for (let i = 0; i < len; i++) history.push(hex(b.subarray(T.history + i * 32, T.history + i * 32 + 32)));
  const nullifierRoots = [];
  for (let i = 0; i < 100; i++) {
    const r = b.subarray(T.nfHistory + i * 32, T.nfHistory + i * 32 + 32);
    if (r.some((x) => x)) nullifierRoots.push(hex(r));
  }
  const head = hex(b.subarray(T.root, T.root + 32));
  if (head !== history[cursor]) throw new Error("the tree head and its history disagree");
  return { head, headSlot: u64(b, T.rootSlot), nextLeaf: u64(b, T.nextLeaf), nullifierQueue: u64(b, T.nullQueue), history, nullifierRoots };
}

/** The relayer balance as a band (never the number). */
export function band(lamports, limits = LIMITS) {
  const b = limits.bands.find((x) => lamports < x.below) || limits.bands[limits.bands.length - 1];
  return { band: b.band, range: b.range };
}

export function worst(states) {
  return states.reduce((w, s) => ((RANK[s] ?? 0) > (RANK[w] ?? 0) ? s : w), "ok");
}

/** Where the Verifier is reached from. Never the request's Host header on Vercel (audit POF-20): an explicit
 *  POF_STATUS_ORIGIN, else the production domain Vercel sets, else this deployment's own URL. The Host header is used only
 *  off Vercel (a local run). */
export function selfOrigin(env = process.env, requestOrigin = "") {
  const o = env.POF_STATUS_ORIGIN
    || (env.VERCEL_ENV === "production" && env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : "")
    || (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : "")
    || (env.VERCEL ? "" : requestOrigin);
  return String(o || "").replace(/\/+$/, "");
}

/** Env → the dependencies of one run. Tests build their own. */
export function depsFromEnv(env = process.env, origin = "") {
  const rpcUrls = [...new Set(String(env.SOLANA_RPC || env.RPC_URL || "").split(",").map((s) => s.trim()).filter(Boolean))];
  const programId = env.POF_PROGRAM || env.POF_PROGRAM_ID || sdk.POF_PROGRAM_ID;
  const f = globalThis.fetch;
  return {
    fetch: f,
    rpcUrls,
    programId,
    indexer: env.HELIUS_API_KEY ? { url: (env.HELIUS_SPR_URL || "https://mainnet.helius-rpc.com/v1/spr").replace(/\/+$/, ""), apiKey: env.HELIUS_API_KEY } : null,
    origin: selfOrigin(env, origin),
    keeperLive: env.POF_KEEPER_LIVE === "1",
    internalSecret: env.POF_INTERNAL_SECRET || null,
    network: env.POF_NETWORK || "mainnet",
    limits: { ...LIMITS, relayFloorLamports: Number(env.POF_RELAY_FLOOR_LAMPORTS || LIMITS.relayFloorLamports) },
    store: null,
    now: () => Date.now(),
  };
}

function client(d) {
  if (!d.rpcUrls.length) return null;
  return new sdk.PofClient({ rpc: new sdk.Rpc(d.rpcUrls[0], { commitment: "confirmed", timeoutMs: 8_000, fetch: d.fetch }), programId: d.programId });
}

async function getJson(d, path) {
  const t0 = Date.now();
  const headers = { accept: "application/json" };
  // the log's rate limit lets this deployment's own readers through; the secret goes only to our own origin (selfOrigin)
  if (d.internalSecret && path.startsWith("/api/attest/log")) headers["x-pof-internal"] = d.internalSecret;
  const r = await withTimeout(d.fetch(d.origin + path, { headers }), 8_000, path);
  const body = await r.json().catch(() => null);
  return { status: r.status, body, ms: Date.now() - t0 };
}

const check = (id, name, state, summary, metrics = {}, extra = {}) => ({ id, name, state, summary, metrics, ...extra });

/* ------------------------------------------------------------------------------------------------ the checks */

async function checkRpc(d, ctx) {
  if (!d.rpcUrls.length) return check("rpc", "Solana RPC", "unknown", "no RPC configured on this deployment");
  const nodes = await Promise.all(
    d.rpcUrls.map(async (url, i) => {
      try {
        const { result, ms } = await rpcCall(d.fetch, url, "getSlot", [{ commitment: "confirmed" }]);
        return { node: i + 1, ok: true, ms, slot: Number(result) };
      } catch (e) {
        return { node: i + 1, ok: false, error: scrub(e.message) };
      }
    }),
  );
  const up = nodes.filter((n) => n.ok);
  if (!up.length) return check("rpc", "Solana RPC", "down", "no configured RPC node answered", { nodes: nodes.length, answered: 0 }, { nodes });
  ctx.slot = Math.max(...up.map((n) => n.slot));
  const best = Math.min(...up.map((n) => n.ms));
  const spread = ctx.slot - Math.min(...up.map((n) => n.slot));
  const state = up.length < nodes.length || best > d.limits.rpcSlowMs || spread > d.limits.nodeSpreadSlots ? "degraded" : "ok";
  const why = up.length < nodes.length ? `${nodes.length - up.length} of ${nodes.length} nodes did not answer` : best > d.limits.rpcSlowMs ? `slow: ${best} ms` : spread > d.limits.nodeSpreadSlots ? `a node is ${spread} slots behind` : `${up.length} node(s) answered`;
  return check("rpc", "Solana RPC", state, why, { nodes: nodes.length, answered: up.length, bestMs: best, slot: ctx.slot, spreadSlots: spread }, { nodes });
}

async function checkProgram(d, ctx) {
  const c = client(d);
  if (!c) return check("program", "pof program", "unknown", "no RPC configured");
  const cfg = await c.getConfig();
  ctx.config = cfg;
  if (!cfg) return check("program", "pof program", "unknown", `no Config account for ${d.programId} on this network (not deployed yet)`, { programId: d.programId });
  ctx.slot = Math.max(ctx.slot || 0, cfg.slot);
  const rotation = cfg.nextVerifier && cfg.slot < cfg.nextVerifierSlot ? { nextVerifier: cfg.nextVerifier, inSlots: cfg.nextVerifierSlot - cfg.slot } : null;
  const m = { programId: d.programId, paused: cfg.paused, closing: cfg.closing, activeVerifier: cfg.activeVerifier, feeLamports: cfg.feeLamports, maxRootLag: cfg.maxRootLag, maxAttestAge: cfg.maxAttestAge, validitySlots: cfg.validitySlots, rotation };
  if (cfg.closing) return check("program", "pof program", "down", "the program is winding down: no certify or renew; anyone may expire certificates", m);
  if (cfg.paused) return check("program", "pof program", "down", "certify and renew are paused; revocation and expiry still work", m);
  return check("program", "pof program", "ok", rotation ? `live; a Verifier key rotation takes over in ${rotation.inSlots} slots` : "live", m);
}

async function readTree(d, ctx) {
  if (ctx.tree) return ctx.tree;
  const { result } = await rpcCall(d.fetch, d.rpcUrls[0], "getAccountInfo", [RINGS_TREE, { encoding: "base64", commitment: "confirmed" }]);
  if (!result?.value) throw new Error("the Rings tree account was not found on this network");
  if (result.value.owner !== RINGS_PROGRAM) throw new Error("the Rings tree account is not owned by the Rings program");
  ctx.tree = { ...decodeTree(new Uint8Array(Buffer.from(result.value.data[0], "base64"))), readSlot: Number(result.context.slot) };
  ctx.slot = Math.max(ctx.slot || 0, ctx.tree.readSlot);
  return ctx.tree;
}

async function checkRingsTree(d, ctx) {
  if (!d.rpcUrls.length) return check("rings_tree", "Rings tree root", "unknown", "no RPC configured");
  const t = await readTree(d, ctx);
  const maxLag = ctx.config?.maxRootLag || d.limits.maxRootLag;
  const age = Math.max(0, t.readSlot - t.headSlot);
  const m = { tree: RINGS_TREE, headSlot: t.headSlot, readSlot: t.readSlot, rootAgeSlots: age, maxRootLag: maxLag, leaves: t.nextLeaf, rootHistory: t.history.length };
  if (age >= maxLag) return check("rings_tree", "Rings tree root", "down", `the Rings tree has not changed for ${age} slots; the program refuses a root older than ${maxLag}, so certify waits for the next Rings transaction`, m);
  if (age >= maxLag / 2) return check("rings_tree", "Rings tree root", "degraded", `the tree root is ${age} slots old (the program accepts up to ${maxLag})`, m);
  return check("rings_tree", "Rings tree root", "ok", `root updated ${age} slots ago`, m);
}

/** The Verifier's view of Rings: it accepts an "unspent" answer from the indexer only when the indexer's non-inclusion path
 *  reaches a nullifier root the tree account holds. Here the same call is made for a fixed probe value. */
async function checkIndexer(d, ctx) {
  if (!d.indexer) return check("rings_indexer", "Rings indexer (Verifier's view)", "unknown", "no Helius key configured on this deployment");
  const probe = new Uint8Array(32);
  probe[31] = 7;
  const leaf = sdk.encodeBase58(probe);
  const url = `${d.indexer.url}/getNonInclusionProofs?api-key=${encodeURIComponent(d.indexer.apiKey)}`;
  const { result, ms } = await rpcCall(d.fetch, url, "getNonInclusionProofs", { treeAccount: RINGS_TREE, leaves: [leaf] });
  const p = result?.proofs?.[0];
  if (!p) throw new Error("the indexer returned no proof");
  const t = await readTree(d, ctx);
  const rootHex = hex(sdk.decodeBase58(p.root));
  const known = t.nullifierRoots.includes(rootHex);
  const lag = Math.max(0, t.readSlot - Number(result.context?.slot ?? 0));
  const m = { ms, indexerSlot: Number(result.context?.slot ?? 0), lagSlots: lag, rootInHistory: known, nullifierRoots: t.nullifierRoots.length };
  if (!known) return check("rings_indexer", "Rings indexer (Verifier's view)", lag <= d.limits.indexerLagDegraded ? "degraded" : "down", "the indexer's nullifier root is not in the tree account's history yet; the Verifier refuses until they agree", m);
  if (lag > d.limits.indexerLagDegraded) return check("rings_indexer", "Rings indexer (Verifier's view)", "down", `the indexer is ${lag} slots behind the chain`, m);
  if (lag > d.limits.indexerLagOk) return check("rings_indexer", "Rings indexer (Verifier's view)", "degraded", `the indexer is ${lag} slots behind the chain`, m);
  return check("rings_indexer", "Rings indexer (Verifier's view)", "ok", `in step with the chain (${lag} slots), root in the on-chain history`, m);
}

async function checkVerifier(d, ctx) {
  if (!d.origin) return check("verifier", "Verifier", "unknown", "no origin to reach the Verifier from");
  const r = await getJson(d, "/api/attest");
  if (r.status !== 200 || !r.body?.verifierKey) {
    const code = r.body?.error?.code;
    return check("verifier", "Verifier", code === "NOT_CONFIGURED" ? "unknown" : "down", code === "NOT_CONFIGURED" ? "the Verifier is not configured on this deployment" : `the Verifier answered ${r.status}${code ? ` (${code})` : ""}`, { ms: r.ms });
  }
  ctx.verifier = r.body;
  const published = PUBLISHED?.sha256 || null;
  const m = { ms: r.ms, verifierKey: r.body.verifierKey, version: r.body.version, bundleHash: r.body.bundleHash, publishedBundleHash: published, bundleMatches: !!published && r.body.bundleHash === published };
  const active = ctx.config?.activeVerifier;
  if (active && active !== r.body.verifierKey) return check("verifier", "Verifier", "down", "the Verifier's key is not the key the program accepts now; its attestations would be refused", { ...m, programKey: active });
  if (published && r.body.bundleHash !== published) return check("verifier", "Verifier", "degraded", "the running Verifier bundle is not the published build (verifier/dist/BUILD.json)", m);
  return check("verifier", "Verifier", "ok", active ? "answers; its key is the program's active key; running the published build" : "answers; running the published build", m);
}

async function checkRelayer(d, ctx) {
  const addr = ctx.config?.relayer || ctx.verifier?.relayer || null;
  if (!addr || addr === sdk.SYSTEM_PROGRAM_ID) return check("relayer", "Relayer balance", "unknown", "no relayer configured");
  if (!d.rpcUrls.length) return check("relayer", "Relayer balance", "unknown", "no RPC configured");
  const { result } = await rpcCall(d.fetch, d.rpcUrls[0], "getBalance", [addr, { commitment: "confirmed" }]);
  const lamports = Number(result?.value ?? result ?? 0);
  const b = band(lamports, d.limits);
  const m = { band: b.band, range: b.range };
  if (lamports < d.limits.relayFloorLamports) return check("relayer", "Relayer balance", "down", "below the relayer's floor: relayed certificates wait (holders can still certify from their own wallet)", m);
  if (b.band === "low") return check("relayer", "Relayer balance", "degraded", `the relayer balance is ${b.range}`, m);
  return check("relayer", "Relayer balance", "ok", `the relayer balance is ${b.range}`, m);
}

async function checkKeeper(d, ctx) {
  if (!d.keeperLive) return check("keeper", "Keeper", "off", "off before launch: nobody watches nullifiers yet (holders can revoke themselves)");
  if (!d.store) return check("keeper", "Keeper", "unknown", "no store to read the keeper's last run from");
  const last = await d.store.getJson("keeper/last-scan.json");
  if (!last || !Number.isFinite(Number(last.slot))) return check("keeper", "Keeper", "unknown", "the keeper has not reported a run yet");
  const slot = ctx.slot || Number(last.slot);
  const age = Math.max(0, slot - Number(last.slot));
  const m = { lastRunSlot: Number(last.slot), slotsAgo: age, kits: last.kits ?? null, live: last.live ?? null, revoked: Array.isArray(last.revoked) ? last.revoked.length : last.revoked ?? null, errors: Array.isArray(last.errors) ? last.errors.length : last.errors ?? null };
  if (age > 4 * d.limits.keeperEverySlots) return check("keeper", "Keeper", "down", `the keeper last ran ${age} slots ago`, m);
  if (age > 2 * d.limits.keeperEverySlots || (m.errors ?? 0) > 0) return check("keeper", "Keeper", "degraded", m.errors ? `the last run had ${m.errors} error(s)` : `the keeper last ran ${age} slots ago`, m);
  return check("keeper", "Keeper", "ok", `last run ${age} slots ago`, m);
}

async function checkLog(d, ctx) {
  if (!d.origin) return check("log", "Transparency log", "unknown", "no origin to reach the log from");
  const r = await getJson(d, "/api/attest/log?head");
  if (r.status !== 200 || typeof r.body?.treeSize !== "number") {
    const code = r.body?.error?.code;
    return check("log", "Transparency log", code === "NOT_CONFIGURED" ? "unknown" : "down", code === "NOT_CONFIGURED" ? "the log is not configured on this deployment" : `the log answered ${r.status}${code ? ` (${code})` : ""}`, { ms: r.ms });
  }
  const sth = r.body;
  const sigOk = await sdk.verifyTreeHead(sth, d.programId).catch(() => false);
  const keyOk = !ctx.verifier || ctx.verifier.verifierKey === sth.verifierKey;
  ctx.logHead = { treeSize: sth.treeSize, rootHash: sth.rootHash };
  const treasury = ctx.config ? await client(d).getTreasury().catch(() => null) : null;
  const anchored = treasury?.log || null;
  const m = { ms: r.ms, size: sth.treeSize, rootHash: sth.rootHash, signatureValid: sigOk, anchoredSize: anchored?.treeSize ?? 0, anchoredSlot: anchored?.slot ?? null, unanchored: sth.treeSize - (anchored?.treeSize ?? 0) };
  if (!sigOk || !keyOk) return check("log", "Transparency log", "down", !sigOk ? "the signed tree head does not verify" : "the tree head is signed by another key than the Verifier's", m);

  /* the log must extend every head seen before: the one anchored on chain and the one the last sample stored */
  const seen = [];
  if (anchored) seen.push({ from: "chain", treeSize: anchored.treeSize, rootHash: anchored.rootHash });
  const prev = d.store ? await d.store.getJson("status/log-head.json").catch(() => null) : null;
  if (prev && typeof prev.treeSize === "number") seen.push({ from: "last sample", treeSize: prev.treeSize, rootHash: prev.rootHash });
  for (const s of seen) {
    if (s.treeSize > sth.treeSize) return check("log", "Transparency log", "down", `the log is shorter (${sth.treeSize}) than the head seen ${s.from === "chain" ? "on chain" : "at the last sample"} (${s.treeSize})`, m);
    if (s.treeSize === 0) continue;
    const c = await getJson(d, `/api/attest/log?consistency=${s.treeSize}&size=${sth.treeSize}`);
    const ok = c.status === 200 && c.body?.firstRoot === s.rootHash && c.body?.secondRoot === sth.rootHash && (await sdk.verifyConsistency({ size1: s.treeSize, size2: sth.treeSize, root1: s.rootHash, root2: sth.rootHash, proof: c.body.path || [] }).catch(() => false));
    m[s.from === "chain" ? "consistentWithChain" : "consistentWithLastSample"] = ok;
    if (!ok) return check("log", "Transparency log", "down", `the log is not consistent with the head seen ${s.from === "chain" ? "on chain" : "at the last sample"} (size ${s.treeSize})`, m);
  }
  const since = anchored && ctx.slot ? ctx.slot - anchored.slot : null;
  m.slotsSinceAnchor = since;
  if (d.keeperLive && m.unanchored > 0 && (since === null || since > d.limits.anchorStaleSlots)) return check("log", "Transparency log", "degraded", `${m.unanchored} entries are not anchored on chain yet`, m);
  return check("log", "Transparency log", "ok", `${sth.treeSize} entries, signed head verifies${anchored ? `, consistent with the on-chain anchor (size ${anchored.treeSize})` : ""}`, m);
}

const CHECKS = [
  ["rpc", checkRpc],
  ["program", checkProgram],
  ["rings_tree", checkRingsTree],
  ["rings_indexer", checkIndexer],
  ["verifier", checkVerifier],
  ["relayer", checkRelayer],
  ["keeper", checkKeeper],
  ["log", checkLog],
];
export const CHECK_IDS = CHECKS.map(([id]) => id);

/** Runs every check. Order matters a little: rpc and program first (they set the slot and Config the others compare to). */
export async function runChecks(d) {
  const ctx = { slot: 0, config: null, tree: null, verifier: null };
  const out = [];
  for (const [id, fn] of CHECKS) {
    const t0 = d.now();
    let r;
    try {
      r = await withTimeout(fn(d, ctx), d.limits.checkTimeoutMs, id);
    } catch (e) {
      r = check(id, id, "down", scrub(e?.message || e));
    }
    r.ms = d.now() - t0;
    out.push(r);
  }
  return {
    v: 1,
    network: d.network,
    overall: worst(out.map((c) => c.state)),
    slot: ctx.slot || null,
    checkedAt: new Date(d.now()).toISOString(),
    published: { bundleHash: PUBLISHED?.sha256 || null },
    checks: out,
    logHead: ctx.logHead || null,
  };
}

/* ------------------------------------------------------------------------------------------------ the history */

/** One stored sample: the states and the few numbers the history graphs need. */
export function compact(run) {
  const c = {}, m = {};
  for (const x of run.checks) c[x.id] = x.state;
  const get = (id, k) => run.checks.find((x) => x.id === id)?.metrics?.[k];
  m.rootAgeSlots = get("rings_tree", "rootAgeSlots") ?? null;
  m.indexerLagSlots = get("rings_indexer", "lagSlots") ?? null;
  m.rpcMs = get("rpc", "bestMs") ?? null;
  m.verifierMs = get("verifier", "ms") ?? null;
  m.logSize = get("log", "size") ?? null;
  m.anchoredSize = get("log", "anchoredSize") ?? null;
  m.relayerBand = get("relayer", "band") ?? null;
  return { t: Math.floor(Date.parse(run.checkedAt) / 1000), slot: run.slot, o: run.overall, c, m };
}

const day = (unixSec) => new Date(unixSec * 1000).toISOString().slice(0, 10);

/** Adds one sample to the per-day summary (counts of ok / degraded / down per check; off and unknown are not counted). */
export function addToSummary(summary, sample, keepDays = LIMITS.historyDays) {
  const s = summary && summary.v === 1 ? summary : { v: 1, days: {} };
  const k = day(sample.t);
  const d = (s.days[k] ||= { n: 0, overall: [0, 0, 0], c: {} });
  d.n++;
  const idx = { ok: 0, degraded: 1, down: 2 };
  if (sample.o in idx) d.overall[idx[sample.o]]++;
  for (const [id, st] of Object.entries(sample.c)) {
    if (!(st in idx)) continue;
    (d.c[id] ||= [0, 0, 0])[idx[st]]++;
  }
  const keys = Object.keys(s.days).sort();
  for (const old of keys.slice(0, Math.max(0, keys.length - keepDays))) delete s.days[old];
  s.updatedAt = sample.t;
  s.lastSlot = sample.slot;
  return s;
}

/** The summary as the page shows it: per day and per check, the share of samples that were not down. */
export function historyView(summary) {
  if (!summary || summary.v !== 1) return null;
  const pct = ([ok, deg, down]) => (ok + deg + down ? Math.round(((ok + deg) / (ok + deg + down)) * 10_000) / 100 : null);
  const days = Object.keys(summary.days).sort().map((date) => {
    const d = summary.days[date];
    const checks = {};
    for (const [id, cnt] of Object.entries(d.c)) checks[id] = { ok: cnt[0], degraded: cnt[1], down: cnt[2], uptime: pct(cnt) };
    return { date, samples: d.n, uptime: pct(d.overall), checks };
  });
  const totals = {};
  for (const d of days) for (const [id, c] of Object.entries(d.checks)) {
    const t = (totals[id] ||= [0, 0, 0]);
    t[0] += c.ok; t[1] += c.degraded; t[2] += c.down;
  }
  return {
    asOf: summary.updatedAt ? new Date(summary.updatedAt * 1000).toISOString() : null,
    lastSlot: summary.lastSlot ?? null,
    days,
    uptime: Object.fromEntries(Object.entries(totals).map(([id, t]) => [id, pct(t)])),
  };
}

/** Stores one sample: the day's sample file, the summary, the latest run and the log head (for the next consistency check). */
export async function storeSample(store, run) {
  const s = compact(run);
  const dayKey = `status/samples/${day(s.t)}.json`;
  const list = (await store.getJson(dayKey)) || [];
  list.push(s);
  await store.putJson(dayKey, list);
  const summary = addToSummary(await store.getJson("status/summary.json"), s);
  await store.putJson("status/summary.json", summary);
  await store.putJson("status/latest.json", run);
  const logOk = run.checks.find((c) => c.id === "log")?.state;
  if (run.logHead && logOk !== "down") await store.putJson("status/log-head.json", run.logHead);
  return { sample: s, days: Object.keys(summary.days).length };
}

/* ------------------------------------------------------------------------------------------------ storage */

/** Vercel Blob, private, the same store as the Verifier (prefix pof/). Reads bypass the CDN cache. */
export class BlobStatusStore {
  constructor(prefix = "pof/") {
    this.prefix = prefix;
    this.B = null;
  }
  async b() {
    return this.B || (this.B = await import("@vercel/blob"));
  }
  async getJson(key) {
    const B = await this.b();
    try {
      const r = await B.get(this.prefix + key, { access: "private", useCache: false });
      if (!r || !r.stream) return null;
      return JSON.parse(await new Response(r.stream).text());
    } catch (e) {
      if (/not.?found|404/i.test(String(e?.message)) || e?.name === "BlobNotFoundError") return null;
      throw e;
    }
  }
  async putJson(key, value) {
    const B = await this.b();
    await B.put(this.prefix + key, JSON.stringify(value), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
  }
}

export class MemoryStatusStore {
  constructor() {
    this.m = new Map();
  }
  async getJson(key) {
    return this.m.has(key) ? structuredClone(this.m.get(key)) : null;
  }
  async putJson(key, value) {
    this.m.set(key, structuredClone(value));
  }
}

export function storeFromEnv(env = process.env) {
  return env.BLOB_READ_WRITE_TOKEN ? new BlobStatusStore(env.POF_BLOB_PREFIX || "pof/") : null;
}

/* ------------------------------------------------------------------------------------------------ HTTP */

const HEADERS = { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "x-content-type-options": "nosniff" };

export function send(res, status, body, cache = "no-store") {
  res.statusCode = status;
  for (const [k, v] of Object.entries(HEADERS)) res.setHeader(k, v);
  res.setHeader("cache-control", cache);
  res.end(JSON.stringify(body));
}

export function originOf(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  return req.headers.host ? `${proto}://${req.headers.host}` : "";
}

/** Upstream reads are bounded three ways (audit POF-14): the edge caches the one URL; each warm instance runs the checks
 *  at most once per `ms`; and across instances a run stored in Blob younger than `sharedMs` is served as is, and at most
 *  `perMinute` runs start in any one-minute window (counted in Blob). Past the cap the last stored run is served, marked
 *  stale. Without a store only the first two apply. */
let memo = null;
/** Single flight per instance: concurrent callers share one in-flight run (and its Blob reads), not one run each. */
let inflight = null;
export function cachedRun(d, opts = {}) {
  if (memo && memo.until > d.now() && memo.origin === d.origin) return Promise.resolve(memo.run);
  if (inflight && inflight.origin === d.origin) return inflight.p;
  const p = freshRun(d, opts).finally(() => { if (inflight?.p === p) inflight = null; });
  inflight = { p, origin: d.origin };
  return p;
}
async function freshRun(d, { ms = 15_000, sharedMs = 30_000, perMinute = 6 } = {}) {
  const keep = (run) => { memo = { run, until: d.now() + ms, origin: d.origin }; return run; };
  if (!d.store) return keep(await runChecks(d));
  const last = await d.store.getJson("status/live.json").catch(() => null);
  if (last?.run && d.now() - last.at < sharedMs) return keep(last.run);
  const w = Math.floor(d.now() / 60_000);
  const key = `status/runs/${w % 60}.json`;
  const c = await d.store.getJson(key).catch(() => null);
  const n = c && c.w === w ? c.n : 0;
  if (n >= perMinute && last?.run) return keep({ ...last.run, stale: true });
  await d.store.putJson(key, { w, n: n + 1 }).catch(() => {});
  const run = await runChecks(d);
  await d.store.putJson("status/live.json", { at: d.now(), run }).catch(() => {});
  return keep(run);
}
export function clearCache() {
  memo = null;
  inflight = null;
}
