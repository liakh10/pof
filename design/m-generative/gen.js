/* m-generative: the drawing engine. Everything on the page is drawn here, live, from real values: the field from the
   latest Solana blockhash and the slot, every certificate mark from its 32-byte subject hash. Pure canvas, hairlines only.
   Deterministic: the same bytes always draw the same picture. */

export const INK = '#0a0c10';
export const LINE = [236, 229, 214];           // warm off-white, the plotter pen
export const ACCENT = [255, 104, 46];          // the one accent: the signal
export const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const TAU = Math.PI * 2;

/* ------------------------------------------------------------------ seeded randomness (sfc32 from up to 16 bytes) */
export function rng(bytes) {
  const b = bytes && bytes.length ? bytes : Uint8Array.of(7, 3, 1, 9);
  const w = i => (b[i % b.length] | (b[(i + 1) % b.length] << 8) | (b[(i + 2) % b.length] << 16) | (b[(i + 3) % b.length] << 24)) >>> 0;
  let a = w(0), c = w(4), d = w(8), e = w(12);
  const next = () => {
    a >>>= 0; c >>>= 0; d >>>= 0; e >>>= 0;
    let t = (a + c) | 0; a = c ^ (c >>> 9); c = (d + (d << 3)) | 0; d = (d << 21) | (d >>> 11); e = (e + 1) | 0; t = (t + e) | 0; d = (d + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  return next;
}
export const bit = (bytes, i) => (bytes[(i >> 3) % bytes.length] >> (7 - (i & 7))) & 1;
export function hexBytes(hex) {
  const s = String(hex || '').replace(/^0x/, '');
  const out = new Uint8Array(Math.floor(s.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16) || 0;
  return out;
}
export async function sha(text) { return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))); }

/* a smooth 1-D value noise on a circle, seeded */
function ringNoise(r, n = 8) {
  const k = Array.from({ length: n }, () => [r() * TAU, 0.4 + r() * 0.6]);
  return phi => { let s = 0; for (let i = 0; i < n; i++) s += Math.sin(phi * (i + 1) + k[i][0]) * k[i][1] / (i + 1); return s; };
}

/* ------------------------------------------------------------------ canvas sizing */
export function fit(canvas) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const r = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h, dpr };
}

/* ==================================================================================================================
   THE MARK. 32 bytes → eight rings of 32 bits each (a 1 is drawn arc, a 0 is a gap), radial ties where a bit is set on two
   neighbouring rings, a hypotrochoid at the centre (its ratio and pen distance from the hash), and the tier band outside:
   one hairline per tier step. The innermost tier line carries the accent while the certificate is live.
   Revoked: every arc unspools into a straight tangent strand, the ties let go, the tier band opens at 315°.
   ================================================================================================================== */
export function markGeometry(bytes, { tier = 3, asset = 'SOL' } = {}) {
  const b = bytes.length >= 32 ? bytes : Uint8Array.from({ length: 32 }, (_, i) => bytes[i % Math.max(1, bytes.length)] || 0);
  const r = rng(b);
  const seg = TAU / 32;
  const rings = [];
  for (let k = 0; k < 8; k++) {
    const rad = 0.34 + k * 0.074;
    const rot = (b[(k * 5 + 3) % 32] / 256) * seg * (k % 2 ? 1 : -1) - Math.PI / 2;
    const bits = Array.from({ length: 32 }, (_, i) => bit(b, k * 32 + i));
    const arcs = [];
    for (let i = 0; i < 32; i++) {
      if (!bits[i] || (i > 0 && bits[i - 1])) continue;
      let j = i; while (j + 1 < 32 && bits[j + 1]) j++;
      arcs.push({ a0: rot + i * seg + 0.018, a1: rot + (j + 1) * seg - 0.018, spin: r(), droop: (r() - 0.5) * 0.9, lag: r() });
    }
    if (bits[0] && bits[31] && arcs.length > 1) { const first = arcs.shift(); arcs[arcs.length - 1].a1 = first.a1 + TAU; }
    rings.push({ rad, rot, bits, arcs, pen: (b[(k * 3 + 11) % 32] >> 2) % 3 });
  }
  const ties = [];
  for (let k = 0; k < 7; k++) for (let i = 0; i < 32; i++) {
    if (rings[k].bits[i] && rings[k + 1].bits[i] && (b[(k * 7 + i) % 32] & 3) === 0) {
      const a = rings[k].rot + (i + 0.5) * seg;
      ties.push({ a, r0: rings[k].rad, r1: rings[k + 1].rad, lag: r() });
    }
  }
  // the centre: a hypotrochoid. q lobes, p/q ratio, pen distance d
  const q = 3 + (b[0] % 7), p = 1 + (b[1] % (q - 1));
  const g = (x, y) => (y ? g(y, x % y) : x);
  const pp = g(p, q) === 1 ? p : 1;
  const d = 0.35 + (b[2] / 255) * 0.75;
  const turns = pp;
  return { b, rings, ties, rose: { q, p: pp, d, turns }, tier: Math.max(1, Math.min(5, tier)), asset };
}

/** draw a mark. state: live | revoked | expired; t: 0..1 how far it has come apart (revoked), draw: 0..1 how far it is drawn */
export function drawMark(ctx, cx, cy, R, geo, { state = 'live', t = state === 'revoked' ? 1 : 0, draw = 1, lw = 1, alpha = 1, accent = true } = {}) {
  const dim = state === 'expired' ? 0.34 : 1;
  const A = a => rgba(LINE, a * alpha * dim);
  const ease = x => x * x * (3 - 2 * x);
  const u = ease(Math.max(0, Math.min(1, t)));
  ctx.save();
  ctx.lineCap = 'butt'; ctx.lineJoin = 'round';

  // the outer hair and the crosshair registration
  ctx.lineWidth = 0.6 * lw; ctx.strokeStyle = A(0.22);
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU * Math.min(1, draw * 1.4)); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - R * 1.04, cy); ctx.lineTo(cx - R * 0.9, cy); ctx.moveTo(cx + R * 0.9, cy); ctx.lineTo(cx + R * 1.04, cy);
  ctx.moveTo(cx, cy - R * 1.04); ctx.lineTo(cx, cy - R * 0.9); ctx.moveTo(cx, cy + R * 0.9); ctx.lineTo(cx, cy + R * 1.04); ctx.stroke();

  // the tier band: one hair per tier step, SOL whole, USDC dotted; the inner line in the accent while live
  const brk = 315 * Math.PI / 180, gap = (36 * Math.PI / 180) * u;
  for (let j = 0; j < geo.tier; j++) {
    const rr = R * (0.955 - j * 0.03);
    const live = j === 0 && state === 'live' && accent;
    const open = j === 0 && state === 'revoked';
    ctx.lineWidth = (live ? 1.25 : 0.7) * lw;
    ctx.strokeStyle = live ? rgba(ACCENT, alpha) : open ? A(0.55 - 0.25 * u) : A(0.5);
    if (geo.asset === 'USDC' && !live && !open) ctx.setLineDash([1.2 * lw, 2.4 * lw]); else ctx.setLineDash([]);
    ctx.beginPath();
    const span = TAU * Math.min(1, Math.max(0, draw * 1.25 - j * 0.04));
    if (open && gap > 0.001) ctx.arc(cx, cy, rr, brk + gap / 2, brk - gap / 2 + TAU);
    else ctx.arc(cx, cy, rr, -Math.PI / 2, -Math.PI / 2 + span);
    ctx.stroke();
    if (open && u > 0) { // the two loose ends of the break, falling out
      for (const s of [-1, 1]) {
        const a = brk + s * gap / 2;
        const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
        const tx = -Math.sin(a) * s, ty = Math.cos(a) * s;
        const L = R * 0.16 * u;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.quadraticCurveTo(px - tx * L * 0.5, py - ty * L * 0.5, px - tx * L + Math.cos(a) * L * 0.6, py - ty * L + Math.sin(a) * L * 0.6); ctx.stroke();
      }
    }
  }
  ctx.setLineDash([]);

  // the eight bit-rings. Each ring takes one of three pens from the hash: a single hair, a double hair, or a hatch of
  // radial ticks; so two subjects differ in texture as well as in pattern
  geo.rings.forEach((ring, k) => {
    const rr = R * ring.rad, pen = ring.pen, dl = R * 0.0105;
    for (const arc of ring.arcs) {
      const local = Math.max(0, Math.min(1, (draw - k * 0.06) / 0.5));
      if (local <= 0) continue;
      const a1d = arc.a0 + (arc.a1 - arc.a0) * local;
      const ku = u <= 0 ? 0 : Math.max(0, Math.min(1, (u - arc.lag * 0.35) / 0.65));
      // unspool: the arc keeps [a0, cut], the rest leaves along the tangent as a strand, drooping a little
      const cut = a1d - (a1d - arc.a0) * ku * (0.55 + arc.spin * 0.45);
      const grow = 1 + ku * 0.04 * (arc.spin - 0.3);
      const alpha = 0.9 - k * 0.03 - u * 0.32;
      const strand = (r0, w) => {
        ctx.lineWidth = w;
        ctx.beginPath(); ctx.arc(cx, cy, r0, arc.a0, cut);
        if (ku > 0) {
          const px = cx + Math.cos(cut) * r0, py = cy + Math.sin(cut) * r0;
          const len = r0 * (a1d - cut);
          const dir = cut + Math.PI / 2 + arc.droop * ku;
          const mx = px + Math.cos(cut + Math.PI / 2) * len * 0.5, my = py + Math.sin(cut + Math.PI / 2) * len * 0.5;
          ctx.quadraticCurveTo(mx, my, px + Math.cos(dir) * len, py + Math.sin(dir) * len);
        }
        ctx.stroke();
      };
      ctx.strokeStyle = A(alpha);
      if (pen === 0) strand(rr * grow, 0.9 * lw);
      else if (pen === 1) { strand((rr - dl * 0.55) * grow, 0.6 * lw); strand((rr + dl * 0.55) * grow, 0.6 * lw); }
      else {
        // hatch: a tick every 1.6 degrees across the ring's width, then the strand if it is coming apart
        const step = (1.25 * Math.PI) / 180, r0 = rr * grow;
        ctx.lineWidth = 0.55 * lw; ctx.beginPath();
        for (let a = arc.a0; a <= cut + 1e-6; a += step) {
          ctx.moveTo(cx + Math.cos(a) * (r0 - dl * 0.8), cy + Math.sin(a) * (r0 - dl * 0.8));
          ctx.lineTo(cx + Math.cos(a) * (r0 + dl * 0.8), cy + Math.sin(a) * (r0 + dl * 0.8));
        }
        ctx.stroke();
        if (ku > 0) { ctx.strokeStyle = A(alpha * 0.7); strand(r0, 0.5 * lw); }
      }
    }
  });

  // the ties between rings
  ctx.lineWidth = 0.6 * lw;
  for (const tie of geo.ties) {
    const local = Math.max(0, Math.min(1, (draw - 0.35) / 0.4));
    if (local <= 0) continue;
    const let_go = Math.max(0, Math.min(1, (u - tie.lag * 0.4) / 0.4));
    if (let_go >= 1) continue;
    ctx.strokeStyle = A(0.55 * (1 - let_go));
    const r0 = R * tie.r0, r1 = R * (tie.r0 + (tie.r1 - tie.r0) * local * (1 - let_go));
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(tie.a) * r0, cy + Math.sin(tie.a) * r0); ctx.lineTo(cx + Math.cos(tie.a) * r1, cy + Math.sin(tie.a) * r1); ctx.stroke();
  }

  // the centre: a hypotrochoid traced three times at falling pen distances, a small guilloche; it loosens when revoked
  const { q, p, d } = geo.rose;
  const big = 1, small = p / q, Rr = R * 0.255;
  const N = 1100, total = TAU * p;
  const shown = Math.max(0, Math.min(1, (draw - 0.15) / 0.8)) * (1 - u * 0.55);
  [[1, 0.8, 1], [0.8, 0.5, 0.86], [0.6, 0.32, 0.72]].forEach(([dk, al, sc]) => {
    const dd = d * dk;
    ctx.lineWidth = 0.55 * lw; ctx.strokeStyle = A(al - u * 0.2);
    ctx.beginPath();
    const m = 1 / (big - small + dd * small);
    for (let i = 0; i <= N * shown; i++) {
      const th = (i / N) * total;
      let x = (big - small) * Math.cos(th) + dd * small * Math.cos(((big - small) / small) * th);
      let y = (big - small) * Math.sin(th) - dd * small * Math.sin(((big - small) / small) * th);
      const loose = 1 + u * 0.24 * Math.sin(th * 3 + geo.b[3] + dk * 4);
      x *= m * loose * sc; y *= m * loose * sc;
      const X = cx + x * Rr, Y = cy + y * Rr;
      i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
    }
    ctx.stroke();
  });
  ctx.restore();
}

/* ==================================================================================================================
   THE FIELD (hero). Two families of concentric hairline rings whose centres drift apart with the slot: the moiré between
   them is the picture. Around them, the 256 bits of the latest blockhash as a cipher ring (long tick = 1), the epoch's
   progress as the one accent arc, and a faint filing field of short strokes seeded by the same hash.
   ================================================================================================================== */
export class Field {
  constructor(canvas, { reduce = false, layout } = {}) {
    this.c = canvas; this.reduce = reduce; this.layout = layout;
    this.hash = new Uint8Array(32); this.from = new Uint8Array(32); this.switchedAt = -1e9; this.hashText = '';
    this.slot = 0; this.slotAt = 0; this.started = performance.now();
    this.filings = null; this.filingsOld = null; this.fileAt = 0;
    this.ro = new ResizeObserver(() => { this.filings = null; this.frame(performance.now(), true); }); this.ro.observe(canvas);
    this.visible = true;
    new IntersectionObserver(es => { this.visible = es[0].isIntersecting; }).observe(canvas);
    const loop = now => { if (this.visible && !document.hidden) this.frame(now); this.raf = requestAnimationFrame(loop); };
    if (!reduce) this.raf = requestAnimationFrame(loop); else this.frame(performance.now(), true);
  }
  setSlot(s) { if (s > this.slot) { this.slot = s; this.slotAt = performance.now(); if (this.reduce) this.frame(performance.now(), true); } }
  setHash(bytes, text) {
    if (!bytes || bytes.length < 32) return;
    if (this.hashText === text) return;
    const first = !this.hashText;
    this.from = first ? bytes : this.hash; this.hash = bytes; this.hashText = text; this.switchedAt = first ? -1e9 : performance.now();
    this.filingsOld = first ? null : this.filings; this.filings = null; this.fileAt = performance.now();
    if (this.reduce) this.frame(performance.now(), true);
  }
  slotF(now) { return this.slot + (this.reduce ? 0 : Math.min(3, (now - this.slotAt) / 400)); }
  geometry(w, h) {
    const L = this.layout ? this.layout(w, h) : { cx: w * 0.7, cy: h * 0.52, R: Math.min(w, h) * 0.36 };
    return L;
  }
  buildFilings(w, h, bytes) {
    const off = document.createElement('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    off.width = Math.round(w * dpr); off.height = Math.round(h * dpr);
    const x = off.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0);
    const r = rng(bytes.slice(16));
    const n1 = ringNoise(rng(bytes), 6), n2 = ringNoise(rng(bytes.slice(8)), 6);
    const { cx, cy, R } = this.geometry(w, h);
    const step = w < 700 ? 15 : 17;
    x.lineWidth = 0.55; x.lineCap = 'round';
    for (let yy = step / 2; yy < h; yy += step) for (let xx = step / 2; xx < w; xx += step) {
      const jx = xx + (r() - 0.5) * step * 0.7, jy = yy + (r() - 0.5) * step * 0.7;
      const dx = jx - cx, dy = jy - cy, dist = Math.hypot(dx, dy);
      if (dist < R * 1.32) continue;
      // the strokes swirl around the rings, bent by two noises of the hash
      const base = Math.atan2(dy, dx) + Math.PI / 2;
      const a = base + n1(jx / w * 5) * 0.9 + n2(jy / h * 5) * 0.9;
      const fade = Math.min(1, (dist - R * 1.32) / (R * 0.5));
      const left = w > 900 ? Math.min(1, Math.max(0.16, (jx - w * 0.06) / (w * 0.5))) : 0.5;
      const len = step * (0.42 + r() * 0.3);
      x.strokeStyle = rgba(LINE, 0.2 * fade * left);
      x.beginPath(); x.moveTo(jx - Math.cos(a) * len / 2, jy - Math.sin(a) * len / 2); x.lineTo(jx + Math.cos(a) * len / 2, jy + Math.sin(a) * len / 2); x.stroke();
    }
    return off;
  }
  frame(now, force = false) {
    const { ctx, w, h } = fit(this.c);
    const { cx, cy, R } = this.geometry(w, h);
    ctx.clearRect(0, 0, w, h);
    const sf = this.slotF(now);

    // filings, cross-fading when a new blockhash arrives
    if (!this.filings) this.filings = this.buildFilings(w, h, this.hash);
    const fk = this.reduce ? 1 : Math.min(1, (now - this.fileAt) / 1800);
    if (this.filingsOld && fk < 1) { ctx.globalAlpha = 1 - fk; ctx.drawImage(this.filingsOld, 0, 0, w, h); }
    ctx.globalAlpha = this.filingsOld ? fk : 1; ctx.drawImage(this.filings, 0, 0, w, h); ctx.globalAlpha = 1;
    if (fk >= 1) this.filingsOld = null;

    // registration lines through the centre
    ctx.lineWidth = 0.5; ctx.strokeStyle = rgba(LINE, 0.13);
    const vTop = w < 720 ? Math.max(0, cy - R * 1.32) : 0;
    ctx.beginPath(); ctx.moveTo(0, cy + 0.5); ctx.lineTo(w, cy + 0.5); ctx.moveTo(cx + 0.5, vTop); ctx.lineTo(cx + 0.5, h); ctx.stroke();

    // the two ring families
    const hb = this.hash;
    const s = Math.max(3.6, R / 74);                     // ring pitch
    const n = Math.floor(R / s);
    const theta = TAU * ((sf % 720) / 720) + (hb[4] / 255) * TAU;   // one turn every 720 slots (about 5 min)
    const D = s * (7 + 3 * Math.sin(sf / 160 + hb[5] / 40));          // how far apart the centres sit
    const bx = cx + Math.cos(theta) * D, by = cy + Math.sin(theta) * D;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip();
    ctx.lineWidth = 0.75;
    for (let i = 1; i <= n; i++) {
      const rr = i * s, f = rr / R;
      ctx.strokeStyle = rgba(LINE, 0.78 * (1 - Math.pow(f, 8)) * (0.6 + 0.4 * f) * (bit(hb, (i * 3) % 256) ? 1 : 0.5));
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.stroke();
    }
    const s2 = s * (1.0 + (hb[6] / 255) * 0.035);
    for (let i = 1; i <= n + 8; i++) {
      const rr = i * s2, f = Math.min(1, rr / R);
      ctx.strokeStyle = rgba(LINE, 0.6 * (1 - Math.pow(f, 8)) * (0.55 + 0.45 * f));
      ctx.beginPath(); ctx.arc(bx, by, rr, 0, TAU); ctx.stroke();
    }
    ctx.restore();

    // the edge of the disc, and the hair at its centre
    ctx.lineWidth = 0.8; ctx.strokeStyle = rgba(LINE, 0.55);
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();

    // the cipher ring: 256 bits of the blockhash; on a new hash the ticks sweep over clockwise
    const r0 = R + Math.max(10, R * 0.04), longT = Math.max(9, R * 0.042), shortT = Math.max(3, R * 0.012);
    const sweep = this.reduce ? 1 : Math.min(1, (now - this.switchedAt) / 1600);
    ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.strokeStyle = rgba(LINE, 0.28); ctx.arc(cx, cy, r0 - 4, 0, TAU); ctx.stroke();
    for (let i = 0; i < 256; i++) {
      const a = -Math.PI / 2 + (i / 256) * TAU;
      const front = i / 256;
      const k = Math.max(0, Math.min(1, (sweep - front) * 8 + 0.0));
      const was = bit(this.from, i) ? longT : shortT, is = bit(hb, i) ? longT : shortT;
      const L = was + (is - was) * (sweep >= 1 ? 1 : k);
      const on = bit(hb, i);
      ctx.strokeStyle = rgba(LINE, on ? 0.85 : 0.42);
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); ctx.lineTo(cx + Math.cos(a) * (r0 + L), cy + Math.sin(a) * (r0 + L)); ctx.stroke();
    }
    // the sweep hand, while a new hash is being written
    if (sweep < 1) {
      const a = -Math.PI / 2 + sweep * TAU;
      ctx.strokeStyle = rgba(LINE, 0.5 * (1 - sweep)); ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R * 0.2, cy + Math.sin(a) * R * 0.2); ctx.lineTo(cx + Math.cos(a) * (r0 + longT + 6), cy + Math.sin(a) * (r0 + longT + 6)); ctx.stroke();
    }

    // the epoch: 432,000 slots; its progress is the accent arc, with a fine scale of tenths
    const er = r0 + longT + Math.max(12, R * 0.05);
    const ep = this.slot ? (sf % 432000) / 432000 : 0;
    ctx.lineWidth = 0.6; ctx.strokeStyle = rgba(LINE, 0.3);
    ctx.beginPath(); ctx.arc(cx, cy, er, 0, TAU); ctx.stroke();
    for (let i = 0; i < 100; i++) {
      const a = -Math.PI / 2 + (i / 100) * TAU, L = i % 10 === 0 ? 7 : 2.5;
      ctx.strokeStyle = rgba(LINE, i % 10 === 0 ? 0.6 : 0.3);
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * er, cy + Math.sin(a) * er); ctx.lineTo(cx + Math.cos(a) * (er + L), cy + Math.sin(a) * (er + L)); ctx.stroke();
    }
    if (this.slot) {
      ctx.strokeStyle = rgba(ACCENT, 1); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(cx, cy, er, -Math.PI / 2, -Math.PI / 2 + ep * TAU); ctx.stroke();
      const a = -Math.PI / 2 + ep * TAU;
      ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * (er - 6), cy + Math.sin(a) * (er - 6)); ctx.lineTo(cx + Math.cos(a) * (er + 12), cy + Math.sin(a) * (er + 12)); ctx.stroke();
      ctx.fillStyle = rgba(ACCENT, 1); ctx.beginPath(); ctx.arc(cx + Math.cos(a) * (er + 16), cy + Math.sin(a) * (er + 16), 1.8, 0, TAU); ctx.fill();
    }

    // the two centres, as fine crosses
    const cross = (x, y, k, a) => { ctx.strokeStyle = rgba(LINE, a); ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(x - k, y); ctx.lineTo(x + k, y); ctx.moveTo(x, y - k); ctx.lineTo(x, y + k); ctx.stroke(); };
    cross(cx, cy, 7, 0.9); cross(bx, by, 4, 0.6);
    this.info = { cx, cy, R, er, ep, D, s, n, theta };
    this.onframe && this.onframe(this.info);
  }
}

/* ==================================================================================================================
   THE FIVE DIAGRAMS (how it works). Each is a scene: draw(ctx, w, h, time in s). Seeded from the blockhash too.
   ================================================================================================================== */
function notesFor(seed, n = 34) {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => ({ orbit: 0.3 + Math.floor(r() * 5) * 0.13, a: r() * TAU, sp: (0.05 + r() * 0.06) * (r() < 0.5 ? 1 : 1), born: r() * 6, i }));
}
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const sm = x => { x = clamp(x); return x * x * (3 - 2 * x); };

export const scenes = {
  /* 01 shield: notes arrive along spirals and settle on the vault's orbits; all the same size, the amounts never show */
  shield(seed) {
    const notes = notesFor(seed, 34);
    return (ctx, w, h, t) => {
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.44;
      ctx.lineWidth = 0.6;
      for (let k = 0; k < 5; k++) { ctx.strokeStyle = rgba(LINE, 0.2); ctx.beginPath(); ctx.arc(cx, cy, R * (0.3 + k * 0.13), 0, TAU); ctx.stroke(); }
      ctx.strokeStyle = rgba(LINE, 0.5); ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(cx, cy, R * 0.92, 0, TAU); ctx.stroke();
      for (let i = 0; i < 72; i++) { const a = (i / 72) * TAU; ctx.strokeStyle = rgba(LINE, 0.35); ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R * 0.92, cy + Math.sin(a) * R * 0.92); ctx.lineTo(cx + Math.cos(a) * R * (i % 6 ? 0.95 : 0.985), cy + Math.sin(a) * R * (i % 6 ? 0.95 : 0.985)); ctx.stroke(); }
      const cyc = t % 10;
      for (const n of notes) {
        const k = sm((cyc - n.born * 0.8) / 2.2);
        if (k <= 0) continue;
        const a = n.a + t * n.sp;
        const rr = R * (n.orbit + (1 - k) * 1.1);
        const aa = a - (1 - k) * 2.2;
        const x = cx + Math.cos(aa) * rr, y = cy + Math.sin(aa) * rr;
        // the trail
        ctx.strokeStyle = rgba(LINE, 0.25 * k * (cyc > 9 ? (10 - cyc) : 1)); ctx.lineWidth = 0.5; ctx.beginPath();
        for (let j = 0; j <= 24; j++) { const kk = Math.max(0, k - j * 0.02), r2 = R * (n.orbit + (1 - kk) * 1.1), a2 = a - j * 0.02 - (1 - kk) * 2.2; const X = cx + Math.cos(a2) * r2, Y = cy + Math.sin(a2) * r2; j ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
        ctx.stroke();
        ctx.strokeStyle = rgba(LINE, 0.9 * (cyc > 9 ? (10 - cyc) : 1)); ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.arc(x, y, 3.2, 0, TAU); ctx.stroke();
      }
    };
  },

  /* 02 disclose: of all the notes, the fewest that reach the tier are picked; hairlines run from them to one point */
  disclose(seed) {
    const notes = notesFor(seed, 34);
    const r = rng(seed.slice(3));
    const picked = new Set(); while (picked.size < 3) picked.add(Math.floor(r() * notes.length));
    return (ctx, w, h, t) => {
      const tall = h > w * 1.1;
      const cx = tall ? w / 2 : w * 0.42, cy = tall ? h * 0.4 : h / 2, R = tall ? w * 0.44 : Math.min(w * 0.9, h) * 0.42;
      const px = tall ? w / 2 : w * 0.93, py = tall ? h * 0.92 : cy;
      const cyc = t % 8, k = sm((cyc - 0.8) / 1.6), out = cyc > 7.2 ? sm((8 - cyc) / 0.8) : 1;
      ctx.lineWidth = 0.6;
      for (let j = 0; j < 5; j++) { ctx.strokeStyle = rgba(LINE, 0.18); ctx.beginPath(); ctx.arc(cx, cy, R * (0.3 + j * 0.13) / 0.92, 0, TAU); ctx.stroke(); }
      const pts = [];
      for (const n of notes) {
        const a = n.a + t * n.sp * 0.4, rr = R * n.orbit / 0.92;
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        const on = picked.has(n.i);
        ctx.strokeStyle = rgba(LINE, on ? 0.95 : 0.85 - 0.6 * k * out); ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.arc(x, y, 3.2, 0, TAU); ctx.stroke();
        if (on) pts.push([x, y]);
      }
      for (const [x, y] of pts) {
        ctx.strokeStyle = rgba(ACCENT, out); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, 3.2 + 5 * k, 0, TAU * k); ctx.stroke();
        ctx.strokeStyle = rgba(LINE, 0.7 * k * out); ctx.lineWidth = 0.6;
        const mx = (x + px) / 2, my = (y + py) / 2;
        ctx.beginPath(); ctx.moveTo(x, y);
        if (tall) ctx.bezierCurveTo(x, my, px, my, x + (px - x) * k * k, y + (py - y) * k);
        else ctx.bezierCurveTo(mx, y, mx, py, x + (px - x) * k, y + (py - y) * k * k);
        ctx.stroke();
      }
      // the Verifier's point, and the tier it must reach
      ctx.strokeStyle = rgba(LINE, 0.9); ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(px, py, 6, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px - 10, py); ctx.lineTo(px + 10, py); ctx.moveTo(px, py - 10); ctx.lineTo(px, py + 10); ctx.stroke();
      ctx.strokeStyle = rgba(LINE, 0.35); ctx.setLineDash([2, 3]);
      ctx.beginPath(); if (tall) ctx.arc(px, py, 22 + 6 * k, Math.PI * 1.1, Math.PI * 1.9); else ctx.arc(px, py, 22 + 6 * k, Math.PI * 0.6, Math.PI * 1.4); ctx.stroke(); ctx.setLineDash([]);
    };
  },

  /* 03 attest: the Rings state tree; each disclosed leaf climbs its authentication path to the root */
  attest(seed) {
    const depth = 6, leaves = 1 << depth;
    const r = rng(seed.slice(5));
    const leaf = Math.floor(r() * leaves);
    return (ctx, w, h, t) => {
      const top = h * 0.12, bot = h * 0.86, padX = w * 0.06;
      const X = (lvl, i) => padX + (w - 2 * padX) * ((i + 0.5) / (1 << (depth - lvl)));
      const Y = lvl => bot - (bot - top) * (lvl / depth);
      const cyc = t % 7, k = sm((cyc - 0.6) / 3.6), out = cyc > 6.3 ? sm((7 - cyc) / 0.7) : 1;
      ctx.lineWidth = 0.55;
      for (let lvl = 0; lvl < depth; lvl++) {
        const n = 1 << (depth - lvl);
        for (let i = 0; i < n; i++) {
          ctx.strokeStyle = rgba(LINE, 0.28 + lvl * 0.05);
          ctx.beginPath(); ctx.moveTo(X(lvl, i), Y(lvl)); ctx.lineTo(X(lvl + 1, i >> 1), Y(lvl + 1)); ctx.stroke();
        }
      }
      for (let i = 0; i < leaves; i++) { ctx.strokeStyle = rgba(LINE, 0.6); ctx.beginPath(); ctx.moveTo(X(0, i), Y(0)); ctx.lineTo(X(0, i), Y(0) + 6); ctx.stroke(); }
      // the path, with its siblings ringed
      let idx = leaf;
      const climbed = k * depth;
      for (let lvl = 0; lvl < depth; lvl++) {
        const sib = idx ^ 1, seg = clamp(climbed - lvl);
        if (seg > 0) {
          ctx.strokeStyle = rgba(LINE, 0.8 * out); ctx.lineWidth = 0.7;
          ctx.beginPath(); ctx.arc(X(lvl, sib), Y(lvl), 3, 0, TAU); ctx.stroke();
          ctx.strokeStyle = rgba(ACCENT, out); ctx.lineWidth = 1.2;
          const x0 = X(lvl, idx), y0 = Y(lvl), x1 = X(lvl + 1, idx >> 1), y1 = Y(lvl + 1);
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + (x1 - x0) * seg, y0 + (y1 - y0) * seg); ctx.stroke();
        }
        idx >>= 1;
      }
      ctx.strokeStyle = rgba(LINE, 0.9); ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.arc(X(depth, 0), Y(depth), 5, 0, TAU); ctx.stroke();
      if (k >= 1) { ctx.strokeStyle = rgba(ACCENT, out); ctx.beginPath(); ctx.arc(X(depth, 0), Y(depth), 9, 0, TAU); ctx.stroke(); }
      ctx.strokeStyle = rgba(ACCENT, out); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(X(0, leaf), Y(0), 3.2, 0, TAU); ctx.stroke();
    };
  },

  /* 04 certify: the 240 bytes the program rebuilds, as 240 radial ticks; the mark is drawn inside them */
  certify(seed, geo) {
    const r = rng(seed.slice(7));
    const bytes = Array.from({ length: 240 }, () => Math.floor(r() * 256));
    return (ctx, w, h, t) => {
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.44;
      const cyc = t % 9, k = sm((cyc - 0.3) / 2.4), dr = sm((cyc - 2.2) / 3.2), out = cyc > 8.2 ? sm((9 - cyc) / 0.8) : 1;
      ctx.lineWidth = 0.55;
      for (let i = 0; i < 240; i++) {
        if (i / 240 > k) break;
        const a = -Math.PI / 2 + (i / 240) * TAU, L = 3 + (bytes[i] / 255) * R * 0.14;
        ctx.strokeStyle = rgba(LINE, (0.3 + (bytes[i] / 255) * 0.55) * out);
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R * 0.86, cy + Math.sin(a) * R * 0.86); ctx.lineTo(cx + Math.cos(a) * (R * 0.86 + L), cy + Math.sin(a) * (R * 0.86 + L)); ctx.stroke();
      }
      if (dr > 0) drawMark(ctx, cx, cy, R * 0.74, geo, { state: 'live', draw: dr, alpha: out });
    };
  },

  /* 05 revoke: the nullifier field; one disclosed nullifier appears on chain, the keeper proves it, the mark comes apart */
  revoke(seed, geo) {
    const r = rng(seed.slice(9));
    const cols = 11, rows = 13;
    const field = Array.from({ length: cols * rows }, () => ({ a: r() * Math.PI, d: r() }));
    const spent = Math.floor(r() * field.length);
    const disclosed = new Set([spent]); while (disclosed.size < 3) disclosed.add(Math.floor(r() * field.length));
    return (ctx, w, h, t) => {
      const tall = h > w * 0.9;
      const gx0 = tall ? w * 0.06 : w * 0.05, gw = tall ? w * 0.88 : w * 0.4, gy0 = tall ? h * 0.04 : h * 0.1, gh = tall ? h * 0.44 : h * 0.8;
      const cyc = t % 10;
      const flip = sm((cyc - 1.2) / 0.8), wire = sm((cyc - 2.0) / 1.0), un = sm((cyc - 3.0) / 2.6), out = cyc > 9.2 ? sm((10 - cyc) / 0.8) : 1;
      let sx = 0, sy = 0;
      field.forEach((f, i) => {
        const c = i % cols, rr = Math.floor(i / cols);
        const x = gx0 + gw * ((c + 0.5) / cols), y = gy0 + gh * ((rr + 0.5) / rows);
        const isS = i === spent, isD = disclosed.has(i);
        const a = isS ? f.a + (Math.PI / 2 - f.a) * flip : f.a + Math.sin(t * 0.4 + f.d * 6) * 0.08;
        const L = Math.min(gw / cols, gh / rows) * 0.36;
        ctx.strokeStyle = isS && flip > 0 ? rgba(ACCENT, out) : rgba(LINE, isD ? 0.85 : 0.38);
        ctx.lineWidth = isS ? 1.2 : 0.6;
        ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * L, y - Math.sin(a) * L); ctx.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); ctx.stroke();
        if (isD) { ctx.strokeStyle = rgba(LINE, 0.5); ctx.lineWidth = 0.5; ctx.beginPath(); ctx.arc(x, y, L + 3, 0, TAU); ctx.stroke(); }
        if (isS) { sx = x; sy = y; }
      });
      const mx = tall ? w / 2 : w * 0.74, my = tall ? h * 0.76 : h / 2, mR = tall ? Math.min(w * 0.3, h * 0.2) : Math.min(w * 0.22, h * 0.36);
      if (wire > 0) {
        ctx.strokeStyle = rgba(LINE, 0.6 * out); ctx.lineWidth = 0.6;
        const tx = tall ? mx : mx - mR * 1.05, ty = tall ? my - mR * 1.05 : my;
        const ex = sx + (tx - sx) * wire, ey = sy + (ty - sy) * wire;
        ctx.beginPath(); ctx.moveTo(sx, sy);
        if (tall) ctx.bezierCurveTo(sx, (sy + ty) / 2, tx, (sy + ty) / 2, ex, ey); else ctx.bezierCurveTo((sx + mx) / 2, sy, (sx + mx) / 2, my, ex, ey);
        ctx.stroke();
      }
      drawMark(ctx, mx, my, mR, geo, { state: un > 0 ? 'revoked' : 'live', t: un, alpha: cyc > 9.2 ? 0.25 + 0.75 * out : 1 });
    };
  },
};

/** run a scene in a canvas only while it is on screen; reduced motion draws one still at `still` seconds */
export function runScene(canvas, scene, { reduce = false, still = 5 } = {}) {
  let on = false, t0 = performance.now(), raf = 0;
  const paint = t => { const { ctx, w, h } = fit(canvas); ctx.clearRect(0, 0, w, h); scene(ctx, w, h, t); };
  const loop = now => { if (!on) return; paint((now - t0) / 1000); raf = requestAnimationFrame(loop); };
  new IntersectionObserver(es => {
    const v = es[0].isIntersecting;
    if (reduce) { if (v) paint(still); return; }
    if (v && !on) { on = true; raf = requestAnimationFrame(loop); } else if (!v) { on = false; cancelAnimationFrame(raf); }
  }, { rootMargin: '80px' }).observe(canvas);
  new ResizeObserver(() => paint(reduce ? still : (performance.now() - t0) / 1000)).observe(canvas);
}

/** a small glyph for an index row: three rings and a chord pattern from the bytes of a word */
export function drawGlyph(ctx, cx, cy, R, bytes, { alpha = 1, accent = false } = {}) {
  ctx.save(); ctx.lineWidth = 0.7;
  for (let k = 0; k < 3; k++) { ctx.strokeStyle = rgba(LINE, 0.5 * alpha); ctx.beginPath(); ctx.arc(cx, cy, R * (0.45 + k * 0.27), 0, TAU); ctx.stroke(); }
  const n = 9 + (bytes[0] % 7);
  ctx.strokeStyle = accent ? rgba(ACCENT, alpha) : rgba(LINE, 0.85 * alpha);
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + ((i * (2 + (bytes[1] % (n - 3)))) % n) / n * TAU;
    const X = cx + Math.cos(a) * R * 0.99, Y = cy + Math.sin(a) * R * 0.99;
    i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
  }
  ctx.stroke(); ctx.restore();
}
