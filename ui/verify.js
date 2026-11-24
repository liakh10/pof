/* /verify: any subject, read through /v1 (cached a few seconds) with an optional gate check, results as live cards. */
import { $, $$, esc, num, TIERS } from './fmt.js';
import { source } from './data.js';
import { certCard } from './cards.js';

const form = $('[data-verify-form]'), out = $('[data-results]'), verdict = $('[data-verdict]');
$('[data-host]').textContent = location.host;
const REASON = { ok: 'Yes.', no_certificate: 'No certificate.', below_tier: 'Below that tier.', revoked_spent: 'Revoked: the funds moved.', revoked_by_holder: 'Revoked by the holder.', expired: 'Expired.' };

function tiers() {
  const a = $('input[name="asset"]:checked').value;
  $('[data-min]').hidden = !a;
  if (a) $('#mintier').innerHTML = TIERS[a].map((t, i) => `<option value="${i + 1}">at least ${t} ${a}</option>`).join('');
}
$$('input[name="asset"]').forEach(r => r.addEventListener('change', tiers));

const who = s => (s.kind ? `${s.kind} ${s.value ?? s.subjectHash.slice(0, 12) + '…'}` : s.subjectHash.slice(0, 12) + '…');

async function run(subject) {
  const src = await source();
  const asset = $('input[name="asset"]:checked').value;
  const minTier = asset ? $('#mintier').value : undefined;
  verdict.innerHTML = '<p><span class="spinner"></span> Reading the chain</p>'; out.innerHTML = '';
  const q = new URLSearchParams({ q: subject, ...(asset ? { asset, minTier } : {}) });
  history.replaceState(null, '', `/verify?${q}`);
  try {
    const r = await src.lookup(subject, asset ? { asset, minTier } : {});
    const c = r.check;
    const head = c ? (REASON[c.reason] || c.reason) : r.certificates.length ? (r.live ? 'Live certificate found.' : 'Certificates found, none live.') : 'No certificate.';
    const good = c ? c.ok : r.live;
    verdict.innerHTML = `<div class="note${good ? ' hot' : ''}"><p class="h2" style="margin-bottom:var(--s2)">${esc(head)}</p><p class="quiet">Read from the chain at slot ${num(r.slot)}${r.subjects?.length ? ` for ${esc(r.subjects.map(who).join(', '))}` : ''}.</p></div>`;
    out.innerHTML = r.certificates.map(x => certCard(x)).join('');
    window.dispatchEvent(new Event('pof:content'));
  } catch (e) {
    verdict.innerHTML = `<div class="note err"><strong>${esc(e.code === 'bad_subject' ? 'That is not a subject.' : 'The check did not go through.')}</strong><p>${esc(e.message)}</p></div>`;
  }
}
form.addEventListener('submit', e => { e.preventDefault(); const s = $('#subject').value.trim(); if (s) run(s); });
const p = new URLSearchParams(location.search);
if (p.get('asset')) { const r = $(`input[name="asset"][value="${CSS.escape(p.get('asset'))}"]`); if (r) r.checked = true; }
tiers();
if (p.get('minTier')) $('#mintier').value = p.get('minTier');
if (p.get('q')) { $('#subject').value = p.get('q'); run(p.get('q')); }
