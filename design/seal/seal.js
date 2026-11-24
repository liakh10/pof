/* v3 "The seal is the interface". One seal; every certificate on chain is one ring of it.
   Weight = tier, orange = among the newest, a broken ring = revoked (it stops, then opens at the crack, upper right).
   Newest rings sit by the disc and push the older ones outward. Hover or tap a ring to read its certificate; type a
   wallet or @handle into the disc to check it. Data comes only through ui/data.js: the chain in production, the dev
   fixture on localhost with ?fixture. Before launch the seal shows its empty orbits and says so. */
import { $, $$, num, roll, esc, short, tierParts, subjectLine, certPath, STATUS_TEXT, KIND_TEXT } from '/ui/fmt.js';
import { source, LIVE } from '/ui/data.js';
import { markSVG } from '/ui/seal.js';
import { stateOf } from '/ui/cards.js';

const NS = 'http://www.w3.org/2000/svg';
const RM = matchMedia('(prefers-reduced-motion: reduce)');
const WIDE = matchMedia('(min-width: 1081px)');
const FILM = { src: '/film/pof.mp4', captions: '/film/pof.vtt' };
const Z0 = 230, Z1 = 460, DISC = 198;
const WEIGHTED = () => (WIDE.matches ? 20 : 10);
const TIER_W = [1.4, 1, 1.7, 2.8, 5.2, 10];  // ring weight per tier, in seal units (1000 across)
const GAP_ = 6.5;                            // space between rings
const CRACK = -34;                           // degrees: every revoked ring opens here
const GAP = 64;                              // the opening, in pathLength units

const stage = $('[data-stage]'), wrap = $('[data-seal]'), field = $('[data-field]');
const ringsG = $('[data-rings]'), orbitsG = $('[data-orbits]');
const leaders = $('[data-leaders]'), noteLeaders = $('[data-note-leaders]'), cardLeader = $('[data-card-leader]'), cardDot = $('[data-card-dot]');
const card = $('[data-card]'), pin = $('[data-card-pin]');
const liveNum = $('[data-live-num]'), liveLabel = $('[data-live-label]'), liveSub = $('[data-live-sub]'), evLine = $('[data-event]');
const form = $('[data-probe]'), input = $('#probe');
const emptyCard = card.innerHTML;

let src = null, mode = 'pre', slot = 0;
let list = [];                       // certificates, newest first
const rings = new Map();             // address -> ring
let order = [];                      // addresses as laid out, centre outwards
let hot = null, hotAngle = null;     // the ring under the pointer
let pinned = null, verdict = null;   // what the card rests on
let cursor = -1;                     // keyboard reading position

/* ------------------------------------------------------------------ small geometry */
const el = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
const rad = d => d * Math.PI / 180;
const pt = (r, deg) => [r * Math.cos(rad(deg)), r * Math.sin(rad(deg))];
const arc = (r, a, b) => { const [x0, y0] = pt(r, a), [x1, y1] = pt(r, b); return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; };
function h32(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }
function prng(seed) { let x = seed || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }

/** each ring carries its own notches, from its address: the ring's fingerprint, and what makes its rotation visible */
function notches(addr) {
  const r = prng(h32(addr));
  const k = 1;
  const at = Array.from({ length: k }, () => r() * 1000).sort((a, b) => a - b);
  const out = []; let cur = 0;
  for (const p of at) { const len = 2.5 + r() * 4; if (p - cur < 40) continue; out.push((p - cur).toFixed(1), len.toFixed(1)); cur = p + len; }
  out.push(Math.max(1, 1000 - cur).toFixed(1), '0');
  return out.join(' ');
}
/** the opening of a revoked ring, centred on CRACK (the ring itself no longer turns) */
function opening(g) {
  const sc = ((CRACK % 360) + 360) % 360 / 360 * 1000;
  return { arr: `${(1000 - g).toFixed(1)} ${g.toFixed(1)}`, off: (((1000 - g / 2 - sc) % 1000) + 1000) % 1000 };
}

/* ------------------------------------------------------------------ rings */
function makeRing(c) {
  const g = el('g', { class: 'ring' });
  const band = el('circle', { class: 'band', r: Z0, 'stroke-width': 0, pathLength: 1000 });
  g.appendChild(band);
  const R = prng(h32(c.address) ^ 0x9e3779b9);
  const dur = 60 + R() * 180;
  g.style.setProperty('--d', `${dur.toFixed(1)}s`);
  g.style.setProperty('--delay', `${(-R() * dur).toFixed(1)}s`);
  const dir = h32(c.address) & 1 ? 1 : -1;
  if (dir < 0) g.classList.add('ccw');
  ringsG.appendChild(g);
  return { c, g, band, r: Z0, w: 0, tr: Z0, tw: 0, dir, shards: null, state: null, sig: false };
}

function paint(o, animate) {
  const s = stateOf(o.c), holder = o.c.status === 'revoked_by_holder';
  o.g.classList.toggle('exp', s === 'expired');
  if (s === 'revoked') {
    o.g.classList.remove('sig');
    if (o.state === 'live' && animate && !RM.matches) { o.state = s; breakRing(o, holder); return; }
    o.g.classList.add('still', 'dead');
    const { arr, off } = opening(GAP);
    o.band.setAttribute('stroke-dasharray', arr); o.band.setAttribute('stroke-dashoffset', off.toFixed(1));
    if (!holder) addShards(o, false);
  } else {
    o.g.classList.toggle('sig', o.sig);
    if (o.g.classList.contains('old')) o.band.removeAttribute('stroke-dasharray'); else o.band.setAttribute('stroke-dasharray', notches(o.c.address));
    o.band.removeAttribute('stroke-dashoffset');
  }
  o.state = s;
}

/* a ring that is revoked while you watch: it slows to a stop, the opening tears at the crack, two shards fall outward */
function breakRing(o, holder) {
  const t = getComputedStyle(o.g).transform;
  const m = t && t !== 'none' ? new DOMMatrix(t) : new DOMMatrix();
  const deg = Math.atan2(m.b, m.a) * 180 / Math.PI;
  o.g.classList.add('still'); o.g.style.transform = `rotate(${deg}deg)`;
  const to = o.dir > 0 ? Math.ceil((deg + 60) / 360) * 360 : Math.floor((deg - 60) / 360) * 360;
  const a = o.g.animate([{ transform: `rotate(${deg}deg)` }, { transform: `rotate(${to}deg)` }], { duration: 1600, easing: 'cubic-bezier(.12,.62,.2,1)' });
  a.onfinish = () => {
    o.g.style.transform = '';
    o.g.classList.add('dead'); o.g.classList.remove('sig');
    const t0 = performance.now();
    const step = t => {
      const k = Math.min(1, (t - t0) / 520), e = 1 - Math.pow(1 - k, 3);
      const { arr, off } = opening(Math.max(.5, GAP * e));
      o.band.setAttribute('stroke-dasharray', arr); o.band.setAttribute('stroke-dashoffset', off.toFixed(1));
      if (k < 1) requestAnimationFrame(step); else if (!holder) addShards(o, true);
    };
    requestAnimationFrame(step);
  };
}
function addShards(o, animate) {
  if (o.shards) return;
  const half = GAP / 1000 * 180;
  o.shards = [[CRACK - half + 1.5, CRACK - half * .3], [CRACK + half * .15, CRACK + half - 1.5]].map(([a, b]) => { const p = el('path', { class: 'shard' }); o.g.appendChild(p); return { p, a, b }; });
  placeShards(o);
  const u = pt(1, CRACK);
  o.shards.forEach((s, i) => {
    const d = (i ? 16 : 8) + o.w * (i ? 1.7 : 1.1), rot = i ? 2.6 : -1.8;
    const to = `translate(${(u[0] * d).toFixed(1)}px, ${(u[1] * d).toFixed(1)}px) rotate(${rot}deg)`;
    if (animate) s.p.animate([{ transform: 'translate(0px, 0px) rotate(0deg)' }, { transform: to }], { duration: 1100, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
    else s.p.style.transform = to;
  });
}
function placeShards(o) { for (const s of o.shards || []) { s.p.setAttribute('d', arc(o.r, s.a, s.b)); s.p.setAttribute('stroke-width', o.w.toFixed(2)); } }

/** a ring that just landed draws itself round once, then takes its notches */
function drawIn(o) {
  if (RM.matches) return;
  o.band.style.strokeDasharray = '1000';
  const a = o.band.animate([{ strokeDashoffset: 1000 }, { strokeDashoffset: 0 }], { duration: 1500, easing: 'cubic-bezier(.4,0,.2,1)' });
  a.onfinish = () => { o.band.style.strokeDasharray = ''; };
}

/** lay the rings out from the disc outwards, weight by tier, scaled so they always fill the band between Z0 and Z1 */
function layout(animate) {
  const W = Math.min(list.length, WEIGHTED());           // the newest keep their weight
  const had = rings.size > 0;
  const ws = list.slice(0, W).map(c => TIER_W[c.tier] || TIER_W[0]);
  const need = ws.reduce((a, b) => a + b, 0) + GAP_ * W;
  const room = list.length > W ? (Z1 - Z0) * .74 : Z1 - Z0;
  const s = W ? Math.min(1.35, room / need) : 1;
  const left = Z1 - Z0 - need * s;
  const minStep = WIDE.matches ? 4.2 : 10;               // older ones age into hairlines in the outer band, never closer than a hairline can print
  const old = Math.max(0, Math.min(list.length - W, Math.floor(left / minStep)));
  const shown = list.slice(0, W + old);
  const step = old ? Math.min(7, left / old) : 0;
  let r = Z0;
  const keep = new Set();
  shown.forEach((c, i) => {
    let o = rings.get(c.address); const fresh = !o;
    if (fresh) { o = makeRing(c); rings.set(c.address, o); }
    const prev = o.c.status; o.c = c; keep.add(c.address);
    const aged = i >= W;
    o.g.classList.toggle('old', aged);
    const w = aged ? (WIDE.matches ? .8 : 1.7) : ws[i] * s;
    if (aged) { r += step / 2; o.tr = r; o.tw = w; r += step / 2; }
    else { r += w / 2; o.tr = r; o.tw = w; r += w / 2 + GAP_ * s; }
    o.sig = !aged && c.status === 'live' && (i < 3 || (slot > 0 && slot - Number(c.certifiedSlot) < 9000));
    if (fresh) { if (had && animate) { o.r = Z0 - 8; o.w = 0; } else { o.r = o.tr; o.w = o.tw; } }
    paint(o, animate && !fresh && prev !== c.status);
    if (fresh && had && animate) drawIn(o);
  });
  for (const [a, o] of rings) if (!keep.has(a)) { o.g.remove(); rings.delete(a); }
  order = shown.map(c => c.address);
  drawOrbits(shown.length ? r + 6 : Z0);
  tween(animate);
}

/** quiet orbits fill what certificates do not; before launch they are the whole seal, with the first ring's place marked */
function drawOrbits(from) {
  orbitsG.replaceChildren();
  if (mode === 'pre') orbitsG.appendChild(el('circle', { class: 'guide', r: Z0 }));
  let i = 0;
  for (let r = mode === 'pre' ? Z0 + 10 : from + 4; r <= Z1; r += mode === 'pre' ? 10 : 11, i++) orbitsG.appendChild(el('circle', { class: mode === 'pre' && (i === 4 || i === 13) ? 'orbit heavy' : 'orbit', r: r.toFixed(1) }));
}

let raf = 0;
function tween(animate) {
  cancelAnimationFrame(raf);
  const items = [...rings.values()], from = items.map(o => [o.r, o.w]);
  const t0 = performance.now(), T = animate && !RM.matches ? 950 : 0;
  const step = t => {
    const k = T ? Math.min(1, (t - t0) / T) : 1, e = 1 - Math.pow(1 - k, 3);
    items.forEach((o, i) => {
      o.r = from[i][0] + (o.tr - from[i][0]) * e; o.w = from[i][1] + (o.tw - from[i][1]) * e;
      o.band.setAttribute('r', o.r.toFixed(2)); o.band.setAttribute('stroke-width', o.w.toFixed(2));
      if (o.shards) placeShards(o);
    });
    if (k < 1) raf = requestAnimationFrame(step); else drawLeaders();
  };
  raf = requestAnimationFrame(step);
}

/* ------------------------------------------------------------------ reading: pointer, tap, keys */
function geom() {
  const a = stage.getBoundingClientRect(), b = field.getBoundingClientRect();
  return { k: b.width / 1000, cx: b.left - a.left + b.width / 2, cy: b.top - a.top + b.height / 2, bx: b.left, by: b.top, bw: b.width };
}
function ringAt(d) {
  let best = null, bd = 1e9;
  for (const a of order) { const o = rings.get(a); const dd = Math.abs(d - o.r); if (dd < bd) { bd = dd; best = o; } }
  return best && bd <= best.w / 2 + GAP_ * 1.2 + 2 ? best : null;
}
function fromEvent(e) {
  const g = geom();
  const x = (e.clientX - g.bx) / g.k - 500, y = (e.clientY - g.by) / g.k - 500;
  const d = Math.hypot(x, y);
  return { o: d > DISC + 8 && d < Z1 + 10 ? ringAt(d) : null, ang: Math.atan2(y, x) * 180 / Math.PI };
}
function setHot(o, ang = null) {
  const a = o ? o.c.address : null;
  const changed = a !== hot;
  hot = a; hotAngle = ang;
  if (changed) {
    for (const x of rings.values()) x.g.classList.toggle('hot', x.c.address === a);
    field.classList.toggle('reading', !!a);
    renderCard();
  }
  drawCardLeader();
}
field.addEventListener('pointermove', e => { if (e.pointerType !== 'mouse' || wrap.classList.contains('playing')) return; const { o, ang } = fromEvent(e); setHot(o, ang); });
field.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') setHot(null); });
field.addEventListener('click', e => {
  if (wrap.classList.contains('playing')) return;
  const { o, ang } = fromEvent(e);
  if (!o) return;
  pinned = o.c.address; verdict = null; cursor = order.indexOf(pinned);
  if (e.pointerType === 'mouse') { setHot(o, ang); renderCard(); }
  else { setHot(o, ang); if (!WIDE.matches) card.scrollIntoView({ behavior: RM.matches ? 'auto' : 'smooth', block: 'center' }); }
});
field.addEventListener('keydown', e => {
  if (!order.length || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape'].includes(e.key)) return;
  e.preventDefault();
  if (e.key === 'Escape') { cursor = -1; pinned = null; setHot(null); return; }
  cursor = Math.max(0, Math.min(order.length - 1, cursor + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1)));
  pinned = order[cursor]; verdict = null;
  setHot(rings.get(pinned), CRACK + 60);
});
field.addEventListener('blur', () => { if (hot && !pinned) setHot(null); });

/* ------------------------------------------------------------------ the card */
const resting = () => list.find(c => c.address === pinned) || verdict?.cert || list[0] || null;
function renderCard() {
  const c = (hot && rings.get(hot)?.c) || resting();
  const v = !hot && verdict ? verdict : null;
  card.dataset.good = v && v.good ? '1' : '0';
  if (!c) {
    if (v) { card.dataset.state = 'verdict'; card.innerHTML = `<span class="cc-pin" data-card-pin></span><p class="cc-head"><span>Check</span></p><p class="cc-verdict">${esc(v.head)}</p><dl class="cc-rows"><div><dt>Subject</dt><dd><span class="mono">${esc(short(v.q, 10))}</span></dd></div></dl><p class="cc-note">${esc(v.sub)}</p>`; return; }
    if (card.dataset.state !== 'empty') { card.dataset.state = 'empty'; card.innerHTML = emptyCard; }
    return;
  }
  const t = tierParts(c.tierLabel, c.asset), s = stateOf(c), subj = subjectLine(c), hashOnly = subj === c.subjectHash;
  const at = order.indexOf(c.address);
  card.dataset.state = s;
  const rows = [
    ['Subject', `${esc(KIND_TEXT[c.kind] || c.kind)} <span class="mono" title="${esc(subj)}">${hashOnly ? 'hash ' : ''}${esc(short(subj, 6))}</span>`],
    ['Status', `<span class="st"><i aria-hidden="true"></i>${esc(STATUS_TEXT[c.status] || c.status)}</span>`],
    ['Certified', `<span class="mono">slot ${num(c.certifiedSlot)}</span>`],
  ];
  if (s === 'revoked' && Number(c.revokedSlot)) rows.push(['Revoked', `<span class="mono">slot ${num(c.revokedSlot)}</span>`]);
  card.innerHTML = `<span class="cc-pin" data-card-pin></span>
  <p class="cc-head"><span>Certificate</span>${at >= 0 ? `<span class="mono">ring ${String(at + 1).padStart(2, '0')} of ${order.length}</span>` : ''}</p>
  ${v ? `<p class="cc-verdict">${esc(v.head)}</p>` : ''}
  <p class="cc-tier" aria-label="${esc(c.tierLabel)}"><svg class="ge" viewBox="0 0 18 26" aria-hidden="true"><path d="M2.5 3.5 L15.5 10 L2.5 16.5 M2.5 23 H15.5"/></svg><b>${esc(t.amt)}</b><span class="sym">${esc(t.sym)}</span></p>
  <dl class="cc-rows">${rows.map(([k, val]) => `<div><dt>${k}</dt><dd>${val}</dd></div>`).join('')}</dl>
  <a class="cc-open" href="${esc(certPath(c))}">Open the certificate</a>`;
}
function drawCardLeader() {
  if (!WIDE.matches) return;
  const p = card.querySelector('[data-card-pin]');
  const c = (hot && rings.get(hot)?.c) || resting();
  const o = c && rings.get(c.address);
  if (!p || !o || wrap.classList.contains('playing')) { cardLeader.setAttribute('d', ''); cardDot.setAttribute('cx', -20); return; }
  const g = geom(), a = stage.getBoundingClientRect(), pr = p.getBoundingClientRect();
  const px = pr.left - a.left, py = pr.top - a.top;
  const ang = hot && hotAngle !== null ? hotAngle : Math.atan2(py - g.cy, px - g.cx) * 180 / Math.PI;
  const [x, y] = pt(o.r * g.k, ang);
  cardLeader.setAttribute('d', `M ${px.toFixed(1)} ${py.toFixed(1)} L ${(g.cx + x).toFixed(1)} ${(g.cy + y).toFixed(1)}`);
  cardDot.setAttribute('cx', (g.cx + x).toFixed(1)); cardDot.setAttribute('cy', (g.cy + y).toFixed(1));
}

/* ------------------------------------------------------------------ annotations: Swiss leader lines from each note to its rings */
const notes = $$('[data-note]');
function target(kind) {
  const all = order.map(a => rings.get(a));
  if (kind === 'center') return { r: DISC, ang: -62 };
  if (kind === 'weight') { const o = all.filter(o => o.state === 'live').sort((a, b) => b.c.tier - a.c.tier || b.w - a.w)[0]; return o ? { r: o.r, o, ang: -12 } : { r: 211, ang: -12 }; }
  if (kind === 'orange') { const o = all.find(o => o.sig); return o ? { r: o.r, o, ang: 9 } : { r: Z0, ang: 9 }; }
  if (kind === 'broken') { const o = all.find(o => o.state === 'revoked' && o.c.status === 'revoked_spent') || all.find(o => o.state === 'revoked'); return { r: o ? o.r : (Z0 + Z1) / 2, ang: CRACK, o }; }
}
let firstLeaders = true;
function drawLeaders() {
  drawCardLeader();
  if (!WIDE.matches) return;
  const g = geom(), a = stage.getBoundingClientRect();
  leaders.setAttribute('viewBox', `0 0 ${a.width.toFixed(0)} ${a.height.toFixed(0)}`);
  noteLeaders.replaceChildren();
  notes.forEach((li, i) => {
    const t = target(li.dataset.note);
    const h = li.querySelector('h2').getBoundingClientRect();
    const ax = h.left - a.left - 14, ay = h.top - a.top + h.height / 2;
    const ang = t.ang ?? Math.atan2(ay - g.cy, ax - g.cx) * 180 / Math.PI;
    const [x, y] = pt(t.r * g.k, ang);
    const tx = g.cx + x, ty = g.cy + y;
    const elbow = Math.max(tx + 24, ax - 36);
    const grp = el('g', { class: 'ln', style: `--i:${i}`, 'data-for': li.dataset.note });
    grp.appendChild(el('path', { d: `M ${ax.toFixed(1)} ${ay.toFixed(1)} H ${elbow.toFixed(1)} L ${tx.toFixed(1)} ${ty.toFixed(1)}`, pathLength: 1 }));
    grp.appendChild(el('circle', { class: 'tip', cx: tx.toFixed(1), cy: ty.toFixed(1), r: 5.5 }));
    grp.appendChild(el('circle', { class: 'tip-in', cx: tx.toFixed(1), cy: ty.toFixed(1), r: 2 }));
    noteLeaders.appendChild(grp);
  });
  if (firstLeaders && !RM.matches) { leaders.classList.add('drawing'); setTimeout(() => leaders.classList.remove('drawing'), 3200); }
  firstLeaders = false;
}
for (const li of notes) {
  const on = v => {
    li.classList.toggle('on', v);
    noteLeaders.querySelector(`[data-for="${li.dataset.note}"]`)?.classList.toggle('on', v);
    const k = li.dataset.note;
    const match = o => (k === 'weight' ? o.c.tier >= 4 && o.state === 'live' : k === 'orange' ? o.sig : k === 'broken' ? o.state === 'revoked' : false);
    let any = false;
    for (const o of rings.values()) { const m = v && match(o); o.g.classList.toggle('hot', m); any ||= m; }
    field.classList.toggle('reading', any);
  };
  li.addEventListener('mouseenter', () => on(true));
  li.addEventListener('mouseleave', () => on(false));
  if (li.dataset.note === 'center') li.addEventListener('click', () => input.focus());
}
addEventListener('resize', () => { drawLeaders(); });
document.fonts?.ready.then(drawLeaders);
WIDE.addEventListener('change', drawLeaders);

/* ------------------------------------------------------------------ the live number and events */
addEventListener('pof:slot', e => {
  slot = e.detail;
  if (mode === 'pre') liveNum.textContent = num(slot);
  else { const s = $('[data-live-slot]'); if (s) s.textContent = num(slot); }
});
function say(c, kind) {
  const t = c.tierLabel || '';
  evLine.textContent = kind === 'new' ? `Certified at slot ${num(c.certifiedSlot)}: ${t}, ${(KIND_TEXT[c.kind] || '').toLowerCase()}.` : `Revoked at slot ${num(c.revokedSlot || slot)}: ${t}, ${c.status === 'revoked_spent' ? 'the funds moved' : 'by the holder'}.`;
}
async function tick() {
  const [s, r] = await Promise.all([src.stats(), src.list({ status: 'any', limit: 500 })]);
  const first = mode !== 'live';
  mode = 'live';
  liveLabel.textContent = 'Live certificates, read from chain';
  roll(liveNum, s.live);
  liveSub.innerHTML = `slot <b data-live-slot>${num(slot || s.slot)}</b> · at least <b>${num(s.solCertified)} SOL</b> and <b>${num(s.usdcCertified)} USDC</b> certified`;
  const prev = new Map(list.map(c => [c.address, c.status]));
  list = r.certificates.slice().sort((a, b) => Number(b.certifiedSlot) - Number(a.certifiedSlot));
  const flipped = list.find(c => prev.get(c.address) === 'live' && c.status !== 'live');
  const landed = prev.size ? list.find(c => !prev.has(c.address)) : null;
  if (first) { field.classList.add('sweeping'); setTimeout(() => field.classList.remove('sweeping'), 2000); }
  layout(!first);
  if (flipped) say(flipped, 'revoked'); else if (landed) say(landed, 'new');
  if (!hot) renderCard();
}

/* ------------------------------------------------------------------ check a subject in the disc */
form.addEventListener('submit', async e => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q || !src) return;
  form.classList.add('busy');
  try {
    const r = await src.lookup(q);
    const best = r.certificates[0] || null;
    const good = !!r.live;
    verdict = { q, good, cert: best, head: best ? (good ? 'Yes. A live certificate.' : 'Certificates found, none live.') : 'No certificate.', sub: `Read from the chain at slot ${num(r.slot)}.` };
    field.dataset.verdict = good ? 'yes' : 'no';
    pinned = best ? best.address : null;
    hot = null; for (const x of rings.values()) x.g.classList.toggle('hot', !!best && x.c.address === best.address);
    field.classList.toggle('reading', !!(best && rings.has(best.address)));
  } catch (err) {
    verdict = { q, good: false, cert: null, head: err.code === 'bad_subject' ? 'That is not a subject.' : 'The check did not go through.', sub: err.message };
    field.dataset.verdict = 'no'; pinned = null;
  }
  form.classList.remove('busy');
  renderCard(); drawCardLeader();
  if (!WIDE.matches) card.scrollIntoView({ behavior: RM.matches ? 'auto' : 'smooth', block: 'center' });
});
input.addEventListener('input', () => { if (!input.value) { delete field.dataset.verdict; verdict = null; field.classList.remove('reading'); renderCard(); drawCardLeader(); } });

/* ------------------------------------------------------------------ the film, inside the seal; its progress is the orange ring */
{
  const plays = $$('[data-film-play]'), mute = $('[data-film-mute]'), cap = $('[data-film-cap]'), slotEl = $('[data-video-slot]'), prog = $('[data-film-progress]');
  let v = null;
  const make = () => {
    v = Object.assign(document.createElement('video'), { src: FILM.src, playsInline: true, preload: 'auto' });
    v.setAttribute('aria-label', 'The Proof of Funds film');
    const t = Object.assign(document.createElement('track'), { kind: 'captions', src: FILM.captions, srclang: 'en', label: 'English', default: true });
    v.appendChild(t); slotEl.appendChild(v);
    t.track.mode = 'hidden';
    t.track.addEventListener('cuechange', () => { const c = t.track.activeCues && t.track.activeCues[0]; cap.textContent = c ? c.text : ''; });
    v.addEventListener('timeupdate', () => { prog.style.strokeDashoffset = String(1000 * (1 - v.currentTime / (v.duration || 1))); });
    v.addEventListener('ended', () => { stop(); cap.textContent = ''; });
    slotEl.addEventListener('click', toggle);
  };
  const stop = () => { wrap.classList.remove('playing'); stage.classList.remove('playing'); mute.hidden = true; setHot(null); drawCardLeader(); };
  const toggle = () => {
    if (!v) make();
    if (v.paused) { wrap.classList.add('playing'); stage.classList.add('playing'); v.play(); mute.hidden = false; setHot(null); drawCardLeader(); }
    else { v.pause(); stop(); }
  };
  plays.forEach(p => p.addEventListener('click', toggle));
  mute.addEventListener('click', () => { if (!v) return; v.muted = !v.muted; mute.textContent = v.muted ? 'Sound on' : 'Sound off'; });
}

/* ------------------------------------------------------------------ start */
drawOrbits(Z0);
drawLeaders();
(async () => {
  src = await source();
  if (!(LIVE || src.mode === 'fixture')) return;     // before launch: the empty seal, the mainnet slot, the tier ladder
  try { await tick(); } catch (e) { evLine.textContent = `${e.message} It retries by itself.`; }
  setInterval(() => { if (!document.hidden) tick().catch(() => {}); }, src.mode === 'fixture' ? 3500 : 6000);
})();
