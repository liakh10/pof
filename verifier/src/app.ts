/* The wiring: configuration from the environment, one set of singletons per function instance, and the HTTP handlers the
   Vercel functions in pof/api/{attest,relay,keeper,link} export. Every handler answers JSON; every rejection is
   { error: { code, message, details? } } with its status. Keys and the Helius key are never logged or echoed. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PofError, fromB58, hex, sha256, text, unhex } from './codec.js';
import { ASSETS } from './contract.js';
import { signerFromJson, type Signer } from './keys.js';
import { BlobStore, FsStore, type Store } from './store.js';
import { TransparencyLog } from './log.js';
import { HeliusRings, jsonRpc, type RingsSource } from './rings.js';
import { Verifier } from './verify.js';
import { Keeper } from './keeper.js';
import { Relayer } from './relayer.js';
import { Linker } from './linker.js';
import { NoteLocks } from './locks.js';
import { bucket, windowCap } from './limits.js';
import type { PofChain } from './chain.js';
import { makeProgramChain } from './program.js';

export const VERSION = '0.1.0';

/** sha256 of the running bundle file (the build's published hash), or of nothing when running from sources */
let selfHash: Uint8Array | null = null;
export function bundleHash(): Uint8Array {
  if (selfHash) return selfHash;
  try { selfHash = sha256(new Uint8Array(fs.readFileSync(fileURLToPath(import.meta.url)))); } catch { selfHash = new Uint8Array(32); }
  return selfHash;
}

function keyJson(envName: string, file: string): string | null {
  if (process.env[envName]) return process.env[envName]!;
  const f = path.join(os.homedir(), '.config', 'pof', file);
  try { return fs.readFileSync(f, 'utf8'); } catch { return null; }
}

export interface Ctx {
  env: Record<string, string | undefined>;
  programId: Uint8Array; signer: Signer; relayerSigner: Signer | null; store: Store; rings: RingsSource; chain: PofChain | null;
  log: TransparencyLog; keeper: Keeper; locks: NoteLocks; verifier: Verifier; relayer: Relayer | null; linker: Linker; sealKey: Uint8Array;
}

let ctx: Ctx | null = null;
let chainFactory: ((c: Omit<Ctx, 'chain' | 'relayer' | 'verifier' | 'keeper' | 'locks' | 'linker' | 'log'>) => Promise<PofChain | null>) | null = null;
export function setChainFactory(f: typeof chainFactory) { chainFactory = f; ctx = null; }
export function setContext(c: Ctx | null) { ctx = c; }

export async function context(overrides: Partial<Ctx> = {}): Promise<Ctx> {
  if (ctx) return ctx;
  const env = process.env;
  const pid = env.POF_PROGRAM;
  if (!pid) throw new PofError('NOT_CONFIGURED', 'POF_PROGRAM is not set', 503);
  const programId = fromB58(pid, 32, 'POF_PROGRAM');
  const vk = keyJson('POF_VERIFIER_KEY', 'verifier.json');
  if (!vk) throw new PofError('NOT_CONFIGURED', 'the Verifier key is not configured', 503);
  const signer = signerFromJson(vk, 'verifier key');
  const rk = keyJson('POF_RELAYER_KEY', 'relayer.json');
  const relayerSigner = rk ? signerFromJson(rk, 'relayer key') : null;
  const sealHex = env.POF_SEAL_KEY || (() => { try { return fs.readFileSync(path.join(os.homedir(), '.config', 'pof', 'seal.hex'), 'utf8').trim(); } catch { return ''; } })();
  if (!sealHex) throw new PofError('NOT_CONFIGURED', 'POF_SEAL_KEY is not configured', 503);
  const sealKey = unhex(sealHex, 32, 'POF_SEAL_KEY');
  const store: Store = overrides.store || (env.POF_STORE && env.POF_STORE.startsWith('fs:') ? new FsStore(env.POF_STORE.slice(3)) : new BlobStore(env.POF_BLOB_PREFIX || 'pof/'));
  const rpcUrls = String(env.SOLANA_RPC || 'http://127.0.0.1:8899').split(',').map(s => s.trim()).filter(Boolean);
  const rpc = jsonRpc(rpcUrls);
  const rings = overrides.rings || new HeliusRings(rpc, { url: env.HELIUS_SPR_URL || 'https://mainnet.helius-rpc.com/v1/spr', apiKey: env.HELIUS_API_KEY }, rpcUrls[0]);
  const base = { env, programId, signer, relayerSigner, store, rings, sealKey };
  let chain: PofChain | null = overrides.chain !== undefined ? overrides.chain : chainFactory ? await chainFactory(base as any) : null;
  if (overrides.chain === undefined && !chainFactory && relayerSigner) {
    const web3 = await import('@solana/web3.js');
    chain = await makeProgramChain({ web3, rpcUrl: rpcUrls[0], programId: pid, relayer: relayerSigner, verifier: signer, rings });
  }
  const log = new TransparencyLog(store, signer, programId);
  const keeper = new Keeper(store, sealKey, rings, chain);
  const certifyWindow = BigInt(env.POF_CERTIFY_WINDOW_SLOTS || 300); // the program's max_attest_age
  const locks = new NoteLocks(store, sha256(text('pof:locks:'), sealKey), certifyWindow, chain);
  const mints: Record<number, string> = { 0: ASSETS[0].mint, 1: env.POF_USDC_MINT || ASSETS[1].mint };
  const verifier = new Verifier({
    programId, minAgeSlots: BigInt(env.POF_MIN_AGE_SLOTS ?? 150), validitySlots: BigInt(env.POF_VALIDITY_SLOTS ?? 6_480_000),
    subjectProofSlots: BigInt(env.POF_SUBJECT_PROOF_SLOTS ?? 1_500), maxRootAgeSlots: 150n, maxRootLagSlots: BigInt(env.POF_MAX_ROOT_LAG_SLOTS ?? 9_000),
    relayer: relayerSigner?.address ?? null, mints, bundleHash: bundleHash(),
  }, signer, rings, log, keeper, locks);
  const relayer = relayerSigner && chain ? new Relayer({
    address: relayerSigner.address, verifierKey: signer.publicKey, programId,
    dailyCapLamports: BigInt(env.POF_RELAY_DAILY_LAMPORTS ?? 2_000_000_000), balanceFloorLamports: BigInt(env.POF_RELAY_FLOOR_LAMPORTS ?? 50_000_000),
    quoteTtlSec: 1800, free: env.POF_RELAY_FREE === '1', hmacKey: sha256(text('pof:quote:'), sealKey),
  }, store, chain, log) : null;
  const linker = new Linker(store, (h, exp) => verifier.linkToken(h, exp));
  ctx = { env, programId, signer, relayerSigner, store, rings, chain, log, keeper, locks, verifier, relayer, linker, sealKey };
  return ctx;
}

/* ---------- HTTP ---------- */
const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'x-content-type-options': 'nosniff' };
export const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(body, (_, v) => typeof v === 'bigint' ? String(v) : v), { status, headers: { ...HEADERS, 'cache-control': 'no-store', ...extra } });

export function fail(e: any): Response {
  if (e instanceof PofError || e?.name === 'PofError') {
    const h: Record<string, string> = {};
    if (e.details?.retryAfterSec) h['retry-after'] = String(e.details.retryAfterSec);
    return json({ error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } }, e.status, h);
  }
  const id = crypto.randomBytes(4).toString('hex');
  console.error(`pof internal ${id}:`, String(e?.stack || e).replace(/api-key=[^&\s"]+/g, 'api-key=***').slice(0, 600));
  return json({ error: { code: 'INTERNAL', message: `something broke on our side (ref ${id}); nothing was signed` } }, 500);
}

const clientOf = (req: Request) => (req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for') || 'local').split(',')[0].trim();
async function body(req: Request, max = 16_384): Promise<any> {
  const t = await req.text();
  if (t.length > max) throw new PofError('TOO_LARGE', `the request body is larger than ${max} bytes`, 413);
  try { return JSON.parse(t); } catch { throw new PofError('BAD_JSON', 'the request body is not JSON'); }
}
const wrap = (f: (req: Request) => Promise<Response>) => async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS });
  try { return await f(req); } catch (e) { return fail(e); }
};
function cronOk(req: Request, env: Record<string, string | undefined>) {
  const s = env.CRON_SECRET;
  if (!s || req.headers.get('authorization') !== `Bearer ${s}`) throw new PofError('FORBIDDEN', 'cron routes need the cron secret', 403);
}

export const routes = {
  /** GET /api/attest: the Verifier's public facts. POST /api/attest: a §4 disclosure package → a §3 attestation */
  attest: wrap(async (req) => {
    const c = await context();
    if (req.method === 'GET') return json({
      verifierKey: c.signer.address, program: c.env.POF_PROGRAM, relayer: c.relayerSigner?.address ?? null, version: VERSION,
      bundleHash: hex(bundleHash()), minAgeSlots: Number(c.verifier.cfg.minAgeSlots), validitySlots: Number(c.verifier.cfg.validitySlots),
      subjectProofSlots: Number(c.verifier.cfg.subjectProofSlots), assets: Object.fromEntries(Object.entries(ASSETS).map(([k, a]) => [k, { name: a.name, mint: c.verifier.cfg.mints[+k], tiers: a.tiers.map(String) }])),
      keeps: 'no amounts, no openings, no nullifier key; the log holds only the attestation bytes',
    }, 200, { 'cache-control': 'public, max-age=60' });
    if (req.method !== 'POST') throw new PofError('METHOD', 'GET or POST', 405);
    const who = clientOf(req);
    bucket(`attest:${who}`, 6, 6);
    await windowCap(c.store, 'attest', who, Number(c.env.POF_ATTEST_PER_10MIN || 30));
    return json(await c.verifier.attest(await body(req)));
  }),

  /** GET /api/attest/log?head | ?entry=i | ?proof=i[&size=n] | ?consistency=m[&size=n] | ?from=i&to=j */
  log: wrap(async (req) => {
    const c = await context();
    bucket(`log:${clientOf(req)}`, 120, 60);
    const q = new URL(req.url).searchParams;
    const n = (k: string) => { const v = q.get(k); if (v === null || v === '') return undefined; if (!/^\d+$/.test(v)) throw new PofError('BAD_QUERY', `${k} must be a non-negative integer`); return Number(v); };
    const cache = { 'cache-control': 'public, max-age=5' };
    if (q.has('entry')) return json(await c.log.entry(n('entry')!), 200, { 'cache-control': 'public, max-age=31536000, immutable' });
    if (q.has('proof')) return json(await c.log.proof(n('proof')!, n('size')), 200, cache);
    if (q.has('consistency')) return json(await c.log.consistency(n('consistency')!, n('size')), 200, cache);
    if (q.has('from')) return json(await c.log.range(n('from')!, n('to') ?? n('from')! + 50), 200, cache);
    const slot = c.chain ? await c.chain.slot().catch(() => undefined) : undefined;
    return json(await c.log.head(slot), 200, cache);
  }),

  relayQuote: wrap(async (req) => {
    const c = await context();
    bucket(`quote:${clientOf(req)}`, 20, 10);
    if (!c.relayer) throw new PofError('RELAY_OFF', 'the relayer is not configured here; submit certify from your own wallet', 503);
    return json(await c.relayer.quote());
  }),

  relayCertify: wrap(async (req) => {
    const c = await context();
    if (req.method !== 'POST') throw new PofError('METHOD', 'POST', 405);
    bucket(`relay:${clientOf(req)}`, 6, 4);
    if (!c.relayer) throw new PofError('RELAY_OFF', 'the relayer is not configured here; submit certify from your own wallet', 503);
    return json(await c.relayer.certify(await body(req)));
  }),

  linkStart: wrap(async (req) => {
    const c = await context();
    if (req.method !== 'POST') throw new PofError('METHOD', 'POST', 405);
    const who = clientOf(req);
    bucket(`link:${who}`, 4, 4);
    await windowCap(c.store, 'link', who, 20);
    const b = await body(req, 2048);
    return json(await c.linker.start(b.handle));
  }),

  /** GET /api/link?id=<link id> → { verified, handle, expiresAt } (the bots and /verify read it) */
  linkVerify: wrap(async (req) => {
    const c = await context();
    bucket(`linkverify:${clientOf(req)}`, 60, 30);
    const id = new URL(req.url).searchParams.get('id') || '';
    const handle = id.split('.')[0] || '';
    try { c.verifier.checkLinkToken(handle, id); const exp = Number(id.split('.')[1]); return json({ verified: true, handle, expiresAt: exp }); }
    catch (e: any) { if (e?.code === 'BAD_HANDLE' || e?.code === 'BAD_SUBJECT_PROOF' || e?.code === 'LINK_EXPIRED') return json({ verified: false, handle: handle || null, reason: e.code }); throw e; }
  }),

  linkCheck: wrap(async (req) => {
    const c = await context();
    if (req.method !== 'POST') throw new PofError('METHOD', 'POST', 405);
    bucket(`linkcheck:${clientOf(req)}`, 10, 5);
    const b = await body(req, 2048);
    return json(await c.linker.check(b.handle, b.post));
  }),

  /** cron (off before launch: no vercel.json cron entry, and POF_KEEPER_LIVE must be 1) */
  keeperScan: wrap(async (req) => {
    const c = await context();
    cronOk(req, c.env);
    if (c.env.POF_KEEPER_LIVE !== '1') return json({ ok: true, skipped: 'the keeper is off before launch (POF_KEEPER_LIVE)' });
    return json(await c.keeper.scan());
  }),

  /** cron: anchors the log head on chain (anchor_log, the §7 signed head) when the log grew since the last anchor */
  keeperAnchor: wrap(async (req) => {
    const c = await context();
    cronOk(req, c.env);
    if (c.env.POF_KEEPER_LIVE !== '1') return json({ ok: true, skipped: 'the keeper is off before launch (POF_KEEPER_LIVE)' });
    if (!c.chain) throw new PofError('CHAIN_OFF', 'no program configured', 503);
    const head = await c.log.head();
    const last = await c.store.get('log/anchored');
    const mark = `${head.treeSize}:${head.rootHash}`;
    if (!head.treeSize || (last && Buffer.from(last).toString() === mark)) return json({ ok: true, anchored: false, head: mark });
    const r = await c.chain.anchorLog(head.treeSize, unhex(head.rootHash, 32));
    await c.store.put('log/anchored', text(mark));
    return json({ ok: true, anchored: true, head: mark, signature: r.signature });
  }),
};
