/* Wallet compatibility in headless Chrome, with stand-ins that reproduce each wallet's provider surface (the shapes their
   public docs and the house wallet module handle): Phantom (window.phantom.solana, signMessage(bytes, display) → { signature }),
   Solflare (window.solflare, → { signature }), Backpack (window.backpack.solana, → Uint8Array), any Wallet Standard wallet
   (solana:signMessage → [{ signedMessage, signature }]), an MPC-style wallet whose signatures differ every time, and phones
   with no wallet (deep links into the wallet apps). For each: connect (the picker when there is more than one), the vault
   signature with its determinism check, the Rings derivation message (off-chain message v0) through deriveRing.
   The stand-ins sign with real Ed25519 keys; what they cannot show is a real wallet's own prompt policy (owner steps).
   Needs node lab/serve.mjs and the local clone. Writes lab/test/wallets.json. Run: node lab/test/wallets.mjs [base] */
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/Users/artem/Desktop/sol/_solkit/onair/');
const { chromium } = require('playwright-core');
const BASE = process.argv[2] || 'http://localhost:5491';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
/* runs in the page before any script: one or more stand-in wallets, keyed by their test names */
const install = kinds => {
  window.__made = [];
  const keyFor = async name => { const S = await import('/client/dist/spr.js'); const seed = new Uint8Array(32); new TextEncoder().encodeInto('wallet-' + name, seed); const k = S.SigningKey.fromEd25519Bytes(seed); return { k, S, pub: k.publicKey().ed25519() }; };
  const b58 = b => { const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'; let x = 0n; for (const v of b) x = (x << 8n) + BigInt(v); let s = ''; while (x > 0n) { s = A[Number(x % 58n)] + s; x /= 58n; } for (const v of b) { if (v) break; s = '1' + s; } return s; };
  const signer = async (name, random) => { const { k, S, pub } = await keyFor(name); const der = S.ed25519DerivationMessage(pub); const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    return { pub, address: b58(pub), sign: bytes => { if (same(bytes, der)) return k.derivationSeed(); if (random) { const r = crypto.getRandomValues(new Uint8Array(64)); return r; } return k.sign(bytes); } }; };
  const pk = address => ({ toString: () => address, toBase58: () => address });
  for (const kind of kinds) {
    if (kind === 'phantom') window.phantom = { solana: { isPhantom: true, connect: async () => { const s = await signer('phantom'); window.__phantom = s; return { publicKey: pk(s.address) }; }, get publicKey() { return window.__phantom && pk(window.__phantom.address); }, signMessage: async (bytes, display) => { window.__made.push(['phantom', display]); return { signature: window.__phantom.sign(bytes), publicKey: pk(window.__phantom.address) }; }, on() {} } };
    if (kind === 'solflare') window.solflare = { isSolflare: true, connect: async () => { window.__solflare = await signer('solflare'); return true; }, get publicKey() { return window.__solflare && pk(window.__solflare.address); }, signMessage: async (bytes, display) => { window.__made.push(['solflare', display]); return { signature: window.__solflare.sign(bytes) }; }, on() {} };
    if (kind === 'backpack') window.backpack = { solana: { isBackpack: true, connect: async () => { window.__backpack = await signer('backpack'); return { publicKey: pk(window.__backpack.address) }; }, get publicKey() { return window.__backpack && pk(window.__backpack.address); }, signMessage: async bytes => { window.__made.push(['backpack']); return window.__backpack.sign(bytes); }, on() {} } };
    if (kind === 'standard' || kind === 'mpc') {
      const name = kind === 'standard' ? 'Standard Wallet' : 'MPC Wallet';
      const w = { version: '1.0.0', name, icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', chains: ['solana:mainnet'], accounts: [],
        features: {
          'standard:connect': { version: '1.0.0', connect: async () => { const s = await signer(kind, kind === 'mpc'); window['__' + kind] = s; w.accounts = [{ address: s.address, publicKey: s.pub, chains: ['solana:mainnet'], features: ['solana:signMessage'] }]; return { accounts: w.accounts }; } },
          'solana:signMessage': { version: '1.0.0', signMessage: async ({ message }) => { window.__made.push([kind]); return [{ signedMessage: message, signature: window['__' + kind].sign(message) }]; } },
          'solana:signTransaction': { version: '1.0.0', signTransaction: async () => { throw Error('not in this test'); } },
        } };
      const reg = e => { try { e.detail.register(w); } catch {} };
      addEventListener('wallet-standard:app-ready', reg);
      dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: api => api.register(w) }));
    }
  }
};
const rows = [];
const probe = async (label, kinds, pickName, { mobile = false } = {}) => {
  const ctx = await browser.newContext(mobile ? { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' } : {});
  const page = await ctx.newPage();
  await page.addInitScript(install, kinds);
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE + '/lab/');
  const cfg = await (await fetch(BASE + '/lab/config')).json();
  const row = { wallet: label };
  try {
    row.seen = await page.evaluate(async () => { const W = await import('/client/wallet.js'); await new Promise(r => setTimeout(r, 100)); return W.wallets().map(w => w.name); });
    if (!kinds.length) {
      // no wallet: the picker offers the wallet apps (phone: open this page inside them; desktop: install links)
      page.evaluate(async () => { const W = await import('/client/wallet.js'); W.connect().catch(() => {}); });
      await page.waitForSelector('.fcw a.fcw-row');
      row.links = await page.$$eval('.fcw a.fcw-row', as => as.map(a => [a.textContent.trim(), a.getAttribute('href')]));
      row.ok = row.links.length >= 3;
    } else {
      const pickerShown = kinds.length > 1;
      const conn = page.evaluate(async () => { const W = await import('/client/wallet.js'); return W.connect(); });
      if (pickerShown) { await page.waitForSelector('.fcw [data-i]'); row.picker = await page.$$eval('.fcw [data-i] .n', e => e.map(x => x.textContent)); await page.click(`.fcw [data-i]:has-text("${pickName}")`); }
      row.connected = (await conn).wallet;
      const out = await page.evaluate(async ({ program }) => {
        const { createPofClient } = await import('/client/pof-client.js');
        const W = await import('/client/wallet.js');
        const pof = await createPofClient({ network: 'local', rpc: ['/api/rpc?net=local'], indexer: null, wallet: W, programId: program, storage: new Map(), minAgeSlots: 0 });
        await pof.ready();
        const r = {};
        try { const v = await pof.deriveVault(); r.vault = v.mode; } catch (e) { r.vault = e.code; if (e.code === 'PASSPHRASE_NEEDED') { const v = await pof.deriveVault({ passphrase: 'a test passphrase' }); r.vault += ' → ' + v.mode + (v.needsBackup ? ' (backup required)' : ''); } }
        try { const d = await pof.deriveRing(); r.ring = 'ok ' + d.ownerHash.slice(0, 8); } catch (e) { r.ring = e.code || e.message; }
        r.calls = window.__made.map(x => x.join(':'));
        return r;
      }, { program: cfg.program });
      Object.assign(row, out);
      row.ok = !!row.connected && /^(signature|PASSPHRASE_NEEDED → random)/.test(row.vault) && /^ok/.test(row.ring);
    }
  } catch (e) { row.error = String(e.message || e).slice(0, 300); row.ok = false; }
  row.errors = errors;
  rows.push(row);
  await ctx.close();
};
try {
  await probe('Phantom (injected)', ['phantom'], 'Phantom');
  await probe('Solflare (injected)', ['solflare'], 'Solflare');
  await probe('Backpack (injected)', ['backpack'], 'Backpack');
  await probe('Wallet Standard', ['standard'], 'Standard Wallet');
  await probe('MPC-style (non-deterministic)', ['mpc'], 'MPC Wallet');
  await probe('Phantom + Solflare + Standard (picker)', ['phantom', 'solflare', 'standard'], 'Solflare');
  await probe('Phantom in-app browser (iOS, injected)', ['phantom'], 'Phantom', { mobile: true });
  await probe('Phone, no wallet (deep links)', [], '', { mobile: true });
  await probe('Desktop, no wallet (install links)', [], '');
} finally { await browser.close(); }
fs.writeFileSync(new URL('./wallets.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), rows }, null, 1));
for (const r of rows) console.log((r.ok ? '  ok   ' : '  FAIL ') + r.wallet + ' · ' + JSON.stringify({ seen: r.seen, picker: r.picker, connected: r.connected, vault: r.vault, ring: r.ring, calls: r.calls, links: r.links, error: r.error, errors: r.errors?.length ? r.errors : undefined }));
process.exit(rows.every(r => r.ok) ? 0 : 1);
