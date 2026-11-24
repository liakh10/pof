// GET /api/status/sample: cron only (Authorization: Bearer CRON_SECRET). Runs every check and stores one sample in Vercel
// Blob (pof/status/...): the day's samples, the per-day summary, the latest run, and the log head the next run must extend.
// Parked before launch: the entry lives in vercel.crons.json until the lead moves it into vercel.json.
import { depsFromEnv, originOf, runChecks, scrub, send, storeFromEnv, storeSample } from "./_core.js";

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) return send(res, 403, { error: { code: "FORBIDDEN", message: "cron routes need the cron secret" } });
  try {
    const store = storeFromEnv(process.env);
    if (!store) return send(res, 503, { error: { code: "NO_STORE", message: "connect a Blob store (BLOB_READ_WRITE_TOKEN) to keep the status history" } });
    const d = depsFromEnv(process.env, originOf(req));
    d.store = store;
    const run = await runChecks(d);
    const saved = await storeSample(store, run);
    send(res, 200, { ok: true, overall: run.overall, slot: run.slot, days: saved.days, states: saved.sample.c });
  } catch (e) {
    send(res, 500, { error: { code: "INTERNAL", message: scrub(e?.message || e) } });
  }
}
