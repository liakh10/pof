/* /rooms: the pof_gate rooms on chain, and creating one (create_room, signed by the creator's wallet). */
import { $, $$, esc, num, short, toast, TIERS } from './fmt.js';
import { source, LIVE } from './data.js';
import { createRoomInstruction } from './tx.js';

const SYM = ['SOL', 'USDC'];
const dots = (n, on) => `<span class="rings-count" aria-hidden="true">${Array.from({ length: 5 }, (_, i) => `<i class="${i < on ? 'on' : ''}"></i>`).join('')}</span>`;

function drawTiers() {
  const a = Number($('input[name="rasset"]:checked').value);
  $('[data-rtiers]').innerHTML = TIERS[SYM[a]].map((t, i) => `<label class="choice"><input type="radio" name="rtier" value="${i + 1}" ${i === 2 ? 'checked' : ''}><b>≥ ${t}</b><span>${SYM[a]}</span></label>`).join('');
}
$$('input[name="rasset"]').forEach(r => r.addEventListener('change', drawTiers));
drawTiers();
$('[data-act="new"]').addEventListener('click', () => { const p = $('[data-create]'); p.hidden = false; p.scrollIntoView({ behavior: 'smooth', block: 'start' }); $('#rname').focus(); });

$('[data-act="create"]').addEventListener('click', async e => {
  const b = e.currentTarget;
  if (!LIVE) { toast('Rooms open at launch'); return; }
  const name = $('#rname').value.trim();
  if (!name) { toast('Name the room'); $('#rname').focus(); return; }
  if (new TextEncoder().encode(name).length > 32) { toast('The name is longer than 32 bytes'); return; }
  const { explain } = await import('/client/errors.js');
  const W = await import('/client/wallet.js');
  try {
    b.disabled = true; b.textContent = 'Waiting for the wallet';
    if (!W.state().address) await W.connect();
    const { room, instruction } = await createRoomInstruction({ creator: W.state().address, name, asset: Number($('input[name="rasset"]:checked').value), minTier: Number($('input[name="rtier"]:checked').value) });
    const r = await W.send([instruction]);
    b.textContent = 'Waiting for the chain';
    await r.wait();
    location.href = `/rooms/${room}`;
  } catch (err) {
    const x = explain(err);
    if (!x.silent) { const box = $('[data-error]'); box.hidden = false; box.innerHTML = `<strong>${esc(x.title)}</strong><p>${esc(x.action)}</p>`; }
  } finally { b.disabled = false; b.textContent = 'Connect and create'; }
});

(async () => {
  const src = await source();
  const box = $('[data-rooms]');
  box.innerHTML = '<p><span class="spinner"></span> Reading the rooms from the chain</p>';
  try {
    const { rooms } = await src.rooms();
    if (!rooms.length) { box.innerHTML = `<div class="empty" style="grid-column:1/-1"><p class="h3">No rooms yet.</p><p class="quiet">The first room can be yours: it takes one transaction once the program is live.</p></div>`; return; }
    box.innerHTML = rooms.sort((a, b) => b.memberCount - a.memberCount).map(r => `<a class="room-card" href="/rooms/${esc(r.address)}">
      <div class="row" style="justify-content:space-between"><span class="label quiet">Room</span>${dots(5, r.minTier)}</div>
      <p class="h3">${esc(r.name || 'Unnamed room')}</p>
      <p class="cert-tier"><span class="ge">≥</span><span class="amt" style="font-size:44px">${esc((r.minTierLabel || '').replace(/^≥\s*/, '').replace(/\s*\w+$/, ''))}</span><span class="sym">${esc(r.asset)}</span></p>
      <div class="room-meta"><span>${num(r.memberCount)} members</span><span>by ${esc(short(r.creator, 4))}</span></div>
    </a>`).join('');
  } catch (e) {
    box.innerHTML = `<div class="empty" style="grid-column:1/-1"><p class="h3">The rooms could not be read just now.</p><p class="quiet">${esc(e.message)}</p></div>`;
  }
})();
