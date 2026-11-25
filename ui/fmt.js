/* Formatting and tiny DOM helpers shared by every page. No fixed times anywhere: durations are counted in slots and
   shown as rounded spans ("about 4 min"); a date appears only when data is old ("as of 2026-11-25"). */

export const SLOT_SECONDS = 0.4;
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const h = (strings, ...vals) => strings.reduce((a, s, i) => a + s + (i < vals.length ? (vals[i] && vals[i].__html !== undefined ? vals[i].__html : esc(vals[i])) : ''), '');
export const raw = html => ({ __html: html });

const NF = new Intl.NumberFormat('en-US');
export const num = n => (n === null || n === undefined || Number.isNaN(Number(n)) ? '0' : NF.format(Number(n)));
export const short = (a, n = 4) => (a && a.length > 2 * n + 3 ? `${a.slice(0, n)}…${a.slice(-n)}` : a || '');

/** "≥ 1,000 SOL" → { ge: '≥', amt: '1,000', sym: 'SOL' } */
export function tierParts(label, asset) {
  const m = /^(≥)?\s*([\d,.]+)\s*(\w+)?/.exec(String(label || ''));
  if (!m) return { ge: '≥', amt: String(label || '?'), sym: asset || '' };
  return { ge: '≥', amt: m[2], sym: m[3] || asset || '' };
}
export const TIERS = {
  SOL: ['1', '10', '100', '1,000', '10,000'],
  USDC: ['100', '1,000', '10,000', '100,000', '1,000,000'],
};
export const tierLabel = (asset, tier) => `≥ ${TIERS[asset]?.[tier - 1] ?? '?'} ${asset}`;
/** a tier label for display type: "≥ 1,000 SOL" → "at least 1,000 SOL" (the display face has no ≥) */
export const atLeast = label => String(label || '').replace(/^≥\s*/, 'at least ');

/** slots → "about 4 min" / "about 2 h" / "about 3 days" */
export function span(slots) {
  const s = Math.max(0, Number(slots) * SLOT_SECONDS);
  if (s < 90) return `about ${Math.max(1, Math.round(s))} s`;
  if (s < 90 * 60) return `about ${Math.round(s / 60)} min`;
  if (s < 36 * 3600) return `about ${Math.round(s / 3600)} h`;
  return `about ${Math.round(s / 86400)} days`;
}
/** a slot relative to now: "312 slots ago (about 2 min)" */
export function ago(slot, now) {
  if (!slot || !now) return '';
  const d = Number(now) - Number(slot);
  if (d < 0) return `in ${num(-d)} slots (${span(-d)})`;
  return `${num(d)} slots ago (${span(d)})`;
}
export const STATUS_TEXT = { live: 'Live', revoked_spent: 'Revoked: funds moved', revoked_by_holder: 'Revoked by holder', expired: 'Expired', voided: 'Voided: signing key revoked', settling: 'Settling', none: 'No certificate' };
export const STATUS_SHORT = { live: 'Live', revoked_spent: 'Revoked', revoked_by_holder: 'Revoked', expired: 'Expired', voided: 'Voided', settling: 'Settling' };
export const KIND_TEXT = { wallet: 'Wallet', x: 'X handle', badge: 'Badge' };

/** what a subject looks like on a card: a wallet and a badge show their key; an X handle shows only its hash */
export function subjectLine(c) {
  if (c.subject) return c.kind === 'x' ? '@' + String(c.subject).replace(/^@/, '') : c.subject;
  if (c.kind === 'wallet' || c.kind === 'badge') return c.controller && c.controller !== '11111111111111111111111111111111' ? c.controller : c.subjectHash;
  return c.subjectHash;
}
/** the /c/ path for a certificate */
export function certPath(c) {
  if (c.subject) return c.kind === 'x' ? `/c/@${encodeURIComponent(String(c.subject).replace(/^@/, ''))}` : `/c/${c.kind}:${encodeURIComponent(c.subject)}`;
  if ((c.kind === 'wallet' || c.kind === 'badge') && c.controller && c.controller !== '11111111111111111111111111111111') return `/c/${c.kind}:${c.controller}`;
  return `/c/${c.subjectHash}`;
}

export function toast(text) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = text; t.classList.add('on');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 2200);
}
export async function copy(text, label = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(label); }
  catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text }); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast(label); } catch { toast('Copy failed'); } ta.remove();
  }
}
/** animate a number from its current text to n */
export function roll(el, n, { ms = 700 } = {}) {
  if (!el) return;
  const from = Number(String(el.dataset.v ?? el.textContent).replace(/[^\d.-]/g, '')) || 0;
  el.dataset.v = n;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || from === n || !Number.isFinite(from)) { el.textContent = num(n); return; }
  const t0 = performance.now();
  const step = t => { const k = Math.min(1, (t - t0) / ms); const e = 1 - Math.pow(1 - k, 3); el.textContent = num(Math.round(from + (n - from) * e)); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
export const sleep = ms => new Promise(r => setTimeout(r, ms));
/** data older than 2 h shows its date */
export function asOf(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || Date.now() - t < 2 * 3600e3) return '';
  return `as of ${new Date(t).toISOString().slice(0, 10)}`;
}
