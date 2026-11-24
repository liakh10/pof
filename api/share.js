// GET /c/<subject> (rewritten to /api/share?subject=…): the certificate page (c.html, built by site/build.mjs) with the
// share tags filled for this subject, so a link posted on X unfurls as the live card (/api/card/<subject>.png) and a title
// that says the tier and the status read now. The page itself then reads the chain in the browser. The lookup is bounded
// (a slow RPC gives the plain tags, never a slow page).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGE = () => fs.readFileSync(path.join(here, "..", "c.html"), "utf8");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const STATUS = { live: "live", revoked_spent: "revoked: the funds moved", revoked_by_holder: "revoked by the holder", expired: "expired" };

export function withTags(html, { origin, subject, title, description }) {
  const enc = encodeURIComponent(subject);
  const url = `${origin}/c/${enc}`;
  const img = `${origin}/api/card/${enc}.png`;
  const set = (re, val) => { html = html.replace(re, val); };
  set(/<title>[^<]*<\/title>/, `<title>${esc(title)} · Proof of Funds</title>`);
  set(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${esc(url)}">`);
  set(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(title)}">`);
  set(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${esc(url)}">`);
  set(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${esc(img)}">`);
  set(/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${esc(img)}">`);
  if (description) {
    set(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(description)}">`);
    set(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(description)}">`);
  }
  return html;
}

async function describe(subject) {
  const { getClient, lookupSubject } = await import("./v1/_lib.js");
  const look = await Promise.race([lookupSubject(getClient(process.env), subject, {}), new Promise((_, no) => setTimeout(() => no(Error("slow")), 2500))]);
  const c = look.certificates[0];
  if (!c) return { title: `${subject}: no certificate`, description: "No Proof of Funds certificate for this subject on chain right now." };
  return { title: `${c.tierLabel}, ${STATUS[c.status] || c.status}`, description: `${subject} holds a Proof of Funds certificate of ${c.tierLabel}, ${STATUS[c.status] || c.status}, read from chain at slot ${c.certifiedSlot}. Never an amount.` };
}

export default async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  const subject = decodeURIComponent(url.searchParams.get("subject") || "").slice(0, 120);
  // one cache key per subject: stray query strings go to the bare /c/<subject> (audit A2-04)
  if ([...url.searchParams.keys()].some(k => k !== "subject")) {
    res.statusCode = 308;
    res.setHeader("location", `/c/${encodeURIComponent(subject)}`);
    res.setHeader("cache-control", "public, max-age=3600, s-maxage=86400");
    return res.end();
  }
  const proto = req.headers["x-forwarded-proto"] || "https";
  const origin = `${proto}://${req.headers.host}`;
  let meta = { title: `Certificate for ${subject}`, description: null };
  try { if (subject) meta = await describe(subject); } catch {}
  res.statusCode = 200;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "public, max-age=0, s-maxage=60, stale-while-revalidate=600");
  res.end(withTags(PAGE(), { origin, subject, ...meta }));
}
