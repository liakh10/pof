/* Docs pages: the on-page outline follows the reading position; on a phone the section lists start folded. */
import { $$ } from './fmt.js';

const links = $$('.docs-toc a');
const heads = links.map(a => document.getElementById(decodeURIComponent(a.hash.slice(1)))).filter(Boolean);
if (heads.length && 'IntersectionObserver' in window) {
  const vis = new Set();
  const io = new IntersectionObserver(es => {
    for (const e of es) e.isIntersecting ? vis.add(e.target) : vis.delete(e.target);
    const first = heads.find(h => vis.has(h));
    if (!first) return;
    links.forEach(a => a.classList.toggle('on', a.hash === '#' + first.id));
  }, { rootMargin: '-72px 0px -60% 0px' });
  heads.forEach(h => io.observe(h));
}
if (matchMedia('(max-width: 860px)').matches) $$('.docs-pick').forEach(d => d.removeAttribute('open'));
