// Shared server helpers for /v1, the hosted MCP endpoint and the bots. Everything reads the chain through @pof/sdk.
import * as sdk from "../../sdk/dist/index.js";

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
export async function remember(key, ms, fn) {
  const hit = memo.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await fn();
  memo.set(key, { value, until: Date.now() + ms });
  if (memo.size > 500) memo.delete(memo.keys().next().value);
  return value;
}
export function clearMemo() {
  memo.clear();
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

/** The transparency log lives with the verifier (CONTRACT §7, GET /api/attest/log). */
export function logBase(env = process.env, origin) {
  if (env.POF_LOG_URL) return env.POF_LOG_URL.replace(/\/$/, "");
  if (origin) return `${origin}/api/attest/log`;
  throw new HttpError(503, "log_not_configured", "the transparency log URL is not configured");
}

export async function logGet(base, qs, f = fetch) {
  let res;
  try {
    res = await f(`${base}?${qs}`, { headers: { accept: "application/json" } });
  } catch {
    throw new HttpError(502, "log_unreachable", "the transparency log did not answer");
  }
  const body = await res.json().catch(() => null);
  if (res.status === 404) throw new HttpError(404, "not_found", body?.error?.message ?? body?.message ?? "no such log entry");
  if (!res.ok || !body) throw new HttpError(502, "log_error", `the transparency log answered ${res.status}`);
  return body;
}

export async function verifiedHead(base, client, f) {
  const head = await logGet(base, "head", f);
  const programId = client?.programId ?? sdk.POF_PROGRAM_ID;
  const signatureValid = await sdk.verifyTreeHead(head, programId).catch(() => false);
  // the latest head anchored on chain by anchor_log (Treasury), and whether this head is consistent with it
  let anchor = null;
  const t = client ? await client.getTreasury().catch(() => null) : null;
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
  return { ...head, signatureValid, programId, anchor };
}

export async function verifiedProof(base, client, index, f) {
  const programId = client?.programId ?? sdk.POF_PROGRAM_ID;
  const head = await logGet(base, "head", f);
  if (index >= head.treeSize) throw new HttpError(404, "not_found", `log entry ${index} does not exist yet (the log has ${head.treeSize})`);
  const [entry, proof] = await Promise.all([
    logGet(base, `entry=${index}`, f),
    logGet(base, `proof=${index}&size=${head.treeSize}`, f),
  ]);
  const check = await sdk.verifyLogEntry({
    leaf: entry.leaf, index, proof: { treeSize: proof.treeSize, rootHash: proof.rootHash, path: proof.path }, head, programId,
  });
  const a = check.leaf?.attestation;
  return {
    index,
    leaf: entry.leaf,
    leafHash: entry.leafHash,
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
          nonce: a.nonce,
          signature: check.leaf.signature,
          verifierKey: check.leaf.verifierKey,
          bundleHash: check.leaf.bundleHash,
          loggedSlot: check.leaf.loggedSlot,
        }
      : null,
    proof: { treeSize: proof.treeSize, rootHash: proof.rootHash, path: proof.path },
    head,
    verified: check.ok,
    checks: check.checks,
  };
}
