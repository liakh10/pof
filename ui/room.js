/* /rooms/:room: one pof_gate room, its members and whether each still passes; join with a wallet certificate; evict a
   member whose certificate died (anyone may, and the evicted member's rent returns to whoever paid it). */
import { $, esc, num, short, toast, STATUS_SHORT } from './fmt.js';
import { source, LIVE, sdk } from './data.js';
import { joinInstruction, evictInstruction } from './tx.js';

const addr = decodeURIComponent((location.pathname.match(/^\/rooms\/([^/]+)/) || [])[1] || new URLSearchParams(location.search).get('room') || '');
let src, room = null;

async function wallet() {
  const W = await import('/client/wallet.js');
  if (!W.state().address) await W.connect();
  return W;
}
async function fail(err) {
  const { explain } = await import('/client/errors.js');
  const x = explain(err);
  if (x.silent) return;
  const box = $('[data-error]'); box.hidden = false; box.innerHTML = `<strong>${esc(x.title)}</strong><p>${esc(x.action)}</p>`;
}

function draw(r) {
  room = r;
  $('[data-r-title]').textContent = r.name || 'Unnamed room';
  document.title = `${r.name || 'Room'} · Proof of Funds`;
  $('[data-r-lead]').textContent = `Members hold a live certificate of ${r.minTierLabel}. ${num(r.liveMembers)} of ${num(r.members.length)} pass right now.`;
  $('[data-r-facts]').innerHTML = `<div><dt>Minimum</dt><dd>${esc(r.minTierLabel)}</dd></div><div><dt>Account</dt><dd><a href="https://solscan.io/account/${esc(r.address)}" rel="noopener" target="_blank">${esc(r.address)}</a></dd></div><div><dt>Creator</dt><dd>${esc(r.creator)}</dd></div><div><dt>Created at slot</dt><dd>${num(r.createdSlot)}</dd></div>`;
  $('[data-r-count]').textContent = `${num(r.members.length)} members`;
  $('[data-r-slot]').textContent = `read at slot ${num(r.slot)}`;
  $('[data-r-members]').innerHTML = r.members.length ? r.members.map(m => `<tr${m.live ? '' : ' class="hit"'}>
    <td class="mono"><a href="/c/${esc(m.subjectHash)}">${esc(short(m.subjectHash, 8))}</a></td><td>${m.tier ? esc(String(m.tier)) : ''}</td>
    <td>${esc(STATUS_SHORT[m.certificateStatus] || m.certificateStatus)}</td><td>${m.live ? 'yes' : '<b>no</b>'}</td>
    <td>${m.live ? '' : `<button class="btn ghost small" type="button" data-evict="${esc(m.address)}" data-cert="${esc(m.certificate || '')}">Evict</button>`}</td></tr>`).join('')
    : `<tr><td colspan="5" class="quiet">No members yet.</td></tr>`;
}

$('[data-act="join-wallet"]').addEventListener('click', async e => {
  const b = e.currentTarget;
  if (!LIVE) { toast('Rooms open at launch'); return; }
  try {
    b.disabled = true;
    const W = await wallet();
    const me = W.state().address;
    const { instruction } = await joinInstruction({ room: room.address, asset: room.assetId, subject: sdk.walletSubject(me), payer: me, controller: me });
    const r = await W.send([instruction]); await r.wait();
    toast('You are in'); draw(await src.room(addr));
  } catch (err) { fail(err); } finally { b.disabled = false; }
});
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-evict]'); if (!b) return;
  if (!LIVE) { toast('Rooms open at launch'); return; }
  try {
    b.disabled = true;
    const W = await wallet();
    const acc = await src.chain().rpc.getAccount(b.dataset.evict);
    const m = sdk.decodeMember(b.dataset.evict, acc.data);
    const ix = await evictInstruction({ room: room.address, member: b.dataset.evict, payer: m.payer || W.state().address, certificate: b.dataset.cert || m.certificate, caller: W.state().address });
    const r = await W.send([ix]); await r.wait();
    toast('Evicted'); draw(await src.room(addr));
  } catch (err) { fail(err); } finally { b.disabled = false; }
});

(async () => {
  src = await source();
  if (!addr) { $('[data-r-title]').textContent = 'Name a room'; return; }
  try { draw(await src.room(addr)); setInterval(async () => { if (!document.hidden) try { draw(await src.room(addr)); } catch {} }, 10000); }
  catch (e) { $('[data-r-title]').textContent = 'No room here'; $('[data-r-lead]').textContent = e.message; $('[data-join]').hidden = true; }
})();
