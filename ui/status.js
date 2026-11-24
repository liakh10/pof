/* /status: the checks of /api/status (run on request, cached a few seconds) and the stored history once the sampler runs. */
import { $, esc, num, asOf } from './fmt.js';

const WORD = { ok: 'All parts are working.', degraded: 'Working, with one part slow.', down: 'A part is down.', unknown: 'Some parts are not set up yet.' };
const fmt = v => (typeof v === 'number' ? num(v) : typeof v === 'boolean' ? (v ? 'yes' : 'no') : v === null || v === undefined ? '' : String(v));
const label = k => k.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()).replace(/ Ms$/, ' (ms)').replace(/ Slots$/, ' (slots)');

async function run() {
  $('[data-checks]').innerHTML = '<p><span class="spinner"></span> Running the checks</p>';
  try {
    const r = await fetch('/api/status', { headers: { accept: 'application/json' } }).then(x => x.json());
    if (r.error) throw Error(r.error.message);
    $('[data-overall]').textContent = WORD[r.overall] || r.overall;
    const old = asOf(r.checkedAt);
    $('[data-checked]').textContent = `Checked at slot ${num(r.slot)} on ${r.network || 'mainnet'}${old ? `, ${old}` : ''}.`;
    $('[data-checks]').innerHTML = r.checks.map(c => `<article class="svc">
      <div class="svc-top"><h3>${esc(c.name)}</h3><span class="state ${esc(c.state)}">${esc(c.state)}</span></div>
      <p class="small">${esc(c.summary || '')}</p>
      <dl>${Object.entries(c.metrics || {}).filter(([, v]) => v !== null && typeof v !== 'object').slice(0, 6).map(([k, v]) => `<dt>${esc(label(k))}</dt><dd>${esc(fmt(v))}</dd>`).join('')}</dl>
    </article>`).join('');
    const facts = await fetch('/api/attest').then(x => x.json()).catch(() => null);
    const pub = r.published?.bundleHash;
    $('[data-verifier]').innerHTML = `<div><dt>Published bundle sha256</dt><dd>${esc(pub || 'not published')}</dd></div>`
      + (facts && !facts.error ? `<div><dt>Running bundle sha256</dt><dd>${esc(facts.bundleHash)}${pub ? (facts.bundleHash === pub ? ' · matches' : ' · DIFFERS') : ''}</dd></div><div><dt>Verifier key</dt><dd>${esc(facts.verifierKey)}</dd></div><div><dt>Minimum note age</dt><dd>${num(facts.minAgeSlots)} slots</dd></div><div><dt>Keeps</dt><dd>${esc(facts.keeps || '')}</dd></div>` : `<div><dt>Verifier</dt><dd>not reachable from here</dd></div>`);
    if (r.history && r.history.days && r.history.days.length) {
      $('[data-history-wrap]').hidden = false;
      $('[data-history]').innerHTML = `<div class="bars" aria-label="Daily uptime">${r.history.days.map(d => `<i class="${d.uptime >= 99.5 ? '' : d.uptime >= 95 ? 'd' : 'x'}" title="${esc(d.date)}: ${d.uptime}%"></i>`).join('')}</div><p class="small quiet">One bar a day, oldest first.</p>`;
    }
  } catch (e) {
    $('[data-overall]').textContent = 'The status checks did not answer.';
    $('[data-checks]').innerHTML = `<div class="note err"><strong>${esc(e.message)}</strong><p>Try again in a moment.</p></div>`;
  }
}
$('[data-refresh]').addEventListener('click', run);
run();
