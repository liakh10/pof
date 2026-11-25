/* Direction M · WebGL: the page. The live slot comes from the one slot clock of /ui/app.js (`pof:slot`), the wall and the
   stats from /ui/data.js, the formatting from /ui/fmt.js. This file adds the ring stages, the film and the ledger rows. */
import { $, $$, num, esc, short, tierParts, subjectLine, certPath, STATUS_TEXT, KIND_TEXT } from '/ui/fmt.js';
import { source, LIVE } from '/ui/data.js';

const FILM = { src: '/film/pof.mp4', poster: '/film/poster.jpg', captions: '/film/pof.vtt', length: 36 };
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const hero = $('[data-hero]'), art = $('[data-art]'), steps = $('[data-steps]');
const top = $('[data-top]');

/* ------------------------------------------------------------------ header: a paper bar once the page moves */
const onScroll = () => top.classList.toggle('scrolled', scrollY > 8);
addEventListener('scroll', onScroll, { passive: true }); onScroll();


/* ------------------------------------------------------------------ the live number (mono figures, the commas tucked in) */
const monoNum = n => num(n).replace(/,/g, '<span class="sep">,</span>');
/** count up to n in mono figures */
function roll(el, n, ms = 700) {
  if (!el) return;
  const from = Number(el.dataset.v || 0), to = Number(n) || 0; el.dataset.v = String(to);
  if (from === to || reduce) { el.innerHTML = monoNum(to); return; }
  const t0 = performance.now();
  const step = now => { const k = Math.min(1, (now - t0) / ms), e = 1 - (1 - k) ** 3; el.innerHTML = monoNum(Math.round(from + (to - from) * e)); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
let mode = 'pre', slot = 0;
const liveNum = $('[data-live-num]'), liveLabel = $('[data-live-label]'), liveSub = $('[data-live-sub]');
addEventListener('pof:slot', e => {
  slot = e.detail;
  if (mode === 'pre') { if (!liveNum.classList.contains('ready')) liveNum.classList.add('ready'); liveNum.innerHTML = monoNum(slot); }
  else { const s = $('[data-live-slot]'); if (s) s.textContent = num(slot); }
});

/* ------------------------------------------------------------------ the ring stages */
const input = { x: 0, y: 0, tx: 0, ty: 0 };
let heroStage = null, stepsStage = null, heroOn = true, stepsOn = false, filmOn = false;
async function rings() {
  if (reduce) return; // the stills on disk are frames of the same scenes: reduced motion keeps them
  let gl;
  try { gl = await import('./rings.js'); } catch { return; }
  if (!gl.supported()) return;
  try {
    heroStage = new gl.Stage($('[data-hero-gl]'), { dprMax: 2 }).add(art, gl.hero(), 'virtual');
    stepsStage = new gl.Stage($('[data-steps-gl]'), { dprMax: 2 });
    for (const el of $$('[data-view]')) stepsStage.add(el, gl.step(el.dataset.view), 'rect');
  } catch { return; }
  const q = new URLSearchParams(location.search);
  if (q.has('stills')) return stills();
  if (q.has('t') && ['localhost', '127.0.0.1'].includes(location.hostname)) { heroStage.offset = stepsStage.offset = Number(q.get('t')) || 0; heroStage.freeze = stepsStage.freeze = q.has('freeze'); } // development: start the loops at a moment
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.target === hero) heroOn = e.isIntersecting;
    if (e.target === steps) stepsOn = e.isIntersecting;
  }), { rootMargin: '80px 0px' });
  io.observe(hero); io.observe(steps);
  hero.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    const b = art.getBoundingClientRect(), h = b.width * 0.625;
    input.tx = Math.max(-1, Math.min(1, (e.clientX - (b.left + b.width / 2)) / h));
    input.ty = Math.max(-1, Math.min(1, (e.clientY - (b.top + b.height / 2)) / h));
  });
  hero.addEventListener('pointerleave', () => { input.tx = 0; input.ty = 0; });
  let last = performance.now();
  const loop = now => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const k = 1 - Math.exp(-dt * 3);
    input.x += (input.tx - input.x) * k; input.y += (input.ty - input.y) * k;
    if (!document.hidden) {
      if (heroOn && !filmOn && heroStage.render(now, input) && heroStage.frames === 1) { $('[data-hero-gl]').classList.add('on'); hero.classList.add('gl-live'); }
      if (stepsOn && stepsStage.render(now) && stepsStage.frames === 1) { $('[data-steps-gl]').classList.add('on'); steps.classList.add('gl-live'); }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
/* development only (?stills on localhost): render every view at its key frame for the files in still/ */
function stills() {
  if (!['localhost', '127.0.0.1'].includes(location.hostname)) return;
  const out = { hero: heroStage.still(0, 1800), hero900: heroStage.still(0, 900, 1) };
  $$('[data-view]').forEach((el, i) => { out[el.dataset.view] = stepsStage.still(i, 560, 2); });
  window.__stills = out;
}

/* ------------------------------------------------------------------ the film: it opens in the rings, edges feathered into the
   paper, captions and controls as plain text under it */
{
  const box = $('[data-film]'), cap = $('[data-film-cap]'), time = $('[data-film-time]');
  const tog = $('[data-film-toggle]'), mute = $('[data-film-mute]'), close = $('[data-film-close]');
  let v = null;
  const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const make = () => {
    v = Object.assign(document.createElement('video'), { src: FILM.src, poster: FILM.poster, playsInline: true, preload: 'auto' });
    v.setAttribute('aria-label', 'The Proof of Funds film');
    const tr = Object.assign(document.createElement('track'), { kind: 'captions', src: FILM.captions, srclang: 'en', label: 'English', default: true });
    v.appendChild(tr); box.appendChild(v);
    tr.track.mode = 'hidden';
    tr.track.addEventListener('cuechange', () => { const c = tr.track.activeCues && tr.track.activeCues[0]; cap.textContent = c ? c.text : ''; });
    v.addEventListener('timeupdate', () => { time.textContent = `${mmss(v.currentTime)} / ${mmss(v.duration || FILM.length)}`; });
    v.addEventListener('ended', stop);
    v.addEventListener('click', toggle);
  };
  const open = () => {
    if (!v) make();
    filmOn = true; hero.classList.add('film-on');
    v.currentTime = v.ended ? 0 : v.currentTime; v.muted = false; mute.textContent = 'Sound off';
    v.play().catch(() => {}); tog.textContent = 'Pause';
  };
  const toggle = () => { if (!v) return; if (v.paused) { v.play(); tog.textContent = 'Pause'; } else { v.pause(); tog.textContent = 'Play'; } };
  function stop() { if (v) { v.pause(); v.currentTime = 0; } cap.textContent = ''; hero.classList.remove('film-on'); filmOn = false; $('[data-film-play]').focus({ preventScroll: true }); }
  $('[data-film-play]').addEventListener('click', open);
  tog.addEventListener('click', toggle);
  close.addEventListener('click', stop);
  mute.addEventListener('click', () => { if (!v) return; v.muted = !v.muted; mute.textContent = v.muted ? 'Sound on' : 'Sound off'; });
  addEventListener('keydown', e => { if (e.key === 'Escape' && filmOn) stop(); });
}

/* ------------------------------------------------------------------ the wall: a ledger, read from chain */
const wall = $('[data-wall]');
let filter = 'any', lastList = [];
const order = c => Math.max(Number(c.certifiedSlot) || 0, Number(c.revokedSlot) || 0);
const isRevoked = s => s === 'revoked_spent' || s === 'revoked_by_holder';
const glyph = state => state === 'live'
  ? '<svg viewBox="-20 -20 40 40" width="28" height="28" aria-hidden="true"><circle r="17" fill="none" stroke="currentColor" stroke-width=".8" opacity=".35"/><circle r="11" fill="none" stroke="var(--signal)" stroke-width="2.4"/></svg>'
  : '<svg viewBox="-20 -20 40 40" width="28" height="28" aria-hidden="true"><circle r="17" fill="none" stroke="currentColor" stroke-width=".8" opacity=".35"/><circle r="11" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="3 4.2" opacity=".7"/></svg>';
function row(c) {
  const t = tierParts(c.tierLabel, c.asset), subj = subjectLine(c), state = c.status === 'live' ? 'live' : isRevoked(c.status) ? 'revoked' : 'expired';
  const slotTxt = isRevoked(c.status) && c.revokedSlot ? num(c.revokedSlot) : num(c.certifiedSlot);
  return `<a class="row" role="row" href="${esc(certPath(c))}" data-addr="${esc(c.address)}" data-status="${esc(c.status)}">
  <span class="g" role="cell">${glyph(state)}</span>
  <span class="s" role="cell"><span class="subj" title="${esc(subj)}">${subj === c.subjectHash ? 'hash ' : ''}${esc(short(subj, 6))}</span><span class="kind">${esc(KIND_TEXT[c.kind] || c.kind)}</span></span>
  <span class="tier" role="cell"><span class="sr">at least </span>${esc(t.amt)}<small>${esc(t.sym)}</small></span>
  <span class="st is-${state}" role="cell">${esc(STATUS_TEXT[c.status] || c.status)}</span>
  <span class="slot r" role="cell">${slotTxt}</span>
</a>`;
}
function drawWall() {
  const list = filter === 'live' ? lastList.filter(c => c.status === 'live') : filter === 'revoked' ? lastList.filter(c => isRevoked(c.status)) : lastList;
  if (!list.length) return; // the empty state in the HTML stays
  const before = new Map($$('.row', wall).map(el => [el.dataset.addr, el.dataset.status]));
  wall.innerHTML = list.slice(0, 48).map(row).join('');
  for (const el of $$('.row', wall)) if (before.has(el.dataset.addr) && before.get(el.dataset.addr) !== el.dataset.status) el.classList.add('flip');
}
for (const b of $$('[data-filter]')) b.addEventListener('click', () => {
  filter = b.dataset.filter;
  $$('[data-filter]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  drawWall();
});

(async () => {
  rings();
  const src = await source();
  if (!(LIVE || src.mode === 'fixture')) return; // before launch: the slot, and an honest empty wall
  const tick = async () => {
    try {
      const [s, r] = await Promise.all([src.stats(), src.list({ status: 'any', limit: 500 })]);
      mode = 'live';
      liveLabel.textContent = 'Live certificates, read from chain';
      roll(liveNum, s.live); liveNum.classList.add('ready');
      liveSub.innerHTML = `<span>slot <b data-live-slot>${num(slot || s.slot)}</b></span><span>at least <b>${num(s.solCertified)} SOL</b> and <b>${num(s.usdcCertified)} USDC</b> certified</span>`;
      $('[data-tally]').hidden = false; $('[data-filters]').hidden = false;
      for (const [k, v] of [['live', s.live], ['sol', s.solCertified], ['usdc', s.usdcCertified], ['spent', s.revokedSpent]]) roll($(`[data-c="${k}"]`), Number(v) || 0);
      lastList = r.certificates.slice().sort((a, b) => order(b) - order(a));
      drawWall();
    } catch { /* the wall keeps what it showed; it retries */ }
  };
  await tick();
  setInterval(() => { if (!document.hidden) tick(); }, src.mode === 'fixture' ? 3500 : 6000);
})();
