/* Proof of Funds · design variant v2 "Instrument". Uses the site's engines (data source, the slot clock broadcast by
   app.js, formatting, card paths) and draws what this composition needs: the slot as digit drums with a 150-tick ruler,
   the seal as a dial whose ten rings are the tiers (lit by live certificates, a hand stepping once per slot), the
   ledger as a timetable, the film in a framed module. */
import { $, $$, num, roll, esc, short, span, tierParts, subjectLine, certPath, STATUS_SHORT, KIND_TEXT } from '/ui/fmt.js';
import { source, LIVE } from '/ui/data.js';
import { markSVG } from '/ui/seal.js';

const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (!RM) document.documentElement.classList.add('js-motion');
const SVGNS = 'http://www.w3.org/2000/svg';
const f1 = n => n.toFixed(1);

/* ------------------------------------------------------------------ the tiers (the program's own table: sdk ASSETS) */
const TIERS = [
  ...[1, 10, 100, 1_000, 10_000].map((min, i) => ({ asset: 'SOL', tier: i + 1, min, units: BigInt(min) * 1_000_000_000n, unit: 'lamports', r: 176 + i * 30 })),
  ...[100, 1_000, 10_000, 100_000, 1_000_000].map((min, i) => ({ asset: 'USDC', tier: i + 1, min, units: BigInt(min) * 1_000_000n, unit: 'base units', r: 340 + i * 30 })),
];
const key = (asset, tier) => `${asset}:${tier}`;

/* ------------------------------------------------------------------ the dial */
function dialSVG() {
  const p = [];
  const ray = -58 * Math.PI / 180;
  // fine hairline rings, every 10 units, behind everything
  let i = 0;
  for (let r = 160; r <= 470; r += 10) if (!TIERS.some(t => Math.abs(t.r - r) < 6)) p.push(`<circle class="hl" style="--i:${i++ % 12}" r="${r}" fill="none" stroke="var(--ink)" stroke-opacity=".22" stroke-width=".5" pathLength="1000"/>`);
  // crosshair and registration marks
  p.push(`<g class="tk" stroke="var(--ink)" stroke-width=".6"><path d="M-500 0H500M0-500V500"/>${[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, y]) => `<circle cx="${x * 478}" cy="${y * 478}" r="7" fill="none"/><path d="M${x * 478 - 12} ${y * 478}h24M${x * 478} ${y * 478 - 12}v24"/>`).join('')}</g>`);
  // the slot ring: 150 ticks, one per slot
  let tk = '', tkM = '';
  for (let k = 0; k < 150; k++) { const a = k / 150 * 2 * Math.PI - Math.PI / 2, c = Math.cos(a), s = Math.sin(a); const r1 = k % 10 === 0 ? 496 : 486; (k % 10 === 0 ? (tkM += `M${f1(c * 476)} ${f1(s * 476)}L${f1(c * r1)} ${f1(s * r1)}`) : (tk += `M${f1(c * 478)} ${f1(s * 478)}L${f1(c * r1)} ${f1(s * r1)}`)); }
  p.push(`<g class="tk" stroke="var(--ink)" fill="none"><path d="${tk}" stroke-width=".7"/><path d="${tkM}" stroke-width="1.6"/><circle r="474" stroke-width=".7"/></g>`);
  // the tier rings
  TIERS.forEach((t, j) => {
    const lx = Math.cos(ray) * t.r, ly = Math.sin(ray) * t.r;
    p.push(`<g class="ring" data-k="${key(t.asset, t.tier)}">`
      + `<circle class="tr" style="--i:${j}" r="${t.r}" fill="none" stroke="var(--ink)" stroke-width="${t.tier === 1 ? 3.2 : 2.2}" pathLength="1000"/>`
      + `<circle class="arc" r="${t.r}" fill="none" stroke="var(--signal)" stroke-width="10" pathLength="1000" stroke-dasharray="1000" stroke-dashoffset="1000" transform="rotate(-90)"/>`
      + `<circle r="${t.r}" fill="none" stroke="transparent" stroke-width="22"/>`
      + `<text class="lbl" x="${f1(lx + 9)}" y="${f1(ly + 5)}">${t.min.toLocaleString('en-US')}</text>`
      + `</g>`);
  });
  p.push(`<text class="lbl k" x="-236" y="-10" text-anchor="middle">SOL</text><text class="lbl k" x="-400" y="-10" text-anchor="middle">USDC</text>`);
  p.push(`<circle class="tk" r="318" fill="none" stroke="var(--ink)" stroke-width="1" stroke-dasharray="2 6"/>`);
  // the hub: micro ticks, the segmented ring that turns, the disc and the check
  let mt = '';
  for (let k = 0; k < 360; k += 3) { const a = k * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); mt += `M${f1(c * 138)} ${f1(s * 138)}L${f1(c * (k % 15 ? 143 : 148))} ${f1(s * (k % 15 ? 143 : 148))}`; }
  p.push(`<path class="tk" d="${mt}" stroke="var(--ink)" stroke-width=".6" fill="none"/>`);
  p.push(`<g class="spin"><circle r="123" fill="none" stroke="var(--ink)" stroke-width="9" pathLength="1000" stroke-dasharray="210 40 120 40 300 40 50 40 120 40"/></g>`);
  p.push(`<circle r="104" fill="var(--ink)"/><path d="M -86 25 A 89 89 0 0 0 86 25" stroke="var(--paper)" stroke-width="2" fill="none"/><path d="M -46 -3 L -13 30 L 51 -34" stroke="var(--paper)" stroke-width="27" fill="none" stroke-linecap="square" stroke-linejoin="miter"/>`);
  // the hand: one tick per slot
  p.push(`<g class="hand"><path d="M0 -112V-500" stroke="var(--signal)" stroke-width="1.6"/><circle cy="-500" r="5" fill="var(--signal)"/><circle r="4" fill="var(--signal)"/></g>`);
  return `<svg class="seal" viewBox="-510 -510 1020 1020" role="img" aria-label="The tier dial: ten rings, five SOL tiers inside and five USDC tiers outside, lit by live certificates">${p.join('')}</svg>`;
}
const dial = $('[data-dial]');
dial.innerHTML = dialSVG();
const hand = $('.hand', dial);

/* the tier table, linked to the rings */
const tbody = $('[data-tiers] tbody'), thead = $('[data-tiers-head]');
let counts = null;
function drawTable() {
  thead.innerHTML = counts
    ? '<tr><th scope="col">Ring</th><th scope="col">Asset</th><th scope="col">Minimum</th><th scope="col" class="num">Live</th><th scope="col" class="num">Revoked</th></tr>'
    : '<tr><th scope="col">Ring</th><th scope="col">Asset</th><th scope="col">Minimum</th><th scope="col" class="num">On chain, smallest units</th></tr>';
  tbody.innerHTML = TIERS.map((t, j) => {
    const k = key(t.asset, t.tier), c = counts?.get(k) || { live: 0, revoked: 0 };
    return `<tr data-k="${k}"${j === 4 ? ' class="gap"' : ''}><td class="rn">R${String(j + 1).padStart(2, '0')}</td><td>${t.asset}</td><td class="mn"><i class="ge">≥</i> ${t.min.toLocaleString('en-US')}</td>`
      + (counts ? `<td class="num">${num(c.live)}</td><td class="num">${num(c.revoked)}</td>` : `<td class="num bu">${num(t.units)}</td>`) + '</tr>';
  }).join('');
}
drawTable();
const hot = (k, on) => { $$(`[data-k="${CSS.escape(k)}"]`).forEach(el => el.classList.toggle('hot', on)); };
for (const root of [tbody, dial]) {
  root.addEventListener('pointerover', e => { const el = e.target.closest('[data-k]'); if (el) hot(el.dataset.k, true); });
  root.addEventListener('pointerout', e => { const el = e.target.closest('[data-k]'); if (el) hot(el.dataset.k, false); });
}
function lightRings() {
  const max = Math.max(1, ...[...(counts?.values() || [])].map(c => c.live));
  for (const g of $$('.ring', dial)) {
    const c = counts?.get(g.dataset.k);
    const share = c ? c.live / max : 0;
    g.querySelector('.arc').setAttribute('stroke-dashoffset', String(Math.round(1000 * (1 - share))));
  }
}

/* ------------------------------------------------------------------ the slot: digit drums, the ruler, the dial hand */
const slotEl = $('[data-slot]'), sr = $('[data-slot-sr]');
const ruler = $('[data-ruler]');
ruler.innerHTML = '<i></i>'.repeat(150);
const ticks = [...ruler.children];
let shape = '', drums = [], lastK = -1, base = null;
const since = $('[data-since]'), sinceT = $('[data-since-t]');
function drawSlot(s) {
  const str = num(s);
  const sh = str.replace(/\d/g, 'd');
  if (sh !== shape) {
    shape = sh;
    slotEl.querySelectorAll('.dg, .cm').forEach(n => n.remove());
    drums = [];
    for (const ch of str) {
      if (ch === ',') { slotEl.insertAdjacentHTML('beforeend', '<span class="cm" aria-hidden="true">,</span>'); continue; }
      const d = document.createElement('span'); d.className = 'dg'; d.setAttribute('aria-hidden', 'true');
      d.innerHTML = `<span>${'0123456789'.split('').map(x => `<span>${x}</span>`).join('')}</span>`;
      slotEl.appendChild(d); drums.push(d.firstElementChild);
    }
  }
  let j = 0;
  for (const ch of str) if (ch !== ',') drums[j++].style.transform = `translateY(${-Number(ch)}em)`;
  sr.textContent = `Slot ${str}`;
  const k = Number(s % 150);
  if (k < lastK || lastK < 0) ticks.forEach((t, i) => { t.className = i <= k ? 'on' : ''; });
  else for (let i = lastK; i <= k; i++) ticks[i].className = 'on';
  ticks[k].className = 'on now';
  lastK = k;
  if (base === null) base = s;
  const d = s - base; since.textContent = `+${num(d)}`; sinceT.textContent = d ? `slots, ${span(d)}` : 'slots';
  hand.style.transform = `rotate(${((base % 150) + (s - base)) * 2.4}deg)`;
}
addEventListener('pof:slot', e => drawSlot(e.detail));

/* ------------------------------------------------------------------ the film module */
const FILM = { src: '/film/pof.mp4', captions: '/film/pof.vtt', len: 36 };
{
  const film = $('[data-film]'), frame = $('.film-frame', film);
  const plays = $$('[data-film-play]'), mute = $('[data-film-mute]'), cap = $('[data-film-cap]'), label = $('[data-film-label]');
  const fill = $('[data-film-fill]'), time = $('[data-film-time]');
  const mmss = t => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  let v = null;
  const make = () => {
    v = Object.assign(document.createElement('video'), { src: FILM.src, playsInline: true, preload: 'auto' });
    v.setAttribute('aria-label', 'The Proof of Funds film');
    const t = Object.assign(document.createElement('track'), { kind: 'captions', src: FILM.captions, srclang: 'en', label: 'English', default: true });
    v.appendChild(t);
    frame.insertBefore(v, $('.film-big', frame));
    t.track.mode = 'hidden';
    t.track.addEventListener('cuechange', () => { const c = t.track.activeCues && t.track.activeCues[0]; cap.textContent = c ? c.text : ''; });
    v.addEventListener('timeupdate', () => { const d = v.duration || FILM.len; fill.style.width = `${(v.currentTime / d) * 100}%`; time.textContent = `${mmss(v.currentTime)} / ${mmss(d)}`; });
    v.addEventListener('ended', () => { film.classList.remove('playing'); label.textContent = 'Play again'; cap.textContent = ''; mute.hidden = true; });
    v.addEventListener('click', toggle);
  };
  const toggle = () => {
    if (!v) make();
    if (v.paused) { film.classList.add('playing'); v.play(); label.textContent = 'Pause'; mute.hidden = false; }
    else { v.pause(); label.textContent = 'Play'; }
  };
  plays.forEach(p => p.addEventListener('click', toggle));
  mute.addEventListener('click', () => { if (!v) return; v.muted = !v.muted; mute.textContent = v.muted ? 'Sound on' : 'Sound off'; });
}

/* ------------------------------------------------------------------ the ledger */
const ledger = $('[data-ledger]');
let filter = 'any', lastList = [];
const shown = new Map();
const stateOf = c => (c.status === 'live' ? 'live' : c.status === 'revoked_spent' || c.status === 'revoked_by_holder' ? 'revoked' : 'expired');
const visible = list => filter === 'live' ? list.filter(c => c.status === 'live') : filter === 'revoked' ? list.filter(c => stateOf(c) === 'revoked') : list;
function emptyLedger(title, body) {
  const blanks = Array.from({ length: 7 }, (_, i) => `<div class="lr blank" aria-hidden="true"><span class="no">${String(i + 2).padStart(3, '0')}</span></div>`).join('');
  ledger.innerHTML = `<div class="lr msg" role="row"><span class="no">001</span><div class="m" role="cell">${markSVG({ state: 'live', size: 40 })}<div><h3>${esc(title)}</h3><p>${esc(body)}</p></div></div></div>${blanks}`;
}
function row(c, i) {
  const t = tierParts(c.tierLabel, c.asset), state = stateOf(c), subj = subjectLine(c);
  const subjText = subj === c.subjectHash ? `hash ${short(subj, 6)}` : short(subj, 8);
  return `<a class="lr is-${state}" role="row" href="${esc(certPath(c))}" data-addr="${esc(c.address)}" data-status="${esc(c.status)}">`
    + `<span class="no" role="cell">${String(i + 1).padStart(3, '0')}</span><span class="sl" role="cell">${num(c.certifiedSlot)}</span>`
    + `<span class="sb" role="cell" title="${esc(subj)}">${esc(subjText)}</span><span class="kd" role="cell">${esc(KIND_TEXT[c.kind] || c.kind)}</span>`
    + `<span class="t" role="cell"><i class="ge">≥</i><span>${esc(t.amt)}</span><small>${esc(t.sym)}</small></span>`
    + `<span class="st" role="cell"><span class="status ${esc(c.status)}">${esc(STATUS_SHORT[c.status] || c.status)}</span></span>`
    + `<span class="sl" role="cell">${c.revokedSlot ? num(c.revokedSlot) : ''}</span></a>`;
}
function drawLedger() {
  const list = visible(lastList);
  if (!lastList.length) return emptyLedger('No certificates yet.', 'The first certificate appears here the moment it lands on chain, and turns over the moment its funds move.');
  if (!list.length) return emptyLedger(filter === 'live' ? 'No live certificates right now.' : 'Nothing revoked yet.', 'Switch the filter to see the rest of the ledger.');
  const first = !shown.size;
  ledger.innerHTML = list.slice(0, 24).map(row).join('');
  for (const el of ledger.querySelectorAll('a.lr')) {
    const was = shown.get(el.dataset.addr);
    if (was && was !== el.dataset.status) el.classList.add('flip');
    else if (!was && !first) el.classList.add('new');
  }
  for (const c of lastList) shown.set(c.address, c.status);
}
for (const b of $$('[data-filter]')) b.addEventListener('click', () => {
  filter = b.dataset.filter;
  $$('[data-filter]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  drawLedger();
});

/* ------------------------------------------------------------------ arrivals: the dial draws when it comes into view, blocks rise */
if (RM) dial.classList.add('on');
else {
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add(e.target === dial ? 'on' : 'in'); io.unobserve(e.target); } }), { threshold: .2 });
  io.observe(dial);
  $$('.sx:not(.s0) .g > *').forEach(el => { el.classList.add('rise'); io.observe(el); });
}

/* ------------------------------------------------------------------ data */
(async () => {
  const src = await source();
  const live = LIVE || src.mode === 'fixture';
  if (!live) { drawLedger(); return; }
  $('[data-readouts]').innerHTML = '<div><dt>Live certificates</dt><dd data-c="live">0</dd></div><div><dt>SOL certified, at least</dt><dd data-c="sol">0</dd></div><div><dt>USDC certified, at least</dt><dd data-c="usdc">0</dd></div><div><dt>Log entries</dt><dd data-c="log">0</dd></div>';
  $('[data-six]').hidden = false;
  const order = c => Math.max(Number(c.certifiedSlot) || 0, Number(c.revokedSlot) || 0);
  const tick = async () => {
    try {
      const [s, r] = await Promise.all([src.stats(), src.list({ status: 'any', limit: 500 })]);
      const set = (k, v) => $$(`[data-c="${k}"]`).forEach(el => roll(el, Number(v) || 0));
      set('live', s.live); set('sol', s.solCertified); set('usdc', s.usdcCertified); set('spent', s.revokedSpent); set('holder', s.revokedByHolder); set('log', s.log?.treeSize ?? 0);
      lastList = r.certificates.slice().sort((a, b) => order(b) - order(a));
      counts = new Map(TIERS.map(t => [key(t.asset, t.tier), { live: 0, revoked: 0 }]));
      for (const c of lastList) { const e = counts.get(key(c.asset, c.tier)); if (!e) continue; if (c.status === 'live') e.live++; else if (stateOf(c) === 'revoked') e.revoked++; }
      drawTable(); lightRings(); drawLedger();
    } catch (e) {
      if (!lastList.length) emptyLedger('The ledger could not be read just now.', `${e.message} It retries by itself.`);
    }
  };
  await tick();
  setInterval(() => { if (!document.hidden) tick(); }, src.mode === 'fixture' ? 3500 : 6000);
})();
