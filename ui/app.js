/* The shell on every page: the menu, the CA box (CLAUDE.md rules), token links, the live slot in the header, copy buttons,
   reveal-on-scroll. It also runs the one slot clock of the page and broadcasts `pof:slot` events, so pages never poll twice. */
import { $, $$, copy, num, esc } from './fmt.js';
import { source, slotClock } from './data.js';

const CFG = window.POF || {};

/* ------------------------------------------------------------------ menu */
const menu = $('.menu'), nav = $('#nav');
if (menu && nav) {
  const set = open => { menu.setAttribute('aria-expanded', String(open)); nav.classList.toggle('open', open); document.documentElement.style.overflow = open ? 'hidden' : ''; };
  menu.addEventListener('click', () => set(menu.getAttribute('aria-expanded') !== 'true'));
  nav.addEventListener('click', e => { if (e.target.closest('a')) set(false); });
  addEventListener('keydown', e => { if (e.key === 'Escape') set(false); });
  matchMedia('(min-width: 1081px)').addEventListener('change', e => e.matches && set(false));
}

/* ------------------------------------------------------------------ the CA box: SOON without a copy button; a real CA on one line with a copy button */
const CA = String(CFG.CA || '').trim();
const realCA = CA && CA.toUpperCase() !== 'SOON';
for (const box of $$('[data-ca]')) {
  box.innerHTML = `<span class="ca-label">CA</span><span class="ca-value">${esc(realCA ? CA : 'SOON')}</span>${realCA ? '<button class="ca-copy" type="button" aria-label="Copy the contract address">Copy</button>' : ''}`;
  const b = box.querySelector('.ca-copy');
  if (b) b.addEventListener('click', () => copy(CA, 'Contract address copied'));
}
for (const el of $$('[data-token-links]')) {
  const links = [];
  if (realCA) links.push([`https://pump.fun/coin/${CA}`, 'pump.fun'], [`https://dexscreener.com/solana/${CA}`, 'DexScreener']);
  if (CFG.X_URL) links.push([CFG.X_URL, 'X']);
  el.innerHTML = links.map(([href, label]) => `<a href="${esc(href)}" rel="noopener" target="_blank">${label}</a>`).join('');
  if (!links.length) el.remove();
}

/* ------------------------------------------------------------------ copy buttons on code blocks */
document.addEventListener('click', e => {
  const b = e.target.closest('.code-copy');
  if (b) copy(b.parentElement.querySelector('code').textContent, 'Code copied');
  const c = e.target.closest('[data-copy]');
  if (c) copy(c.dataset.copy, c.dataset.copyLabel || 'Copied');
});

/* ------------------------------------------------------------------ reveal on scroll */
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver(es => es.forEach(x => { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); } }), { rootMargin: '0px 0px -8% 0px' });
  const watch = () => $$('.rv:not(.in)').forEach(el => io.observe(el));
  watch();
  window.addEventListener('pof:content', watch);
} else $$('.rv').forEach(el => el.classList.add('in'));

/* ------------------------------------------------------------------ the slot clock and the header mini counter */
const mini = $('[data-slot-mini]'), miniText = $('[data-slot-text]');
source().then(src => {
  let first = true;
  slotClock(src, s => {
    window.dispatchEvent(new CustomEvent('pof:slot', { detail: s }));
    if (mini) {
      if (first) { mini.hidden = false; first = false; }
      miniText.textContent = `slot ${num(s)}`;
      const d = mini.querySelector('.dot'); d.classList.remove('tick'); void d.offsetWidth; d.classList.add('tick');
    }
  }, { every: document.body.dataset.page === 'wall' ? 4000 : 8000 });
  if (src.mode === 'fixture') document.documentElement.dataset.mode = 'fixture';
});
