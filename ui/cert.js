/* /c/:subject: one subject's certificates, read from the chain in this browser, with each log entry proven here:
   the leaf parses, the attestation is signed by a key the program's Config trusts, the audit path reaches a signed head,
   and the leaf's signed bytes match the certificate on chain. The status re-reads itself; a revoke breaks the seal. */
import { $, esc, num, short, span, ago, copy, toast, STATUS_TEXT, KIND_TEXT, certPath, subjectLine, atLeast } from './fmt.js';
import { source, verifyEntry, fromChain, sdk, PROGRAM } from './data.js';
import { certCard, stateOf } from './cards.js';
import { sealSVG } from './seal.js';

const body = $('[data-c-body]');
const raw = decodeURIComponent((location.pathname.match(/^\/c\/(.+)$/) || [])[1] || new URLSearchParams(location.search).get('subject') || '');
let src, now = 0, shown = new Map();

addEventListener('pof:slot', e => { now = e.detail; });

function title(certs, query) {
  const c = certs[0];
  if (!c) return `No certificate for ${short(query, 8)}`;
  const t = atLeast(c.tierLabel);
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}, ${STATUS_TEXT[c.status].toLowerCase()}`;
}

function facts(c) {
  const row = (k, v, mono = true) => v === null || v === undefined || v === '' ? '' : `<div><dt>${k}</dt><dd${mono ? '' : ' style="font-family:var(--face-text)"'}>${v}</dd></div>`;
  const link = a => `<a href="https://solscan.io/account/${esc(a)}" rel="noopener" target="_blank">${esc(a)}</a>`;
  return `<dl class="facts">
    ${row('Status', esc(STATUS_TEXT[c.status]), false)}
    ${row('Subject', esc(KIND_TEXT[c.kind]) + (c.subject ? ` · ${esc(c.kind === 'x' ? '@' + c.subject : c.subject)}` : c.kind === 'x' ? ' · the chain holds only the hash' : ''), false)}
    ${row('Subject hash', esc(c.subjectHash))}
    ${row('Account', link(c.address))}
    ${row('Certified at slot', `${num(c.certifiedSlot)}${now ? ` · ${esc(ago(c.certifiedSlot, now))}` : ''}`)}
    ${c.revokedSlot ? row('Revoked at slot', num(c.revokedSlot)) : row('Valid through slot', `${num(c.expirySlot)}${now && c.expirySlot > now ? ` · ${esc(span(c.expirySlot - now))} left` : ''}`)}
    ${row('Notes behind it', num(c.noteCount))}
    ${row('Controller', c.controller ? link(c.controller) : '')}
    ${row('Paid by', link(c.payer))}
    ${row('Verifier key', esc(c.verifierKey))}
    ${row('Renewals', num(c.renewals || 0))}
    ${row('Log entry', c.logIndex !== null && c.logIndex !== undefined ? `<a href="/log?entry=${c.logIndex}">#${num(c.logIndex)}</a>` : '')}
    ${c.revealed ? row('Spent note revealed', `index ${c.revealed.index} · nullifier ${esc(short(c.revealed.nullifier, 10))}`) : ''}
  </dl>`;
}

function proofBlock(c) {
  return `<section class="stack" data-proof="${esc(c.address)}">
    <p class="label">The log entry, checked in your browser</p>
    <ul class="checks">
      <li data-k="leafParses"><span class="wait"></span><span>The entry is a well-formed POF log leaf</span><small></small></li>
      <li data-k="attestationSigned"><span class="wait"></span><span>The Verifier's signature over the 240-byte attestation is valid</span><small></small></li>
      <li data-k="keyTrusted"><span class="wait"></span><span>That key is the one the program's Config trusts</span><small></small></li>
      <li data-k="included"><span class="wait"></span><span>The audit path leads to the log root</span><small></small></li>
      <li data-k="headSigned"><span class="wait"></span><span>The root is a signed tree head</span><small></small></li>
      <li data-k="matches"><span class="wait"></span><span>The signed bytes match this certificate on chain</span><small></small></li>
    </ul>
    <p class="small quiet" data-proof-note></p>
  </section>`;
}

async function prove(c) {
  const box = body.querySelector(`[data-proof="${CSS.escape(c.address)}"]`);
  if (!box) return;
  const set = (k, ok, note = '') => { const li = box.querySelector(`[data-k="${k}"]`); if (!li) return; li.firstElementChild.className = ok === null ? 'wait' : ok ? 'ok' : 'no'; li.querySelector('small').textContent = note; };
  if (c.logIndex === null || c.logIndex === undefined) { box.querySelector('[data-proof-note]').textContent = 'This certificate names no log entry.'; return; }
  try {
    const v = await verifyEntry(src, Number(c.logIndex));
    for (const k of ['leafParses', 'attestationSigned', 'keyTrusted', 'included']) set(k, !!v.checks[k]);
    set('headSigned', v.checks.headSigned !== false, `size ${num(v.head.treeSize)}`);
    const m = v.leaf ? sdk.matchCertificateLeaf({ subjectHash: c.subjectHash, asset: c.assetId, tier: c.tier, nullsetHash: c.nullsetHash, nonce: c.nonce, payer: c.payer, controller: c.controller, issuedSlot: c.issuedSlot, expirySlot: c.expirySlot, verifier: c.verifierKey }, v.leaf) : { matches: false, mismatched: ['leaf'] };
    set('matches', m.matches, m.matches ? '' : `differs: ${m.mismatched.join(', ')}`);
    box.querySelector('[data-proof-note]').innerHTML = `Path of ${v.proof.path.length} hashes to root <span class="mono">${esc(short(v.proof.rootHash, 10))}</span>. Trusted keys come from the program's Config on chain, never from the log. <a href="/log?entry=${c.logIndex}">Open the entry</a>`;
  } catch (e) {
    for (const k of ['leafParses', 'attestationSigned', 'keyTrusted', 'included', 'headSigned', 'matches']) set(k, null);
    box.querySelector('[data-proof-note]').textContent = `The log could not be read just now (${e.message}). The certificate above is read from the chain either way.`;
    box.querySelectorAll('.wait').forEach(x => (x.className = 'no'));
  }
}

function render(look) {
  const certs = look.certificates;
  $('[data-c-title]').textContent = title(certs, raw);
  document.title = `${title(certs, raw)} · Proof of Funds`;
  if (!certs.length) {
    $('[data-c-lead]').textContent = 'The chain holds no certificate for this subject, in any asset. A subject is a wallet, an @handle or a badge key.';
    body.innerHTML = `<div class="empty"><p class="h3">Nothing certified here.</p><p class="quiet">Read from the chain at slot ${num(look.slot)}.</p><div class="row"><a class="btn" href="/get">Get certified</a><a class="btn ghost" href="/verify">Check another subject</a></div></div>`;
    return;
  }
  const c0 = certs[0];
  $('[data-c-lead]').textContent = c0.status === 'live'
    ? 'Live right now. The notes behind it were unspent when it was certified, and a spend would have revoked it on chain.'
    : c0.status === 'revoked_spent' ? 'A note behind this certificate was spent, and the chain recorded it at the slot below. It no longer proves anything.'
    : c0.status === 'revoked_by_holder' ? 'The holder revoked it. It no longer proves anything.' : 'It expired. Certificates last about 30 days unless renewed.';
  const url = location.origin + certPath(c0);
  body.innerHTML = certs.map(c => `
    <article class="cert-page grid" style="padding:0;row-gap:var(--s5)" data-addr="${esc(c.address)}">
      <div class="col-7">${certCard(c, { link: false, cls: 'cert-xl', seal: true })}</div>
      <div class="col-5 stack">${facts(c)}</div>
      <div class="col-12">${proofBlock(c)}</div>
    </article>`).join('<hr style="border:0;border-top:2px solid var(--ink);margin:var(--s6) 0">') + `
    <section class="band" style="margin-top:var(--s6)">
      <p class="label">Share</p>
      <div class="row" style="margin-top:var(--s3)">
        <button class="btn" type="button" data-copy="${esc(url)}" data-copy-label="Link copied">Copy the link</button>
        <a class="btn ghost" href="https://x.com/intent/post?text=${encodeURIComponent(`${c0.tierLabel}, live on chain: ${url}`)}" rel="noopener" target="_blank">Post on X</a>
        <a class="btn ghost" href="/api/card/${encodeURIComponent(raw)}.png" rel="noopener" target="_blank">The card image</a>
      </div>
      <p class="small quiet" style="margin-top:var(--s4)">Embed a live badge on any site:</p>
      <div class="code" data-lang="html"><span class="code-lang">html</span><button class="code-copy" type="button" aria-label="Copy code">Copy</button><pre><code>${esc(`<script type="module" src="${location.origin}/embed/pof-badge.js"></script>\n<pof-badge subject="${raw}" asset="${c0.asset}" min-tier="${c0.tier}"></pof-badge>`)}</code></pre></div>
    </section>`;
  for (const c of certs) { shown.set(c.address, c.status); prove(c); }
}

async function read() {
  const r = await src.chain().lookup(raw);
  const byHash = new Map(r.candidates.map(x => [x.subjectHash, x.value]));
  const certificates = r.certificates.sort((a, b) => Number(b.live) - Number(a.live) || b.tier - a.tier).map(c => fromChain(c, byHash.get(c.subjectHash) ?? null));
  return { slot: r.slot, certificates };
}

/* the live re-read: a status change re-renders that card and breaks its seal */
async function watch() {
  try {
    const look = await read();
    for (const c of look.certificates) {
      if (shown.get(c.address) && shown.get(c.address) !== c.status) {
        const art = body.querySelector(`[data-addr="${CSS.escape(c.address)}"]`);
        if (art) {
          art.querySelector('.col-7').innerHTML = certCard(c, { link: false, cls: 'cert-xl flip', seal: true }).replace('class="seal ', 'class="seal breaking ');
          art.querySelector('.col-5').innerHTML = facts(c);
          toast(`Status changed: ${STATUS_TEXT[c.status]}`);
        }
        shown.set(c.address, c.status);
        $('[data-c-title]').textContent = title(look.certificates, raw);
      }
    }
  } catch {}
}

(async () => {
  src = await source();
  if (!raw) { body.innerHTML = `<div class="empty"><p class="h3">Name a subject.</p><p class="quiet">Open /c/ followed by a wallet, an @handle or a badge key, or use <a href="/verify">Verify</a>.</p></div>`; return; }
  try {
    render(await read());
    setInterval(() => { if (!document.hidden) watch(); }, 8000);
  } catch (e) {
    $('[data-c-title]').textContent = 'That is not a subject';
    body.innerHTML = `<div class="note err"><strong>${esc(e.message || 'The chain could not be read.')}</strong><p>A subject is a wallet address, an @handle, badge:&lt;key&gt; or a 64-character subject hash. <a href="/verify">Try Verify</a>.</p></div>`;
  }
})();
