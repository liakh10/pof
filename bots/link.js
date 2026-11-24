// Linking a Telegram or Discord account to a POF subject.
// The bot hands the user a signed, expiring link token for THEIR platform id; the user proves control of the subject
// (a wallet or badge signature over the link message, or the verifier's X-handle link id); we store the pair.
// One subject links to one account per platform: a new link moves it, so a certificate cannot be shared around a group.
import crypto from "node:crypto";
import { sdk } from "../api/v1/_lib.js";
import { K } from "./store.js";

export const LINK_TTL_S = 30 * 60;

function secret(env) {
  const s = env.BOT_LINK_SECRET;
  if (!s || s.length < 32) throw new Error("BOT_LINK_SECRET is not set (32+ chars)");
  return s;
}

const b64u = (b) => Buffer.from(b).toString("base64url");

/** p: "tg" | "dc"; u: platform user id; g: optional Discord guild (to grant the role right after linking). */
export function makeLinkToken(env, { p, u, g = "" }, now = Date.now()) {
  const e = Math.floor(now / 1000) + LINK_TTL_S;
  const t = b64u(crypto.createHmac("sha256", secret(env)).update(`${p}|${u}|${g}|${e}`).digest());
  return { p, u: String(u), g: String(g), e, t };
}

export function linkUrl(env, params) {
  const tok = makeLinkToken(env, params);
  const base = (env.SITE_URL || "").replace(/\/$/, "");
  const qs = new URLSearchParams({ p: tok.p, u: tok.u, ...(tok.g ? { g: tok.g } : {}), e: String(tok.e), t: tok.t });
  return `${base}/link?${qs}`;
}

export function checkLinkToken(env, { p, u, g = "", e, t }, now = Date.now()) {
  if (!["tg", "dc"].includes(p)) return "unknown platform";
  if (!/^\d{1,20}$/.test(String(u))) return "bad user id";
  if (!/^\d*$/.test(String(g ?? ""))) return "bad guild id";
  if (!/^\d+$/.test(String(e)) || Number(e) * 1000 < now) return "this link expired; ask the bot for a new one";
  const want = crypto.createHmac("sha256", secret(env)).update(`${p}|${u}|${g ?? ""}|${e}`).digest();
  let got;
  try {
    got = Buffer.from(String(t), "base64url");
  } catch {
    return "bad token";
  }
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return "bad token";
  return null;
}

/** The exact UTF-8 text a wallet or badge key signs. */
export function linkMessage({ p, u, e }) {
  const platform = p === "tg" ? "Telegram" : "Discord";
  return `Proof of Funds: link ${platform} account ${u} to this key. Valid until ${e}. pof:link:${p}:${u}:${e}`;
}

/**
 * Verify the subject proof. kind 0/2: an ed25519 signature (base58 or hex) by the key over linkMessage.
 * kind 1: a link id from the verifier's X-handle linker, checked by `checkXLink(linkId) → handle | null`.
 */
export async function verifySubjectProof(tok, subject, proof, { checkXLink } = {}) {
  const kind = Number(subject?.kind);
  if (kind === 0 || kind === 2) {
    const key = sdk.toAddressBytes(String(subject.value));
    let sig;
    try {
      sig = /^[0-9a-f]{128}$/i.test(proof) ? sdk.fromHex(proof) : sdk.decodeBase58(String(proof));
    } catch {
      return "the signature cannot be read";
    }
    const ok = await sdk.ed25519Verify(key, new TextEncoder().encode(linkMessage(tok)), sig);
    return ok ? null : "the signature does not match this key";
  }
  if (kind === 1) {
    if (!checkXLink) return "X handles link through the handle check on the site; it is not configured here";
    const handle = await checkXLink(String(proof));
    if (!handle) return "that X link id is unknown or expired";
    if (sdk.normalizeHandle(handle) !== sdk.normalizeHandle(String(subject.value))) return "that X link id belongs to another handle";
    return null;
  }
  return "unknown subject kind";
}

/** Store the link (and move the subject away from any other account on the same platform). */
export async function saveLink(store, { p, u }, subject, now = Date.now()) {
  const subj = subject.kind === 1 ? sdk.xSubject(subject.value) : subject.kind === 0 ? sdk.walletSubject(subject.value) : sdk.badgeSubject(subject.value);
  const hash = await sdk.subjectHashHex(subj);
  const prev = await store.get(K.bySubject(p, hash));
  if (prev && prev.u !== String(u)) await store.del(K.link(p, prev.u));
  const old = await store.get(K.link(p, u));
  if (old && old.subjectHash !== hash) await store.del(K.bySubject(p, old.subjectHash));
  const rec = { kind: subj.kind, value: subj.value, subjectHash: hash, linkedAt: Math.floor(now / 1000) };
  await store.put(K.link(p, u), rec);
  await store.put(K.bySubject(p, hash), { u: String(u) });
  return { rec, movedFrom: prev && prev.u !== String(u) ? prev.u : null };
}

export async function unlink(store, p, u) {
  const old = await store.get(K.link(p, u));
  if (!old) return false;
  await store.del(K.link(p, u));
  await store.del(K.bySubject(p, old.subjectHash));
  return true;
}

/** The query string for a linked subject (what PofClient.lookup reads). */
export const subjectQuery = (rec) => (rec.kind === 1 ? `x:${rec.value}` : rec.kind === 2 ? `badge:${rec.value}` : `wallet:${rec.value}`);
export const subjectLabel = (rec) => (rec.kind === 1 ? `@${rec.value}` : rec.kind === 2 ? `badge ${rec.value.slice(0, 4)}…${rec.value.slice(-4)}` : `wallet ${rec.value.slice(0, 4)}…${rec.value.slice(-4)}`);
