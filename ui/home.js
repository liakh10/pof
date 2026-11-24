/* Home: the poster, the live chain number, the counters and the certificate wall (revoking in real time). */
import { $, $$, num, roll, esc } from './fmt.js';
import { source, LIVE } from './data.js';
import { syncCards } from './cards.js';
import { sealSVG, markSVG } from './seal.js';

const FILM = window.POF_FILM || null;   // { src, poster, captions, length } once the film ships (ui/film.js sets it)
const liveNum = $('[data-live-num]'), liveLabel = $('[data-live-label]'), liveSub = $('[data-live-sub]');
const wall = $('[data-wall]');
const film = $('[data-film]');
let src, mode = 'pre', filter = 'any', lastList = [], slot = 0;

/* the hero cross lines meet at the seal's centre */
function placeCross() {
  const hero = $('.hero'), seal = film && film.querySelector('.seal');
  if (!hero || !seal) return;
  const a = hero.getBoundingClientRect(), b = seal.getBoundingClientRect();
  hero.querySelector('.hero-cross').style.setProperty('--cx', `${b.left - a.left + b.width / 2}px`);
  hero.querySelector('.hero-cross').style.setProperty('--cy', `${b.top - a.top + b.height / 2}px`);
  hero.querySelector('.hero-cross').style.setProperty('--cl', `${$('.hero-art').getBoundingClientRect().left - a.left - 24}px`);
}
addEventListener('resize', placeCross); placeCross(); document.fonts?.ready.then(placeCross);

/* a revoke somewhere: the hero seal's signal ring breaks, then draws itself whole again */
let breaking = false;
function breakSeal() {
  if (!film || breaking || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  breaking = true;
  const old = film.querySelector('.seal');
  const tmp = document.createElement('div'); tmp.innerHTML = sealSVG({ state: 'revoked' });
  const broken = tmp.firstElementChild; broken.classList.add('breaking');
  old.replaceWith(broken);
  setTimeout(() => {
    const t2 = document.createElement('div'); t2.innerHTML = sealSVG({ state: 'live' });
    const whole = t2.firstElementChild; whole.classList.add('draw');
    broken.replaceWith(whole); breaking = false;
  }, 2600);
}
function pulseSeal() { const s = film?.querySelector('.seal'); if (!s) return; s.classList.remove('pulse'); void s.getBoundingClientRect(); s.classList.add('pulse'); }

/* ------------------------------------------------------------------ the live number */
addEventListener('pof:slot', e => {
  slot = e.detail;
  if (mode === 'pre') liveNum.textContent = num(slot);
  else $('[data-live-slot]') && ($('[data-live-slot]').textContent = num(slot));
});
function preLaunch() {
  mode = 'pre';
  liveLabel.textContent = 'Solana mainnet slot, read live';
  liveSub.innerHTML = `<span>The wall fills from the chain the moment the first certificate lands.</span>`;
}

async function readStats() {
  const s = await src.stats();
  mode = 'live';
  liveLabel.textContent = 'Live certificates, read from chain';
  roll(liveNum, s.live);
  liveSub.innerHTML = `<span>slot <b data-live-slot>${num(slot || s.slot)}</b></span><span>at least <b>${num(s.solCertified)} SOL</b> and <b>${num(s.usdcCertified)} USDC</b> certified</span>`;
  const set = (k, v) => roll($(`[data-c="${k}"]`), Number(v) || 0);
  set('live', s.live); set('sol', s.solCertified); set('usdc', s.usdcCertified); set('spent', s.revokedSpent); set('holder', s.revokedByHolder); set('log', s.log?.treeSize ?? 0);
}

/* ------------------------------------------------------------------ the wall */
const order = c => Math.max(Number(c.certifiedSlot) || 0, Number(c.revokedSlot) || 0);
function visible(list) {
  if (filter === 'live') return list.filter(c => c.status === 'live');
  if (filter === 'revoked') return list.filter(c => c.status === 'revoked_spent' || c.status === 'revoked_by_holder');
  return list;
}
function emptyWall(text) {
  wall.innerHTML = `<div class="empty" style="grid-column:1/-1;display:grid;grid-template-columns:72px 1fr;gap:var(--s5);align-items:center">${markSVG({ state: 'live', size: 72 })}<div><p class="h3">${esc(text.title)}</p><p class="quiet" style="margin:0">${esc(text.body)}</p></div></div>`;
}
function drawWall() {
  const list = visible(lastList);
  if (!lastList.length) return emptyWall({ title: 'No certificates yet.', body: 'The first certificate appears here the moment it lands on chain, and turns over the moment its funds move.' });
  if (!list.length) return emptyWall({ title: filter === 'live' ? 'No live certificates right now.' : 'Nothing revoked yet.', body: 'Switch the filter to see the rest of the wall.' });
  if (wall.querySelector('.empty')) wall.replaceChildren();
  const flipped = syncCards(wall, list, { limit: 48 });
  if (flipped.length) breakSeal();
  window.dispatchEvent(new Event('pof:content'));
}
async function readWall() {
  const r = await src.list({ status: 'any', limit: 500 });
  const before = new Set(lastList.map(c => c.address));
  lastList = r.certificates.slice().sort((a, b) => order(b) - order(a));
  if (before.size && lastList.some(c => !before.has(c.address))) pulseSeal();
  drawWall();
}
for (const b of $$('[data-filter]')) b.addEventListener('click', () => {
  filter = b.dataset.filter;
  $$('[data-filter]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  wall.replaceChildren(); drawWall();
});

/* ------------------------------------------------------------------ the film (shown only when it exists) */
if (FILM && film) {
  const plays = $$('[data-film-play]');
  plays.forEach(p => (p.hidden = false));
  $('[data-film-cta]').hidden = false;
  if (FILM.length) $('[data-film-len]').textContent = FILM.length;
  plays.forEach(p => p.addEventListener('click', () => {
    let v = film.querySelector('video');
    if (!v) {
      v = Object.assign(document.createElement('video'), { src: FILM.src, playsInline: true, controls: true, preload: 'auto' });
      if (FILM.poster) v.poster = FILM.poster;
      if (FILM.captions) { const t = Object.assign(document.createElement('track'), { kind: 'captions', src: FILM.captions, srclang: 'en', label: 'English', default: true }); v.appendChild(t); }
      film.appendChild(v);
      v.addEventListener('ended', () => film.classList.remove('playing'));
    }
    film.classList.add('playing'); v.play();
  }));
}

/* ------------------------------------------------------------------ start */
(async () => {
  src = await source();
  const live = LIVE || src.mode === 'fixture';
  if (!live) { preLaunch(); emptyWall({ title: 'No certificates yet.', body: 'The first certificate appears here the moment it lands on chain, and turns over the moment its funds move.' }); return; }
  wall.innerHTML = Array.from({ length: 8 }, () => '<div class="cert skeleton" aria-hidden="true"></div>').join('');
  const tick = async () => {
    try { await Promise.all([readStats(), readWall()]); }
    catch (e) {
      if (!lastList.length) emptyWall({ title: 'The wall could not be read just now.', body: `${e.message} It retries by itself.` });
    }
  };
  await tick();
  setInterval(() => { if (!document.hidden) tick(); }, src.mode === 'fixture' ? 3500 : 6000);
})();
