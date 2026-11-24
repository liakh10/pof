/* The certificate card, shared by the wall, /verify, /rooms and /c. Input is the /v1 Certificate shape (CONTRACT §6). */
import { esc, num, short, tierParts, subjectLine, certPath, STATUS_SHORT, KIND_TEXT } from './fmt.js';
import { markSVG, sealSVG } from './seal.js';

const isRevoked = s => s === 'revoked_spent' || s === 'revoked_by_holder';
export const stateOf = c => (c.status === 'live' ? 'live' : isRevoked(c.status) ? 'revoked' : 'expired');

export function certCard(c, { link = true, cls = '', seal = false } = {}) {
  const t = tierParts(c.tierLabel, c.asset);
  const state = stateOf(c);
  const subj = subjectLine(c);
  const hashOnly = subj === c.subjectHash;
  const tag = link ? 'a' : 'div';
  const slotLine = state === 'revoked' && c.revokedSlot ? `revoked at ${num(c.revokedSlot)}` : `slot ${num(c.certifiedSlot)}`;
  return `<${tag} class="cert is-${state} ${cls}"${link ? ` href="${esc(certPath(c))}"` : ''} data-addr="${esc(c.address)}" data-status="${esc(c.status)}">
  <div class="cert-top"><div><div class="cert-kind">${esc(KIND_TEXT[c.kind] || c.kind)}</div><div class="cert-subject" title="${esc(subj)}">${hashOnly ? `hash ${esc(short(subj, 6))}` : esc(short(subj, 6))}</div></div>${seal ? '' : markSVG({ state })}</div>
  ${seal ? `<div class="cert-seal">${sealSVG({ state, crosshair: false })}</div>` : ''}
  <div class="cert-tier" aria-label="${esc(c.tierLabel)}"><span class="ge">${t.ge}</span><span class="amt">${esc(t.amt)}</span><span class="sym">${esc(t.sym)}</span></div>
  <div class="cert-foot"><span class="status ${esc(c.status)}">${esc(STATUS_SHORT[c.status] || c.status)}</span><span>${slotLine}</span></div>
  ${state === 'revoked' ? `<span class="cert-stamp" aria-hidden="true">REVOKED</span>` : ''}
</${tag}>`;
}

/** render or update a list of cards in a container, keyed by address; returns the addresses that flipped to revoked */
export function syncCards(root, list, { limit = 48 } = {}) {
  const flipped = [];
  const seen = new Map([...root.querySelectorAll('.cert')].map(el => [el.dataset.addr, el]));
  const frag = [];
  for (const c of list.slice(0, limit)) {
    const old = seen.get(c.address);
    if (old && old.dataset.status === c.status) { frag.push(old); continue; }
    const tmp = document.createElement('div'); tmp.innerHTML = certCard(c).trim();
    const el = tmp.firstElementChild;
    if (old) { el.classList.add('flip'); if (stateOf(c) === 'revoked') flipped.push(c.address); }
    else if (seen.size) el.classList.add('new');
    frag.push(el);
  }
  root.replaceChildren(...frag);
  return flipped;
}
