/* The holder's wallet for POF: Phantom, Solflare, Backpack, anything announced through the wallet standard, and in the lab the
   test wallet the harness injects. With more than one wallet the picker asks (the house rule: never the first one found).
   One connection at a time; the choice is remembered by name. Adapted from the house wallet module (hush/lib/wallet.js);
   the site agent restyles the picker with the approved look. */
import { PublicKey, Transaction, TransactionInstruction, ComputeBudgetProgram, Buffer } from './dist/web3.js';
let CHAIN = 'solana:mainnet';
export const setChain = c => { CHAIN = c; };
import { rpc, b64 } from './chain.js';

const found = new Map();
function register(w) { if (w && w.name && w.accounts && w.features && w.features['solana:signAndSendTransaction'] || (w && w.features && w.features['solana:signTransaction'])) found.set(w.name, w); }
try { addEventListener('wallet-standard:register-wallet', e => { try { e.detail(register); } catch {} }); dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: { register } })); } catch {}

const KEY = 'pof:wallet';
const W = { kind: null, name: null, provider: null, std: null, address: null, listeners: new Set() };
const emit = () => W.listeners.forEach(fn => { try { fn(state()); } catch {} });
export const state = () => ({ address: W.address, wallet: W.name });
export const onChange = fn => { W.listeners.add(fn); return () => W.listeners.delete(fn); };
export const short = a => a ? a.slice(0, 4) + '…' + a.slice(-4) : '';

/* wallet pictures kept on this site (never hotlinked): the known wallets, and a fallback for any that brings none */
let ICONS = { phantom: '', solflare: '', backpack: '', coinbase: '', magiceden: '' };
/* the site sets its own wallet pictures (kept on the site, never hotlinked) */
export const setWalletIcons = map => { ICONS = { ...ICONS, ...map }; };
const iconFor = name => { const k = String(name).toLowerCase().replace(/[^a-z]/g, ''); return Object.entries(ICONS).find(([n]) => k.includes(n))?.[1] || ''; };
/* the wallets the page can see, injected providers first because they are the ones people actually have */
export function wallets() {
  const list = [];
  const seen = new Set();
  const add = (id, name, icon, provider) => { if (!provider || seen.has(name)) return; seen.add(name); list.push({ id, name, icon, provider }); };
  if (window.solana && window.solana.isDevWallet) add('dev', 'Dev wallet', '', window.solana);
  if (window.phantom && window.phantom.solana) add('phantom', 'Phantom', ICONS.phantom, window.phantom.solana);
  if (window.solflare) add('solflare', 'Solflare', ICONS.solflare, window.solflare);
  if (window.backpack && window.backpack.solana) add('backpack', 'Backpack', ICONS.backpack, window.backpack.solana);
  for (const [name, w] of found) {
    const same = list.find(x => x.name === name);
    if (same) { if (!same.icon && w.icon) same.icon = w.icon; continue; }
    seen.add(name); list.push({ id: 'std:' + name, name, icon: w.icon || iconFor(name), std: w });
  }
  if (!list.length && window.solana) add('injected', 'Browser wallet', '', window.solana);
  return list;
}

/* a refusal the reader chose (closing the picker, leaving for a wallet app) that no page should print as an error */
const quiet = text => { const e = Error(text); e.silent = true; return e; };
/* phones and in-app browsers (Telegram, X) carry no extension wallet: the wallet apps open the page in their own browser */
const mobile = () => /Android|iPhone|iPad|iPod|Mobile|Telegram/i.test(navigator.userAgent || '') || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent || ''));
const KNOWN = [
  { key: 'phantom', name: 'Phantom', install: 'https://phantom.com/download', open: (h, r) => `https://phantom.app/ul/browse/${h}?ref=${r}` },
  { key: 'solflare', name: 'Solflare', install: 'https://solflare.com/download', open: (h, r) => `https://solflare.com/ul/v1/browse/${h}?ref=${r}` },
  { key: 'backpack', name: 'Backpack', install: 'https://backpack.app/downloads', open: (h, r) => `https://backpack.app/ul/v1/browse/${h}?ref=${r}` },
  { key: 'coinbase', name: 'Coinbase Wallet', install: 'https://www.coinbase.com/wallet/downloads' },
  { key: 'magiceden', name: 'Magic Eden', install: 'https://wallet.magiceden.io/download' },
];
/* the wallets that are not here: install links on a computer, "open this page in the app" links on a phone */
function walletLinks(have) {
  const here = encodeURIComponent(location.href), ref = encodeURIComponent(location.origin), phone = mobile();
  const got = have.map(w => String(w.name).toLowerCase().replace(/[^a-z]/g, ''));
  return KNOWN.filter(k => !got.some(g => g.includes(k.key))).filter(k => !phone || k.open)
    .map(k => phone ? { name: k.name, icon: ICONS[k.key], href: k.open(here, ref), label: 'Open' } : { name: k.name, icon: ICONS[k.key], href: k.install, label: 'Install', tab: true });
}

/* the picker, drawn by this module as a desktop dialog: detected wallets first, the rest as links */
const PICKER_CSS = `
.fcw{position:fixed;inset:0;z-index:99999;display:grid;place-items:center;padding:16px;background:rgba(2,4,8,.72);backdrop-filter:blur(3px);animation:fcwIn .25s ease}
@keyframes fcwIn{from{opacity:0}}
.fcw-box{width:min(420px,100%);max-height:calc(100vh - 32px);overflow:auto;background:#0b0f16;color:#e9f1fb;border:1px solid #2a3442;border-radius:14px;box-shadow:0 0 0 1px rgba(150,190,255,.06),0 30px 80px -20px #000;font:400 16px/1.4 'Encode Sans',system-ui,sans-serif}
.fcw-head{position:relative;display:flex;align-items:center;justify-content:center;height:58px;border-bottom:1px solid #1d2531}
.fcw-head b{font:400 20px/1 'Electrolize','Encode Sans',sans-serif;letter-spacing:.06em;text-transform:uppercase}
.fcw-x{position:absolute;right:14px;top:16px;width:26px;height:26px;border:1px solid #2a3442;border-radius:50%;background:transparent;cursor:pointer;padding:0;font-size:0}
.fcw-x::before,.fcw-x::after{content:"";position:absolute;left:6px;right:6px;top:12px;height:1.5px;background:#9fb0c6;transform:rotate(45deg)}.fcw-x::after{transform:rotate(-45deg)}
.fcw-body{padding:8px 14px 18px}
.fcw-sec{margin:14px 6px 6px;font:500 11px/1 'Encode Sans',sans-serif;font-stretch:75%;letter-spacing:.16em;text-transform:uppercase;color:#6f8096}
.fcw-note{margin:10px 6px 4px;color:#9fb0c6}
.fcw-row{display:flex;align-items:center;gap:12px;width:100%;box-sizing:border-box;margin:5px 0;padding:11px 12px;background:#101622;color:#e9f1fb;border:1px solid #1d2531;border-radius:10px;font:500 17px/1.1 'Encode Sans',sans-serif;text-align:left;text-decoration:none;cursor:pointer;transition:border-color .2s,box-shadow .2s}
.fcw-row:hover,.fcw-row:focus-visible{border-color:#5ef08a;box-shadow:0 0 18px -6px #5ef08a;outline:none}
.fcw-row img,.fcw-row .fcw-blank{width:28px;height:28px;flex:none;object-fit:cover;border-radius:6px}
.fcw-row span.n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fcw-tag{flex:none;font:500 11px/1 'Encode Sans',sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#6f8096}
.fcw-row.dim{opacity:.85}`;
function pick(list) {
  return new Promise((resolve, reject) => {
    if (!document.getElementById('fcw-css')) { const st = document.createElement('style'); st.id = 'fcw-css'; st.textContent = PICKER_CSS; document.head.appendChild(st); }
    const esc = t => String(t).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
    const links = walletLinks(list), phone = mobile(), none = !list.length;
    const o = document.createElement('div');
    o.className = 'fcw'; o.setAttribute('role', 'dialog'); o.setAttribute('aria-modal', 'true'); o.setAttribute('aria-label', 'Connect a wallet');
    const pic = (src, name) => src ? `<img src="${esc(src)}" alt="" width="36" height="36" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'fcw-blank'}))">` : '<span class="fcw-blank"></span>';
    o.innerHTML = `<div class="fcw-box"><div class="fcw-head"><b>Connect a wallet</b><button type="button" class="fcw-x" data-x aria-label="Close"></button></div><div class="fcw-body">`
      + (none ? `<p class="fcw-note">${phone ? 'This browser has no wallet. Your wallet app opens this page in its own browser' : 'No Solana wallet in this browser yet. Install one, then reload this page'}</p>` : `<div class="fcw-sec">Detected</div>`)
      + list.map((w, i) => `<button type="button" class="fcw-row" data-i="${i}">${pic(w.icon, w.name)}<span class="n">${esc(w.name)}</span><span class="fcw-tag on">Detected</span></button>`).join('')
      + (links.length ? `<div class="fcw-sec">${phone ? 'Open in' : 'Get a wallet'}</div>` + links.map(l => `<a class="fcw-row dim" href="${esc(l.href)}"${l.tab ? ' target="_blank" rel="noopener"' : ''}>${pic(l.icon, l.name)}<span class="n">${esc(l.name)}</span><span class="fcw-tag get">${l.label}</span></a>`).join('') : '')
      + `</div></div>`;
    const done = () => { removeEventListener('keydown', onKey); o.remove(); };
    const close = () => { done(); reject(quiet(none ? 'No wallet in this browser' : 'No wallet chosen')); };
    const onKey = e => { if (e.key === 'Escape' && o.isConnected) close(); };
    o.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { done(); resolve(list[Number(b.dataset.i)]); });
    // inside a Telegram Mini App a plain link stays in the webview; Telegram has to hand it to the phone
    const tg = window.Telegram && window.Telegram.WebApp;
    if (tg && tg.initData && tg.openLink) o.querySelectorAll('a.fcw-row').forEach(a => a.onclick = e => { e.preventDefault(); tg.openLink(a.href); });
    o.querySelector('[data-x]').onclick = close;
    o.addEventListener('click', e => { if (e.target === o) close(); });
    addEventListener('keydown', onKey);
    document.body.appendChild(o);
    const first = o.querySelector('[data-i]') || o.querySelector('a.fcw-row'); if (first) first.focus({ preventScroll: true });
  });
}

export async function connect(id) {
  const list = wallets();
  let w = list.find(x => x.id === id);
  if (!w && list.length !== 1) w = await pick(list);
  if (!w) w = list[0];
  if (w.provider) {
    const r = await w.provider.connect();
    W.kind = 'injected'; W.provider = w.provider; W.std = null; W.name = w.name;
    W.address = (r && r.publicKey ? r.publicKey : w.provider.publicKey).toString();
    if (w.provider.on) { w.provider.on('accountChanged', p => { W.address = p ? p.toString() : null; emit(); }); w.provider.on('disconnect', () => { W.address = null; emit(); }); }
  } else {
    const r = await w.std.features['standard:connect'].connect();
    W.kind = 'std'; W.std = w.std; W.provider = null; W.name = w.name;
    W.address = r.accounts[0].address;
  }
  try { localStorage.setItem(KEY, w.id); } catch {}
  emit(); return state();
}
export async function restore() {
  let id = null; try { id = localStorage.getItem(KEY); } catch {}
  if (!id) return state();
  await new Promise(r => setTimeout(r, 300));
  const w = wallets().find(x => x.id === id);
  if (!w) return state();
  try { if (w.provider) { const r = await w.provider.connect({ onlyIfTrusted: true }); W.kind = 'injected'; W.provider = w.provider; W.name = w.name; W.address = (r && r.publicKey ? r.publicKey : w.provider.publicKey).toString(); emit(); } else await connect(id); } catch {}
  return state();
}
export function disconnect() { try { W.provider && W.provider.disconnect && W.provider.disconnect(); } catch {} W.address = null; try { localStorage.removeItem(KEY); } catch {} emit(); }
export const me = () => { if (!W.address) throw Error('Connect a wallet first.'); return new PublicKey(W.address); };


/* ---------------------------------------------------------------- signing */
const quietRefusal = e => { if (e && /reject|denied|cancel/i.test(String(e.message || e))) { const q = Error('You declined in the wallet.'); q.silent = true; q.declined = true; return q; } return e; };
/* sign exact bytes and return the 64-byte signature. `display` is how an injected wallet shows them ("utf8" for readable
   text, "hex" for binary such as the Rings derivation message) */
export async function signBytes(bytes, display = 'utf8') {
  try {
    let sig;
    if (W.kind === 'injected') { const r = await W.provider.signMessage(bytes, display); sig = r && r.signature ? r.signature : r; }
    else { const r = await W.std.features['solana:signMessage'].signMessage({ account: W.std.accounts[0], message: bytes }); sig = r[0].signature; }
    sig = sig instanceof Uint8Array ? sig : new Uint8Array(sig.data || sig);
    if (sig.length !== 64) throw Error('the wallet returned a signature of ' + sig.length + ' bytes');
    return sig;
  } catch (e) { throw quietRefusal(e); }
}
export const signText = text => signBytes(new TextEncoder().encode(text), 'utf8');

/* an SDK instruction ({ programAddress, accounts: [{ address, role }], data }, roles: 0 read, 1 write, 2 read+sign, 3 write+sign)
   as a web3.js instruction */
export const toWeb3 = ix => new TransactionInstruction({ programId: new PublicKey(ix.programAddress), keys: ix.accounts.map(a => ({ pubkey: new PublicKey(a.address), isSigner: a.role >= 2, isWritable: (a.role & 1) === 1 })), data: Buffer.from(ix.data) });

/* build a legacy transaction (every wallet signs these), simulate it, have the wallet sign it as fee payer, add the
   signatures of keys this page holds (a vault key: { publicKey, sign(message) => 64 bytes }), check it, send it, wait */
export async function send(instructions, { cosigners = [], units = 0, price = 0 } = {}) {
  const payer = me();
  const { blockhash, lastValidBlockHeight } = await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]).then(r => r.value);
  const build = (cu, p) => { const tx = new Transaction({ feePayer: payer, blockhash, lastValidBlockHeight }); tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: cu })); if (p) tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: p })); for (const ix of instructions) tx.add(ix); return tx; };
  const sim = await rpc('simulateTransaction', [b64(build(1_400_000, 0).serialize({ requireAllSignatures: false, verifySignatures: false })), { encoding: 'base64', commitment: 'confirmed', sigVerify: false, replaceRecentBlockhash: true }]);
  if (sim.value.err) { const e = Error('simulation failed: ' + JSON.stringify(sim.value.err)); e.logs = sim.value.logs; throw e; }
  const used = Number(sim.value.unitsConsumed) || 0;
  const tx = build(units || Math.min(1_400_000, Math.max(20_000, Math.ceil(used * 1.25))), price);
  let signed;
  try {
    if (W.kind === 'injected') signed = await W.provider.signTransaction(tx);
    else { const r = await W.std.features['solana:signTransaction'].signTransaction({ account: W.std.accounts[0], chain: CHAIN, transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }) }); signed = Transaction.from(r[0].signedTransaction); }
  } catch (e) { throw quietRefusal(e); }
  if (!(signed instanceof Transaction)) signed = Transaction.from(signed.serialize({ requireAllSignatures: false, verifySignatures: false }));
  const message = signed.serializeMessage();
  for (const s of cosigners) signed.addSignature(new PublicKey(s.publicKey), Buffer.from(await s.sign(message)));
  const raw = b64(signed.serialize());
  const signature = await rpc('sendTransaction', [raw, { encoding: 'base64', preflightCommitment: 'confirmed', maxRetries: 5 }]);
  return { signature, wait: () => confirm(signature, lastValidBlockHeight, raw) };
}
export async function confirm(signature, lastValidBlockHeight, raw) {
  const resend = raw ? setInterval(() => rpc('sendTransaction', [raw, { encoding: 'base64', skipPreflight: true, maxRetries: 0 }]).catch(() => {}), 2000) : 0;
  try {
    for (let i = 0; i < 100; i++) {
      const s = (await rpc('getSignatureStatuses', [[signature]]).catch(() => ({ value: [null] }))).value[0];
      if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) { if (s.err) throw Error('the transaction failed on chain: ' + JSON.stringify(s.err)); return { signature, slot: BigInt(s.slot) }; }
      if (lastValidBlockHeight && i % 5 === 4) { const h = await rpc('getBlockHeight', [{ commitment: 'confirmed' }]).catch(() => 0); if (h > lastValidBlockHeight) throw Object.assign(Error('the transaction expired before it was confirmed'), { expired: true }); }
      await new Promise(r => setTimeout(r, 1200));
    }
    throw Error('the transaction was not confirmed in time');
  } finally { clearInterval(resend); }
}
export { PublicKey };
