// A small Markdown renderer for the POF docs, reports, changelog and /developers. No dependencies. It covers what those
// files use: front matter, ATX headings (with anchors), paragraphs, emphasis, inline code, links, images, block quotes,
// nested lists (ordered and not), fenced code (```lang, ```mermaid kept as a figure), tables with alignment, rules, and
// raw HTML blocks passed through. Every heading gets a stable id; the renderer returns the outline for the sidebar.

export function frontMatter(src) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  if (!m) return { meta: {}, body: src };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const k = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (k) meta[k[1]] = k[2].replace(/^["']|["']$/g, '');
  }
  return { meta, body: src.slice(m[0].length) };
}

export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function slugify(text) {
  return String(text).toLowerCase().replace(/<[^>]+>/g, '').replace(/`/g, '').replace(/&[a-z]+;/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-') || 'section';
}

/** inline: code spans first (protected), then links/images, emphasis */
export function inline(text, opts = {}) {
  const codes = [];
  let s = String(text).replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, t, c) => { codes.push(c.trim()); return `\u0000${codes.length - 1}\u0000`; });
  // keep raw inline html tags that are safe (br, sup, sub, kbd)
  const tags = [];
  s = s.replace(/<(\/?(?:br|sup|sub|kbd|abbr)(?:\s[^>]*)?)\/?>/gi, (m) => { tags.push(m); return `\u0001${tags.length - 1}\u0001`; });
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (_, alt, src, t) => `<img src="${fixHref(src, opts)}" alt="${alt}"${t ? ` title="${t}"` : ''} loading="lazy">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (_, label, href, t) => {
    const h = fixHref(href.replace(/&amp;/g, '&'), opts);
    const ext = /^https?:\/\//.test(h);
    return `<a href="${esc(h)}"${ext ? ' rel="noopener" target="_blank"' : ''}${t ? ` title="${t}"` : ''}>${label}</a>`;
  });
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:])/g, (_, pre, u) => `${pre}<a href="${u}" rel="noopener" target="_blank">${u}</a>`);
  s = s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+?)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\s][^_]*?)_(?![_\w])/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/\u0001(\d+)\u0001/g, (_, i) => tags[+i]);
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
  if (opts.origin) s = s.replaceAll('{{ORIGIN}}', opts.origin);
  return s;
}

function fixHref(href, opts) {
  if (opts.origin) href = href.replaceAll('{{ORIGIN}}', opts.origin);
  return opts.link ? opts.link(href) : href;
}

/** Render a document. Returns { html, outline: [{ depth, id, text }], title } */
export function render(src, opts = {}) {
  const lines = src.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const out = [];
  const outline = [];
  const ids = new Map();
  let title = null;
  const uid = base => { const n = ids.get(base) || 0; ids.set(base, n + 1); return n ? `${base}-${n}` : base; };
  const I = t => inline(t, opts);

  let i = 0;
  const blank = l => /^\s*$/.test(l);
  const isFence = l => /^\s*(```|~~~)/.test(l);
  const isHead = l => /^#{1,6}\s/.test(l);
  const isRule = l => /^\s*([-*_])(\s*\1){2,}\s*$/.test(l);
  const isList = l => /^\s*([-*+]|\d+[.)])\s+/.test(l);
  const isQuote = l => /^\s*>/.test(l);
  const isTable = (l, n) => /\|/.test(l) && n !== undefined && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(n);
  const isHtml = l => /^\s*<(div|details|figure|table|section|aside|p|svg|img|picture|video)\b/i.test(l);

  while (i < lines.length) {
    const l = lines[i];
    if (blank(l)) { i++; continue; }

    if (isFence(l)) {
      const fence = l.trim().slice(0, 3);
      const lang = l.trim().slice(3).trim().split(/\s+/)[0] || '';
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) buf.push(lines[i++]);
      i++;
      let code = buf.join('\n');
      if (opts.origin) code = code.replaceAll('{{ORIGIN}}', opts.origin);
      if (lang === 'mermaid') out.push(`<figure class="diagram" data-kind="mermaid"><pre><code>${esc(code)}</code></pre><figcaption>Diagram source</figcaption></figure>`);
      else out.push(`<div class="code"${lang ? ` data-lang="${esc(lang)}"` : ''}>${lang ? `<span class="code-lang">${esc(lang)}</span>` : ''}<button class="code-copy" type="button" aria-label="Copy code">Copy</button><pre><code${lang ? ` class="lang-${esc(lang)}"` : ''}>${esc(code)}</code></pre></div>`);
      continue;
    }

    if (isHead(l)) {
      const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
      const depth = m[1].length;
      let text = m[2];
      let id;
      const custom = /\s*\{#([\w-]+)\}$/.exec(text);
      if (custom) { id = custom[1]; text = text.slice(0, custom.index); }
      id = uid(id || slugify(text));
      const html = I(text);
      if (depth === 1 && !title) title = text.replace(/[`*_]/g, '');
      outline.push({ depth, id, text: html.replace(/<[^>]+>/g, '') });
      out.push(`<h${depth} id="${id}">${html}${depth > 1 ? `<a class="anchor" href="#${id}" aria-label="Link to this section">#</a>` : ''}</h${depth}>`);
      i++;
      continue;
    }

    if (isRule(l)) { out.push('<hr>'); i++; continue; }

    if (isTable(l, lines[i + 1])) {
      const cells = row => row.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
      const head = cells(l);
      const align = cells(lines[i + 1]).map(c => c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : '');
      i += 2;
      const rows = [];
      while (i < lines.length && /\|/.test(lines[i]) && !blank(lines[i])) rows.push(cells(lines[i++]));
      const a = k => align[k] ? ` style="text-align:${align[k]}"` : '';
      out.push(`<div class="table"><table><thead><tr>${head.map((h, k) => `<th${a(k)}>${I(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${head.map((_, k) => `<td${a(k)}>${I(r[k] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }

    if (isQuote(l)) {
      const buf = [];
      while (i < lines.length && (isQuote(lines[i]) || (!blank(lines[i]) && buf.length && !isHead(lines[i])))) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      const inner = render(buf.join('\n'), { ...opts, nested: true });
      out.push(`<blockquote>${inner.html}</blockquote>`);
      continue;
    }

    if (isList(l)) {
      const { html, next } = list(lines, i, I, opts);
      out.push(html);
      i = next;
      continue;
    }

    if (isHtml(l)) {
      const buf = [];
      while (i < lines.length && !blank(lines[i])) buf.push(lines[i++]);
      out.push(buf.join('\n'));
      continue;
    }

    // paragraph
    const buf = [];
    while (i < lines.length && !blank(lines[i]) && !isFence(lines[i]) && !isHead(lines[i]) && !isRule(lines[i]) && !isQuote(lines[i]) && !(isList(lines[i]) && buf.length === 0) && !isTable(lines[i], lines[i + 1])) {
      if (isList(lines[i]) && /^\s*([-*+]|1[.)])\s+/.test(lines[i]) && buf.length) break;
      buf.push(lines[i++]);
    }
    const text = buf.map(s => s.trim()).join('\n').replace(/ {2,}\n/g, '<br>\n');
    out.push(`<p>${I(text)}</p>`);
  }
  return { html: out.join('\n'), outline, title };
}

function list(lines, start, I, opts) {
  const indentOf = l => /^(\s*)/.exec(l)[1].length;
  const base = indentOf(lines[start]);
  const ordered = /^\s*\d+[.)]/.test(lines[start]);
  const first = ordered ? Number(/^\s*(\d+)/.exec(lines[start])[1]) : 1;
  const items = [];
  let i = start;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*$/.test(l)) {
      // a blank line ends the list unless the next line continues it (same list or deeper)
      const n = lines[i + 1];
      if (n !== undefined && indentOf(n) >= base && (/^\s*([-*+]|\d+[.)])\s+/.test(n) ? indentOf(n) >= base : indentOf(n) > base)) { i++; if (items.length) items[items.length - 1].loose = true; continue; }
      break;
    }
    const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(l);
    if (m && m[1].length === base) { items.push({ lines: [m[3]], loose: false }); i++; continue; }
    if (m && m[1].length < base) break;
    if (!items.length) break;
    if (indentOf(l) > base || !/^\s*([-*+]|\d+[.)])\s+/.test(l)) {
      if (indentOf(l) <= base && /^(#{1,6}\s|```|>)/.test(l.trim())) break;
      items[items.length - 1].lines.push(l.slice(Math.min(indentOf(l), base + 2)));
      i++;
      continue;
    }
    break;
  }
  const tag = ordered ? 'ol' : 'ul';
  const body = items.map(it => {
    const src = it.lines.join('\n');
    const hasBlock = it.lines.slice(1).some(x => /^\s*([-*+]|\d+[.)])\s+|^\s*```|^\s*\|/.test(x));
    if (!hasBlock && !it.loose) return `<li>${I(it.lines.map(s => s.trim()).join('\n'))}</li>`;
    const inner = render(src, { ...opts, nested: true }).html;
    return `<li>${it.loose ? inner : inner.replace(/^<p>([\s\S]*?)<\/p>/, '$1')}</li>`;
  }).join('');
  return { html: `<${tag}${ordered && first !== 1 ? ` start="${first}"` : ''}>${body}</${tag}>`, next: i };
}
