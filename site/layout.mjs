// The one page shell (head, header, footer) every POF page is built with. Pages are static HTML; the live parts load as
// ES modules from /ui. Copy rules: no em dashes, no fixed times, no "sandbox/demo" labels.
import { esc } from './md.mjs';
import { markSVG } from '../ui/seal.js';

export const NAV = [
  ['wall', '/', 'Certificates'],
  ['get', '/get', 'Get certified'],
  ['verify', '/verify', 'Verify'],
  ['rooms', '/rooms', 'Rooms'],
  ['log', '/log', 'Log'],
  ['docs', '/docs', 'Docs'],
  ['developers', '/developers', 'Developers'],
];

const FOOT = [
  ['Protocol', [['/docs', 'The paper'], ['/docs/trust', 'Trust points'], ['/docs/threat-model', 'Threat model'], ['/docs/privacy', 'Privacy'], ['/docs/revocation', 'Revocation'], ['/docs/fees', 'Fees']]],
  ['Check', [['/verify', 'Verify a subject'], ['/log', 'Transparency log'], ['/rooms', 'Rooms'], ['/status', 'Status']]],
  ['Build', [['/developers', 'Developers'], ['/developers#http-api', 'HTTP API'], ['/developers#the-sdk', 'SDK'], ['/v1/openapi.json', 'OpenAPI']]],
  ['Record', [['/changelog', 'Changelog'], ['/reports', 'Test reports'], ['/docs/glossary', 'Glossary'], ['https://github.com/liakh10/pof', 'Source code']]],
];

/**
 * page: { title, description, nav, body, scripts: [module urls], bodyClass, canonical, og, noindex, head }
 * site: { origin, bundleHash, program, gate, built }
 */
export function shell(page, site) {
  const title = page.title ? `${page.title} · Proof of Funds` : 'Proof of Funds · post proof, not wallet';
  const desc = page.description || 'A public certificate that you hold at least a tier of SOL or USDC, proven from Helius Privacy Rings without showing the amount. It revokes itself the moment the money moves.';
  const url = site.origin + (page.canonical || '/');
  const og = page.og || `${site.origin}/api/card/proof-of-funds.png`;
  const nav = NAV.map(([id, href, label]) => `<a href="${href}"${page.nav === id ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  const scripts = (page.scripts || []).map(s => `<script type="module" src="${s}"></script>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta name="theme-color" content="#f3efe6">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/ui/fonts/mona-sans.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/ui/tokens.css">
<link rel="stylesheet" href="/ui/site.css">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Proof of Funds">
<meta property="og:title" content="${esc(page.ogTitle || title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(og)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(og)}">
${page.noindex ? '<meta name="robots" content="noindex">\n' : ''}${page.head || ''}
<script src="/config.js"></script>
<script type="module" src="/ui/app.js"></script>
${scripts}
</head>
<body class="${esc(page.bodyClass || '')}" data-page="${esc(page.nav || '')}">
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <a class="brand" href="/" aria-label="Proof of Funds, home">${markSVG({ size: 30 })}<span class="brand-name">Proof of Funds</span></a>
  <nav class="nav" id="nav" aria-label="Main">${nav}</nav>
  <div class="top-end"><span class="top-slot" data-slot-mini hidden><span class="dot"></span><span data-slot-text></span></span><button class="menu" type="button" aria-expanded="false" aria-controls="nav"><span class="menu-bars"></span><span class="sr">Menu</span></button></div>
</header>
<main id="main">
${page.body}
</main>
<footer class="foot">
  <div class="foot-grid">
    <div class="foot-lead">
      <p class="foot-claim">Post proof,<br>not wallet.</p>
      <div class="ca" data-ca></div>
      <div class="foot-links" data-token-links></div>
    </div>
    ${FOOT.map(([h, links]) => `<div class="foot-col"><h2>${h}</h2><ul>${links.map(([href, label]) => `<li><a href="${href}"${/^https?:/.test(href) ? ' rel="noopener" target="_blank"' : ''}>${label}</a></li>`).join('')}</ul></div>`).join('')}
  </div>
  <dl class="foot-facts">
    <div><dt>Program</dt><dd><a class="mono" href="https://solscan.io/account/${site.program}" rel="noopener" target="_blank">${site.program}</a></dd></div>
    <div><dt>Gate program</dt><dd><a class="mono" href="https://solscan.io/account/${site.gate}" rel="noopener" target="_blank">${site.gate}</a></dd></div>
    <div><dt>Verifier bundle sha256</dt><dd class="mono">${site.bundleHash || 'published at deploy'}</dd></div>
  </dl>
  <p class="foot-note">Built on Helius Privacy Rings. A certificate proves a minimum, never an amount, and it is only as private as the subject you choose.</p>
</footer>
</body>
</html>
`;
}

/** The docs shell body: sidebar of sections, the article, the on-page outline. */
export function docsBody({ sections, groups, current, html, outline, meta, prev, next, kicker }) {
  const list = secs => secs.map(s => `<li><a href="${s.href}"${s.slug === current ? ' aria-current="page"' : ''}><span class="n">${s.num}</span>${esc(s.title)}</a></li>`).join('');
  const side = list(sections);
  const more = (groups || []).map(g => `<details class="docs-pick" open><summary>${esc(g.title)}</summary><ol class="docs-list">${list(g.sections)}</ol></details>`).join('');
  const toc = outline.filter(o => o.depth === 2 || o.depth === 3).map(o => `<li class="d${o.depth}"><a href="#${o.id}">${esc(o.text.replace(/#$/, ''))}</a></li>`).join('');
  return `<div class="docs">
  <aside class="docs-side" aria-label="Sections">
    <details class="docs-pick" open><summary>${esc(kicker || 'The paper')}</summary><ol class="docs-list">${side}</ol></details>${more}
  </aside>
  <article class="prose" data-docs>
    ${meta?.summary ? `<p class="kicker">${esc(meta.summary)}</p>` : ''}
    ${html}
    <nav class="docs-next" aria-label="Pages">${prev ? `<a class="prev" href="${prev.href}"><span>Previous</span>${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a class="next" href="${next.href}"><span>Next</span>${esc(next.title)}</a>` : ''}</nav>
  </article>
  ${toc ? `<aside class="docs-toc" aria-label="On this page"><h2>On this page</h2><ol>${toc}</ol></aside>` : '<aside class="docs-toc"></aside>'}
</div>`;
}
