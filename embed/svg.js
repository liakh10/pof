// The server-rendered status badge: GET /v1/badge/{subject}.svg. Plain on purpose; the palette lives in THEMES only,
// so the site can restyle it in one place.
export const THEMES = {
  light: { bg: "#f4f3ee", fg: "#15161a", label: "#5d6068", line: "#d9d7cf", live: "#0f6b3a", revoked: "#9b1c1c", none: "#5d6068" },
  dark: { bg: "#141518", fg: "#ecebe6", label: "#9a9ca3", line: "#2b2d31", live: "#4fc184", revoked: "#f07a7a", none: "#9a9ca3" },
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// average advance of the 11px system sans at this size; generous so text never clips
const width = (s) => Math.ceil([...s].reduce((n, c) => n + (/[A-Z0-9≥@#]/.test(c) ? 7.4 : /[ .,:·il|]/.test(c) ? 3.6 : 6.4), 0));

/**
 * @param {{ subject: string, state: "live"|"revoked"|"expired"|"below"|"none", tierLabel?: string|null, slot?: number|null,
 *           revokedSlot?: number|null, theme?: string }} b
 */
export function renderBadge(b) {
  const t = THEMES[b.theme] ?? THEMES.light;
  const label = "PROOF OF FUNDS";
  const who = b.subject.length > 28 ? `${b.subject.slice(0, 12)}…${b.subject.slice(-8)}` : b.subject;
  const state = {
    live: "LIVE",
    revoked: b.revokedSlot ? `REVOKED · slot ${b.revokedSlot}` : "REVOKED",
    expired: "EXPIRED",
    below: "BELOW TIER",
    voided: "VOIDED",
    settling: "SETTLING",
    none: "NO CERTIFICATE",
  }[b.state];
  const color = b.state === "live" ? t.live : b.state === "none" || b.state === "settling" ? t.none : t.revoked;
  const middle = [who, b.tierLabel].filter(Boolean).join(" · ");
  const pad = 10;
  const w1 = width(label) + pad * 2;
  const w2 = width(middle) + pad * 2;
  const w3 = width(state) + pad * 2 + 10;
  const W = w1 + w2 + w3;
  const H = 24;
  const title = `${b.subject}: ${b.tierLabel ? `${b.tierLabel}, ` : ""}${state}${b.slot ? ` (as of slot ${b.slot})` : ""}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="4" fill="${t.bg}" stroke="${t.line}"/>
<line x1="${w1}" y1="1" x2="${w1}" y2="${H - 1}" stroke="${t.line}"/>
<line x1="${w1 + w2}" y1="1" x2="${w1 + w2}" y2="${H - 1}" stroke="${t.line}"/>
<g font-family="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="11" dominant-baseline="central">
<text x="${pad}" y="${H / 2}" fill="${t.label}" letter-spacing="0.6">${esc(label)}</text>
<text x="${w1 + pad}" y="${H / 2}" fill="${t.fg}">${esc(middle)}</text>
<circle cx="${w1 + w2 + pad + 3}" cy="${H / 2}" r="3" fill="${color}"/>
<text x="${w1 + w2 + pad + 10}" y="${H / 2}" fill="${color}" font-weight="600">${esc(state)}</text>
</g>
</svg>`;
}

/** Map a /v1/certificates answer to the badge's state. */
export function badgeState(answer, { asset, minTier } = {}) {
  let certs = answer.certificates ?? [];
  if (asset !== undefined) certs = certs.filter((c) => c.assetId === asset);
  const c = certs[0] ?? null; // the API sorts live first, then highest tier
  if (!c) return { state: "none", tierLabel: null, revokedSlot: null };
  if (c.status === "revoked_spent" || c.status === "revoked_by_holder") return { state: "revoked", tierLabel: c.tierLabel, revokedSlot: c.revokedSlot };
  if (c.status === "expired") return { state: "expired", tierLabel: c.tierLabel, revokedSlot: null };
  if (c.status === "voided") return { state: "voided", tierLabel: c.tierLabel, revokedSlot: c.revokedSlot };
  if (c.status === "settling") return { state: "settling", tierLabel: c.tierLabel, revokedSlot: null };
  if (minTier !== undefined && c.tier < minTier) return { state: "below", tierLabel: c.tierLabel, revokedSlot: null };
  return { state: "live", tierLabel: c.tierLabel, revokedSlot: null };
}
