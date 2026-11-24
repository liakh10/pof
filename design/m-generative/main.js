/* m-generative: the page. The shell (menu, CA box, the one slot clock that broadcasts `pof:slot`) is /ui/app.js; data and
   formatting come from /ui/data.js and /ui/fmt.js. This file feeds real values into the drawings in ./gen.js:
   the latest blockhash and the slot into the field, subject hashes into marks, the certificate set into the wall. */
import { $, $$, num, esc, short, TIERS, KIND_TEXT, STATUS_SHORT, subjectLine, certPath, tierParts } from '/ui/fmt.js';
import { source, LIVE, sdk } from '/ui/data.js';
import { stateOf } from '/ui/cards.js';
import { Field, markGeometry, drawMark, scenes, runScene, fit, hexBytes, sha, drawGlyph, rgba, LINE } from './gen.js';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const EPOCH = 432000;
let src, slot = 0, chainSeed = null;

/* ------------------------------------------------------------------ the field */
const fieldLayout = (w, h) => {
  if (w < 720) { const R = Math.min(w * 0.6, 260); return { cx: w * 0.5, cy: h + R * 0.1, R }; }
  if (w < 1080) { const R = Math.min(h * 0.3, w * 0.34); return { cx: w * 0.66, cy: h * 0.62, R }; }
  const R = Math.min(h * 0.335, w * 0.225);
  return { cx: w * 0.695, cy: h * 0.475, R };
};
const field = new Field($('[data-field]'), { reduce, layout: fieldLayout });
const liveNum = $('[data-live-num]'), bhEl = $('[data-bh]'), epEl = $('[data-epoch]');

addEventListener('pof:slot', e => {
  slot = e.detail;
  field.setSlot(slot);
  liveNum.textContent = num(slot);
  const ep = Math.floor(slot / EPOCH), pct = ((slot % EPOCH) / EPOCH) * 100;
  epEl.innerHTML = `${num(ep)} <span class="acc">${pct.toFixed(2)}%</span> <span>of ${num(EPOCH)} slots</span>`;
});

async function readHash() {
  try {
    if (src.rpc) {
      const r = await src.rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]);
      const text = r.value.blockhash;
      const bytes = sdk.decodeBase58(text);
      field.setHash(bytes, text);
      bhEl.textContent = text;
      return bytes;
    }
    // the development fixture has no blockhash: the field is seeded by the slot it reads, and says so
    const s = slot || (await src.slot());
    const bytes = await sha(`slot:${s}`);
    field.setHash(bytes, `slot:${s}`);
    bhEl.textContent = `fixture, seeded by slot ${num(s)}`;
    return bytes;
  } catch { return null; }
}

/* the film button: 36 ticks, one per second of the film */
(() => {
  const g = $('.film-btn .ft'); if (!g) return;
  g.innerHTML = Array.from({ length: 36 }, (_, i) => {
    const a = -Math.PI / 2 + (i / 36) * Math.PI * 2, r0 = 19, r1 = i % 9 === 0 ? 23.5 : 21.5;
    return `<line${i === 0 ? ' class="m"' : ''} x1="${(Math.cos(a) * r0).toFixed(2)}" y1="${(Math.sin(a) * r0).toFixed(2)}" x2="${(Math.cos(a) * r1).toFixed(2)}" y2="${(Math.sin(a) * r1).toFixed(2)}"/>`;
  }).join('');
})();

/* ------------------------------------------------------------------ the five plates, seeded by the chain */
function startPlates(seed) {
  const geo = markGeometry(seed, { tier: 4 });
  for (const c of $$('[data-scene]')) {
    const name = c.dataset.scene;
    const scene = scenes[name](seed, geo);
    runScene(c, scene, { reduce, still: { shield: 6, disclose: 4, attest: 5, certify: 6, revoke: 6.5 }[name] });
  }
}

/* ------------------------------------------------------------------ the mark explorer */
const mk = {
  canvas: $('[data-mark]'), input: $('[data-mk-input]'), err: $('[data-mk-err]'),
  geo: null, bytes: null, state: 'live', tier: 4, asset: 'SOL',
  drawAt: 0, t: 0, tFrom: 0, tTo: 0, tAt: 0, raf: 0,
};
function mkFrame(now) {
  if (!mk.geo) return;
  const { ctx, w, h } = fit(mk.canvas);
  ctx.clearRect(0, 0, w, h);
  const draw = reduce ? 1 : Math.min(1, (now - mk.drawAt) / 1800);
  const k = reduce ? 1 : Math.min(1, (now - mk.tAt) / 1500);
  mk.t = mk.tFrom + (mk.tTo - mk.tFrom) * k;
  const R = Math.min(w, h) * 0.44;
  // a fine scale around the mark: 32 bit positions, and the 315° of the break
  ctx.save(); ctx.lineWidth = 0.6;
  for (let i = 0; i < 32; i++) {
    const a = -Math.PI / 2 + (i / 32) * Math.PI * 2, r0 = R * 1.06, r1 = R * (i % 8 ? 1.085 : 1.11);
    ctx.strokeStyle = rgba(LINE, i % 8 ? 0.25 : 0.5);
    ctx.beginPath(); ctx.moveTo(w / 2 + Math.cos(a) * r0, h / 2 + Math.sin(a) * r0); ctx.lineTo(w / 2 + Math.cos(a) * r1, h / 2 + Math.sin(a) * r1); ctx.stroke();
  }
  ctx.restore();
  const state = mk.t > 0.001 ? 'revoked' : mk.state === 'expired' ? 'expired' : 'live';
  drawMark(ctx, w / 2, h / 2, R, mk.geo, { state, t: mk.t, draw, lw: Math.max(1, w / 520) });
  if (draw < 1 || k < 1) mk.raf = requestAnimationFrame(mkFrame);
}
const mkPaint = () => { cancelAnimationFrame(mk.raf); mk.raf = requestAnimationFrame(mkFrame); };
new ResizeObserver(mkPaint).observe(mk.canvas);

async function mkSubject(q) {
  mk.err.textContent = '';
  let bytes, formula, verifyQ = q.trim();
  try {
    const p = sdk.parseSubjectQuery(q);
    if (p.type === 'hash') { bytes = p.hash; formula = 'the subject hash, as typed'; }
    else {
      const s = p.subjects[0];
      const kind = ['wallet', 'x', 'badge'][s.kind];
      bytes = await sdk.subjectHash(s);
      formula = `sha256("pof:${kind}:${s.value}")`;
    }
  } catch (e) { mk.err.textContent = e.message; return; }
  mk.bytes = bytes;
  mk.geo = markGeometry(bytes, { tier: mk.tier, asset: mk.asset });
  mk.drawAt = performance.now();
  $('[data-mk-formula]').textContent = formula;
  const hex = sdk.toHex(bytes);
  $('[data-mk-hex]').innerHTML = [0, 1, 2, 3].map(r => `<span>${hex.slice(r * 16, r * 16 + 16).match(/../g).map((x, i) => (i % 2 ? `<b>${x}</b>` : x)).join(' ')}</span>`).join('');
  $('[data-mk-rose]').textContent = `centre: ${mk.geo.rose.q} lobes, ratio ${mk.geo.rose.p}/${mk.geo.rose.q}`;
  $('[data-mk-verify]').href = `/verify?q=${encodeURIComponent(verifyQ)}`;
  mkPaint();
}
function mkTierLabel() { $('[data-mk-tier]').textContent = `at least ${TIERS[mk.asset][mk.tier - 1]} ${mk.asset}`; }
const tierBox = $('[data-mk-tiers]');
function mkTiers() {
  tierBox.innerHTML = TIERS[mk.asset].map((t, i) => `<button type="button" data-mk-t="${i + 1}" aria-pressed="${i + 1 === mk.tier}">${t}</button>`).join('');
}
tierBox.addEventListener('click', e => {
  const b = e.target.closest('[data-mk-t]'); if (!b) return;
  mk.tier = Number(b.dataset.mkT); mkTiers(); mkTierLabel();
  if (mk.bytes) { mk.geo = markGeometry(mk.bytes, { tier: mk.tier, asset: mk.asset }); mkPaint(); }
});
for (const b of $$('[data-mk-asset]')) b.addEventListener('click', () => {
  mk.asset = b.dataset.mkAsset; $$('[data-mk-asset]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  mkTiers(); mkTierLabel();
  if (mk.bytes) { mk.geo = markGeometry(mk.bytes, { tier: mk.tier, asset: mk.asset }); mkPaint(); }
});
for (const b of $$('[data-mk-state]')) b.addEventListener('click', () => {
  const st = b.dataset.mkState;
  $$('[data-mk-state]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  mk.tFrom = mk.t; mk.tTo = st === 'revoked' ? 1 : 0; mk.tAt = performance.now(); mk.state = st;
  mkPaint();
});
$('[data-mk-form]').addEventListener('submit', e => { e.preventDefault(); mkSubject(mk.input.value || '@anon'); });
mkTiers(); mkTierLabel(); mkSubject(mk.input.value);

/* ------------------------------------------------------------------ the glyphs of the index */
(async () => {
  for (const c of $$('[data-glyph]')) {
    const bytes = await sha(`pof:${c.dataset.glyph}`);
    const paint = () => { const { ctx, w, h } = fit(c); ctx.clearRect(0, 0, w, h); drawGlyph(ctx, w / 2, h / 2, Math.min(w, h) * 0.46, bytes); };
    new ResizeObserver(paint).observe(c);
  }
})();

/* ------------------------------------------------------------------ the wall */
const wall = $('[data-wall]');
let lastList = [], filter = 'any';
const cards = new Map();   // address → { el, canvas, geo, state, t, at }

function wallEmpty(title, body, sub) {
  wall.classList.add('is-empty');
  const cols = getComputedStyle(wall).gridTemplateColumns.split(' ').length || 6;
  const cells = Array.from({ length: cols * 2 }, () => '<div class="wcell"><canvas aria-hidden="true"></canvas></div>').join('');
  wall.innerHTML = cells + `<div class="wall-empty"><div><p class="t">${esc(title)}</p><p class="b">${esc(body)}</p>${sub ? `<p class="s mono">${esc(sub)}</p>` : ''}</div></div>`;
  // each empty cell: a registration cross and a dotted hair where a mark will be drawn
  $$('.wcell canvas', wall).forEach((c, i) => {
    const paint = () => {
      const { ctx, w, h } = fit(c); ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h * 0.45, R = Math.min(w, h) * 0.3;
      ctx.lineWidth = 0.6; ctx.strokeStyle = rgba(LINE, 0.2); ctx.setLineDash([1, 3.5]);
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = rgba(LINE, 0.32);
      ctx.beginPath(); ctx.moveTo(cx - 6, cy); ctx.lineTo(cx + 6, cy); ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 6); ctx.stroke();
      ctx.font = `400 9px Martian, monospace`; ctx.fillStyle = rgba(LINE, 0.28); ctx.textAlign = 'left';
      ctx.fillText(String(i + 1).padStart(3, '0'), 12, h - 12);
    };
    new ResizeObserver(paint).observe(c);
  });
}

function certEl(c) {
  const t = tierParts(c.tierLabel, c.asset);
  const state = stateOf(c);
  const subj = subjectLine(c);
  const hashOnly = subj === c.subjectHash;
  const slotLine = state === 'revoked' && c.revokedSlot ? `revoked ${num(c.revokedSlot)}` : `slot ${num(c.certifiedSlot)}`;
  const a = document.createElement('a');
  a.className = `cert is-${state}`; a.href = certPath(c); a.dataset.addr = c.address; a.dataset.status = c.status;
  a.setAttribute('aria-label', `${KIND_TEXT[c.kind] || c.kind} ${hashOnly ? 'hash ' + short(subj, 6) : short(subj, 6)}, at least ${t.amt} ${t.sym}, ${STATUS_SHORT[c.status] || c.status}`);
  a.innerHTML = `<canvas aria-hidden="true"></canvas><p class="cert-k mono"><span>${esc(KIND_TEXT[c.kind] || c.kind)}</span><span>${hashOnly ? 'hash ' + esc(short(subj, 5)) : esc(short(subj, 5))}</span></p>`
    + `<p class="cert-t"><small>at least</small>${esc(t.amt)} ${esc(t.sym)}</p><p class="cert-f mono"><span class="st">${esc(STATUS_SHORT[c.status] || c.status)}</span><span>${slotLine}</span></p>`;
  return a;
}
function paintCard(rec, now = performance.now()) {
  const { ctx, w, h } = fit(rec.canvas); ctx.clearRect(0, 0, w, h);
  const k = reduce ? 1 : Math.min(1, (now - rec.at) / 1600);
  const t = rec.state === 'revoked' ? (rec.flip ? k : 1) : 0;
  const draw = rec.fresh && !reduce ? k : 1;
  drawMark(ctx, w / 2, h / 2, Math.min(w, h) * 0.45, rec.geo, { state: rec.state, t, draw, lw: 0.8 });
  return k < 1 && (rec.flip || rec.fresh);
}
let cardsRaf = 0;
function animateCards() {
  cancelAnimationFrame(cardsRaf);
  const step = now => { let more = false; for (const r of cards.values()) if (r.el.isConnected && (r.flip || r.fresh)) more = paintCard(r, now) || more; if (more) cardsRaf = requestAnimationFrame(step); };
  cardsRaf = requestAnimationFrame(step);
}
const cardRO = new ResizeObserver(es => { for (const e of es) { const r = e.target._rec; if (r) paintCard(r); } });

function drawWall() {
  const list = filter === 'live' ? lastList.filter(c => c.status === 'live') : filter === 'revoked' ? lastList.filter(c => stateOf(c) === 'revoked') : lastList;
  if (!lastList.length) return wallEmpty('No certificates yet.', 'The first certificate appears here the moment it lands on chain, and comes apart the moment its funds move.', slot ? `read at slot ${num(slot)}` : '');
  if (!list.length) return wallEmpty(filter === 'live' ? 'No live certificates right now.' : 'Nothing revoked yet.', 'Switch the filter to see the rest of the wall.');
  if (wall.classList.contains('is-empty')) { wall.classList.remove('is-empty'); wall.replaceChildren(); }
  const els = [];
  for (const c of list.slice(0, 48)) {
    let rec = cards.get(c.address);
    const state = stateOf(c);
    if (rec && rec.status === c.status) { els.push(rec.el); continue; }
    const el = certEl(c);
    const geo = markGeometry(hexBytes(c.subjectHash), { tier: c.tier, asset: c.asset });
    const flip = !!rec && state === 'revoked';
    rec = { el, canvas: el.querySelector('canvas'), geo, state, status: c.status, at: performance.now(), flip, fresh: !rec && cards.size > 0 };
    el.querySelector('canvas')._rec = rec;
    cards.set(c.address, rec);
    cardRO.observe(rec.canvas);
    els.push(el);
  }
  wall.replaceChildren(...els);
  for (const el of els) { const r = el.querySelector('canvas')._rec; if (r) paintCard(r); }
  animateCards();
}
for (const b of $$('[data-filter]')) b.addEventListener('click', () => {
  filter = b.dataset.filter;
  $$('[data-filter]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  drawWall();
});
const rollTo = (el, n) => { if (el) el.textContent = num(n); };
async function readStats() {
  const s = await src.stats();
  $('[data-counts]').hidden = !(Number(s.total) || Number(s.live) || Number(s.revokedSpent) || Number(s.revokedByHolder));
  const set = (k, v) => rollTo($(`[data-c="${k}"]`), Number(v) || 0);
  set('live', s.live); set('sol', s.solCertified); set('usdc', s.usdcCertified); set('spent', s.revokedSpent); set('holder', s.revokedByHolder); set('log', s.log?.treeSize ?? 0);
}
async function readWall() {
  const r = await src.list({ status: 'any', limit: 500 });
  const order = c => Math.max(Number(c.certifiedSlot) || 0, Number(c.revokedSlot) || 0);
  lastList = r.certificates.slice().sort((a, b) => order(b) - order(a));
  $('[data-wall-filter]').hidden = !lastList.length;
  drawWall();
}

/* ------------------------------------------------------------------ the film: in its own room, captions under the picture */
(() => {
  const dlg = $('[data-film]'), frame = $('[data-film-frame]'), cap = $('[data-film-cap]'), prog = $('[data-film-prog]'), tEl = $('[data-film-t]');
  const toggle = $('[data-film-toggle]'), mute = $('[data-film-mute]');
  let v = null;
  const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const make = () => {
    v = Object.assign(document.createElement('video'), { src: '/film/pof.mp4', poster: '/film/poster.jpg', playsInline: true, preload: 'auto' });
    v.setAttribute('aria-label', 'The Proof of Funds film');
    const tr = Object.assign(document.createElement('track'), { kind: 'captions', src: '/film/pof.vtt', srclang: 'en', label: 'English', default: true });
    v.appendChild(tr); frame.appendChild(v);
    tr.track.mode = 'hidden';
    tr.track.addEventListener('cuechange', () => { const c = tr.track.activeCues && tr.track.activeCues[0]; cap.textContent = c ? c.text : ''; });
    v.addEventListener('timeupdate', () => { prog.style.width = `${(100 * v.currentTime / (v.duration || 36)).toFixed(2)}%`; tEl.textContent = fmt(v.currentTime); });
    v.addEventListener('play', () => (toggle.textContent = 'Pause'));
    v.addEventListener('pause', () => (toggle.textContent = v.ended ? 'Play again' : 'Play'));
    v.addEventListener('ended', () => { cap.textContent = ''; });
    v.addEventListener('click', () => (v.paused ? v.play() : v.pause()));
  };
  $$('[data-film-open]').forEach(b => b.addEventListener('click', () => {
    if (!v) make();
    dlg.showModal(); v.currentTime = v.ended ? 0 : v.currentTime; v.play().catch(() => {});
  }));
  toggle.addEventListener('click', () => (v.paused ? v.play() : v.pause()));
  mute.addEventListener('click', () => { v.muted = !v.muted; mute.textContent = v.muted ? 'Sound on' : 'Sound off'; });
  $('[data-film-close]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => v && v.pause());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
})();


/* ------------------------------------------------------------------ start */
(async () => {
  src = await source();
  const first = await Promise.race([readHash(), new Promise(r => setTimeout(() => r(null), 3500))]);
  chainSeed = first || (await sha(window.POF?.PROGRAM || 'pof'));
  startPlates(chainSeed);
  setInterval(() => { if (!document.hidden) readHash(); }, 8000);

  const live = LIVE || src.mode === 'fixture';
  if (!live) { drawWall(); return; }
  wall.innerHTML = '<div class="wall-msg mono">Reading the wall from the chain.</div>';
  const tick = async () => {
    try { await Promise.all([readStats(), readWall()]); }
    catch (e) { if (!lastList.length) wallEmpty('The wall could not be read just now.', `${e.message} It retries by itself.`); }
  };
  await tick();
  setInterval(() => { if (!document.hidden) tick(); }, src.mode === 'fixture' ? 3500 : 6000);
})();
addEventListener('pof:slot', () => { const s = $('.wall-empty .s'); if (s && !lastList.length) s.textContent = `read at slot ${num(slot)}`; });
