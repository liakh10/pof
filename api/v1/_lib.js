// Shared server helpers for /v1, the hosted MCP endpoint and the bots. Everything reads the chain through @pof/sdk.
import * as sdk from "../../sdk/dist/index.js";
import { LogMirror } from "./_logmirror.js";

export { sdk };

export class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/** One PofClient per warm instance. Tests pass their own through setClient(). */
let injected = null;
let cached = null;
export function setClient(c) {
  injected = c;
}
export function getClient(env = process.env) {
  if (injected) return injected;
  if (cached) return cached;
  const rpc = env.SOLANA_RPC || env.RPC_URL;
  if (!rpc) throw new HttpError(503, "rpc_not_configured", "the server has no Solana RPC configured (SOLANA_RPC)");
  cached = new sdk.PofClient({
    rpc: new sdk.Rpc(rpc, { commitment: "confirmed", timeoutMs: 15_000 }),
    programId: env.POF_PROGRAM_ID || undefined,
    gateProgramId: env.POF_GATE_PROGRAM_ID || undefined,
  });
  return cached;
}

/** A small per-instance memo so a burst of identical heavy reads (getProgramAccounts) costs one RPC call. */
const memo = new Map();
export const memoStats = { hits: 0, misses: 0 };
/**
 * Single-flight: concurrent callers of the same key share ONE upstream call (the promise is cached, not just the value),
 * so a burst of identical heavy reads (getProgramAccounts) costs one RPC call, not one per request.
 */
export async function remember(key, ms, fn) {
  if (process.env.POF_MEMO_OFF === "1") return fn();
  const hit = memo.get(key);
  if (hit && hit.until > Date.now()) {
    memoStats.hits++;
    return hit.promise;
  }
  memoStats.misses++;
  const promise = Promise.resolve().then(fn);
  memo.set(key, { promise, until: Date.now() + ms });
  if (memo.size > 500) memo.delete(memo.keys().next().value);
  promise.catch(() => {
    if (memo.get(key)?.promise === promise) memo.delete(key);
  });
  return promise;
}
export function clearMemo() {
  memo.clear();
  logCache.clear();
  mirrors.clear();
}

/** The public shape of a certificate (CONTRACT §6, HTTP part). */
export function certJson(c, subjectValue = null) {
  return {
    address: c.address,
    subject: subjectValue,
    kind: c.subjectKindName,
    subjectHash: c.subjectHash,
    asset: c.assetSymbol,
    assetId: c.asset,
    tier: c.tier,
    tierLabel: c.tierLabel,
    status: c.effectiveStatus,
    statusOnChain: c.statusName,
    live: c.live,
    certifiedSlot: c.certifiedSlot,
    expirySlot: c.expirySlot,
    revokedSlot: c.revokedSlot,
    logIndex: c.logIndex,
    noteCount: c.noteCount,
    payer: c.payer,
    verifierKey: c.verifier,
    controller: c.controller,
    issuedSlot: c.issuedSlot,
    renewals: c.renewals,
    revealed: c.revealed,
  };
}

export function parseIntParam(v, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (v === undefined || v === null || v === "") return undefined;
  if (!/^\d+$/.test(String(v))) throw new HttpError(400, "bad_param", `${name} must be a whole number`);
  const n = Number(v);
  if (n < min || n > max) throw new HttpError(400, "bad_param", `${name} must be between ${min} and ${max}`);
  return n;
}

export function parseAssetParam(v) {
  if (v === undefined || v === null || v === "") return undefined;
  try {
    return sdk.parseAsset(String(v));
  } catch {
    throw new HttpError(400, "bad_asset", `unknown asset "${v}" (use SOL or USDC)`);
  }
}

export function parseTierParam(v, asset, name = "tier") {
  const t = parseIntParam(v, name, { min: 1, max: 5 });
  return t;
}

/** Look a subject up and shape the answer. Optional gate check with asset + minTier. */
export async function lookupSubject(client, query, { asset, minTier } = {}) {
  let r;
  try {
    r = await client.lookup(query, { asset });
  } catch (e) {
    if (e instanceof sdk.RpcError) throw new HttpError(502, "rpc_error", "the Solana RPC did not answer, try again");
    throw new HttpError(400, "bad_subject", e.message);
  }
  const byHash = new Map(r.candidates.map((c) => [c.subjectHash, c]));
  const certificates = r.certificates
    .sort((a, b) => Number(b.live) - Number(a.live) || b.tier - a.tier || a.asset - b.asset)
    .map((c) => certJson(c, byHash.get(c.subjectHash)?.value ?? null));
  const matched = r.candidates.filter((c) => r.certificates.some((x) => x.subjectHash === c.subjectHash));
  const out = {
    query,
    slot: r.slot,
    subjects: (matched.length ? matched : r.candidates).map((c) => ({
      kind: sdk.SUBJECT_KIND_NAMES[c.kind] ?? null, value: c.value, subjectHash: c.subjectHash,
    })),
    live: certificates.some((c) => c.live),
    certificates,
  };
  if (minTier !== undefined) {
    if (asset === undefined) throw new HttpError(400, "bad_param", "minTier needs asset");
    const best = r.certificates.filter((c) => c.asset === asset).sort((a, b) => Number(b.live) - Number(a.live) || b.tier - a.tier)[0];
    let reason = "ok";
    if (!best) reason = "no_certificate";
    else if (!best.live) reason = best.effectiveStatus;
    else if (best.tier < minTier) reason = "below_tier";
    out.check = { asset: sdk.ASSETS[asset].symbol, minTier, minTierLabel: sdk.tierLabel(asset, minTier), ok: reason === "ok", reason };
  }
  return out;
}

export function roomJson(r) {
  return {
    address: r.room.address,
    creator: r.room.creator,
    id: r.room.id,
    name: r.room.name,
    asset: r.room.assetSymbol,
    assetId: r.room.asset,
    minTier: r.room.minTier,
    minTierLabel: r.room.minTierLabel,
    memberCount: r.room.memberCount,
    createdSlot: r.room.createdSlot,
    slot: r.slot,
    liveMembers: r.members.filter((m) => m.live).length,
    members: r.members.map((m) => ({
      address: m.address,
      subjectHash: m.subjectHash,
      certificate: m.certificate,
      certificateStatus: m.certificateStatus,
      tier: m.tier,
      live: m.live,
      joinedSlot: m.joinedSlot,
    })),
  };
}

/** Where /v1/witness reads the witness document (tests inject one; production reads the witness's Blob). */
let witnessSource = null;
export function setWitnessSource(fn) {
  witnessSource = fn;
}
export async function readWitnessDoc(env = process.env) {
  if (witnessSource) return witnessSource();
  if (!env.BLOB_READ_WRITE_TOKEN) return null;
  const { BlobState } = await import("../../witness/store.js");
  return new BlobState().get();
}

/** The transparency log lives with the verifier (CONTRACT §7, GET /api/attest/log). */
export function logBase(env = process.env, origin) {
  if (env.POF_LOG_URL) return env.POF_LOG_URL.replace(/\/$/, "");
  // POF-20: never derive a service URL from the Host header in production
  if (env.VERCEL_ENV === "production" || env.NODE_ENV === "production") throw new HttpError(503, "log_not_configured", "POF_LOG_URL is not configured");
  if (origin) return `${origin}/api/attest/log`;
  throw new HttpError(503, "log_not_configured", "the transparency log URL is not configured");
}

/**
 * POF-13: the verifier keys come from the chain, never from the log. `all` (for log entries): the Config, the keys open
 * certificates were accepted with, and the VerifierSet history in the admin's transactions; cached for 10 minutes.
 * `active` (for heads, audit W-02): the one key that may sign a head now; cached for 30 seconds.
 */
export async function trustedKeys(client) {
  if (!client) return { all: [], active: null, fromHistory: false };
  const [hist, cfg, list] = await Promise.all([
    remember("verifierKeys", 600_000, () => client.verifierKeys({ history: true, maxTransactions: 200 }).catch(() => client.verifierKeys())),
    remember("config", 30_000, () => client.getConfig()),
    // the same memoized scan the list endpoint and stats use: no second getProgramAccounts for the certificates' keys
    remember(LIST_ALL, 10_000, () => client.listCertificates()).catch(() => ({ certificates: [] })),
  ]);
  const active = cfg ? cfg.activeVerifier : hist.active;
  const DEFAULT = "11111111111111111111111111111111";
  const fromCerts = list.certificates.map((c) => c.verifier).filter((k) => k && k !== DEFAULT);
  const all = [...new Set([...hist.all, ...fromCerts, ...(active ? [active] : [])])];
  return { all, active, fromHistory: hist.fromHistory };
}

/** the memo key of the unfiltered certificate scan (shared by list, stats and trusted keys) */
export const LIST_ALL = "list:undefined:undefined:undefined";

const keyEq = (a, b) => {
  try {
    return sdk.encodeBase58(sdk.keyBytes(a)) === sdk.encodeBase58(sdk.keyBytes(b));
  } catch {
    return false;
  }
};

/**
 * Log reads, cached: entries, proofs at a given size and consistency proofs between two sizes never change, so they are
 * kept (LRU, per instance); the head for 3 seconds. A burst of /v1/log traffic then costs the Verifier's log a handful of
 * calls, which matters because its rate limit sees every /v1 instance as one client.
 */
const logCache = new Map();
const LOG_CACHE_MAX = 5000;
const immutable = (qs) => /^(entry=\d+|proof=\d+&size=\d+|consistency=\d+&size=\d+)$/.test(qs);
export const logStats = { fetched: 0, cached: 0 };
export async function logGet(base, qs, f = fetch) {
  const key = `${base}?${qs}`;
  if (qs === "head") return remember(`loghead:${base}`, 3_000, () => logFetch(base, qs, f));
  if (!immutable(qs)) return logFetch(base, qs, f);
  const hit = logCache.get(key);
  if (hit) {
    logStats.cached++;
    logCache.delete(key);
    logCache.set(key, hit); // LRU: most recent last
    return hit;
  }
  const p = logFetch(base, qs, f);
  logCache.set(key, p);
  p.catch(() => logCache.delete(key));
  if (logCache.size > LOG_CACHE_MAX) logCache.delete(logCache.keys().next().value);
  return p;
}

async function logFetch(base, qs, f = fetch) {
  logStats.fetched++;
  let res;
  try {
    res = await f(`${base}?${qs}`, { headers: { accept: "application/json" } });
  } catch {
    throw new HttpError(502, "log_unreachable", "the transparency log did not answer");
  }
  const body = await res.json().catch(() => null);
  if (res.status === 404) throw new HttpError(404, "not_found", body?.error?.message ?? body?.message ?? "no such log entry");
  if (res.status === 429) throw new HttpError(503, "log_busy", "the transparency log is rate limiting this server; retry in a few seconds", { retryAfter: 5 });
  if (!res.ok || !body) throw new HttpError(502, "log_error", `the transparency log answered ${res.status}`);
  return body;
}

export function clearLogCache() {
  logCache.clear();
}
/** drop cached answers that did not verify, so a bad answer is never served from the cache */
export function forgetLog(base, ...qs) {
  for (const q of qs) logCache.delete(`${base}?${q}`);
}

export async function verifiedHead(base, client, f) {
  const head = await logGet(base, "head", f);
  const programId = client?.programId ?? sdk.POF_PROGRAM_ID;
  const keys = await trustedKeys(client);
  // a head must be signed by the key active now; a retired key may have signed old entries, never a new head (W-02)
  const keyTrusted = !!keys.active && keyEq(keys.active, head.verifierKey);
  const signatureValid = keyTrusted && (await sdk.verifyTreeHead(head, programId).catch(() => false));
  // the latest head anchored on chain by anchor_log (Treasury), and whether this head is consistent with it
  let anchor = null;
  const t = client ? await remember("treasury", 5_000, () => client.getTreasury()).catch(() => null) : null;
  if (t?.log) {
    anchor = { ...t.log, consistent: null };
    if (t.log.treeSize === head.treeSize) anchor.consistent = t.log.rootHash === String(head.rootHash).toLowerCase();
    else if (t.log.treeSize < head.treeSize) {
      try {
        const c = await logGet(base, `consistency=${t.log.treeSize}&size=${head.treeSize}`, f);
        anchor.consistent = await sdk.verifyConsistency({ size1: t.log.treeSize, size2: head.treeSize, root1: t.log.rootHash, root2: head.rootHash, proof: c.path ?? c.proof ?? [] });
      } catch {
        anchor.consistent = null;
      }
    } else anchor.consistent = false;
  }
  return { ...head, signatureValid, keyTrusted, activeKey: keys.active, trustedKeys: keys.all, programId, anchor };
}

const mirrors = new Map();
const MIRROR_WAIT_MS = 1_500;
// synchronous on purpose: an await between the lookup and the set let a burst build fifty mirrors, each paging the log
function mirrorFor(base, f) {
  if (!mirrors.has(base)) {
    mirrors.set(base, new LogMirror({
      head: () => logGet(base, "head", f),
      entries: async (a, b) => (await logFetch(base, `from=${a}&to=${b}`, f)).entries,
      entry: (i) => logGet(base, `entry=${i}`, f),
    }));
  }
  return mirrors.get(base);
}
export function mirrorStats() {
  return [...mirrors.values()].map((m) => ({ size: m.size, ...m.stats }));
}

export async function verifiedProof(base, client, index, f, { certificate } = {}) {
  const programId = client?.programId ?? sdk.POF_PROGRAM_ID;
  const keys = await trustedKeys(client);
  const head = await logGet(base, "head", f);
  if (index >= head.treeSize) throw new HttpError(404, "not_found", `log entry ${index} does not exist yet (the log has ${head.treeSize})`);
  // a head signed by the active key is mirrored: the proof is computed here, so a proof read costs the log no call
  let leafHex, proof, mirrored = false;
  const headOk = !!keys.active && keyEq(keys.active, head.verifierKey) && (await sdk.verifyTreeHead(head, programId).catch(() => false));
  if (headOk) {
    const m = mirrorFor(base, f);
    try {
      // wait a little for the mirror; a long first sync runs on in the background
      const sync = m.syncTo(head);
      sync.catch(() => {});
      const h = await Promise.race([sync, new Promise((r) => setTimeout(() => r(null), MIRROR_WAIT_MS).unref?.())]);
      // still paging in: say so, and do not add per-entry reads to a log that is already busy serving the pages
      if (!h) throw new HttpError(503, "log_syncing", "this server is still reading the transparency log; retry in a few seconds", { retryAfter: 2 });
      if (index < h.treeSize) {
        leafHex = await m.leaf(index);
        proof = { treeSize: h.treeSize, rootHash: h.rootHash, path: m.path(index) };
        mirrored = true;
      }
    } catch (e) {
      if (!e?.mismatch) throw e;
    }
  }
  if (!mirrored) {
    const [entry, p] = await Promise.all([logGet(base, `entry=${index}`, f), logGet(base, `proof=${index}&size=${head.treeSize}`, f)]);
    leafHex = entry.leaf;
    proof = { treeSize: p.treeSize, rootHash: p.rootHash, path: p.path };
  }
  const usedHead = mirrored ? mirrorFor(base, f).head : head;
  const check = await sdk.verifyLogEntry({
    leaf: leafHex, index, proof, head: usedHead, programId, trustedKeys: keys.all, headKeys: keys.active ? [keys.active] : [],
  });
  if (!check.ok && !mirrored) forgetLog(base, `entry=${index}`, `proof=${index}&size=${head.treeSize}`);
  // POF-18: a certificate's log_index is the submitter's word; match the signed bytes instead
  let certificateMatch = null;
  if (certificate && check.leaf && client) {
    const acc = await client.rpc.getAccount(certificate);
    if (acc && acc.owner === client.programId) certificateMatch = sdk.matchCertificateLeaf(sdk.decodeCertificate(certificate, acc.data), check.leaf);
    else certificateMatch = { matches: false, mismatched: ["certificate not found"] };
  }
  const a = check.leaf?.attestation;
  return {
    index,
    leaf: leafHex,
    leafHash: sdk.toHex(await sdk.leafHash(sdk.fromHex(leafHex))),
    attestation: a
      ? {
          bytes: check.leaf.attestationBytes,
          subjectKind: sdk.SUBJECT_KIND_NAMES[a.subjectKind] ?? a.subjectKind,
          subjectHash: a.subjectHash,
          asset: sdk.ASSETS[a.asset]?.symbol ?? a.asset,
          tier: a.tier,
          tierLabel: sdk.ASSETS[a.asset]?.tiers[a.tier] !== undefined ? sdk.tierLabel(a.asset, a.tier) : null,
          treeRoot: a.treeRoot,
          rootSlot: a.rootSlot,
          noteCount: a.noteCount,
          nullsetHash: a.nullsetHash,
          issuedSlot: a.issuedSlot,
          expirySlot: a.expirySlot,
          payer: a.payer,
          controller: a.controller,
          nonce: a.nonce,
          signature: check.leaf.signature,
          verifierKey: check.leaf.verifierKey,
          bundleHash: check.leaf.bundleHash,
          loggedSlot: check.leaf.loggedSlot,
        }
      : null,
    proof,
    head: usedHead,
    trustedKeys: keys.all,
    verified: check.ok && (certificateMatch ? certificateMatch.matches : true),
    checks: check.checks,
    certificateMatch,
    computedBy: mirrored ? "this server's mirror of the log" : "the log",
  };
}
