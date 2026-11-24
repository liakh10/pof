/* /get: the certify flow on top of pof/client (wallet → vault → shield → tier and subject → certify → share).
   Every refusal goes through client/errors.js explain() so the holder reads one sentence and what to do. */
import { $, $$, esc, num, toast, copy, span, tierLabel, TIERS } from './fmt.js';
import { source, LIVE, PROGRAM, sdk } from './data.js';
import { certCard } from './cards.js';
import { certifyInstructions, chainReason } from './tx.js';

const CFG = window.POF || {};
let pof = null, W = null, explain = null, src = null;
const state = { wallet: null, vault: null, notes: null, linkId: null, handle: null, controller: null, running: null, step: 'wallet' };
const ORDER = ['wallet', 'vault', 'shield', 'claim', 'certify', 'done'];
const live = () => LIVE;

/* ------------------------------------------------------------------ the page frame */
function step(name, { done = [] } = {}) {
  state.step = name;
  const at = ORDER.indexOf(name);
  for (const [i, s] of ORDER.entries()) {
    const nav = $(`[data-step-nav="${s}"]`), panel = $(`[data-step="${s}"]`);
    nav.classList.toggle('on', i === at); nav.classList.toggle('done', i < at || done.includes(s));
    panel.setAttribute('aria-disabled', String(i > at && !(s === 'claim' && at >= 2)));
  }
}
const logEl = $('[data-log]');
function log(id, text, st = 'wait') {
  let li = logEl.querySelector(`[data-id="${id}"]`);
  if (!li) { li = document.createElement('li'); li.dataset.id = id; logEl.appendChild(li); }
  li.innerHTML = `<span class="${st === 'ok' ? 'ok' : st === 'no' ? 'no' : 'wait'}"></span><span>${esc(text)}</span><small></small>`;
  return li;
}
function showError(e, where = '[data-error]') {
  const x = explain ? explain(e) : { title: e.message || String(e), action: 'Try again.' };
  if (x.silent) { toast('Nothing was sent.'); return; }
  const box = $(where);
  box.hidden = false;
  box.innerHTML = `<strong>${esc(x.title)}</strong><p>${esc(x.action)}</p>`;
  const reason = chainReason(e);
  if (reason) box.innerHTML += `<p class="small mono">${esc(reason.code)}: ${esc(reason.message)}</p>`;
  if (e && !e.silent) console.warn('[pof]', e.code || '', e.message || e);
}
const clearError = () => { const b = $('[data-error]'); b.hidden = true; b.innerHTML = ''; };
const busy = (btn, on, label) => { if (!btn) return; if (on) { btn.dataset.label = btn.textContent; btn.innerHTML = `<span class="spinner"></span> ${esc(label || btn.textContent)}`; btn.disabled = true; } else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; } };
const val = name => Number($(`input[name="${name}"]:checked`)?.value ?? 0);
const fmtUnits = (v, asset) => { const d = asset === 1 ? 6 : 9; const s = BigInt(v).toString().padStart(d + 1, '0'); const w = s.slice(0, -d), f = s.slice(-d).replace(/0+$/, '').slice(0, 4); return `${num(w)}${f ? '.' + f : ''}`; };
const SYM = ['SOL', 'USDC'];

/* ------------------------------------------------------------------ load the client (the Rings hasher loads on demand) */
async function client() {
  if (pof) return pof;
  const mod = await import('/client/pof-client.js');
  W = await import('/client/wallet.js');
  explain = mod.explain;
  pof = await mod.createPofClient({ network: 'mainnet', programId: PROGRAM });
  pof.onStatus(onStatus);
  return pof;
}
const HASHER = $('[data-progress]');
function onStatus(ev) {
  const s = ev.step, p = ev.phase;
  if (s === 'hasher') {
    const pct = ev.total ? Math.round((ev.loaded / ev.total) * 100) : ev.ready ? 100 : 0;
    HASHER.hidden = pct >= 100; HASHER.style.setProperty('--p', pct + '%');
    return;
  }
  const T = {
    'vault:sign': ['vault', 'Sign the vault message in your wallet.'], 'vault:sign-again': ['vault', 'Sign it once more: this checks your wallet signs the same way every time.'],
    'vault:ready': ['vault', 'Vault ready.', 'ok'], 'vault:needs-passphrase': ['vault', 'Your wallet signs differently each time: choose a passphrase to lock a random vault key.', 'no'],
    'register:sign': ['register', 'Approve the registration in your wallet.'], 'register:sent': ['register', 'Registration sent. Waiting for the chain.'], 'register:done': ['register', 'Vault registered.', 'ok'],
    'shield:sign': ['shield', 'Approve the shield in your wallet.'], 'shield:sent': ['shield', 'Shield sent. Waiting for the chain.'], 'shield:done': ['shield', 'Shielded into the vault.', 'ok'],
    'sync:start': ['sync', 'Reading your vault from the Rings indexer.'], 'sync:done': ['sync', `Vault read: ${ev.count ?? 0} unspent notes.`, 'ok'],
    'age:waiting': ['age', `Your newest note needs ${num(ev.waitSlots)} more slots (${span(ev.waitSlots)}).`], 'age:ready': ['age', 'Your notes are old enough.', 'ok'],
    'delay:waiting': ['delay', `Random wait: ${num(ev.remainingSlots)} of ${num(ev.totalSlots)} slots left (${span(ev.remainingSlots)}).`], 'delay:done': ['delay', 'Random wait over.', 'ok'],
    'subject:sign': ['subject', 'Sign the subject statement in your wallet. It names this vault, the tier and the payer.'], 'subject:sign-ring': ['subject', 'Sign for your Ring in your wallet.'],
    'attest:send': ['attest', 'The Verifier is checking your notes against the Rings tree.'], 'attest:done': ['attest', `The Verifier signed. Log entry ${ev.logIndex}.`, 'ok'], 'attest:refused': ['attest', 'The Verifier refused.', 'no'],
    'relay:pay': ['relay', ev.from === 'vault' ? 'Paying the relayer from the vault (a private transfer).' : 'Approve the relay payment in your wallet.'], 'relay:done': ['relay', 'The relayer submitted the certificate.', 'ok'],
    'relay:off': ['relay', 'The relayer is off: your wallet pays.', 'no'], 'credits:claimed': ['credits', `Relay credits added: ${ev.credited ?? ''}.`, 'ok'],
  };
  const t = T[`${s}:${p}`];
  if (t && state.running === 'certify' || t && ['register', 'shield', 'sync'].includes(s)) log(t[0], t[1], t[2]);
  if (t && s === 'vault') $('[data-vault-state]').textContent = t[1];
}

/* ------------------------------------------------------------------ 1 wallet */
$('[data-act="connect"]').addEventListener('click', async e => {
  const b = e.currentTarget;
  try {
    busy(b, true, 'Connecting');
    await client();
    await pof.connect();
    const w = pof.wallet();
    state.wallet = w.address;
    $('[data-wallet-state]').textContent = `${w.wallet || 'Wallet'} connected`;
    const lamports = await src.rpc('getBalance', [w.address, { commitment: 'confirmed' }]).then(r => r.value).catch(() => null);
    const f = $('[data-wallet-facts]'); f.hidden = false;
    f.innerHTML = `<div><dt>Address</dt><dd>${esc(w.address)}</dd></div>${lamports !== null ? `<div><dt>Balance</dt><dd>${fmtUnits(lamports, 0)} SOL</dd></div>` : ''}`;
    b.textContent = 'Switch wallet';
    $('[data-act="vault"]').disabled = false;
    step('vault', { done: ['wallet'] });
    pof.ready().catch(() => {});   // start loading the Rings hasher now
  } catch (err) { showError(err, '[data-error]'); toastIf(err); }
  finally { busy(b, false); }
});
const toastIf = err => { if (!err?.silent) { const x = explain ? explain(err) : null; if (x) toast(x.title); } };

/* ------------------------------------------------------------------ 2 vault */
$('[data-act="vault"]').addEventListener('click', async e => {
  const b = e.currentTarget;
  try {
    busy(b, true, 'Waiting for the wallet');
    const pp = $('#pp').value || undefined;
    const v = await pof.deriveVault({ passphrase: pp });
    state.vault = v;
    $('[data-passphrase]').hidden = true;
    $('[data-vault-warning]').hidden = true;
    const f = $('[data-vault-facts]'); f.hidden = false;
    f.innerHTML = `<div><dt>Vault key</dt><dd>${esc(v.owner)}</dd></div><div><dt>Registered</dt><dd>${v.registered ? 'yes' : 'not yet'}</dd></div><div><dt>Key</dt><dd>${v.mode === 'random' ? 'random, locked by your passphrase' : 'rebuilt from your wallet signature'}</dd></div>`;
    $('[data-vault-state]').textContent = 'Ready';
    b.hidden = true;
    $('[data-act="register"]').hidden = v.registered;
    $('[data-act="backup"]').hidden = !v.needsBackup;
    if (!live()) { $('[data-act="register"]').disabled = true; }
    if (v.registered || !live()) unlockShield();
  } catch (err) {
    if (err.code === 'PASSPHRASE_NEEDED' || err.code === 'VAULT_LOCKED') {
      $('[data-passphrase]').hidden = false;
      $('[data-passphrase-why]').textContent = err.message;
      $('#pp').focus();
    } else showError(err, '[data-error]');
    toastIf(err);
  } finally { busy(b, false); }
});
$('[data-act="register"]').addEventListener('click', async e => {
  const b = e.currentTarget;
  try { busy(b, true, 'Registering'); await pof.register('vault'); b.hidden = true; unlockShield(); $('[data-vault-facts] div:nth-child(2) dd').textContent = 'yes'; }
  catch (err) { showError(err); toastIf(err); } finally { busy(b, false); }
});
$('[data-act="backup"]').addEventListener('click', async () => {
  try { await pof.kits.download({ passphrase: $('#pp').value }); $('[data-act="backup"]').hidden = true; toast('Backup saved'); }
  catch (err) { showError(err); toastIf(err); }
});
function unlockShield() {
  step('shield', { done: ['wallet', 'vault'] });
  for (const a of ['shield', 'sync']) $(`[data-act="${a}"]`).disabled = !live() && a === 'shield';
  if (!live()) $('[data-shield-state]').textContent = 'Opens at launch';
  readVault();
}

/* ------------------------------------------------------------------ 3 shield */
$('[data-act="shield"]').addEventListener('click', async e => {
  const b = e.currentTarget;
  try {
    const asset = val('shield-asset');
    const amount = $('#amt').value.trim();
    if (!/^\d+(\.\d+)?$/.test(amount) || Number(amount) <= 0) { toast('Enter an amount like 12.5'); $('#amt').focus(); return; }
    busy(b, true, 'Shielding');
    await pof.shield({ asset, amount, into: 'vault' });
    $('#amt').value = '';
    toast('Shielded. Let the notes age before you certify.');
    await readVault();
  } catch (err) { showError(err); toastIf(err); } finally { busy(b, false); }
});
$('[data-act="sync"]').addEventListener('click', () => readVault(true));
async function readVault(loud) {
  const out = $('[data-vault-balance]');
  if (!live() && !loud) { out.textContent = ''; step('claim', { done: ['wallet', 'vault', 'shield'] }); drawTiers(); return; }
  try {
    out.innerHTML = '<span class="spinner"></span> Reading the vault';
    state.notes = await pof.notes({ from: 'vault' });
    const sol = pof.balance(state.notes, 0), usdc = pof.balance(state.notes, 1);
    out.textContent = `In the vault: ${fmtUnits(sol, 0)} SOL · ${fmtUnits(usdc, 1)} USDC in ${state.notes.length} notes`;
    step('claim', { done: ['wallet', 'vault', 'shield'] });
    drawTiers();
  } catch (err) { out.textContent = ''; showError(err); }
}

/* ------------------------------------------------------------------ 4 tier and subject */
function drawTiers() {
  const asset = val('asset');
  const have = state.notes ? pof.balance(state.notes, asset) : null;
  const mins = asset === 0 ? [1n, 10n, 100n, 1000n, 10000n].map(x => x * 1_000_000_000n) : [100n, 1000n, 10000n, 100000n, 1000000n].map(x => x * 1_000_000n);
  const current = val('tier') || 1;
  $('[data-tiers]').innerHTML = TIERS[SYM[asset]].map((t, i) => {
    const ok = have === null || have >= mins[i];
    return `<label class="choice"><input type="radio" name="tier" value="${i + 1}" ${i + 1 === current ? 'checked' : ''} ${ok ? '' : 'disabled'}><b>≥ ${t}</b><span>${SYM[asset]}${ok ? '' : ' · not enough in the vault'}</span></label>`;
  }).join('');
  if (!$('input[name="tier"]:checked')) { const first = $('input[name="tier"]:not(:disabled)'); if (first) first.checked = true; }
  summary();
}
for (const el of $$('input[name="asset"]')) el.addEventListener('change', drawTiers);
document.addEventListener('change', e => {
  if (e.target.name === 'kind') { $('[data-x]').hidden = val('kind') !== 1; $('[data-relay]').hidden = val('kind') === 0; summary(); warnings(); credits(); }
  if (e.target.name === 'tier') { summary(); warnings(); }
  if (e.target.matches('[data-consent]')) gate();
});

function summary() {
  const asset = val('asset'), tier = val('tier') || 1, kind = val('kind');
  $('[data-sum-tier]').textContent = tierLabel(SYM[asset], tier);
  $('[data-sum-subject]').textContent = kind === 0 ? `this wallet (${state.wallet ? state.wallet.slice(0, 4) + '…' + state.wallet.slice(-4) : 'not connected'})` : kind === 1 ? (state.handle ? '@' + state.handle : 'an X handle, once linked') : 'a fresh badge key made in this page';
  $('[data-sum-payer]').textContent = kind === 0 ? 'your wallet' : 'the relayer, paid from your vault';
  if (state.wallet && state.vault && ORDER.indexOf(state.step) >= ORDER.indexOf('claim') && state.step !== 'done') step('certify', { done: ['wallet', 'vault', 'shield', 'claim'] });
  gate();
}

async function warnings() {
  const box = $('[data-warnings]');
  if (!pof || !state.vault) { box.innerHTML = ''; return; }
  try {
    const kind = val('kind'), asset = val('asset'), tier = val('tier') || 1;
    let pick = null;
    if (state.notes && live()) pick = await pof.choose({ asset, tier, from: 'vault', list: state.notes }).catch(() => null);
    const p = await pof.privacy({ subjectKind: kind, pick });
    box.innerHTML = p.warnings.map((w, i) => w.level === 'warn'
      ? `<label class="note hot check-row"><input type="checkbox" data-consent="${i}"><span>${esc(w.text)} <b>I understand.</b></span></label>`
      : `<div class="note${w.level === 'block' ? ' err' : ''}"><p>${esc(w.text)}</p></div>`).join('');
    state.blocked = !p.ok;
    gate();
  } catch { box.innerHTML = ''; }
}
function gate() {
  const consents = $$('[data-consent]');
  const kind = val('kind');
  const ok = live() && state.wallet && state.vault && !state.blocked && consents.every(c => c.checked) && (kind !== 1 || state.linkId) && !state.running;
  $('[data-act="certify"]').disabled = !ok;
  if (!live()) $('[data-cert-state]').textContent = 'Opens at launch';
}

/* the X handle link (CONTRACT §4: a one-time code posted from the handle, bound to this vault's controller) */
let postText = '';
$('[data-act="link-start"]').addEventListener('click', async e => {
  const b = e.currentTarget;
  try {
    const h = $('#handle').value.trim().replace(/^@/, '');
    if (!/^[A-Za-z0-9_]{1,15}$/.test(h)) { toast('A handle is 1 to 15 letters, digits or underscores.'); return; }
    if (!state.vault) { toast('Make your vault first.'); return; }
    busy(b, true, 'Getting a code');
    const r = await pof.linkStart({ handle: h, from: 'vault' });
    state.handle = r.handle;
    postText = r.post || r.code;
    $('[data-x-code]').hidden = false;
    $('[data-code]').textContent = r.code;
    $('[data-x-intent]').href = `https://x.com/intent/post?text=${encodeURIComponent(postText)}`;
  } catch (err) { showError(err); toastIf(err); } finally { busy(b, false); }
});
$('[data-act="copy-post"]').addEventListener('click', () => copy(postText, 'Post text copied'));
$('[data-act="link-check"]').addEventListener('click', async e => {
  const b = e.currentTarget;
  try {
    busy(b, true, 'Checking the post');
    const r = await pof.linkCheck({ handle: state.handle, post: $('#post').value.trim() });
    state.linkId = r.linkId;
    const ok = $('[data-x-ok]'); ok.hidden = false; ok.textContent = `@${r.handle} is linked to this vault. You can delete the post now.`;
    $('[data-x-code]').hidden = true;
    summary();
  } catch (err) { showError(err); toastIf(err); } finally { busy(b, false); }
});

/* the relayer: fees for the vault key, and prepaid credits (no payment lands next to the certificate) */
async function credits() {
  if (!pof || !state.vault || val('kind') === 0) return;
  try { const n = await pof.credits.count(); $('[data-credits]').textContent = n ? `${n} relay credits in this browser` : 'No relay credits yet'; } catch {}
}
$('[data-act="fund"]').addEventListener('click', async e => {
  const b = e.currentTarget;
  if (!live()) { toast('Opens at launch'); return; }
  try { busy(b, true, 'Funding'); await pof.fundVault(5_000_000); toast('The vault key can pay its fees now'); }
  catch (err) { showError(err); toastIf(err); } finally { busy(b, false); }
});
$('[data-act="credits"]').addEventListener('click', async e => {
  const b = e.currentTarget;
  if (!live()) { toast('Opens at launch'); return; }
  try {
    busy(b, true, 'Reading the offer');
    const o = await pof.credits.offer();
    const n = o.bundles?.[0];
    if (!n) throw Object.assign(Error('The relayer sells no credits right now.'), { code: 'RELAY_OFF' });
    if (!confirm(`Buy ${n} relay credits for ${fmtUnits(BigInt(o.unitLamports) * BigInt(n), 0)} SOL, paid privately from the vault?`)) return;
    busy(b, true, 'Buying');
    await pof.credits.buy({ count: n });
    await credits();
  } catch (err) { showError(err); toastIf(err); } finally { busy(b, false); }
});

/* ------------------------------------------------------------------ 5 certify */
let abort = null;
$('[data-act="stop"]').addEventListener('click', () => abort && abort.abort());
$('[data-act="certify"]').addEventListener('click', async e => {
  const b = e.currentTarget;
  clearError(); logEl.innerHTML = '';
  const asset = val('asset'), tier = val('tier') || 1, kind = val('kind');
  const d = $('input[name="delay"]:checked').value;
  const delaySlots = d === '0' ? undefined : d.split('-').map(Number);
  abort = new AbortController();
  state.running = 'certify';
  $('[data-act="stop"]').hidden = false;
  try {
    busy(b, true, 'Certifying');
    log('pick', 'Picking the fewest notes that reach the tier.');
    await pof.waitForAge({ asset, tier, from: 'vault', signal: abort.signal });
    log('pick', 'Notes picked.', 'ok');
    const consented = $$('[data-consent]').length > 0;
    const answer = await pof.certify({ asset, tier, subjectKind: kind, handle: state.handle, linkId: state.linkId, delaySlots, signal: abort.signal, payNow: consented && kind !== 0 });
    let submitted = answer.relayed?.signature;
    if (kind === 0) {
      log('chain', 'Approve the certificate in your wallet. It must land within about 2 min of the Verifier signature.');
      const chain = src.chain();
      const { instructions } = await certifyInstructions(answer, { payer: state.wallet, client: chain });
      const r = await W.send(instructions);
      log('chain', 'Certificate sent. Waiting for the chain.');
      await r.wait();
      submitted = r.signature;
    }
    log('chain', 'The certificate is on chain.', 'ok');
    done(answer, kind, submitted);
  } catch (err) {
    if (err.code !== 'ABORTED') { showError(err); log('fail', (explain ? explain(err).title : err.message), 'no'); }
  } finally {
    state.running = null; busy(b, false); $('[data-act="stop"]').hidden = true; gate();
  }
});

/* ------------------------------------------------------------------ 6 share */
function done(answer, kind, signature) {
  const a = sdk.parseAttestation(sdk.fromHex(answer.attestation));
  const subject = kind === 0 ? state.wallet : kind === 1 ? state.handle : answer.controller;
  const c = { address: '', subject, kind: ['wallet', 'x', 'badge'][kind], subjectHash: a.subjectHash, asset: SYM[a.asset], tier: a.tier, tierLabel: tierLabel(SYM[a.asset], a.tier), status: 'live', certifiedSlot: a.issuedSlot, controller: a.controller };
  const path = kind === 1 ? `/c/@${encodeURIComponent(subject)}` : `/c/${['wallet', 'x', 'badge'][kind]}:${subject}`;
  $('[data-done-card]').innerHTML = certCard(c, { link: false, cls: 'cert-xl' });
  $('[data-done-actions]').hidden = false;
  $('[data-done-link]').href = path;
  const url = new URL(path, location.origin).href;
  $('[data-done-x]').href = `https://x.com/intent/post?text=${encodeURIComponent(`${c.tierLabel}, certified on chain. It revokes itself if the money moves.\n${url}`)}`;
  $('[data-act="share-copy"]').onclick = () => copy(url, 'Link copied');
  step('done', { done: ORDER.slice(0, 5) });
  $('[data-step="done"]').scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (signature) log('sig', `Transaction ${signature.slice(0, 10)}…`, 'ok');
}
$('[data-act="kit"]').addEventListener('click', async () => {
  try { if (!pof) await client(); await pof.kits.download({ passphrase: $('#pp').value || undefined }); }
  catch (err) { showError(err); toastIf(err); }
});
$('[data-kit-import]').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try { if (!pof) await client(); const n = await pof.kits.import(await f.text(), { passphrase: $('#pp').value || undefined }); toast(`${n} kits imported`); }
  catch (err) { showError(err); toastIf(err); }
});

/* ------------------------------------------------------------------ start */
(async () => {
  src = await source();
  if (!live()) $('[data-prelaunch]').hidden = false;
  drawTiers();
  try {
    const cfg = await src.chain().getConfig();
    if (cfg) $('[data-sum-fee]').textContent = cfg.feeLamports ? `${fmtUnits(cfg.feeLamports, 0)} SOL, none with 1,000,000 $${CFG.TICKER || 'POF'} or more` : 'none';
    else $('[data-sum-fee]').textContent = 'set at launch';
  } catch { $('[data-sum-fee]').textContent = 'set at launch'; }
  gate();
})();
