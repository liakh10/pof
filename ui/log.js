/* /log: the transparency log. The head and its signature, the on-chain anchor and its consistency with the head, witness
   cosignatures, any entry proven in the browser (with the audit path drawn), and the tail of the log. */
import { $, esc, num, short, tierLabel } from './fmt.js';
import { source, verifyEntry, trustedKeys, sdk, PROGRAM } from './data.js';

let src, head = null, keys = [];
const KIND = ['wallet', 'X handle', 'badge'];
const SYM = ['SOL', 'USDC'];
const H = (k, v, html = false) => { const el = $(`[data-h="${k}"]`); if (el) el[html ? 'innerHTML' : 'textContent'] = v; };

async function readHead() {
  head = await src.log.head();
  keys = await trustedKeys(src);
  H('size', num(head.treeSize));
  H('root', head.rootHash);
  const signed = await sdk.verifyTreeHead(head, PROGRAM).catch(() => false);
  const trusted = keys.some(k => k === head.verifierKey);
  H('sig', signed && trusted ? 'Valid, trusted key' : signed ? 'Valid, key not in Config' : 'Not valid');
  H('key', short(head.verifierKey, 8));
  // the anchor on chain (anchor_log writes the size and root into the Treasury)
  try {
    const t = await src.chain().getTreasury();
    const size = Number(t?.log?.treeSize ?? 0), root = t?.log?.rootHash ?? null;
    if (!t || !size) { H('anchor', 'Not yet'); H('anchor-note', 'the first anchor lands with the first certificates'); return; }
    let ok = size === head.treeSize ? String(root).toLowerCase() === head.rootHash.toLowerCase() : null;
    if (ok === null && size < head.treeSize) {
      const p = await src.log.consistency(size, head.treeSize);
      ok = await sdk.verifyConsistency({ size1: size, size2: head.treeSize, root1: root, root2: head.rootHash, proof: p.path }).catch(() => false);
    }
    H('anchor', ok ? `Size ${num(size)}, consistent` : `Size ${num(size)}, NOT consistent`);
    H('anchor-note', `the anchored root ${short(String(root), 8)} ${ok ? 'is a prefix of this head' : 'does not extend to this head'}`);
  } catch { H('anchor', 'Unread'); H('anchor-note', 'the chain did not answer'); }
}

async function readWitness() {
  try {
    const w = await src.log.witness();
    const n = (w.cosignatures || []).length;
    $('[data-witness]').innerHTML = `<div class="note${w.cosignaturesValid ? ' hot' : ''}"><strong>${n} witness cosignature${n === 1 ? '' : 's'}${w.cosignaturesValid ? ', all valid' : ''}.</strong><p>Independent witnesses sign the heads they have seen, so a forked log would need them to lie too.</p></div>`;
  } catch { $('[data-witness]').innerHTML = ''; }
}

/* the audit path as a drawing on the grid: the leaf at the bottom, one sibling per level on the side its bit says, orthogonal
   joins up to the root. Module 18, every coordinate a multiple of it. */
function pathSVG(index, size, path, root) {
  const M = 18, X = 16 * M, OFF = 7 * M, ROW = 3 * M, depth = path.length;
  const Wd = 32 * M, Ht = (depth + 1) * ROW + 4 * M;
  const y = l => Ht - M - l * ROW;
  // which side each sibling is on, from the leaf up, by the RFC 9162 split (the tree is not always balanced)
  const sides = [];
  for (let m = index, n = size; n > 1;) {
    let k = 1; while (k * 2 < n) k *= 2;
    if (m < k) { sides.push('right'); n = k; } else { sides.push('left'); m -= k; n -= k; }
  }
  sides.reverse();
  const out = [];
  for (let l = 0; l < depth; l++) {
    const right = sides[l] === 'right';
    const sx = right ? X + OFF : X - OFF;
    out.push(`<path class="ed" d="M ${sx} ${y(l)} V ${y(l + 1)} H ${X}"/>`);
    out.push(`<line class="ed path" x1="${X}" y1="${y(l)}" x2="${X}" y2="${y(l + 1)}"/>`);
    out.push(`<circle class="nd" cx="${sx}" cy="${y(l)}" r="6"/>`);
    out.push(`<text x="${right ? sx + M : sx - M}" y="${y(l) + 4}" text-anchor="${right ? 'start' : 'end'}">${esc(String(path[l]).slice(0, 8))}</text>`);
    if (l > 0) out.push(`<circle class="nd path" cx="${X}" cy="${y(l)}" r="6"/>`);
  }
  out.push(`<rect class="nd leaf" x="${X - 7}" y="${y(0) - 7}" width="14" height="14"/>`);
  out.push(`<text x="${X + M}" y="${y(0) + 4}" text-anchor="start" class="strong">entry ${index}</text>`);
  out.push(`<circle class="nd path" cx="${X}" cy="${y(depth)}" r="10"/><circle class="ring" cx="${X}" cy="${y(depth)}" r="16"/>`);
  out.push(`<text x="${X}" y="${y(depth) - 2 * M + 4}" text-anchor="middle" class="strong">root ${esc(String(root).slice(0, 8))} · size ${size}</text>`);
  return `<svg class="tree" viewBox="0 0 ${Wd} ${Ht}" role="img" aria-label="Audit path: ${depth} sibling hashes from entry ${index} to the root">${out.join('')}</svg>`;
}

async function check(i) {
  const box = $('[data-entry-out]');
  box.innerHTML = '<p><span class="spinner"></span> Fetching the leaf and its path</p>';
  try {
    const v = await verifyEntry(src, i, { head });
    const a = v.leaf.attestation;
    const row = (t, ok) => `<li><span class="${ok ? 'ok' : 'no'}"></span><span>${t}</span><small></small></li>`;
    box.innerHTML = `<ul class="checks">${row('The leaf parses (377 bytes, version 1)', v.checks.leafParses)}${row('The Verifier signed the attestation', v.checks.attestationSigned)}${row('The key is the one in the program Config', v.checks.keyTrusted)}${row(`The path of ${v.proof.path.length} hashes reaches the root`, v.checks.included)}${row('The root is a signed head', v.checks.headSigned !== false)}${row('The attestation names this program', v.checks.programMatches !== false)}</ul>
      ${pathSVG(i, v.proof.treeSize, v.proof.path, v.proof.rootHash)}
      <dl class="facts" style="margin-top:var(--s4)">
        <div><dt>Subject</dt><dd>${esc(KIND[a.subjectKind] || a.subjectKind)} · ${esc(a.subjectHash)}</dd></div>
        <div><dt>Tier</dt><dd>${esc(tierLabel(SYM[a.asset] || '?', a.tier))}</dd></div>
        <div><dt>Notes</dt><dd>${num(a.noteCount)} · nullset ${esc(short(a.nullsetHash, 10))}</dd></div>
        <div><dt>Rings root</dt><dd>${esc(short(a.treeRoot, 12))} at slot ${num(a.rootSlot)}</dd></div>
        <div><dt>Signed at slot</dt><dd>${num(a.issuedSlot)}, valid through ${num(a.expirySlot)}</dd></div>
        <div><dt>Payer</dt><dd>${esc(a.payer)}</dd></div>
        <div><dt>Controller</dt><dd>${esc(a.controller || '')}</dd></div>
        <div><dt>Verifier bundle</dt><dd>${esc(v.leaf.bundleHash || '')}</dd></div>
      </dl>`;
    history.replaceState(null, '', `/log?entry=${i}`);
  } catch (e) { box.innerHTML = `<div class="note err"><strong>${esc(e.message)}</strong></div>`; }
}
$('[data-entry-form]').addEventListener('submit', e => { e.preventDefault(); const i = Number($('#entry').value); if (Number.isInteger(i) && i >= 0) check(i); });

async function recent() {
  const n = head.treeSize, from = Math.max(0, n - 25);
  if (!n) { $('[data-recent]').innerHTML = `<tr><td colspan="6" class="quiet">The log is empty until the first attestation.</td></tr>`; return; }
  const r = await src.log.range(from, n);
  $('[data-recent-note]').textContent = `entries ${num(from)} to ${num(n - 1)}`;
  $('[data-recent]').innerHTML = r.entries.slice().reverse().map(e => {
    let a; try { a = sdk.parseAttestation(sdk.fromHex(e.attestation)); } catch { return ''; }
    return `<tr><td class="mono"><a href="/log?entry=${e.index}" data-entry="${e.index}">${e.index}</a></td><td class="mono">${esc(short(a.subjectHash, 8))}</td><td>${esc(KIND[a.subjectKind] || '')}</td><td>${esc(tierLabel(SYM[a.asset] || '?', a.tier))}</td><td class="mono">${num(a.issuedSlot)}</td><td class="mono">${esc(short(sdk.encodeBase58 ? (e.verifierKey.length === 64 ? sdk.encodeBase58(sdk.fromHex(e.verifierKey)) : e.verifierKey) : e.verifierKey, 5))}</td></tr>`;
  }).join('');
}
document.addEventListener('click', e => { const a = e.target.closest('[data-entry]'); if (a) { e.preventDefault(); $('#entry').value = a.dataset.entry; check(Number(a.dataset.entry)); $('[data-entry-out]').scrollIntoView({ behavior: 'smooth', block: 'center' }); } });

(async () => {
  src = await source();
  try {
    await readHead();
    if (head.treeSize) readWitness();
    await recent();
    const q = new URLSearchParams(location.search).get('entry');
    if (q !== null && /^\d+$/.test(q)) { $('#entry').value = q; check(Number(q)); }
    else if (head.treeSize) { $('#entry').value = head.treeSize - 1; check(head.treeSize - 1); }
  } catch (e) {
    H('size', '0'); H('root', 'no head yet'); H('sig', 'No head'); H('anchor', 'Not yet');
    $('[data-recent]').innerHTML = `<tr><td colspan="6" class="quiet">The log did not answer: ${esc(e.message)}</td></tr>`;
    $('[data-entry-out]').innerHTML = `<div class="empty"><p class="h3">No entries to check yet.</p><p class="quiet">The first entry appears with the first certificate.</p></div>`;
  }
})();
