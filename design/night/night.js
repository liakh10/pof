/* v4 "Night edition". The cover: the poster line set enormous, the live chain number, and the film entry as the centre
   of a seal whose hairline rings run up behind the type and off the page. A ring ripples out when a certificate lands; the
   orange band breaks when one is revoked. Below: a certificate ticker, the film as a full-width band (inverted into night
   ink, its crosshair carried out to the page edges, the horizontal one doubling as the timeline), what a certificate says,
   and a check for any subject. Data comes only through ui/data.js. */
import { $, $$, num, roll, esc, short, tierParts, subjectLine, certPath, STATUS_SHORT, KIND_TEXT, TIERS } from '/ui/fmt.js';
import { source, LIVE } from '/ui/data.js';
import { markSVG } from '/ui/seal.js';
import { stateOf } from '/ui/cards.js';

const NS = 'http://www.w3.org/2000/svg';
const RM = matchMedia('(prefers-reduced-motion: reduce)');
const el = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
const f = n => +n.toFixed(2);

/* ------------------------------------------------------------------ the halo: the seal around the film disc */
const halo = $('[data-halo]');
let band = null;
function buildHalo() {
  const add = (p, a) => p.appendChild(el(a[0], a[1]));
  const g = halo;
  add(g, ['path', { class: 'h', d: 'M -1400 0 H 1400 M 0 -1400 V 1400', 'stroke-width': .75, opacity: .2 }]);
  // ticks round the disc, every 5 degrees, every 30 longer
  let d = '';
  for (let i = 0; i < 72; i++) { const a = i * 5 * Math.PI / 180, r0 = i % 6 ? 180 : 174, r1 = 186; d += `M${f(Math.cos(a) * r0)} ${f(Math.sin(a) * r0)}L${f(Math.cos(a) * r1)} ${f(Math.sin(a) * r1)}`; }
  add(g, ['path', { class: 'tk', d }]);
  // the structural rings, from the disc outwards
  const plan = [[80, 1.2, 'h', 1], [111, .75, 'h', .9], [119, 3, 'h', 1], [127, 1.2, 'h sig', 1]];
  for (const [r, w, cls, o] of plan) add(g, ['circle', { class: cls, r, 'stroke-width': w, opacity: o }]);
  const spin = el('g', { class: 'spin' }); spin.appendChild(el('circle', { class: 'h', r: 87, 'stroke-width': 5, pathLength: 1000, 'stroke-dasharray': '160 18 90 18 240 18 40 18 300 18 62 18' })); g.appendChild(spin);
  const spin2 = el('g', { class: 'spin ccw' }); spin2.appendChild(el('circle', { class: 'h', r: 150, 'stroke-width': 1.6, pathLength: 1000, 'stroke-dasharray': '1.5 5', opacity: .6 })); g.appendChild(spin2);
  band = el('circle', { class: 'h sig band', r: 100, 'stroke-width': 8, pathLength: 1000 }); g.appendChild(band);
  // hairlines out to the edge of the page, spacing opening as they go, every seventh a little firmer, one more in orange
  let r = 166, i = 0;
  while (r < 1390) {
    const firm = i % 7 === 3, orange = i === 19;
    add(g, ['circle', { class: orange ? 'h sig' : 'h', r: f(r), 'stroke-width': orange ? 1.2 : firm ? 1.1 : .7, opacity: orange ? .95 : firm ? .5 : .24 }]);
    r += 12 + (r - 166) * .016; i++;
  }
}
buildHalo();

/* a certificate landed: one ring ripples out of the disc */
function ripple() {
  if (RM.matches) return;
  const c = el('circle', { class: 'ripple', r: 74 }); halo.appendChild(c);
  const a = c.animate([{ r: '74px', opacity: 1, strokeWidth: 3 }, { r: '900px', opacity: 0, strokeWidth: .5 }], { duration: 2600, easing: 'cubic-bezier(.2,.7,.2,1)' });
  a.onfinish = () => c.remove();
}
/* a certificate was revoked: the orange band stops, opens, two shards fall; then it draws itself whole again */
let breaking = false;
function breakBand() {
  if (breaking || RM.matches) return;
  breaking = true;
  const C = 1000, gap = 70, at = 875;
  band.setAttribute('stroke-dasharray', `${C - gap} ${gap}`); band.setAttribute('stroke-dashoffset', String(C - at - gap / 2 + C) );
  const shards = [[-56, -50], [-42, -35]].map(([a, b], i) => {
    const r = 100, p = (deg) => [f(Math.cos(deg * Math.PI / 180) * r), f(Math.sin(deg * Math.PI / 180) * r)];
    const [x0, y0] = p(a), [x1, y1] = p(b);
    const s = el('path', { class: 'h', d: `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`, 'stroke-width': 8 }); halo.appendChild(s);
    const u = [Math.cos(-45 * Math.PI / 180), Math.sin(-45 * Math.PI / 180)], dd = i ? 30 : 16;
    s.animate([{ transform: 'translate(0,0)', opacity: 1 }, { transform: `translate(${u[0] * dd}px, ${u[1] * dd}px) rotate(${i ? 3 : -2}deg)`, opacity: 1, offset: .5 }, { transform: `translate(${u[0] * dd}px, ${u[1] * dd}px) rotate(${i ? 3 : -2}deg)`, opacity: 0 }], { duration: 2800, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
    return s;
  });
  band.classList.remove('sig'); band.style.stroke = 'var(--ink)';
  setTimeout(() => {
    shards.forEach(s => s.remove());
    band.style.stroke = ''; band.classList.add('sig');
    band.setAttribute('stroke-dasharray', '1000'); band.setAttribute('stroke-dashoffset', '1000');
    const a = band.animate([{ strokeDashoffset: 1000 }, { strokeDashoffset: 0 }], { duration: 1500, easing: 'cubic-bezier(.4,0,.2,1)' });
    a.onfinish = () => { band.removeAttribute('stroke-dasharray'); band.removeAttribute('stroke-dashoffset'); breaking = false; };
  }, 2800);
}

/* ------------------------------------------------------------------ the live number */
const liveNum = $('[data-live-num]'), liveLabel = $('[data-live-label]'), liveSub = $('[data-live-sub]'), metaSlot = $('[data-meta-slot]');
let mode = 'pre', slot = 0;
addEventListener('pof:slot', e => {
  slot = e.detail;
  metaSlot.textContent = `slot ${num(slot)}`;
  const d = metaSlot.previousElementSibling; d.classList.remove('tick'); void d.offsetWidth; d.classList.add('tick');
  if (mode === 'pre') liveNum.textContent = num(slot);
});

/* ------------------------------------------------------------------ the ticker */
const ticker = $('[data-ticker]'), track = $('[data-track]');
let pendingTrack = null, sig = '';
function setTrack(html, key) {
  if (key === sig) return;
  const prevSig = sig; sig = key;
  const apply = () => {
    track.innerHTML = html + html;
    requestAnimationFrame(() => track.style.setProperty('--run', `${Math.max(30, track.scrollWidth / 2 / 46).toFixed(1)}s`));
    pendingTrack = null;
  };
  if (!track.children.length || RM.matches || prevSig === 'pre') return apply();
  pendingTrack = apply;
}
track.addEventListener('animationiteration', () => pendingTrack && pendingTrack());
function preTicker() {
  const items = [`<span class="tk-i"><span class="k tk-lead">The tiers a certificate can state</span></span>`];
  for (const a of ['SOL', 'USDC']) TIERS[a].forEach((t, i) => items.push(`<span class="tk-i"><span class="k">Tier ${i + 1}</span><span class="t">≥ ${t} ${a}</span></span>`));
  items.push(`<span class="tk-i"><span class="k">Never</span><span class="s">the amount</span></span>`);
  setTrack(items.join(''), 'pre');
}
function liveTicker(list) {
  const items = list.slice(0, 28).map(c => {
    const s = stateOf(c), t = tierParts(c.tierLabel, c.asset), subj = subjectLine(c), hashOnly = subj === c.subjectHash;
    return `<a class="tk-i ${s}" href="${esc(certPath(c))}">${markSVG({ state: s })}<span class="k">${esc(KIND_TEXT[c.kind] || c.kind)}</span><span class="s">${hashOnly ? 'hash ' : ''}${esc(short(subj, 4))}</span><span class="t">≥ ${esc(t.amt)} ${esc(t.sym)}</span><span class="st">${esc(STATUS_SHORT[c.status] || c.status)}</span><span class="sl">${s === 'revoked' && Number(c.revokedSlot) ? num(c.revokedSlot) : num(c.certifiedSlot)}</span></a>`;
  });
  setTrack(items.join(''), list.slice(0, 28).map(c => c.address + c.status).join());
}
preTicker();

/* ------------------------------------------------------------------ the film band */
const fb = $('[data-band]'), video = $('[data-video]'), cap = $('[data-cap]'), bar = $('[data-bar]'), time = $('[data-time]');
const toggleBtn = $('[data-toggle]'), muteBtn = $('[data-mute]');
const t2 = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const tr = video.textTracks[0];
if (tr) { tr.mode = 'hidden'; tr.addEventListener('cuechange', () => { const c = tr.activeCues && tr.activeCues[0]; cap.textContent = c ? c.text : ''; }); }
video.addEventListener('timeupdate', () => { const k = video.currentTime / (video.duration || 36); bar.style.transform = `scaleX(${k.toFixed(4)})`; time.textContent = `${t2(video.currentTime)} / ${t2(video.duration || 36)}`; });
video.addEventListener('play', () => { fb.classList.add('playing'); toggleBtn.textContent = 'Pause'; });
video.addEventListener('pause', () => { fb.classList.remove('playing'); toggleBtn.textContent = 'Play'; });
video.addEventListener('ended', () => { toggleBtn.textContent = 'Play again'; cap.textContent = ''; });
const toggle = () => (video.paused ? video.play() : video.pause());
$('[data-play]').addEventListener('click', toggle);
video.addEventListener('click', toggle);
toggleBtn.addEventListener('click', toggle);
muteBtn.addEventListener('click', () => { video.muted = !video.muted; muteBtn.textContent = video.muted ? 'Sound on' : 'Sound off'; });
$('[data-film-jump]').addEventListener('click', () => { fb.scrollIntoView({ behavior: RM.matches ? 'auto' : 'smooth', block: 'center' }); video.play(); });
if ('IntersectionObserver' in window) new IntersectionObserver(es => es.forEach(x => { if (!x.isIntersecting && !video.paused) video.pause(); }), { threshold: 0.15 }).observe(fb);

/* ------------------------------------------------------------------ verify anyone */
const form = $('[data-check]'), out = $('[data-check-out]');
let src = null;
form.addEventListener('submit', async e => {
  e.preventDefault();
  const q = $('#q').value.trim();
  if (!q || !src) return;
  form.classList.add('busy');
  try {
    const r = await src.lookup(q);
    const head = r.certificates.length ? (r.live ? 'Yes. A live certificate.' : 'Certificates found, none live.') : 'No certificate.';
    out.innerHTML = `<p class="v${r.live ? ' ok' : ''}">${esc(head)}</p><p class="quiet mono" style="font-size:12.5px;margin-top:6px">Read from the chain at slot ${num(r.slot)}.</p>`
      + (r.certificates.length ? `<div class="rows">${r.certificates.slice(0, 6).map(c => { const t = tierParts(c.tierLabel, c.asset); return `<a class="row" href="${esc(certPath(c))}"><span class="t">≥ ${esc(t.amt)} ${esc(t.sym)}</span><span class="label">${esc(STATUS_SHORT[c.status] || c.status)}</span><span class="mono quiet sl">slot ${num(c.certifiedSlot)}</span></a>`; }).join('')}</div>` : '');
  } catch (err) {
    out.innerHTML = `<p class="v">${esc(err.code === 'bad_subject' ? 'That is not a subject.' : 'The check did not go through.')}</p><p class="quiet">${esc(err.message)}</p>`;
  }
  form.classList.remove('busy');
});

/* ------------------------------------------------------------------ start */
let known = null;
async function tick() {
  const [s, r] = await Promise.all([src.stats(), src.list({ status: 'any', limit: 200 })]);
  mode = 'live';
  liveLabel.textContent = 'Live certificates, read from chain';
  roll(liveNum, s.live);
  liveSub.innerHTML = `at least <b>${num(s.solCertified)} SOL</b> and <b>${num(s.usdcCertified)} USDC</b> certified, never an amount`;
  const list = r.certificates.slice().sort((a, b) => Math.max(Number(b.certifiedSlot), Number(b.revokedSlot) || 0) - Math.max(Number(a.certifiedSlot), Number(a.revokedSlot) || 0));
  if (known) {
    if (list.some(c => known.get(c.address) === 'live' && c.status !== 'live')) breakBand();
    if (list.some(c => !known.has(c.address))) ripple();
  }
  known = new Map(list.map(c => [c.address, c.status]));
  liveTicker(list);
}
(async () => {
  src = await source();
  if (!(LIVE || src.mode === 'fixture')) return;
  try { await tick(); } catch {}
  setInterval(() => { if (!document.hidden) tick().catch(() => {}); }, src.mode === 'fixture' ? 3500 : 6000);
})();
