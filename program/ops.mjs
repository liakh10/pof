/* What launch.mjs and wind-down.mjs share: the RPC (a Helius site key that answers, else publicnode; --url for a rehearsal), the dev
   key (a solana-cli JSON array or the base58 string Phantom exports), a sender that simulates first and resends until confirmed, and
   sol-ops for the two programs. sol-ops deploys the first .so it finds in <project>/program/target/deploy, so each program goes
   through its own staging folder holding only its .so, its keypair and its IDL (removed after). */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const web3 = require('@solana/web3.js');
const bs58m = require('bs58'), bs58 = bs58m.default || bs58m;
const { Connection, Keypair, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } = web3;

export const here = path.dirname(fileURLToPath(import.meta.url));
export const SITE = path.resolve(here, '..');
export const OPS = path.resolve(SITE, '..', '_solkit', 'ops');
export const argv = process.argv.slice(2);
export const flag = (n, d) => { const i = argv.indexOf('--' + n); return i < 0 ? d : argv[i + 1]; };
export const has = n => argv.includes('--' + n);
export const home = p => String(p).replace(/^~(?=$|\/)/, os.homedir());
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const t = () => new Date().toLocaleTimeString();
export const sol = l => (Number(l) / 1e9).toFixed(4);
export const hideKey = s => String(s).replace(/api-key=[\w-]+/g, 'api-key=…');

export async function pickUrl() {
  if (flag('url', '')) return flag('url', '');
  const keys = (() => { try { return fs.readFileSync(path.join(os.homedir(), '.config/helius/site_keys'), 'utf8').split(/\s+/).filter(Boolean); } catch { return []; } })();
  for (const k of [...keys].sort(() => Math.random() - 0.5)) {
    try { const r = await fetch(`https://mainnet.helius-rpc.com/?api-key=${k}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"getSlot"}', signal: AbortSignal.timeout(8000) }); if (r.ok && !(await r.json()).error) return `https://mainnet.helius-rpc.com/?api-key=${k}`; } catch {}
  }
  return 'https://solana-rpc.publicnode.com';
}
export const isLocal = url => /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url);

export function loadKey(file) {
  const raw = fs.readFileSync(home(file), 'utf8').trim();
  return Keypair.fromSecretKey(raw.startsWith('[') ? Uint8Array.from(JSON.parse(raw)) : bs58.decode(raw));
}

/* send: simulated first (a refusal stops with the program's logs), resent until confirmed, re-signed when its blockhash expires */
export function makeSender(conn, payer, { local = false, dry = false, signer = null, quiet = false } = {}) {
  return async function send(ixs, label, { extra = [], units = 400_000 } = {}) {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: local ? 0 : 200_000 }), ...ixs] }).compileToV0Message());
    if (!dry) tx.sign([signer, ...extra]);
    const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: dry });
    if (sim.value.err) { const e = Error(`${label} REFUSED ${JSON.stringify(sim.value.err)}\n    ${(sim.value.logs || []).slice(-8).join('\n    ')}`); e.refused = true; throw e; }
    if (dry) { if (!quiet) console.log(`  ${label}: simulation ok (${sim.value.unitsConsumed} CU)`); return null; }
    const raw = tx.serialize();
    const sig = await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 5 });
    for (let i = 0; ; i++) {
      await sleep(local ? 400 : 1500);
      const st = (await conn.getSignatureStatuses([sig])).value[0];
      if (st && st.confirmationStatus && st.confirmationStatus !== 'processed') { if (st.err) throw Error(`${label} FAILED ${JSON.stringify(st.err)}`); break; }
      if ((await conn.getBlockHeight('confirmed')) > lastValidBlockHeight) { if (!quiet) console.log(`  ${label}: expired, sending it again`); return send(ixs, label, { extra, units }); }
      if (i % 2 === 1) await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
    }
    if (!quiet) console.log(`  ${t()}  ${label}  ${sig}`);
    return sig;
  };
}

/* a staging folder for one program, shaped as sol-ops expects: <dir>/program/target/{deploy,idl} */
export function stage(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `pof-${name}-`));
  const dep = path.join(dir, 'program', 'target', 'deploy'), idl = path.join(dir, 'program', 'target', 'idl');
  fs.mkdirSync(dep, { recursive: true }); fs.mkdirSync(idl, { recursive: true });
  const src = path.join(here, 'target', 'deploy');
  if (!fs.existsSync(path.join(src, name + '.so'))) throw Error(`no target/deploy/${name}.so: build the program first (zsh test/build.sh)`);
  fs.copyFileSync(path.join(src, name + '.so'), path.join(dep, name + '.so'));
  fs.copyFileSync(path.join(src, name + '-keypair.json'), path.join(dep, name + '-keypair.json'));
  fs.chmodSync(path.join(dep, name + '-keypair.json'), 0o600);
  fs.copyFileSync(path.join(here, 'idl', name + '.json'), path.join(idl, name + '.json'));
  return { dir, done() { fs.rmSync(dir, { recursive: true, force: true }); } };
}

/* sol-ops <cmd> for one program (deploy or close), the key file as given; returns its exit status and the tail of its output */
export function solOps(cmd, name, keyFile, url, extraArgs = []) {
  const s = stage(name);
  try {
    const r = spawnSync('node', ['sol-ops.mjs', cmd, '--project', s.dir, '--keypair', home(keyFile), '--url', url, '--yes', ...(isLocal(url) ? ['--fee', '0'] : []), ...extraArgs], { cwd: OPS, encoding: 'utf8', timeout: 3_600_000 });
    const out = hideKey((r.stdout || '') + (r.stderr || ''));
    return { status: r.status, tail: out.split('\n').filter(l => l.trim()).slice(-6).map(l => '    ' + l.trim()).join('\n') };
  } finally { s.done(); }
}

export const connOf = url => new Connection(url, 'confirmed');
