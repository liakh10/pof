// The /v1 router: pure (request in, response out), so tests run it without a server.
import fs from "node:fs";
import {
  sdk, HttpError, getClient, remember, lookupSubject, certJson, roomJson, parseIntParam, parseAssetParam, parseTierParam,
  logBase, verifiedHead, verifiedProof,
} from "./_lib.js";

export const API_VERSION = "1.0.0";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type, accept",
  "access-control-max-age": "86400",
};

const cache = (s, swr = s * 6) => `public, max-age=0, s-maxage=${s}, stale-while-revalidate=${swr}`;

function json(status, body, cacheControl = "no-store") {
  return {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": cacheControl, "x-pof-api": API_VERSION },
    body: JSON.stringify(body, null, 0),
  };
}

const STATUSES = ["live", "revoked_spent", "revoked_by_holder", "expired", "any"];
const KINDS = { wallet: 0, x: 1, badge: 2 };

/**
 * @param {{ method: string, path: string, query: Record<string,string>, origin?: string, env?: Record<string,string>, fetch?: typeof fetch }} req
 */
export async function handleV1(req) {
  const env = req.env ?? process.env;
  if (req.method === "OPTIONS") return { status: 204, headers: CORS, body: "" };
  if (req.method !== "GET" && req.method !== "HEAD") return json(405, { error: { code: "method_not_allowed", message: "the API is read-only: GET" } });
  const parts = req.path.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean).map(decodeURIComponent);
  const q = req.query ?? {};
  try {
    // GET /v1
    if (parts.length === 0) {
      return json(200, {
        name: "Proof of Funds API",
        version: API_VERSION,
        programId: env.POF_PROGRAM_ID || sdk.POF_PROGRAM_ID,
        gateProgramId: env.POF_GATE_PROGRAM_ID || sdk.POF_GATE_PROGRAM_ID,
        endpoints: [
          "GET /v1/certificates/{subject}",
          "GET /v1/certificates?asset=&tier=&minTier=&status=&kind=&limit=&cursor=",
          "GET /v1/rooms",
          "GET /v1/rooms/{room}",
          "GET /v1/stats",
          "GET /v1/config",
          "GET /v1/log/head",
          "GET /v1/log/proof/{id}",
          "GET /v1/openapi.json",
        ],
        docs: "/developers",
      }, cache(300));
    }
    const [head, ...rest] = parts;

    if (head === "openapi.json" && rest.length === 0) {
      const spec = fs.readFileSync(new URL("../openapi.json", import.meta.url), "utf8");
      return { ...json(200, null, cache(3600)), body: spec };
    }

    if (head === "certificates") {
      const client = getClient(env);
      if (rest.length === 1) {
        const asset = parseAssetParam(q.asset);
        const minTier = parseTierParam(q.minTier, asset, "minTier");
        const body = await lookupSubject(client, rest[0], { asset, minTier });
        return json(200, body, cache(5, 30));
      }
      if (rest.length === 0) {
        const asset = parseAssetParam(q.asset);
        const tier = parseTierParam(q.tier, asset);
        const minTier = parseTierParam(q.minTier, asset, "minTier");
        const status = q.status ?? "any";
        if (!STATUSES.includes(status)) throw new HttpError(400, "bad_param", `status must be one of ${STATUSES.join(", ")}`);
        let subjectKind;
        if (q.kind !== undefined && q.kind !== "") {
          subjectKind = KINDS[q.kind];
          if (subjectKind === undefined) throw new HttpError(400, "bad_param", "kind must be wallet, x or badge");
        }
        const limit = parseIntParam(q.limit, "limit", { min: 1, max: 500 }) ?? 100;
        const cursor = parseIntParam(q.cursor, "cursor") ?? 0;
        const key = `list:${asset}:${tier}:${subjectKind}`;
        const all = await remember(key, 10_000, () => client.listCertificates({ asset, tier, subjectKind }));
        let list = all.certificates;
        if (minTier !== undefined) list = list.filter((c) => c.tier >= minTier);
        if (status !== "any") list = list.filter((c) => c.effectiveStatus === status);
        const page = list.slice(cursor, cursor + limit);
        return json(200, {
          slot: all.slot,
          total: list.length,
          cursor,
          nextCursor: cursor + limit < list.length ? String(cursor + limit) : null,
          certificates: page.map((c) => certJson(c)),
        }, cache(10, 60));
      }
    }

    if (head === "rooms") {
      const client = getClient(env);
      if (rest.length === 0) {
        const rooms = await remember("rooms", 15_000, () => client.listRooms());
        return json(200, {
          rooms: rooms.map((r) => ({
            address: r.address, creator: r.creator, id: r.id, name: r.name, asset: r.assetSymbol, minTier: r.minTier,
            minTierLabel: r.minTierLabel, memberCount: r.memberCount, createdSlot: r.createdSlot,
          })),
        }, cache(15, 90));
      }
      if (rest.length === 1) {
        if (!sdk.isAddress(rest[0])) throw new HttpError(400, "bad_room", "a room is a base58 account address");
        const r = await client.getRoomWithMembers(rest[0]);
        if (!r) throw new HttpError(404, "not_found", `no pof_gate room at ${rest[0]}`);
        return json(200, roomJson(r), cache(5, 30));
      }
    }

    if (head === "config" && rest.length === 0) {
      const client = getClient(env);
      const c = await remember("config", 30_000, () => client.getConfig());
      if (!c) throw new HttpError(404, "not_found", "the pof Config account does not exist on this cluster yet");
      return json(200, {
        slot: c.slot,
        programId: client.programId,
        gateProgramId: client.gateProgramId,
        verifier: c.activeVerifier,
        nextVerifier: c.nextVerifier,
        nextVerifierSlot: c.nextVerifierSlot || null,
        relayer: c.relayer,
        rootMint: c.rootMint,
        feeLamports: c.feeLamports,
        holderMin: c.holderMin,
        validitySlots: c.validitySlots,
        maxAttestAge: c.maxAttestAge,
        maxRootLag: c.maxRootLag,
        paused: c.paused,
        assets: c.assets.filter((a) => a.enabled).map((a) => ({
          id: a.id, symbol: sdk.ASSETS[a.id]?.symbol ?? null, mint: a.mint, decimals: a.decimals,
          tiers: a.mins.map((m, i) => ({ tier: i + 1, minimum: m, label: sdk.ASSETS[a.id]?.tiers[i + 1] !== undefined ? sdk.tierLabel(a.id, i + 1) : null })),
        })),
      }, cache(30, 300));
    }

    if (head === "stats" && rest.length === 0) {
      const client = getClient(env);
      const s = await remember("stats", 10_000, () => client.stats());
      let log = null;
      try {
        const h = await verifiedHead(logBase(env, req.origin), client, req.fetch);
        log = { treeSize: h.treeSize, rootHash: h.rootHash, signatureValid: h.signatureValid, anchor: h.anchor };
      } catch {
        log = null;
      }
      return json(200, {
        slot: s.slot,
        live: s.treasury ? s.treasury.live : s.live,
        total: s.total,
        revoked: s.revokedSpent + s.revokedByHolder,
        revokedSpent: s.revokedSpent,
        revokedByHolder: s.revokedByHolder,
        expired: s.expired,
        solCertified: s.treasury ? Number(BigInt(s.treasury.liveMin[0] ?? 0) / 10n ** 9n) : s.byAsset.SOL?.certifiedMinimum ?? 0,
        usdcCertified: s.treasury ? Number(BigInt(s.treasury.liveMin[1] ?? 0) / 10n ** 6n) : s.byAsset.USDC?.certifiedMinimum ?? 0,
        renewed: s.treasury?.renewed ?? null,
        relayed: s.treasury?.relayed ?? null,
        openCertificates: s.treasury?.open ?? null,
        byAsset: s.byAsset,
        bySubjectKind: s.bySubjectKind,
        log,
        note: "solCertified and usdcCertified are sums of the tier minimums of live certificates, never amounts held",
      }, cache(10, 60));
    }

    if (head === "log") {
      const client = (() => { try { return getClient(env); } catch { return null; } })();
      const base = logBase(env, req.origin);
      if (rest.length === 1 && rest[0] === "head") return json(200, await verifiedHead(base, client, req.fetch), cache(5, 30));
      if (rest.length === 2 && rest[0] === "proof") {
        const id = parseIntParam(rest[1], "id");
        if (id === undefined) throw new HttpError(400, "bad_param", "id must be a whole number");
        return json(200, await verifiedProof(base, client, id, req.fetch), cache(5, 30));
      }
    }

    throw new HttpError(404, "no_route", `no endpoint ${req.path}; see GET /v1`);
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: { code: e.code, message: e.message, ...e.extra } }, e.status >= 500 ? "no-store" : cache(5));
    if (e instanceof sdk.RpcError) return json(502, { error: { code: "rpc_error", message: "the Solana RPC did not answer, try again" } });
    console.error("v1 error", e);
    return json(500, { error: { code: "internal", message: "internal error" } });
  }
}
