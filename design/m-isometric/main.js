/* Direction M · Isometric: the page. The shell (menu, the CA box, the one slot clock and its `pof:slot` events) is
   /ui/app.js; the data layer and formatting are /ui/data.js and /ui/fmt.js, so the live number is the same mainnet slot
   the site reads through /api/rpc, and the wall reads /v1/certificates once the protocol is live. */
import { $, $$, num, esc, short, tierParts, subjectLine, certPath, STATUS_SHORT, KIND_TEXT } from '/ui/fmt.js';
import { source, LIVE } from '/ui/data.js';
import * as SC from './scenes.js';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const FILM = { src: '/film/pof.mp4', poster: '/film/poster.jpg', captions: '/film/pof.vtt' };

/* ------------------------------------------------------------------ the drawings */
const draw = { hero: SC.heroScene, shield: SC.shieldScene, disclose: SC.discloseScene, attest: SC.attestScene, certify: SC.certifyScene, revoke: SC.revokeScene };
for (const el of $$('[data-scene]')) { const fn = draw[el.dataset.scene]; if (fn) el.innerHTML = fn(); }
for (const el of $$('[data-glyph]')) el.innerHTML = SC.glyph(el.dataset.glyph);
/* frame each step drawing to what is drawn (the ground grid, movers and halos do not count) */
function fit(svg, pad = 10, scale = 1) {
  const m = svg.getScreenCTM()?.inverse(); if (!m) return;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const el of svg.querySelectorAll(':scope > :not(defs):not(.g-grid):not(.mv):not(.keeper):not(.halo):not(linearGradient)')) {
    const r = el.getBoundingClientRect(); if (!r.width && !r.height) continue;
    for (const [x, y] of [[r.left, r.top], [r.right, r.bottom]]) { const q = new DOMPoint(x, y).matrixTransform(m); x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
  }
  if (!Number.isFinite(x0)) return;
  const w = x1 - x0 + 2 * pad, h = y1 - y0 + 2 * pad;
  svg.setAttribute('viewBox', `${(x0 - pad).toFixed(1)} ${(y0 - pad).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`);
  /* one scale for every drawing, so type and hairlines read the same in each */
  svg.style.width = `${Math.round(w * scale)}px`;
}
const fitAll = root => $$('.step-art svg, .wall-empty svg', root).forEach(s => fit(s));
fitAll(document);
document.fonts?.ready.then(() => fitAll(document));
if (reduce) {
  for (const a of $$('svg.iso animateMotion, svg.iso animate')) a.parentNode.removeChild(a);
  for (const g of $$('svg.iso [data-at]')) {
    const at = g.dataset.at.split(/[ ,]+/).map(Number);
    if (at.length === 2 && at.every(Number.isFinite)) g.setAttribute('transform', `translate(${at[0]} ${at[1]})`); else g.style.display = 'none';
    g.removeAttribute('opacity');
  }
}

/* a drawing only moves while it is on screen */
if ('IntersectionObserver' in window && !reduce) {
  const io = new IntersectionObserver(es => es.forEach(x => { x.target.classList.toggle('run', x.isIntersecting); try { x.isIntersecting ? x.target.unpauseAnimations() : x.target.pauseAnimations(); } catch {} }), { rootMargin: '80px 0px' });
  $$('svg.iso').forEach(s => io.observe(s));
}

/* ------------------------------------------------------------------ the hero's revoke cycle: an illustration, labelled as one */
const hero = $('.hero-iso');
if (hero && !reduce) {
  const co = hero.querySelector('[id$="-co-cert"]');
  const k = co?.querySelector('.co-k'), v = co?.querySelector('.co-v');
  const set = revoked => {
    hero.classList.toggle('revoked', revoked);
    if (k) { k.textContent = revoked ? 'REVOKED' : 'CERTIFICATE'; k.classList.toggle('mint', !revoked); }
    if (v) v.textContent = revoked ? 'a note moved: revoked at that slot' : 'at least a tier, never an amount';
  };
  set(false);
  const cycle = () => { if (!document.hidden && hero.classList.contains('run')) { set(true); setTimeout(() => set(false), 4200); } };
  setTimeout(() => { cycle(); setInterval(cycle, 15000); }, 9000);
}

/* ------------------------------------------------------------------ the live number */
const liveNum = $('[data-live-num]'), liveLabel = $('[data-live-label]'), liveSub = $('[data-live-sub]');
const ground = $('[data-slot-ground]');
let mode = 'pre', slot = 0;
addEventListener('pof:slot', e => {
  slot = e.detail;
  if (mode === 'pre') liveNum.textContent = num(slot);
  else { const s = $('[data-live-slot]'); if (s) s.textContent = num(slot); }
  if (ground) ground.textContent = `SLOT ${num(slot)}`;
  for (const w of $$('[data-wall-slot]')) w.textContent = ` at slot ${num(slot)}`;
});

/* ------------------------------------------------------------------ the wall */
const wall = $('[data-wall]'), seg = $('[data-seg]');
let filter = 'any', lastList = [];
const stateOf = c => (c.status === 'live' ? 'live' : /^revoked/.test(c.status) ? 'revoked' : 'expired');
function tile(c) {
  const t = tierParts(c.tierLabel, c.asset), st = stateOf(c), subj = subjectLine(c);
  const slotLine = st === 'revoked' && c.revokedSlot ? `revoked ${num(c.revokedSlot)}` : `slot ${num(c.certifiedSlot)}`;
  return `<a class="ct is-${st}" href="${esc(certPath(c))}" data-addr="${esc(c.address)}" data-status="${esc(c.status)}">
    <span class="ct-kind"><span>${esc(KIND_TEXT[c.kind] || c.kind)}</span><span>${esc(subj === c.subjectHash ? 'hash ' + short(subj, 4) : short(subj, 5))}</span></span>
    ${SC.certGlyph(st)}
    <span class="ct-tier"><small>At least</small><span class="amt">${esc(t.amt)} ${esc(t.sym)}</span></span>
    <span class="ct-foot"><span class="st">${esc(STATUS_SHORT[c.status] || c.status)}</span><span>${slotLine}</span></span></a>`;
}
function emptyWall(title, body) {
  wall.innerHTML = `<div class="wall-empty">${SC.wallScene()}<div><p class="k">Read from the chain<span data-wall-slot>${slot ? ` at slot ${num(slot)}` : ''}</span></p><h3>${esc(title)}</h3><p>${esc(body)}</p>
    <div class="row"><a class="btn" href="/get">Get certified</a><a class="btn ghost" href="/verify">Verify a subject</a></div></div></div>`;
  $$('svg.iso', wall).forEach(s => s.classList.toggle('run', !reduce));
  $$('svg', wall).forEach(s => fit(s));
}
function drawWall() {
  const list = filter === 'live' ? lastList.filter(c => c.status === 'live') : filter === 'revoked' ? lastList.filter(c => /^revoked/.test(c.status)) : lastList;
  if (!lastList.length) return emptyWall('No certificates yet.', 'The first certificate appears here the moment it lands on chain, and turns over the moment its funds move.');
  if (!list.length) return emptyWall(filter === 'live' ? 'No live certificates right now.' : 'Nothing revoked yet.', 'Switch the filter to see the rest of the wall.');
  let g = wall.querySelector('.wall-grid');
  if (!g) { wall.innerHTML = '<div class="wall-grid"></div>'; g = wall.firstElementChild; }
  const old = new Map($$('.ct', g).map(el => [el.dataset.addr, el]));
  const out = list.slice(0, 48).map(c => {
    const o = old.get(c.address);
    if (o && o.dataset.status === c.status) return o;
    const t = document.createElement('div'); t.innerHTML = tile(c).trim();
    const el = t.firstElementChild; if (old.size && !o) el.classList.add('new');
    return el;
  });
  g.replaceChildren(...out);
}
for (const b of $$('[data-filter]')) b.addEventListener('click', () => {
  filter = b.dataset.filter;
  $$('[data-filter]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  drawWall();
});

(async () => {
  const src = await source();
  const live = LIVE || src.mode === 'fixture';
  if (!live) { emptyWall('No certificates yet.', 'The first certificate appears here the moment it lands on chain, and turns over the moment its funds move.'); return; }
  seg.hidden = false;
  const tick = async () => {
    try {
      const [s, r] = await Promise.all([src.stats(), src.list({ status: 'any', limit: 500 })]);
      mode = 'live';
      liveLabel.textContent = 'Live certificates, read from chain';
      liveNum.textContent = num(s.live);
      liveSub.innerHTML = `slot <b data-live-slot>${num(slot || s.slot)}</b> · at least ${num(s.solCertified)} SOL and ${num(s.usdcCertified)} USDC certified`;
      lastList = r.certificates.slice().sort((a, b) => Math.max(+b.certifiedSlot || 0, +b.revokedSlot || 0) - Math.max(+a.certifiedSlot || 0, +a.revokedSlot || 0));
      drawWall();
    } catch (e) {
      if (!lastList.length) emptyWall('The wall could not be read just now.', `${e.message} It retries by itself.`);
    }
  };
  await tick();
  setInterval(() => { if (!document.hidden) tick(); }, src.mode === 'fixture' ? 3500 : 6000);
})();

/* ------------------------------------------------------------------ the film: its own frame, captions under the picture */
const film = $('[data-film]');
if (film) {
  const box = $('[data-film-v]'), cap = $('[data-film-cap]'), prog = $('[data-film-prog]'), tog = $('[data-film-toggle]'), mute = $('[data-film-mute]');
  let v = null, opener = null;
  const make = () => {
    v = Object.assign(document.createElement('video'), { src: FILM.src, poster: FILM.poster, playsInline: true, preload: 'auto' });
    const t = Object.assign(document.createElement('track'), { kind: 'captions', src: FILM.captions, srclang: 'en', label: 'English', default: true });
    v.appendChild(t); box.appendChild(v);
    t.track.mode = 'hidden';
    t.track.addEventListener('cuechange', () => { const c = t.track.activeCues && t.track.activeCues[0]; cap.textContent = c ? c.text : ''; });
    v.addEventListener('timeupdate', () => { prog.style.width = `${(100 * v.currentTime) / (v.duration || 1)}%`; });
    v.addEventListener('ended', () => { tog.textContent = 'Play again'; cap.textContent = ''; });
    v.addEventListener('click', toggle);
  };
  const toggle = () => { if (v.paused || v.ended) { v.play(); tog.textContent = 'Pause'; } else { v.pause(); tog.textContent = 'Play'; } };
  const open = e => { opener = e?.currentTarget || null; if (!v) make(); film.hidden = false; document.documentElement.style.overflow = 'hidden'; v.currentTime = 0; v.play().catch(() => {}); tog.textContent = 'Pause'; $('[data-film-close]').focus(); };
  const close = () => { if (v) v.pause(); film.hidden = true; document.documentElement.style.overflow = ''; opener?.focus(); };
  $$('[data-film-open]').forEach(b => b.addEventListener('click', open));
  $('[data-film-close]').addEventListener('click', close);
  film.addEventListener('click', e => { if (e.target === film) close(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !film.hidden) close(); });
  tog.addEventListener('click', toggle);
  mute.addEventListener('click', () => { v.muted = !v.muted; mute.textContent = v.muted ? 'Sound on' : 'Sound off'; });
}
