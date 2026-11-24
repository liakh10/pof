/* m-riso: the home page as a two-ink print. The figures are pressed by ./riso.js; the shell (menu, CA box, the one slot
   clock that broadcasts `pof:slot`) is /ui/app.js; data and formatting are /ui/data.js and /ui/fmt.js, as on the live site. */
import { $, $$, num, roll, esc, short, tierParts, subjectLine, certPath, STATUS_SHORT, KIND_TEXT } from '/ui/fmt.js';
import { source, LIVE } from '/ui/data.js';
import { INK, tone, shape, screen, regMark, ring, bytes } from './riso.js';

const RM = matchMedia('(prefers-reduced-motion: reduce)');
const B = INK.blue, P = INK.pink;
const plate = (ink, vb, body) => `<svg class="plate p-${ink}" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${body}</svg>`;
const path = (d, ink) => `<path d="${d}" fill="${ink}"/>`;
const marks = (pts, ink, s) => pts.map(([x, y]) => regMark(x, y, s, ink)).join('');

/* ------------------------------------------------------------------ the figures */
const FIGS = {
  /* the sheet: the blue screen and the pink solid meet over the centre; the film is printed through a hole in both
     plates; the signal ring is printed in both inks, so in register it is the third colour */
  hero() {
    const vb = '0 0 640 640', C = 320;
    const hole = id => `<mask id="${id}"><rect width="640" height="640" fill="#fff"/><circle cx="${C}" cy="${C}" r="137" fill="#000"/></mask>`;
    const corners = [[26, 26], [614, 26], [26, 614], [614, 614]];
    const blueDots = screen(shape.disc(398, 242, 218), { pitch: 6.4, angle: 75, tone: tone.linear(236, 404, 0.03, 548, 92, 0.7) });
    const pinkDots = screen(shape.minus(shape.ring(C, C, 168, 246), shape.disc(242, 398, 218)), { pitch: 6.4, angle: 15, tone: tone.linear(C, 520, 0.42, C, 110, 0.06) });
    const hairs = [262, 274, 286].map(r => `<circle cx="${C}" cy="${C}" r="${r}" fill="none" stroke="${B}" stroke-width="1.1"/>`).join('');
    const ticks = Array.from({ length: 120 }, (_, i) => {
      const a = (i * 3 - 90) * Math.PI / 180, long = i % 10 === 0, r0 = 296, r1 = long ? 312 : 303;
      return `M${(C + r0 * Math.cos(a)).toFixed(2)} ${(C + r0 * Math.sin(a)).toFixed(2)}L${(C + r1 * Math.cos(a)).toFixed(2)} ${(C + r1 * Math.sin(a)).toFixed(2)}`;
    }).join('');
    const blue = `<defs>${hole('hb')}</defs><g mask="url(#hb)">${path(blueDots, B)}${hairs}<path d="${ticks}" stroke="${B}" stroke-width="1.1"/>
      <path d="M0 ${C}H640M${C} 0V640" stroke="${B}" stroke-width="1"/></g>
      <g class="sig-b">${ring(C, C, 150, 13, B)}</g>${marks(corners, B, 13)}`;
    const pink = `<defs>${hole('hp')}</defs><g mask="url(#hp)"><circle cx="242" cy="398" r="218" fill="${P}" filter="url(#ink)"/>${path(pinkDots, P)}</g>
      ${ring(C, C, 150, 13, P)}${marks(corners, P, 13)}`;
    return { vb, blue, pink };
  },

  /* 01 shield: the notes sit in the vault, printed in blue under a pink solid: you see them only as the overlap */
  shield() {
    const vb = '0 0 300 300', C = 150;
    const notes = Array.from({ length: 12 }, (_, i) => { const a = (i * 30 - 75) * Math.PI / 180; return [C + 84 * Math.cos(a), C + 84 * Math.sin(a)]; });
    const blue = `<circle cx="${C}" cy="${C}" r="134" fill="none" stroke="${B}" stroke-width="1.2"/>${notes.map(([x, y]) => `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="17" fill="${B}"/>`).join('')}
      ${path(screen(shape.disc(C, C, 52), { pitch: 5, angle: 75, tone: tone.radial(C, C, 52, 0.55, 0.1) }), B)}`;
    const pink = `<circle cx="${C}" cy="${C}" r="118" fill="${P}" filter="url(#ink)"/>`;
    return { vb, blue, pink };
  },

  /* 02 disclose: three notes leave the ring (the fewest that reach the tier); the rest stay screened, unread */
  disclose() {
    const vb = '0 0 300 300', C = 150, out = [-30, 0, 30];
    let blue = `<circle cx="${C}" cy="${C}" r="134" fill="none" stroke="${B}" stroke-width="1.2" stroke-dasharray="2 5"/>`, pink = '';
    for (let i = 0; i < 12; i++) {
      const deg = i * 30 - 90, a = deg * Math.PI / 180;
      if (out.includes(((deg + 540) % 360) - 180)) {
        const x = C + 122 * Math.cos(a), y = C + 122 * Math.sin(a);
        pink += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="17" fill="${P}"/>`;
        blue += `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="17" fill="none" stroke="${B}" stroke-width="2"/><circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="5.5" fill="${B}"/>`;
      } else {
        const x = C + 84 * Math.cos(a), y = C + 84 * Math.sin(a);
        blue += path(screen(shape.disc(x, y, 17), { pitch: 4.2, angle: 75, tone: tone.flat(0.42) }), B);
      }
    }
    pink += `<path d="${arc(C, C, 122, -48, 48)}" fill="none" stroke="${P}" stroke-width="2"/>`;
    return { vb, blue, pink };
  },

  /* 03 attest: the 240 signed bytes as a 16 x 15 screen, one dot per byte; the signature overprints them */
  attest() {
    const vb = '0 0 300 300', b = bytes(0x2f0f, 240), x0 = 52.5, y0 = 59, s = 13;
    let d = '';
    b.forEach((v, i) => {
      const x = x0 + (i % 16) * s, y = y0 + Math.floor(i / 16) * s, r = 0.8 + 5 * Math.sqrt(v / 255);
      d += `M${(x - r).toFixed(2)} ${y}a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(2 * r).toFixed(2)} 0a${r.toFixed(2)} ${r.toFixed(2)} 0 1 0 ${(-2 * r).toFixed(2)} 0`;
    });
    const crop = `M36 40V28M28 36H40M264 40V28M272 36H260M36 260V272M28 264H40M264 260V272M272 264H260`;
    const blue = `${path(d, B)}<path d="${crop}" stroke="${B}" stroke-width="1"/><text x="150" y="288" text-anchor="middle" class="svg-mono" fill="${B}">240 BYTES · ONE SIGNATURE</text>`;
    const pink = `<circle cx="150" cy="150" r="74" fill="none" stroke="${P}" stroke-width="16"/><circle cx="150" cy="150" r="96" fill="none" stroke="${P}" stroke-width="1.5"/>`;
    return { vb, blue, pink };
  },

  /* 04 certify: the two plates come into register; the ring is the third colour, the minimum knocked out of the disc */
  certify() { return seal(false); },
  /* 05 revoke: the ring breaks where the spent note leaves, and the plates drift off register */
  revoke() { return seal(true); },

  /* the minimum, as a sign */
  ge() {
    const vb = '0 0 400 400';
    const g = `M92 64L300 164L92 264M92 336H300`;
    const blue = `<path d="${g}" fill="none" stroke="${B}" stroke-width="30" stroke-linejoin="miter" stroke-miterlimit="10"/>${marks([[24, 24], [376, 24], [24, 376], [376, 376]], B, 11)}`;
    const pink = `${path(screen(shape.disc(206, 200, 176), { pitch: 7, angle: 15, tone: tone.radial(206, 200, 176, 0.62, 0.04) }), P)}<path d="${g}" fill="none" stroke="${P}" stroke-width="30" stroke-linejoin="miter" stroke-miterlimit="10"/>${marks([[24, 24], [376, 24], [24, 376], [376, 376]], P, 11)}`;
    return { vb, blue, pink };
  },

  /* the empty wall: an open ring, nothing printed in it yet */
  empty() {
    const vb = '0 0 300 300', C = 150;
    const blue = `<circle cx="${C}" cy="${C}" r="112" fill="none" stroke="${B}" stroke-width="1.6" stroke-dasharray="2 5"/><path d="M${C} 18V60M${C} 240V282M18 ${C}H60M240 ${C}H282" stroke="${B}" stroke-width="1"/>`;
    const pink = `${path(screen(shape.disc(C, C, 112), { pitch: 6, angle: 15, tone: tone.radial(C, C, 112, 0.05, 0.3) }), P)}`;
    return { vb, blue, pink };
  },
};
function arc(cx, cy, r, a0, a1) {
  const p = a => [cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180)].map(v => v.toFixed(2)).join(' ');
  return `M${p(a0)}A${r} ${r} 0 0 1 ${p(a1)}`;
}
function seal(broken) {
  const vb = '0 0 300 300', C = 150, corners = [[22, 22], [278, 22], [22, 278], [278, 278]];
  const ge = `M${C - 17} ${C - 25}L${C + 17} ${C - 9}L${C - 17} ${C + 7}M${C - 17} ${C + 22}H${C + 17}`;
  let blue = `<path d="M0 ${C}H300M${C} 0V300" stroke="${B}" stroke-width="1"/>${ring(C, C, 96, 18, B, broken)}<circle cx="${C}" cy="${C}" r="52" fill="${B}"/>
    <path d="${ge}" fill="none" stroke="${INK.paper}" stroke-width="7" stroke-linejoin="miter"/>${marks(corners, B, 10)}`;
  let pink = `${path(screen(shape.disc(C, C, 140), { pitch: 5.6, angle: 15, tone: tone.radial(C, C, 140, 0.5, 0.02) }), P)}${ring(C, C, 96, 18, P, broken)}${marks(corners, P, 10)}`;
  if (broken) {
    const a = -45 * Math.PI / 180, x = (C + 128 * Math.cos(a)).toFixed(2), y = (C + 128 * Math.sin(a)).toFixed(2);
    pink += `<circle cx="${x}" cy="${y}" r="13" fill="${P}"/>`;
    blue += `<circle cx="${x}" cy="${y}" r="13" fill="none" stroke="${B}" stroke-width="2"/>`;
  }
  return { vb, blue, pink };
}

function press(el) {
  const f = FIGS[el.dataset.fig]?.();
  if (!f) return;
  el.insertAdjacentHTML('afterbegin', plate('blue', f.vb, f.blue) + plate('pink', f.vb, f.pink));
}
$$('.fig[data-fig]').forEach(press);

/* ------------------------------------------------------------------ registration */
const reg = (el, state) => { el.dataset.reg = state; };
const heroFig = $('[data-fig="hero"]'), regText = $('[data-reg-text]');
const display = $('.display');
if (RM.matches) {
  $$('.fig[data-reg="enter"]').forEach(el => reg(el, 'in'));
  reg($('[data-fig="revoke"]'), 'out');
  display.classList.add('in');
} else {
  /* first paint off register; one frame later the plates slide in */
  const go = () => setTimeout(() => { reg(heroFig, 'in'); display.classList.add('in'); }, 260);
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(go, go);
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    const el = e.target; io.unobserve(el);
    setTimeout(() => reg(el, el.dataset.fig === 'revoke' ? 'out' : 'in'), 200);
  }), { rootMargin: '0px 0px -18% 0px' });
  $$('.fig[data-fig]').forEach(el => el !== heroFig && io.observe(el));
}
/* a revoke on the wall: the sheet drifts off register for a moment, then the next live certificate pulls it back */
let drifting = false;
function drift(at) {
  if (drifting || RM.matches) return;
  drifting = true;
  reg(heroFig, 'out');
  regText.textContent = `Off register: a certificate was revoked${at ? ` at slot ${num(at)}` : ''}`;
  setTimeout(() => { reg(heroFig, 'in'); regText.textContent = 'Plates in register: a live certificate'; drifting = false; }, 2800);
}

/* ------------------------------------------------------------------ the live number */
const liveNum = $('[data-live-num]'), liveLabel = $('[data-live-label]'), liveSub = $('[data-live-sub]');
let mode = 'pre', slot = 0, src, filter = 'any', lastList = [];
addEventListener('pof:slot', e => {
  slot = e.detail;
  if (mode === 'pre') liveNum.textContent = num(slot);
  else { const s = $('[data-live-slot]'); if (s) s.textContent = num(slot); }
  const w = $('[data-wall-slot]'); if (w) w.textContent = num(slot);
});

async function readStats() {
  const s = await src.stats();
  mode = 'live';
  liveLabel.textContent = 'Live certificates, read from chain';
  roll(liveNum, s.live);
  liveSub.innerHTML = `slot <b data-live-slot>${num(slot || s.slot)}</b> · at least <b>${num(s.solCertified)} SOL</b> and <b>${num(s.usdcCertified)} USDC</b> certified`;
  $('[data-counters]').hidden = false;
  const set = (k, v) => roll($(`[data-c="${k}"]`), Number(v) || 0);
  set('live', s.live); set('sol', s.solCertified); set('usdc', s.usdcCertified); set('spent', s.revokedSpent); set('holder', s.revokedByHolder); set('log', s.log?.treeSize ?? 0);
}

/* ------------------------------------------------------------------ the wall */
const wall = $('[data-wall]');
const isRevoked = s => s === 'revoked_spent' || s === 'revoked_by_holder';
const stateOf = c => (c.status === 'live' ? 'live' : isRevoked(c.status) ? 'revoked' : 'expired');
function card(c) {
  const t = tierParts(c.tierLabel, c.asset), st = stateOf(c), subj = subjectLine(c), hashOnly = subj === c.subjectHash;
  const slotLine = st === 'revoked' && c.revokedSlot ? `revoked at ${num(c.revokedSlot)}` : `slot ${num(c.certifiedSlot)}`;
  const vb = '0 0 80 80';
  const mk = plate('blue', vb, ring(40, 40, 26, 7, B, st === 'revoked') + `<circle cx="40" cy="40" r="14" fill="${B}"/>`) + plate('pink', vb, ring(40, 40, 26, 7, P, st === 'revoked'));
  return `<a class="rc is-${st}" href="${esc(certPath(c))}" data-addr="${esc(c.address)}" data-status="${esc(c.status)}">
    <span class="rc-top"><span><span class="rc-kind mono">${esc(KIND_TEXT[c.kind] || c.kind)}</span><span class="rc-subj mono" title="${esc(subj)}">${hashOnly ? `hash ${esc(short(subj, 6))}` : esc(short(subj, 6))}</span></span>
    <span class="fig fig-mini" data-reg="${st === 'live' ? 'in' : 'out'}">${mk}</span></span>
    <span class="rc-tier" aria-label="at least ${esc(t.amt)} ${esc(t.sym)}"><span class="rc-least">at least</span><span class="rc-amt">${esc(t.amt)}</span><span class="rc-sym mono">${esc(t.sym)}</span></span>
    <span class="rc-foot mono"><span class="st">${esc(STATUS_SHORT[c.status] || c.status)}</span><span>${slotLine}</span></span></a>`;
}
function empty(title, body) {
  wall.innerHTML = `<div class="wall-empty"><div class="fig fig-empty" data-fig="empty" data-reg="in"></div>
    <div><p class="h3">${esc(title)}</p><p>${esc(body)}</p><p class="mono quiet">Read at slot <span data-wall-slot>${slot ? num(slot) : '…'}</span></p>
    <p class="row"><a class="btn" href="/get"><span>Get certified</span></a><a class="arrow" href="/docs/revocation">How a certificate dies</a></p></div></div>`;
  press($('[data-fig="empty"]', wall));
}
const order = c => Math.max(Number(c.certifiedSlot) || 0, Number(c.revokedSlot) || 0);
function visible(list) {
  if (filter === 'live') return list.filter(c => c.status === 'live');
  if (filter === 'revoked') return list.filter(c => isRevoked(c.status));
  return list;
}
function drawWall() {
  const list = visible(lastList);
  if (!lastList.length) return empty('No certificates yet.', 'The first certificate appears here the moment it lands on chain, and turns over the moment its funds move.');
  if (!list.length) return empty(filter === 'live' ? 'No live certificates right now.' : 'Nothing revoked yet.', 'Switch the filter to see the rest of the wall.');
  const seen = new Map($$('.rc', wall).map(el => [el.dataset.addr, el]));
  const out = [];
  let flipped = null;
  for (const c of list.slice(0, 48)) {
    const old = seen.get(c.address);
    if (old && old.dataset.status === c.status) { out.push(old); continue; }
    const tmp = document.createElement('div'); tmp.innerHTML = card(c).trim();
    const el = tmp.firstElementChild;
    if (old && stateOf(c) === 'revoked') { flipped = c; const m = $('.fig-mini', el); m.dataset.reg = 'in'; requestAnimationFrame(() => requestAnimationFrame(() => (m.dataset.reg = 'out'))); }
    out.push(el);
  }
  wall.replaceChildren(...out);
  if (flipped) drift(flipped.revokedSlot);
}
async function readWall() {
  const r = await src.list({ status: 'any', limit: 500 });
  lastList = r.certificates.slice().sort((a, b) => order(b) - order(a));
  drawWall();
}
for (const b of $$('[data-filter]')) b.addEventListener('click', () => {
  filter = b.dataset.filter;
  $$('[data-filter]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  wall.replaceChildren(); drawWall();
});

/* ------------------------------------------------------------------ the film: printed through the hole in both plates,
   separated into the two inks by the #sep filter; its progress is the pink hair ring; captions under the sheet, never on it */
const FILM = { src: '/film/pof.mp4', captions: '/film/pof.vtt' };
const film = $('[data-film]');
if (film) {
  const cap = $('[data-film-cap]'), label = $('[data-film-label]'), mute = $('[data-film-mute]'), prog = $('[data-film-progress]');
  let v = null;
  const make = () => {
    v = Object.assign(document.createElement('video'), { src: FILM.src, playsInline: true, preload: 'auto' });
    v.className = 'film-vid';
    v.setAttribute('aria-label', 'The Proof of Funds film');
    const t = Object.assign(document.createElement('track'), { kind: 'captions', src: FILM.captions, srclang: 'en', label: 'English', default: true });
    v.appendChild(t);
    film.insertBefore(v, $('.film-prog', film));
    t.track.mode = 'hidden';
    t.track.addEventListener('cuechange', () => { const c = t.track.activeCues && t.track.activeCues[0]; cap.textContent = c ? c.text : ''; });
    v.addEventListener('timeupdate', () => { prog.style.strokeDashoffset = String(1000 * (1 - v.currentTime / (v.duration || 1))); });
    v.addEventListener('ended', () => { film.classList.remove('playing'); label.textContent = 'Play again'; cap.textContent = ''; mute.hidden = true; });
    v.addEventListener('click', toggle);
  };
  const toggle = () => {
    if (!v) make();
    if (v.paused) {
      film.classList.add('playing'); v.play(); label.textContent = 'Pause'; mute.hidden = false;
      if (matchMedia('(max-width: 860px)').matches) $('.hero-sheet').scrollIntoView({ behavior: RM.matches ? 'auto' : 'smooth', block: 'center' });
    } else { v.pause(); label.textContent = 'Play'; }
  };
  $$('[data-film-play]').forEach(p => p.addEventListener('click', toggle));
  mute.addEventListener('click', () => { if (!v) return; v.muted = !v.muted; mute.textContent = v.muted ? 'Sound on' : 'Sound off'; });
}

/* ------------------------------------------------------------------ start */
(async () => {
  src = await source();
  const live = LIVE || src.mode === 'fixture';
  if (!live) { empty('No certificates yet.', 'The first certificate appears here the moment it lands on chain, and turns over the moment its funds move.'); return; }
  $('[data-seg]').hidden = false;
  const tick = async () => {
    try { await Promise.all([readStats(), readWall()]); }
    catch (e) { if (!lastList.length) empty('The wall could not be read just now.', `${e.message} It retries by itself.`); }
  };
  await tick();
  setInterval(() => { if (!document.hidden) tick(); }, src.mode === 'fixture' ? 3500 : 6000);
})();
