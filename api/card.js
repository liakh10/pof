// GET /api/card/<subject>.png (or .svg): the live share card for a subject, 1200 × 630, drawn as SVG in the site's Swiss
// poster language and rendered to PNG with resvg (WASM). It reads the certificate from chain through @pof/sdk (the same
// lookup as /v1), so a screenshot of an old card can always be checked against a fresh one. No subject, or
// "proof-of-funds", gives the site's own card. Cached briefly at the edge: the status it shows is never older than that.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { sealSVG, LITERAL } from "../ui/seal.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const W = 1200, H = 630;
const C = LITERAL;
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const num = n => new Intl.NumberFormat("en-US").format(Number(n) || 0);
const short = (a, n = 6) => (a && a.length > 2 * n + 3 ? `${a.slice(0, n)}…${a.slice(-n)}` : a || "");

let resvg = null, fonts = null;
async function renderer() {
  if (resvg) return resvg;
  const mod = await import("@resvg/resvg-wasm");
  await mod.initWasm(fs.readFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));
  fonts = ["mona-condensed-850.ttf", "mona-700.ttf", "mona-500.ttf", "ubuntu-mono-500.ttf"].map(f => new Uint8Array(fs.readFileSync(path.join(here, "_card", f))));
  resvg = mod;
  return mod;
}

const DISPLAY = "Mona Sans Condensed";
const TEXT = "Mona Sans";
const MONO = "Ubuntu Sans Mono";

function frame(inner, state = "live") {
  const seal = sealSVG({ state, colors: C, crosshair: false }).replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${C.paper}"/>
  <line x1="700" y1="315" x2="${W}" y2="315" stroke="${C.ink}" stroke-width="1.5"/>
  <line x1="975" y1="0" x2="975" y2="${H}" stroke="${C.ink}" stroke-width="1.5"/>
  <g transform="translate(975 315) scale(0.5)">${seal}</g>
  <rect x="28" y="28" width="${W - 56}" height="${H - 56}" fill="none" stroke="${C.ink}" stroke-width="6"/>
  ${inner}
</svg>`;
}

/** the card for one certificate (the /v1 JSON shape) */
export function certificateCard({ cert, subjectText, slot }) {
  const state = cert.status === "live" ? "live" : cert.status.startsWith("revoked") ? "revoked" : "expired";
  const m = /([\d,]+)\s*(\w+)/.exec(cert.tierLabel || "") || [];
  const amt = m[1] || "?", sym = m[2] || cert.asset;
  const pill = { live: ["LIVE", C.signal, C.ink], revoked: ["REVOKED", C.ink, C.paper], expired: ["EXPIRED", C.paper, C.ink] }[state];
  const kind = { wallet: "WALLET", x: "X HANDLE", badge: "BADGE" }[cert.kind] || "SUBJECT";
  const big = amt.length > 7 ? 150 : 196;
  const strike = state === "revoked" ? `<rect x="64" y="${380 - big * 0.36 - 7}" width="${Math.min(560, amt.length * big * 0.47)}" height="14" fill="${C.ink}"/>` : "";
  const inner = `
  <rect x="28" y="28" width="${W - 56}" height="64" fill="${C.ink}"/>
  <text x="64" y="70" font-family="${TEXT}" font-weight="700" font-size="24" fill="${C.paper}" letter-spacing="1">PROOF OF FUNDS</text>
  <text x="${W - 64}" y="70" font-family="${MONO}" font-size="20" fill="${C.paper}" text-anchor="end">read live at slot ${num(slot)}</text>
  <text x="64" y="150" font-family="${TEXT}" font-weight="700" font-size="22" letter-spacing="2" fill="${C.ink}">${kind}</text>
  <text x="64" y="186" font-family="${MONO}" font-size="30" fill="${C.ink}">${esc(subjectText)}</text>
  <path d="M 66 ${380 - big * 0.62} L ${66 + big * 0.24} ${380 - big * 0.49} L 66 ${380 - big * 0.36} M 66 ${380 - big * 0.22} L ${66 + big * 0.24} ${380 - big * 0.22}" stroke="${C.ink}" stroke-width="${Math.round(big * 0.07)}" fill="none" stroke-linecap="square" stroke-linejoin="miter"/>
  <text x="${58 + big * 0.36}" y="${380}" font-family="${DISPLAY}" font-weight="800" font-size="${big}" letter-spacing="-6" fill="${C.ink}">${esc(amt)}</text>
  ${strike}
  <text x="64" y="${440}" font-family="${DISPLAY}" font-weight="800" font-size="54" fill="${C.ink}">${esc(sym)}</text>
  <rect x="64" y="486" width="${pill[0].length * 19 + 40}" height="52" fill="${pill[1]}" stroke="${C.ink}" stroke-width="3"/>
  <text x="84" y="522" font-family="${TEXT}" font-weight="700" font-size="26" letter-spacing="2" fill="${pill[2]}">${pill[0]}</text>
  <text x="${64 + pill[0].length * 19 + 64}" y="522" font-family="${MONO}" font-size="22" fill="${C.ink}">${state === "revoked" && cert.revokedSlot ? `revoked at slot ${num(cert.revokedSlot)}` : `certified at slot ${num(cert.certifiedSlot)}`}</text>
  <text x="64" y="578" font-family="${TEXT}" font-weight="500" font-size="19" fill="${C.ink}">A minimum, never an amount. Check it live at the link.</text>`;
  return frame(inner, state);
}

/** the site's own card, and the card of a subject with no certificate */
export function plainCard({ line, sub } = {}) {
  const inner = `
  <text x="64" y="118" font-family="${TEXT}" font-weight="700" font-size="24" letter-spacing="2" fill="${C.ink}">PROOF OF FUNDS</text>
  <text x="58" y="290" font-family="${DISPLAY}" font-weight="800" font-size="150" letter-spacing="-6" fill="${C.ink}">Post proof,</text>
  <text x="58" y="430" font-family="${DISPLAY}" font-weight="800" font-size="150" letter-spacing="-6" fill="${C.ink}">not <tspan fill="${C.signal}">wallet.</tspan></text>
  <text x="64" y="520" font-family="${TEXT}" font-weight="500" font-size="22" fill="${C.ink}">${esc(line || "A live certificate that you hold at least a tier.")}</text>
  <text x="64" y="556" font-family="${TEXT}" font-weight="500" font-size="22" fill="${C.ink}">${esc(sub || "Never the amount. Revoked the moment the money moves.")}</text>`;
  return frame(inner, "live");
}

async function toPng(svg) {
  const r = await renderer();
  const out = new r.Resvg(svg, { fitTo: { mode: "width", value: W }, font: { fontBuffers: fonts, loadSystemFonts: false, defaultFontFamily: TEXT } });
  return Buffer.from(out.render().asPng());
}

async function lookup(subject) {
  const { getClient, lookupSubject } = await import("./v1/_lib.js");
  return lookupSubject(getClient(process.env), subject, {});
}

export default async function handler(req, res) {
  const url = new URL(req.url, "http://x");
  let subject = decodeURIComponent(url.searchParams.get("subject") || "");
  let fmt = "png";
  const m = /\.(png|svg)$/i.exec(subject);
  if (m) { fmt = m[1].toLowerCase(); subject = subject.slice(0, -m[0].length); }
  let svg, cache = "public, max-age=0, s-maxage=30, stale-while-revalidate=120";
  try {
    if (!subject || subject === "proof-of-funds") { svg = plainCard(); cache = "public, max-age=3600, s-maxage=86400"; }
    else {
      const look = await lookup(subject);
      const cert = look.certificates[0];
      const shown = cert && cert.subject ? (cert.kind === "x" ? "@" + cert.subject : short(cert.subject, 8)) : subject.startsWith("@") ? subject : short(subject.replace(/^(wallet|badge|x):/, ""), 8);
      svg = cert ? certificateCard({ cert, subjectText: shown, slot: look.slot }) : plainCard({ line: `${shown}: no certificate on chain right now.`, sub: "Anyone can check a subject live. Nothing to see is also an answer." });
    }
  } catch {
    svg = plainCard();
    cache = "public, max-age=0, s-maxage=15";
  }
  res.statusCode = 200;
  res.setHeader("cache-control", cache);
  res.setHeader("access-control-allow-origin", "*");
  if (fmt === "svg") { res.setHeader("content-type", "image/svg+xml; charset=utf-8"); return res.end(svg); }
  res.setHeader("content-type", "image/png");
  res.end(await toPng(svg));
}
