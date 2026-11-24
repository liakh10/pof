/* Proof of Funds · design variant v1 "Poster series": composes the sheets. It imports the site's engines (data source,
   slot clock via app.js, the seal, the cards) and only adds what this composition needs: finer hairline rings and tick
   marks on the seal, rings that draw as a sheet arrives, one ring lit per step, a seal that breaks on the revocation sheet,
   the film inside the seal, and the wall made of live cards. */
import { $, $$, num, roll, esc } from '/ui/fmt.js';
import { source, LIVE } from '/ui/data.js';
import { syncCards } from '/ui/cards.js';
import { sealSVG, markSVG } from '/ui/seal.js';

const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
/* the sheet height: the viewport height at load, re-read only when the width changes (a phone's toolbar sliding in and out
   must not resize every poster) */
{ let w = 0; const fit = () => { if (innerWidth === w) return; w = innerWidth; document.documentElement.style.setProperty('--vh', `${innerHeight}px`); }; fit(); addEventListener('resize', fit); }
if (!RM) document.documentElement.classList.add('js-motion');

/* ------------------------------------------------------------------ the seal, drawn finer */
const ON_INK = { paper: 'var(--ink)', ink: 'var(--on-ink)', signal: 'var(--signal)', quiet: 'rgba(243,239,230,.4)' };
const QUIET_SIG = { paper: 'var(--paper)', ink: 'var(--ink)', signal: 'var(--ink)', quiet: 'var(--ink-3)' };

/** hairline rings between the outer rings, a fine tick ring outside and a micro tick ring inside the segmented ring */
function fine(svg, ink) {
  const hair = [];
  for (let r = 295, i = 0; r <= 475; r += 18, i++) hair.push(`<circle class="hair" style="--i:${i}" r="${r}" fill="none" stroke="${ink}" stroke-width=".7" pathLength="1000"/>`);
  hair.push(`<circle class="hair" style="--i:2" r="176" fill="none" stroke="${ink}" stroke-width=".6" pathLength="1000"/>`);
  hair.push(`<circle class="hair" style="--i:4" r="197" fill="none" stroke="${ink}" stroke-width=".6" pathLength="1000"/>`);
  const t = (a, r0, r1) => { const c = Math.cos(a), s = Math.sin(a); return `M${(c * r0).toFixed(1)} ${(s * r0).toFixed(1)}L${(c * r1).toFixed(1)} ${(s * r1).toFixed(1)}`; };
  let outer = '', major = '', inner = '';
  for (let k = 0; k < 360; k += 2) {
    const a = (k * Math.PI) / 180;
    if (k % 30 === 0) major += t(a, 491, 522); else outer += t(a, 492, k % 10 === 0 ? 506 : 499);
  }
  for (let k = 0; k < 360; k += 3) inner += t((k * Math.PI) / 180, 152, k % 15 === 0 ? 161 : 157);
  const ticks = `<g class="ticks" fill="none" stroke="${ink}"><path d="${outer}" stroke-width=".7"/><path d="${major}" stroke-width="1.4"/><path d="${inner}" stroke-width=".6"/></g>`;
  return svg.replace('<g class="spin">', hair.join('') + ticks + '<g class="spin">');
}
function seal(kind) {
  if (kind === 'break') return fine(sealSVG({ state: 'live', colors: ON_INK, crosshair: false }), 'var(--on-ink)');
  if (kind === 'left') return fine(sealSVG({ state: 'live', colors: QUIET_SIG }), 'var(--ink)');
  return fine(sealSVG({ state: 'live', crosshair: kind !== 'hero' }), 'var(--ink)');
}
for (const el of $$('[data-seal]')) el.innerHTML = seal(el.dataset.seal);
const drawIn = root => { if (!RM) $$('.seal', root).forEach(s => { s.classList.remove('draw'); void s.getBoundingClientRect(); s.classList.add('draw'); }); };
drawIn($('.p1'));
/* the headline columns meet the disc exactly: measure the seal, hand its disc width to the type grid */
{ const s1 = $('.p1-seal'), p1 = $('.p1'); new ResizeObserver(() => p1.style.setProperty('--disc-px', `${s1.offsetWidth * 0.25}px`)).observe(s1); }

/* the visible grid: twelve column hairlines on every sheet */
for (const bl of $$('.bl')) bl.innerHTML = `<div class="cols">${'<i></i>'.repeat(12)}</div>`;

/* ------------------------------------------------------------------ sheets arriving: draw, index the header */
const sN = $('[data-series-n]'), sT = $('[data-series-t]');
const posters = $$('.poster');
const seen = new WeakSet();
const arrive = new IntersectionObserver(es => es.forEach(e => {
  if (!e.isIntersecting || seen.has(e.target)) return;
  seen.add(e.target); e.target.classList.add('on');
  if (e.target !== posters[0]) drawIn(e.target);
  if (e.target.classList.contains('p4')) breakLater(e.target);
}), { threshold: 0.22 });
posters.forEach(p => arrive.observe(p));
const index = new IntersectionObserver(es => es.forEach(e => {
  if (!e.isIntersecting) return;
  const i = posters.indexOf(e.target);
  sN.textContent = String(i + 1).padStart(2, '0');
  sT.textContent = e.target.dataset.title;
}), { rootMargin: '-45% 0px -54% 0px' });
posters.forEach(p => index.observe(p));

/* ------------------------------------------------------------------ 03: one ring lit per step */
const RING_OF_STEP = [1, 3, 5, 7];
const p3rings = () => $$('.p3-seal .rg');
const steps = $$('.p3-steps li');
function light(n) {
  steps.forEach((li, i) => li.classList.toggle('act', i <= n));
  p3rings().forEach((r, i) => r.classList.toggle('lit', RING_OF_STEP.indexOf(i) > -1 && RING_OF_STEP.indexOf(i) <= n));
}
if (RM) light(3);
else {
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) light(Number(e.target.dataset.step)); }), { rootMargin: '-30% 0px -40% 0px' });
  steps.forEach(li => io.observe(li));
}

/* ------------------------------------------------------------------ 04: the signal ring breaks open after it has drawn */
function shards() {
  const r = 226, a0 = -0.11 * 2 * Math.PI, a1 = a0 + 0.085 * 2 * Math.PI;
  const p = (a, rr) => `${(Math.cos(a) * rr).toFixed(1)} ${(Math.sin(a) * rr).toFixed(1)}`;
  return `<path class="shard" d="M ${p(a0 + .012, r + 26)} A ${r + 26} ${r + 26} 0 0 1 ${p(a0 + .05, r + 26)}" stroke="var(--signal)" stroke-width="18" fill="none"/>`
    + `<path class="shard" d="M ${p(a1 - .05, r + 44)} A ${r + 44} ${r + 44} 0 0 1 ${p(a1 - .014, r + 44)}" stroke="var(--signal)" stroke-width="18" fill="none"/>`;
}
function breakNow(sheet) {
  const svg = $('.p4-seal svg', sheet); if (!svg || sheet.classList.contains('broke')) return;
  svg.insertAdjacentHTML('beforeend', shards());
  svg.classList.add('breaking');
  sheet.classList.add('broke');
}
function breakLater(sheet) { if (RM) breakNow(sheet); else setTimeout(() => breakNow(sheet), 2300); }

/* ------------------------------------------------------------------ the live chain number */
const slotEls = $$('[data-slot]');
addEventListener('pof:slot', e => {
  const s = num(e.detail);
  /* each figure in its own equal cell, so the proportional digits never make the number shiver as it ticks */
  const cells = [...s].map((ch, i, a) => ch === ',' ? '<span class="c">,</span>' : `<span class="d${i === a.length - 1 ? ' tk' : ''}">${ch}</span>`).join('');
  for (const el of slotEls) { el.innerHTML = cells; el.setAttribute('aria-label', s); }
});

/* ------------------------------------------------------------------ the film: inside the seal, the progress is an orange hairline round it */
const FILM = { src: '/film/pof.mp4', poster: '/film/poster.jpg', captions: '/film/pof.vtt' };
{
  const field = $('[data-film]'), sheet = $('.p1');
  const plays = $$('[data-film-play]'), mute = $('[data-film-mute]'), cap = $('[data-film-cap]'), label = $('[data-film-label]'), prog = $('[data-film-progress]');
  let v = null;
  const make = () => {
    v = Object.assign(document.createElement('video'), { src: FILM.src, playsInline: true, preload: 'auto', poster: FILM.poster });
    v.setAttribute('aria-label', 'The Proof of Funds film');
    const t = Object.assign(document.createElement('track'), { kind: 'captions', src: FILM.captions, srclang: 'en', label: 'English', default: true });
    v.appendChild(t);
    field.insertBefore(v, $('.p1-prog'));
    t.track.mode = 'hidden';
    t.track.addEventListener('cuechange', () => { const c = t.track.activeCues && t.track.activeCues[0]; cap.textContent = c ? c.text : ''; });
    v.addEventListener('timeupdate', () => { prog.style.strokeDashoffset = String(1000 * (1 - v.currentTime / (v.duration || 1))); });
    v.addEventListener('ended', () => { sheet.classList.remove('playing'); label.textContent = 'Play again'; cap.textContent = ''; mute.hidden = true; });
  };
  const toggle = () => {
    if (!v) make();
    if (v.paused) { sheet.classList.add('playing'); v.play(); label.textContent = 'Pause'; mute.hidden = false; }
    else { v.pause(); sheet.classList.remove('playing'); label.textContent = 'Play'; }
  };
  plays.forEach(p => p.addEventListener('click', toggle));
  mute.addEventListener('click', () => { if (!v) return; v.muted = !v.muted; mute.textContent = v.muted ? 'Sound on' : 'Sound off'; });
  addEventListener('keydown', e => { if (e.key === 'Escape' && v && !v.paused) toggle(); });
}

/* ------------------------------------------------------------------ 06: the wall, made of live cards */
const wall = $('[data-wall]');
let filter = 'any', lastList = [];
const order = c => Math.max(Number(c.certifiedSlot) || 0, Number(c.revokedSlot) || 0);
const visible = list => filter === 'live' ? list.filter(c => c.status === 'live') : filter === 'revoked' ? list.filter(c => c.status === 'revoked_spent' || c.status === 'revoked_by_holder') : list;

function frames(title, body) {
  const ghost = '<svg class="ghost" viewBox="-40 -40 80 80" aria-hidden="true"><circle r="12" stroke-width="1"/><circle r="22" stroke-width=".6"/><circle r="32" stroke-width=".6"/><path d="M-40 0H40M0-40V40" stroke-width=".6"/></svg>';
  const cells = Array.from({ length: 6 }, (_, i) => `<div class="frame" aria-hidden="true"><span class="fno">${String(i + 2).padStart(3, '0')}</span>${ghost}</div>`).join('');
  wall.innerHTML = `<div class="frame first">${markSVG({ state: 'live', size: 56 })}<span class="fno">001</span><h3>${esc(title)}</h3><p>${esc(body)}</p></div>${cells}`;
}
function drawWall() {
  const list = visible(lastList);
  if (!lastList.length) return frames('No certificates yet.', 'The first certificate appears here the moment it lands on chain, and turns over the moment its funds move.');
  if (!list.length) return frames(filter === 'live' ? 'No live certificates right now.' : 'Nothing revoked yet.', 'Switch the filter to see the rest of the wall.');
  if (wall.querySelector('.frame')) wall.replaceChildren();
  const flipped = syncCards(wall, list, { limit: 16 });
  if (flipped.length) { const p4 = $('.p4'); if (p4) { p4.classList.remove('broke'); breakLater(p4); } }
}
for (const b of $$('[data-filter]')) b.addEventListener('click', () => {
  filter = b.dataset.filter;
  $$('[data-filter]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  wall.replaceChildren(); drawWall();
});

(async () => {
  const src = await source();
  const live = LIVE || src.mode === 'fixture';
  if (!live) { drawWall(); return; }
  wall.innerHTML = Array.from({ length: 8 }, () => '<div class="cert skeleton" aria-hidden="true"></div>').join('');
  const tick = async () => {
    try {
      const [s, r] = await Promise.all([src.stats(), src.list({ status: 'any', limit: 500 })]);
      const set = (k, v) => roll($(`[data-c="${k}"]`), Number(v) || 0);
      set('live', s.live); set('sol', s.solCertified); set('usdc', s.usdcCertified); set('spent', s.revokedSpent); set('holder', s.revokedByHolder); set('log', s.log?.treeSize ?? 0);
      $('[data-live-sub]').textContent = `${num(s.live)} live certificates. At least ${num(s.solCertified)} SOL and ${num(s.usdcCertified)} USDC certified.`;
      lastList = r.certificates.slice().sort((a, b) => order(b) - order(a));
      drawWall();
    } catch (e) {
      if (!lastList.length) frames('The wall could not be read just now.', `${e.message} It retries by itself.`);
    }
  };
  await tick();
  setInterval(() => { if (!document.hidden) tick(); }, src.mode === 'fixture' ? 3500 : 6000);
})();
