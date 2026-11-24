// GET /api/status: every check run now (docs-src/status.md), plus the stored uptime history when there is one.
// Read-only; CDN-cached for a few seconds so a burst of page views costs one set of chain reads.
import { cachedRun, depsFromEnv, historyView, originOf, scrub, send, storeFromEnv } from "./_core.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return send(res, 204, null);
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: { code: "METHOD", message: "GET" } });
  // one cacheable URL: a query string would skip the edge cache and cost a fresh set of upstream reads (audit POF-14)
  if (String(req.url || "").includes("?")) {
    res.statusCode = 308;
    res.setHeader("location", "/api/status");
    res.setHeader("cache-control", "public, s-maxage=3600");
    return res.end();
  }
  try {
    const d = depsFromEnv(process.env, originOf(req));
    d.store = storeFromEnv(process.env);
    const run = await cachedRun(d);
    let history = null;
    if (d.store) history = historyView(await d.store.getJson("status/summary.json").catch(() => null));
    const { logHead, ...pub } = run;
    send(res, 200, { ...pub, history }, "public, s-maxage=20, stale-while-revalidate=40");
  } catch (e) {
    send(res, 500, { error: { code: "INTERNAL", message: scrub(e?.message || e) } });
  }
}
