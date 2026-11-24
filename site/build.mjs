#!/usr/bin/env node
// Builds the static POF site at the repo root from site/pages (the app pages), docs-src (the paper), reports/*.md,
// docs-src/developers.md, CHANGELOG.md and the shared shell. Deterministic: the same inputs give the same bytes.
//   node site/build.mjs            write the pages
//   node site/build.mjs --check    build in memory, fail if a committed page differs or an internal link is dead
// The origin (canonical/og links, {{ORIGIN}} in /developers) comes from one place: config.js DOMAIN (default below until set).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { frontMatter, render, esc } from './md.mjs';
import { shell, docsBody } from './layout.mjs';
import { faviconSVG, sealSVG, markSVG, cardArtSVG } from '../ui/seal.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const CHECK = process.argv.includes('--check');
const REPO = 'https://github.com/liakh10/pof/blob/main/';
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = p => fs.existsSync(path.join(ROOT, p));

const cfgText = exists('config.js') ? read('config.js') : '';
const cfg = k => (new RegExp(`${k}\\s*[:=]\\s*["']([^"']*)["']`).exec(cfgText) || [])[1] || '';
const DEFAULT_ORIGIN = 'https://proofoffunds.vercel.app';   // until config.js DOMAIN is set
const origin = ((cfg('DOMAIN') ? `https://${cfg('DOMAIN').replace(/^https?:\/\//, '')}` : '') || DEFAULT_ORIGIN).replace(/\/$/, '');
const site = {
  origin,
  program: cfg('PROGRAM') || 'pofP4QRRDXnmDN9CNYiAGHfwMEgM7sLWhVcUMpsbynT',
  gate: cfg('GATE') || 'gatSToJMD8ZPLa85fKj6seYHUtYx4ah3ptZvLkisLPU',
  bundleHash: (() => { try { return JSON.parse(read('verifier/dist/BUILD.json')).sha256; } catch { return ''; } })(),
};

const outputs = new Map();          // path → content
const emit = (p, s) => outputs.set(p, s);
const pages = new Set();            // every URL the site serves from this build (for the link check)

/* ------------------------------------------------------------------ the paper (docs-src) */
const DOC_SKIP = new Set(['developers.md']);
const docs = fs.readdirSync(path.join(ROOT, 'docs-src')).filter(f => f.endsWith('.md') && !DOC_SKIP.has(f)).map(f => {
  const { meta, body } = frontMatter(read(`docs-src/${f}`));
  const slug = f.replace(/\.md$/, '');
  return { file: f, slug, meta, body, order: Number(meta.order ?? 99), title: meta.title || slug };
}).sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
const docSlugs = new Set(docs.map(d => d.slug));
const reportFiles = exists('reports') ? fs.readdirSync(path.join(ROOT, 'reports')).filter(f => f.endsWith('.md')).sort() : [];

// the first doc (the abstract) is /docs itself; the rest are /docs/<slug>
const lead = docs.find(d => d.slug === 'abstract') || docs[0];
const docHref = slug => (lead && slug === lead.slug ? '/docs' : `/docs/${slug}`);

/** links inside Markdown: sibling docs, reports, repo files → the right URL */
function linker(fromDir) {
  return href => {
    if (/^(https?:|mailto:|#|\/)/.test(href)) return href;
    const [p, hash = ''] = href.split('#');
    const h = hash ? `#${hash}` : '';
    const norm = path.posix.normalize(path.posix.join(fromDir, p));
    const base = norm.replace(/\.md$/, '');
    if (norm.startsWith('docs-src/')) {
      const slug = base.slice('docs-src/'.length);
      if (slug === 'developers') return `/developers${h}`;
      if (slug === 'guides/index' || slug === 'guides') return `/docs/guides${h}`;
      if (docSlugs.has(slug)) return docHref(slug) + h;
      return `/docs/${slug}${h}`;
    }
    if (/^reports\/[\w-]+$/.test(base) && reportFiles.includes(base.slice(8) + '.md')) return `/reports/${base.slice(8)}${h}`;
    if (norm === 'CHANGELOG.md') return `/changelog${h}`;
    return REPO + norm + h;
  };
}

const sections = docs.map((d, i) => ({ slug: d.slug, title: d.title, href: docHref(d.slug), num: String(i + 1).padStart(2, '0') }));

function trustDigest() {
  const t = docs.find(d => d.slug === 'trust');
  if (!t) return '';
  const r = render(t.body, { link: linker('docs-src') });
  const items = [];
  const re = /<h2 id="([^"]+)">([\s\S]*?)<a class="anchor"[\s\S]*?<\/h2>\s*<p>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = re.exec(r.html))) {
    const first = m[3].replace(/<[^>]+>/g, '').split(/(?<=\.)\s/)[0].replace(/:$/, '.');
    items.push(`<li><a href="/docs/trust#${m[1]}"><strong>${m[2].replace(/^\d+\.\s*/, '')}</strong><span>${esc(first)}</span></a></li>`);
  }
  if (!items.length) return '';
  return `<section class="trust-first" aria-labelledby="trust-first-h"><p class="label" id="trust-first-h">Read this first: what you trust</p><ol>${items.join('')}</ol><a class="more" href="/docs/trust">All trust points, with what each party could do</a></section>`;
}

/* guides (docs-src/guides): /docs/guides and /docs/guides/<slug>, a second sidebar group */
const guides = exists('docs-src/guides') ? fs.readdirSync(path.join(ROOT, 'docs-src/guides')).filter(f => f.endsWith('.md')).map(f => {
  const { meta, body } = frontMatter(read(`docs-src/guides/${f}`));
  const slug = f.replace(/\.md$/, '');
  return { slug, meta, body, order: Number(meta.order ?? 99), title: meta.title || slug, href: slug === 'index' ? '/docs/guides' : `/docs/guides/${slug}` };
}).sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug)) : [];
const guideSections = guides.map((g, i) => ({ slug: `guides/${g.slug}`, title: g.slug === 'index' ? 'All guides' : g.title, href: g.href, num: g.slug === 'index' ? 'G' : `G${i}` }));
const guideGroup = guideSections.length ? [{ title: 'Guides', sections: guideSections }] : [];
guides.forEach((g, i) => {
  const r = render(g.body, { link: linker('docs-src/guides') });
  pages.add(g.href);
  const body = docsBody({ sections, groups: guideGroup, current: `guides/${g.slug}`, html: r.html, outline: r.outline, meta: g.meta, prev: guideSections[i - 1], next: guideSections[i + 1] });
  emit(g.slug === 'index' ? 'docs/guides/index.html' : `docs/guides/${g.slug}.html`, shell({ title: g.slug === 'index' ? 'Guides' : g.title, description: g.meta.summary, nav: 'docs', body, canonical: g.href, scripts: ['/ui/docs.js'], bodyClass: 'page-docs' }, site));
});

docs.forEach((d, i) => {
  const r = render(d.body, { link: linker('docs-src') });
  const href = docHref(d.slug);
  pages.add(href);
  const prev = i > 0 ? sections[i - 1] : null, next = i < docs.length - 1 ? sections[i + 1] : null;
  let html = r.html;
  if (d === lead) html = trustDigest() + html;
  const body = docsBody({ sections, groups: guideGroup, current: d.slug, html, outline: r.outline, meta: d.meta, prev, next });
  const out = d === lead ? 'docs/index.html' : `docs/${d.slug}.html`;
  emit(out, shell({ title: d === lead ? 'Docs' : d.title, description: d.meta.summary, nav: 'docs', body, canonical: href, scripts: ['/ui/docs.js'], bodyClass: 'page-docs' }, site));
});

/* ------------------------------------------------------------------ /developers */
if (exists('docs-src/developers.md')) {
  const { meta, body } = frontMatter(read('docs-src/developers.md'));
  const r = render(body, { origin, link: linker('docs-src') });
  const devSections = [{ slug: 'developers', title: meta.title || 'Developers', href: '/developers', num: '20' }];
  const html = docsBody({ sections: devSections, current: 'developers', html: r.html, outline: r.outline, meta, kicker: 'Developers' });
  emit('developers.html', shell({ title: 'Developers', description: meta.summary || 'The read API, the SDK, the require_certificate CPI, pof_gate Rooms, the MCP server and the bots.', nav: 'developers', body: html, canonical: '/developers', scripts: ['/ui/docs.js'], bodyClass: 'page-docs' }, site));
  pages.add('/developers');
}

/* ------------------------------------------------------------------ /reports */
const reports = reportFiles.map(f => {
  const { meta, body } = frontMatter(read(`reports/${f}`));
  const r = render(body, { link: linker('reports') });
  const slug = f.replace(/\.md$/, '');
  const firstP = (/<p>([\s\S]*?)<\/p>/.exec(r.html) || [])[1] || '';
  return { slug, meta, r, title: meta.title || r.title || slug, summary: meta.summary || firstP.replace(/<[^>]+>/g, '').slice(0, 260) };
});
const ORDER = ['program', 'verifier', 'rings', 'devx', 'audit', 'fuzz', 'zk'];
reports.sort((a, b) => ((ORDER.indexOf(a.slug) + 1 || 99) - (ORDER.indexOf(b.slug) + 1 || 99)) || a.slug.localeCompare(b.slug));
const repSections = reports.map((r, i) => ({ slug: r.slug, title: r.title, href: `/reports/${r.slug}`, num: String(i + 1).padStart(2, '0') }));
reports.forEach((rep, i) => {
  const body = docsBody({ sections: repSections, current: rep.slug, html: rep.r.html, outline: rep.r.outline, meta: rep.meta, prev: repSections[i - 1], next: repSections[i + 1], kicker: 'Test reports' });
  emit(`reports/${rep.slug}.html`, shell({ title: rep.title, description: rep.summary, nav: 'docs', body, canonical: `/reports/${rep.slug}`, scripts: ['/ui/docs.js'], bodyClass: 'page-docs' }, site));
  pages.add(`/reports/${rep.slug}`);
});
emit('reports/index.html', shell({
  title: 'Test reports', nav: 'docs', canonical: '/reports', bodyClass: 'page-index',
  description: 'Every part of Proof of Funds publishes what it tested, how, and what failed: the program, the Verifier, the client, the API and SDK, and the internal security review.',
  body: `<section class="band"><div class="grid"><p class="label col-12">Record</p><h1 class="h1 col-8">Test reports</h1><p class="lead col-7">Each part publishes what it tested, the commands that run the tests, and what is still open. Findings stay in the reports after they are fixed.</p></div></section>
<section class="band"><ol class="index-list">${reports.map((r, i) => `<li><a href="/reports/${r.slug}"><span class="n">${String(i + 1).padStart(2, '0')}</span><span class="t">${esc(r.title)}</span><span class="s">${esc(r.summary)}</span></a></li>`).join('')}</ol></section>`,
}, site));
pages.add('/reports');

/* ------------------------------------------------------------------ /changelog */
{
  let html, outline = [];
  if (exists('CHANGELOG.md')) {
    const r = render(frontMatter(read('CHANGELOG.md')).body, { link: linker('') });
    html = r.html; outline = r.outline;
  } else {
    // until the changelog is written by hand: the repository's own history, grouped by day
    let log = '';
    try { log = execFileSync('git', ['log', '--date=short', '--pretty=format:%ad\t%h\t%s', '-n', '400'], { cwd: ROOT, encoding: 'utf8' }); } catch {}
    const byDay = new Map();
    for (const line of log.split('\n').filter(Boolean)) {
      const [d, h, s] = line.split('\t');
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push([h, s]);
    }
    html = `<h1 id="changelog">Changelog</h1><p>Every change to the program, the Verifier, the client, the API and this site, from the repository history.</p>` +
      [...byDay].map(([d, list]) => `<h2 id="d-${d}">${d}</h2><ul class="commits">${list.map(([h, s]) => `<li><a class="mono" href="https://github.com/liakh10/pof/commit/${h}" rel="noopener" target="_blank">${h}</a> ${esc(s)}</li>`).join('')}</ul>`).join('');
    outline = [...byDay.keys()].map(d => ({ depth: 2, id: `d-${d}`, text: d }));
  }
  const body = docsBody({ sections: [{ slug: 'changelog', title: 'Changelog', href: '/changelog', num: '00' }], current: 'changelog', html, outline, kicker: 'Record' });
  emit('changelog.html', shell({ title: 'Changelog', nav: 'docs', canonical: '/changelog', body, scripts: ['/ui/docs.js'], bodyClass: 'page-docs', description: 'What changed in Proof of Funds, part by part.' }, site));
  pages.add('/changelog');
}

/* ------------------------------------------------------------------ the app pages (site/pages/*.html) */
/** <!--seal:STATE--> <!--mark:STATE--> <!--cardart--> placeholders → inline SVG (so the art is there before any script) */
const art = s => s
  .replace(/<!--seal:(\w+)(?::(\w+))?-->/g, (_, state, extra) => sealSVG({ state, title: extra === 'title' ? 'The Proof of Funds seal' : undefined }).replace('class="seal ', `class="seal ${extra === 'draw' ? 'draw ' : ''}`))
  .replace(/<!--mark:(\w+)-->/g, (_, state) => markSVG({ state }))
  .replace(/<!--cardart-->/g, () => cardArtSVG());

const APP = [
  { file: 'home', out: 'index.html', url: '/', nav: 'wall', title: '', scripts: ['/ui/home.js'], bodyClass: 'page-home' },
  { file: 'get', out: 'get.html', url: '/get', nav: 'get', title: 'Get certified', scripts: ['/ui/get.js'], description: 'Shield into your POF vault, choose a tier and a subject, and get a public certificate that never shows the amount.' },
  { file: 'verify', out: 'verify.html', url: '/verify', nav: 'verify', title: 'Verify', scripts: ['/ui/verify.js'], description: 'Check any wallet, X handle or badge against the chain: the tier, the status, the slot.' },
  { file: 'cert', out: 'c.html', url: '/c', nav: 'verify', title: 'Certificate', scripts: ['/ui/cert.js'], description: 'One Proof of Funds certificate, read live from the chain, with its log entry proven in your browser.' },
  { file: 'rooms', out: 'rooms.html', url: '/rooms', nav: 'rooms', title: 'Rooms', scripts: ['/ui/rooms.js'], description: 'pof_gate Rooms admit only live certificates of a tier, on chain. Members fall out when their certificate dies.' },
  { file: 'room', out: 'room.html', url: '/room', nav: 'rooms', title: 'Room', scripts: ['/ui/room.js'], description: 'A pof_gate Room: its tier, its members, and whether each one still passes.' },
  { file: 'log', out: 'log.html', url: '/log', nav: 'log', title: 'Transparency log', scripts: ['/ui/log.js'], description: 'Every attestation the Verifier signs, in an append-only Merkle log anchored on chain. Check any entry in your browser.' },
  { file: 'status', out: 'status.html', url: '/status', nav: '', title: 'Status', scripts: ['/ui/status.js'], description: 'The live health of every part POF depends on: the RPC, the program, the Rings tree, the indexer, the Verifier, the relayer, the keeper and the log.' },
  { file: '404', out: '404.html', url: '/404', nav: '', title: 'Not found', scripts: [], noindex: true },
];
for (const p of APP) {
  const src = path.join(here, 'pages', `${p.file}.html`);
  if (!fs.existsSync(src)) continue;
  const body = art(fs.readFileSync(src, 'utf8'));
  emit(p.out, shell({ ...p, body, canonical: p.url }, site));
  pages.add(p.url);
}
emit('favicon.svg', faviconSVG() + '\n');

/* ------------------------------------------------------------------ links: drop footer links to pages that do not exist yet, check the rest */
const known = url => {
  const u = url.split('#')[0].split('?')[0].replace(/\/$/, '') || '/';
  if (pages.has(u) || outputs.has(u.slice(1)) || outputs.has(u.slice(1) + '.html')) return true;
  if (/^\/(v1|api|c|rooms|ui|client|sdk|mcp|link)(\/|$)/.test(u)) return true;
  return exists(u.slice(1));
};
const dead = [];
for (const [p, s] of outputs) {
  if (!p.endsWith('.html')) continue;
  let t = s.replace(/<li><a href="(\/docs\/[\w-]+)">[^<]*<\/a><\/li>/g, (m, href) => (known(href) ? m : ''));
  for (const m of t.matchAll(/href="(\/[^"]*)"/g)) if (!known(m[1])) dead.push(`${p}: ${m[1]}`);
  outputs.set(p, t);
}

/* ------------------------------------------------------------------ write or check */
let changed = 0;
for (const [p, s] of outputs) {
  const f = path.join(ROOT, p);
  const old = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  if (old === s) continue;
  changed++;
  if (!CHECK) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); }
}
if (dead.length) { const by = new Map(); for (const d of dead) { const u = d.split(': ')[1]; by.set(u, (by.get(u) || 0) + 1); } console.warn('links to pages not built yet: ' + [...by].map(([u, n]) => `${u} (${n})`).join(', ')); }
console.log(`${CHECK ? 'checked' : 'built'} ${outputs.size} files (${changed} ${CHECK ? 'differ' : 'changed'}) for ${origin}`);
if (CHECK && (changed || dead.length)) process.exit(1);
