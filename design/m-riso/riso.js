/* The press: a two-ink risograph made in code. Every figure on the page is two plates (blue, fluorescent pink) printed
   on one sheet with multiply, so where they overlap a third colour appears. Halftones are real screens: dots on a rotated
   grid, the dot's area equal to the tone, cut as one SVG path per plate (crisp at any size). Registration is a transform
   on each plate: a live certificate is printed in register, a revoked one drifts off. Nothing random: every figure is the
   same on every load. */
import { gapDash, BREAK } from '/ui/seal.js';

export const INK = { blue: '#2b318f', pink: '#ff4aa5', paper: '#f3ebdb' };
const f = n => Math.round(n * 100) / 100;

/* ------------------------------------------------------------------ halftone screens */
/** tone helpers: (x, y) → coverage 0..1 */
export const tone = {
  flat: t => () => t,
  linear: (x0, y0, t0, x1, y1, t1) => (x, y) => {
    const dx = x1 - x0, dy = y1 - y0, L = dx * dx + dy * dy;
    const k = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / L));
    return t0 + (t1 - t0) * k;
  },
  radial: (cx, cy, r, t0, t1) => (x, y) => {
    const k = Math.min(1, Math.hypot(x - cx, y - cy) / r);
    return t0 + (t1 - t0) * k;
  },
};
/** inside tests for the shapes a screen is cut to */
export const shape = {
  disc: (cx, cy, r) => ({ box: [cx - r, cy - r, cx + r, cy + r], in: (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r }),
  ring: (cx, cy, r0, r1) => ({ box: [cx - r1, cy - r1, cx + r1, cy + r1], in: (x, y) => { const d = (x - cx) ** 2 + (y - cy) ** 2; return d >= r0 * r0 && d <= r1 * r1; } }),
  rect: (x0, y0, w, h) => ({ box: [x0, y0, x0 + w, y0 + h], in: (x, y) => x >= x0 && x <= x0 + w && y >= y0 && y <= y0 + h }),
  /** points in a but not in b */
  minus: (a, b) => ({ box: a.box, in: (x, y) => a.in(x, y) && !b.in(x, y) }),
};
/** one screen: dots on a grid at `angle` degrees with `pitch` px between centres; returns path data */
export function screen(sh, { pitch = 6, angle = 15, tone: t = tone.flat(0.4), max = 0.72 } = {}) {
  const [x0, y0, x1, y1] = sh.box;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const R = Math.hypot(x1 - x0, y1 - y0) / 2 + pitch;
  const a = angle * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  const n = Math.ceil(R / pitch);
  let d = '';
  for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
    const u = i * pitch, v = j * pitch;
    const x = cx + u * ca - v * sa, y = cy + u * sa + v * ca;
    if (!sh.in(x, y)) continue;
    const k = Math.max(0, Math.min(max, t(x, y)));
    if (k < 0.015) continue;
    const r = pitch * Math.sqrt(k / Math.PI);
    d += `M${f(x - r)} ${f(y)}a${f(r)} ${f(r)} 0 1 0 ${f(2 * r)} 0a${f(r)} ${f(r)} 0 1 0 ${f(-2 * r)} 0`;
  }
  return d;
}

/* ------------------------------------------------------------------ marks */
/** a printer's registration mark: a hair circle and a cross */
export const regMark = (x, y, s = 13, ink = INK.blue) =>
  `<g stroke="${ink}" stroke-width="1" fill="none"><circle cx="${x}" cy="${y}" r="${s * 0.55}"/><path d="M${x - s} ${y}H${x + s}M${x} ${y - s}V${y + s}"/></g>`;
/** a ring with the protocol's one clean break (the 36° gap at 315°, as on the seal) when `broken` */
export function ring(cx, cy, r, w, ink, broken = false) {
  if (!broken) return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${ink}" stroke-width="${w}"/>`;
  const g = gapDash(r, BREAK.deg, BREAK.at);
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${ink}" stroke-width="${w}" stroke-dasharray="${g.dasharray}" stroke-dashoffset="${g.dashoffset}"/>`;
}
/** a deterministic byte stream (mulberry32) for the attestation matrix */
export function bytes(seed, n) {
  let s = seed >>> 0; const out = [];
  for (let i = 0; i < n; i++) {
    s = (s + 0x6d2b79f5) >>> 0; let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out.push(((t ^ (t >>> 14)) >>> 0) & 255);
  }
  return out;
}

/* ------------------------------------------------------------------ plates and figures */
/** one plate as an inline SVG; `ink` is 'blue' or 'pink' */
export const plate = (ink, vb, body, extra = '') =>
  `<svg class="plate p-${ink}" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"${extra}>${body}</svg>`;

/** mount a figure: `figs` is { blue, pink } SVG bodies; reg is 'in', 'out' or 'enter' (prints off, slides into register) */
export function figure(el, vb, { blue, pink }) {
  el.insertAdjacentHTML('afterbegin', plate('blue', vb, blue) + plate('pink', vb, pink));
}
