// Request handlers for /api/bots?fn=telegram|discord|link|sweep, transport-free so tests call them directly.
import { checkLinkToken, verifySubjectProof, saveLink, subjectLabel, linkMessage } from "./link.js";
import { handleTelegramUpdate, onLinked, tgApi } from "./telegram.js";
import { handleDiscordInteraction, verifyDiscordSignature, discordApi, syncMember } from "./discord.js";
import { sweep } from "./sweep.js";
import fs from "node:fs";

const J = (status, body) => ({ status, headers: { "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify(body) });

/** deps: { env, store, client, fetch? } → adds the platform API callers. */
export function withApis(deps) {
  return {
    ...deps,
    api: deps.api ?? (deps.env.TG_BOT_TOKEN ? tgApi(deps.env, deps.fetch) : null),
    dapi: deps.dapi ?? (deps.env.DISCORD_BOT_TOKEN ? discordApi(deps.env, deps.fetch) : null),
  };
}

export async function telegramWebhook({ method, headers, rawBody }, deps) {
  if (method !== "POST") return J(405, { error: "POST only" });
  if (!deps.env.TG_BOT_TOKEN || !deps.env.TG_WEBHOOK_SECRET) return J(503, { error: "telegram bot not configured" });
  if (headers["x-telegram-bot-api-secret-token"] !== deps.env.TG_WEBHOOK_SECRET) return J(401, { error: "bad secret" });
  let update;
  try {
    update = JSON.parse(rawBody);
  } catch {
    return J(400, { error: "bad json" });
  }
  try {
    const r = await handleTelegramUpdate(update, withApis(deps));
    return J(200, { ok: true, result: r?.action ?? "done" });
  } catch (e) {
    console.error("telegram update failed", e);
    return J(200, { ok: false }); // 200 so Telegram does not retry a poison update forever
  }
}

export async function discordWebhook({ method, headers, rawBody }, deps) {
  if (method !== "POST") return J(405, { error: "POST only" });
  if (!deps.env.DISCORD_PUBLIC_KEY) return J(503, { error: "discord bot not configured" });
  if (!verifyDiscordSignature(deps.env.DISCORD_PUBLIC_KEY, headers["x-signature-ed25519"], headers["x-signature-timestamp"], rawBody))
    return J(401, { error: "invalid request signature" });
  const body = JSON.parse(rawBody);
  return J(200, await handleDiscordInteraction(body, withApis(deps)));
}

/** POST /link: { p, u, g?, e, t, subject: { kind, value }, proof } */
export async function linkSubmit({ method, rawBody }, deps) {
  if (method !== "POST") return J(405, { error: "POST only" });
  let b;
  try {
    b = JSON.parse(rawBody);
  } catch {
    return J(400, { error: "bad json" });
  }
  const tok = { p: b.p, u: String(b.u ?? ""), g: String(b.g ?? ""), e: b.e, t: b.t };
  const bad = checkLinkToken(deps.env, tok);
  if (bad) return J(400, { error: bad });
  if (!b.subject || ![0, 1, 2].includes(Number(b.subject.kind)) || typeof b.subject.value !== "string") return J(400, { error: "subject must be { kind: 0|1|2, value }" });
  const subject = { kind: Number(b.subject.kind), value: b.subject.value.trim() };
  let why;
  try {
    why = await verifySubjectProof(tok, subject, String(b.proof ?? ""), { checkXLink: deps.checkXLink });
  } catch (e) {
    why = e.message;
  }
  if (why) return J(400, { error: why });
  const d = withApis(deps);
  const { rec, movedFrom } = await saveLink(d.store, tok, subject);
  let results = [];
  if (tok.p === "tg" && d.api) results = await onLinked(d, Number(tok.u));
  if (tok.p === "dc" && tok.g && d.dapi) {
    const v = await syncMember(d, tok.g, tok.u);
    results = [{ guild: tok.g, ok: v.ok, reason: v.reason, text: v.text }];
  }
  return J(200, { ok: true, linked: subjectLabel(rec), subjectHash: rec.subjectHash, movedFromAnotherAccount: !!movedFrom, results });
}

/** GET /link: the page (plain; the site may restyle bots/link.html). GET /link?message=1&...: the text to sign. */
export function linkPage({ query }, deps) {
  if (query.message) {
    const bad = checkLinkToken(deps.env, { p: query.p, u: query.u, g: query.g ?? "", e: query.e, t: query.t });
    if (bad) return J(400, { error: bad });
    return J(200, { message: linkMessage({ p: query.p, u: query.u, e: query.e }) });
  }
  const html = fs.readFileSync(new URL("./link.html", import.meta.url), "utf8");
  return { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" }, body: html };
}

export async function sweepRun({ headers }, deps) {
  const want = deps.env.CRON_SECRET;
  if (!want || headers.authorization !== `Bearer ${want}`) return J(401, { error: "unauthorized" });
  if (deps.env.BOTS_PAUSED === "1") return J(200, { paused: true });
  return J(200, await sweep(withApis(deps)));
}
