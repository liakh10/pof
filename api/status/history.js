// GET /api/status/history: the stored uptime history (per day, per check), from the samples the status cron writes.
// Before launch the cron is parked (vercel.crons.json), so the history is empty and the answer says so.
import { historyView, scrub, send, storeFromEnv } from "./_core.js";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: { code: "METHOD", message: "GET" } });
  try {
    const store = storeFromEnv(process.env);
    if (!store) return send(res, 200, { history: null, note: "no store configured on this deployment" }, "public, s-maxage=60");
    const view = historyView(await store.getJson("status/summary.json"));
    send(res, 200, { history: view, note: view ? undefined : "no samples yet: the status cron starts at launch" }, "public, s-maxage=60, stale-while-revalidate=120");
  } catch (e) {
    send(res, 500, { error: { code: "INTERNAL", message: scrub(e?.message || e) } });
  }
}
