/* v5 "The Certificate": the first screen is a live certificate. Type any subject and the fields are filled from the chain
   (through /v1, as /verify does); the dial redraws for the state it reads (the signal ring draws for a live certificate,
   breaks open for a revoked one). Below, the register lists every certificate and re-reads itself, striking a row through
   the slot its funds move. The shell (menu, CA box, the one slot clock) is /ui/app.js; data, formatting: /ui/data.js, /ui/fmt.js. */
import { $, $$, num, esc, short, TIERS, STATUS_TEXT, KIND_TEXT, subjectLine, certPath, tierParts } from '/ui/fmt.js';
import { source, LIVE } from '/ui/data.js';
import { stateOf } from '/ui/cards.js';
import { dialSVG } from './dial.js';

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const form = $('[data-doc]'), input = $('[data-subject-input]'), note = $('[data-note]'), dialBox = $('[data-dial]');
const ladder = $('[data-ladder]'), liveNums = $$('[data-live-num]'), reg = $('[data-register]');
const field = k => $(`[data-f="${k}"]`);
let src, slot = 0, shown = null, typed = false, lastList = [], filter = 'any', asset = 'SOL';

/* ------------------------------------------------------------------ the live number: the slot the dial reads at */
addEventListener('pof:slot', e => { slot = e.detail; liveNums.forEach(el => (el.textContent = num(slot))); });

/* ------------------------------------------------------------------ the dial */
let dialState = 'idle';
function setDial(state) {
  if (state === dialState) return;
  dialState = state;
  dialBox.innerHTML = dialSVG({ state, title: state === 'live' ? 'Seal: live' : state === 'revoked' ? 'Seal: revoked' : '' });
  if (reduce) return;
  const d = dialBox.firstElementChild;
  d.classList.add(state === 'revoked' ? 'breaking' : 'drawing');
}

/* ------------------------------------------------------------------ the fields */
function setLadder(a, tier) {
  if (a !== asset) {
    asset = a;
    ladder.querySelectorAll('.rung').forEach((el, i) => (el.textContent = TIERS[a][i]));
    ladder.querySelector('.sym').textContent = a;
  }
  ladder.querySelectorAll('.rung').forEach(el => el.classList.toggle('on', Number(el.dataset.t) === tier));
}
const hint = t => `<span class="hint">${esc(t)}</span>`;
const BLANK = { status: 'Live or revoked', certified: 'A slot number', valid: 'An expiry slot', notes: '1 to 8' };
function statusHTML(c) {
  const st = stateOf(c);
  if (st === 'live') return `<span class="st s-live"><i></i>Valid now</span>`;
  return `<span class="st s-dead"><i></i>${esc(STATUS_TEXT[c.status] || c.status)}</span>`;
}
function blank(text) {
  form.dataset.state = 'blank'; delete form.dataset.status;
  setLadder('SOL', 0);
  for (const [k, v] of Object.entries(BLANK)) field(k).innerHTML = hint(v);
  $('[data-f="valid"]').previousElementSibling.lastChild.textContent = 'Valid through slot';
  note.innerHTML = text;
  setDial('idle');
}
function none(subject, at) {
  form.dataset.state = 'none'; delete form.dataset.status;
  setLadder(asset, 0);
  field('status').innerHTML = `<span class="st s-none"><i></i>No certificate</span>`;
  for (const k of ['certified', 'valid', 'notes']) field(k).textContent = '—';
  note.innerHTML = `The chain holds no certificate for <b class="mono">${esc(short(subject, 10))}</b>, in any asset. Read at slot ${num(at)}. <a href="/get">Get certified</a>`;
  setDial('idle');
}
function found(c, subject) {
  const st = stateOf(c);
  form.dataset.state = 'found'; form.dataset.status = st;
  setLadder(c.asset, Number(c.tier));
  field('status').innerHTML = statusHTML(c);
  field('certified').textContent = num(c.certifiedSlot);
  const revoked = st === 'revoked';
  $('[data-f="valid"]').previousElementSibling.lastChild.textContent = revoked ? 'Revoked at slot' : 'Valid through slot';
  field('valid').textContent = revoked ? num(c.revokedSlot) : num(c.expirySlot);
  field('notes').textContent = num(c.noteCount);
  const lead = st === 'live' ? 'Live right now. The notes behind it were unspent when it was certified, and a spend would revoke it on chain.'
    : c.status === 'revoked_spent' ? 'A note behind this certificate was spent, and the chain recorded it at the slot above. It no longer proves anything.'
    : c.status === 'revoked_by_holder' ? 'The holder revoked it. It no longer proves anything.' : 'It expired at the slot above. It no longer proves anything.';
  const log = c.logIndex !== null && c.logIndex !== undefined ? ` <a href="/log?entry=${esc(c.logIndex)}">Log entry #${num(c.logIndex)}</a>.` : '';
  note.innerHTML = `${lead} <a href="${esc(certPath(c))}">Open the certificate</a>.${log}`;
  if (subject && document.activeElement !== input) input.value = subject;
  setDial(revoked ? 'revoked' : st === 'live' ? 'live' : 'idle');
  shown = { address: c.address, status: c.status, subject };
}

const pick = list => list.slice().sort((a, b) => Number(b.status === 'live') - Number(a.status === 'live') || b.tier - a.tier)[0];

async function lookup(subject, { quiet = false } = {}) {
  if (!quiet) { form.classList.add('reading'); note.textContent = 'Reading the chain'; }
  try {
    const r = await src.lookup(subject);
    const c = r.certificates.length ? pick(r.certificates) : null;
    if (c) { if (!shown || shown.address !== c.address || shown.status !== c.status) found(c, subject); }
    else if (!quiet) { none(subject, r.slot || slot); shown = null; }
  } catch (e) {
    if (!quiet) {
      form.dataset.state = 'error';
      note.innerHTML = `<b>${esc(e.code === 'bad_subject' ? 'That is not a subject.' : 'The chain could not be read just now.')}</b> ${esc(e.message || '')} A subject is a wallet address, an @handle or a badge key.`;
    }
  } finally { form.classList.remove('reading'); }
}

form.addEventListener('submit', e => {
  e.preventDefault();
  const s = input.value.trim();
  if (!s) { input.focus(); return; }
  typed = true;
  history.replaceState(null, '', `?q=${encodeURIComponent(s)}`);
  lookup(s);
});
input.addEventListener('input', () => { if (!input.value.trim() && form.dataset.state !== 'blank') blank(note.dataset.blank); });
note.dataset.blank = note.innerHTML;

/* ------------------------------------------------------------------ the register */
const isRevoked = c => stateOf(c) === 'revoked';
function rowHTML(c) {
  const st = stateOf(c), subj = subjectLine(c), t = tierParts(c.tierLabel, c.asset);
  const hashOnly = subj === c.subjectHash;
  return `<a class="r-row is-${st}" role="row" href="${esc(certPath(c))}" data-addr="${esc(c.address)}" data-status="${esc(c.status)}">
    <span class="r-idx" role="cell">${c.logIndex !== null && c.logIndex !== undefined ? '#' + num(c.logIndex) : ''}</span>
    <span class="r-subj" role="cell"><small>${esc(KIND_TEXT[c.kind] || c.kind)}</small><span title="${esc(subj)}">${hashOnly ? 'hash ' + esc(short(subj, 6)) : esc(short(subj, 8))}</span></span>
    <span class="r-tier" role="cell">≥ ${esc(t.amt)}<small>${esc(t.sym)}</small></span>
    <span class="r-st" role="cell">${statusHTML(c)}</span>
    <span class="r-slot" role="cell">${isRevoked(c) && c.revokedSlot ? num(c.revokedSlot) : num(c.certifiedSlot)}</span></a>`;
}
function visible(list) {
  if (filter === 'live') return list.filter(c => c.status === 'live');
  if (filter === 'revoked') return list.filter(isRevoked);
  return list;
}
function drawRegister() {
  const list = visible(lastList).slice(0, 14);
  if (!list.length) {
    if (!lastList.length) return;
    reg.innerHTML = `<div class="r-empty" role="row"><span role="cell">${filter === 'live' ? 'Nothing live in this view right now.' : 'Nothing revoked in this view.'} Switch the filter to see the rest of the register.</span></div>`;
    return;
  }
  const seen = new Map([...reg.querySelectorAll('.r-row[data-addr]')].map(el => [el.dataset.addr, el]));
  const rows = list.map(c => {
    const old = seen.get(c.address);
    if (old && old.dataset.status === c.status) return old;
    const tmp = document.createElement('div'); tmp.innerHTML = rowHTML(c).trim();
    const el = tmp.firstElementChild;
    if (old) el.classList.add('flip'); else if (seen.size) el.classList.add('new');
    return el;
  });
  reg.replaceChildren(...rows);
}
for (const b of $$('[data-filter]')) b.addEventListener('click', () => {
  filter = b.dataset.filter;
  $$('[data-filter]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  reg.replaceChildren(); drawRegister();
});

/* ------------------------------------------------------------------ the film: a screening room on ink, captions under the frame */
{
  const dlg = $('[data-film]'), v = $('[data-video]'), cap = $('[data-cap]'), tog = $('[data-toggle]'), mute = $('[data-mute]');
  const bar = $('[data-prog] i'), time = $('[data-time]'), reel = $('.reel-prog');
  const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const track = v.querySelector('track');
  track.track.mode = 'hidden';
  track.addEventListener('load', () => (track.track.mode = 'hidden'));
  track.track.addEventListener('cuechange', () => { const c = track.track.activeCues && track.track.activeCues[0]; cap.textContent = c ? c.text : ''; });
  const sync = () => { tog.classList.toggle('paused', v.paused); tog.setAttribute('aria-label', v.paused ? 'Play' : 'Pause'); };
  v.addEventListener('play', sync); v.addEventListener('pause', sync);
  v.addEventListener('timeupdate', () => {
    const k = v.currentTime / (v.duration || 36);
    bar.style.width = `${k * 100}%`; time.textContent = `${mmss(v.currentTime)} / ${mmss(v.duration || 36)}`;
    if (reel) reel.style.strokeDashoffset = String(1000 * (1 - k));
  });
  v.addEventListener('ended', () => { cap.textContent = ''; sync(); });
  const toggle = () => (v.paused ? v.play() : v.pause());
  v.addEventListener('click', toggle); tog.addEventListener('click', toggle);
  $('[data-prog]').addEventListener('click', e => { const r = e.currentTarget.getBoundingClientRect(); if (v.duration) v.currentTime = ((e.clientX - r.left) / r.width) * v.duration; });
  mute.addEventListener('click', () => { v.muted = !v.muted; mute.textContent = v.muted ? 'Sound on' : 'Sound off'; });
  $('[data-close]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => v.pause());
  $$('[data-film-open]').forEach(b => b.addEventListener('click', () => { dlg.showModal(); v.play().catch(() => {}); }));
}

/* ------------------------------------------------------------------ start */
(async () => {
  src = await source();
  const q = new URLSearchParams(location.search).get('q');
  if (q) { input.value = q; typed = true; await lookup(q); }
  const live = LIVE || src.mode === 'fixture';
  if (!live) return;
  const tick = async () => {
    try {
      const r = await src.list({ status: 'any', limit: 500 });
      const order = c => Math.max(Number(c.certifiedSlot) || 0, Number(c.revokedSlot) || 0);
      lastList = r.certificates.slice().sort((a, b) => order(b) - order(a));
      drawRegister();
      // the certificate on the first screen: the one the visitor asked for, or the newest live one
      if (shown) {
        const now = lastList.find(c => c.address === shown.address);
        if (now && now.status !== shown.status) found(now, shown.subject);
        else if (!now && typed) lookup(shown.subject, { quiet: true });
      } else if (!typed) {
        const c = lastList.find(x => x.status === 'live');
        if (c) found(c, subjectLine(c));
      }
    } catch {}
  };
  await tick();
  setInterval(() => { if (!document.hidden) tick(); }, src.mode === 'fixture' ? 3500 : 6000);
})();
