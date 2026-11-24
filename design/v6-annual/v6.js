/* v6 "Editorial": the live slot set as Fig. 1, the film played in place as Plate 1 (captions in the figure caption, never on
   the picture), and the schematics drawing their orange path once when they scroll in. When certificates exist (or in the
   localhost fixture), Fig. 1 adds the live count read from /v1/stats. The shell (menu, CA, slot clock) is /ui/app.js. */
import { $, $$, num } from '/ui/fmt.js';
import { source, LIVE } from '/ui/data.js';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const figs = $$('[data-live-num]');
addEventListener('pof:slot', e => figs.forEach(el => (el.textContent = num(e.detail))));

/* ------------------------------------------------------------------ Plate 1: the film, in place */
{
  const plate = $('[data-plate]'), frame = plate.querySelector('.plate-frame'), play = $('[data-play]');
  const cap = $('[data-cap]'), time = $('[data-time]'), mute = $('[data-mute]'), bar = $('[data-prog]');
  const rest = cap.textContent;
  const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  let v = null;
  const make = () => {
    v = Object.assign(document.createElement('video'), { src: '/film/pof.mp4', poster: '/film/poster.jpg', playsInline: true, preload: 'auto' });
    v.setAttribute('aria-label', 'The Proof of Funds film');
    const t = Object.assign(document.createElement('track'), { kind: 'captions', src: '/film/pof.vtt', srclang: 'en', label: 'English', default: true });
    v.appendChild(t);
    frame.insertBefore(v, play);
    t.track.mode = 'hidden';
    t.track.addEventListener('cuechange', () => { const c = t.track.activeCues && t.track.activeCues[0]; cap.textContent = c ? c.text : ''; });
    v.addEventListener('timeupdate', () => { bar.style.width = `${(100 * v.currentTime) / (v.duration || 36)}%`; time.textContent = `${mmss(v.currentTime)} / ${mmss(v.duration || 36)}`; });
    v.addEventListener('play', () => { plate.classList.add('playing'); mute.hidden = false; });
    v.addEventListener('pause', () => plate.classList.remove('playing'));
    v.addEventListener('ended', () => { cap.textContent = rest; time.textContent = '0:36'; mute.hidden = true; });
    v.addEventListener('click', () => (v.paused ? v.play() : v.pause()));
  };
  play.addEventListener('click', () => { if (!v) make(); v.play().catch(() => {}); });
  mute.addEventListener('click', () => { if (!v) return; v.muted = !v.muted; mute.textContent = v.muted ? 'Sound on' : 'Sound off'; });
}

/* ------------------------------------------------------------------ schematics draw once, on scroll */
if (!reduce && 'IntersectionObserver' in window) {
  document.documentElement.classList.add('js-motion');
  const io = new IntersectionObserver(es => es.forEach(x => { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } }), { rootMargin: '0px 0px -12% 0px' });
  $$('.schem').forEach(el => io.observe(el));
}

/* ------------------------------------------------------------------ live counts, once the chain has certificates */
(async () => {
  const src = await source();
  if (!(LIVE || src.mode === 'fixture')) return;
  const cap = $('.figure-num figcaption');
  const read = async () => {
    try {
      const s = await src.stats();
      cap.innerHTML = `<span class="cap">Fig. 1</span> The Solana mainnet slot, read live. <b>${num(s.live)}</b> live certificates at this slot, for at least <b>${num(s.solCertified)} SOL</b> and <b>${num(s.usdcCertified)} USDC</b>.`;
    } catch {}
  };
  await read();
  setInterval(() => { if (!document.hidden) read(); }, 8000);
})();
