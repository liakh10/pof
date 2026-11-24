// Vercel function for the bots: /api/bots/telegram, /api/bots/discord, /link (GET page, POST submit), /api/bots/sweep (cron).
import { getClient } from "./v1/_lib.js";
import { getStore } from "../bots/store.js";
import { telegramWebhook, discordWebhook, linkSubmit, linkPage, sweepRun } from "../bots/handlers.js";

async function rawBody(req) {
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > 128 * 1024) throw new Error("body too large");
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** kind 1 subjects: ask the verifier's X-handle linker whether a link id is valid and for which handle. */
function xLinkChecker(env, origin) {
  const base = (env.POF_X_LINK_URL || `${origin}/api/link`).replace(/\/$/, "");
  return async (id) => {
    if (!/^[A-Za-z0-9_-]{6,128}$/.test(id)) return null;
    const r = await fetch(`${base}?id=${encodeURIComponent(id)}`).catch(() => null);
    if (!r?.ok) return null;
    const j = await r.json().catch(() => null);
    return j?.verified && j?.handle ? String(j.handle) : null;
  };
}

export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
  const query = Object.fromEntries(url.searchParams);
  const fn = query.fn || url.pathname.split("/").filter(Boolean).pop();
  delete query.fn;
  const origin = `${req.headers["x-forwarded-proto"] || "https"}://${req.headers.host}`;
  let out;
  try {
    const env = process.env;
    const body = req.method === "POST" ? await rawBody(req) : "";
    const r = { method: req.method, headers: req.headers, rawBody: body, query };
    const deps = fn === "link" && req.method === "GET"
      ? { env }
      : { env, store: getStore(env), client: getClient(env), checkXLink: xLinkChecker(env, origin) };
    if (fn === "telegram") out = await telegramWebhook(r, deps);
    else if (fn === "discord") out = await discordWebhook(r, deps);
    else if (fn === "link") out = req.method === "GET" ? linkPage(r, deps) : await linkSubmit(r, deps);
    else if (fn === "sweep") out = await sweepRun(r, deps);
    else out = { status: 404, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "no such bot endpoint" }) };
  } catch (e) {
    console.error("bots error", e);
    out = { status: 503, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: e.message }) };
  }
  res.statusCode = out.status;
  for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
  res.end(out.body);
}
