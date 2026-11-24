/* The site's proxies to Helius Privacy Rings, so the browser client never holds the Helius key (RINGS.md §8, §10).
     POST /api/spr/<method>[?net=devnet]           the indexer: the seven read methods only, JSON-RPC body as the SDK sends it
     ANY  /api/spr-prover/<route>[?net=devnet]     the prover: /attestation, /health, /proving-keys, /prove/<key>[/status|/indexed]
   Both go to https://<net>.helius-rpc.com/v1/spr/… with the key added here. The prover's payloads are HPKE-encrypted to its
   attested enclave by the SDK (headers Spr-Tee*), so this proxy forwards bytes it cannot read.
   Keys: HELIUS_KEYS (comma separated) or HELIUS_API_KEY; a 429 or 5xx moves to the next key. A key never appears in a
   response or a log line. Abuse brake: a per-address window in each function instance, and size caps.
   Web-standard Request → Response: the Vercel function (api/spr/[method].js) and the lab server (lab/serve.mjs) share it. */
const INDEXER = new Set(['getEncryptedUtxosByTags', 'getShieldedTransactionsByTags', 'getShieldedTransactionsByNullifiers', 'getShieldedTransactionsBySignature', 'getUserRecords', 'getMerkleProofs', 'getNonInclusionProofs']);
const PROVER_ROUTE = /^\/(attestation|health|proving-keys|prove\/[A-Za-z0-9_.-]{1,128}(\/status|\/indexed)?)$/;
const PASS_UP = ['content-type', 'spr-tee', 'spr-tee-enc', 'spr-tee-ciphertext', 'x-sync', 'x-async'];
const PASS_DOWN = ['content-type', 'spr-tee', 'spr-tee-enc', 'spr-tee-ciphertext', 'retry-after'];
export const LIMITS = Object.freeze({ indexerPerMin: 240, proverPerMin: 300, indexerBody: 256 * 1024, proverBody: 4 * 1024 * 1024, timeoutMs: 25_000 });
const NETS = ['mainnet', 'devnet'];

export function keysFromEnv(env = (typeof process !== 'undefined' ? process.env : {})) {
  return String(env.HELIUS_KEYS || env.HELIUS_API_KEY || '').split(',').map(s => s.trim()).filter(Boolean);
}
const scrub = s => String(s).replace(/api-key=[^&\s"']+/g, 'api-key=…');

/* a sliding minute per caller address, per instance; enough to stop a loop, not a substitute for the edge firewall */
const windows = new Map();
export function limited(req, bucket, perMin, now = Date.now()) {
  const ip = (req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for') || 'local').split(',')[0].trim();
  const key = bucket + '|' + ip;
  const w = windows.get(key) || [];
  while (w.length && now - w[0] > 60_000) w.shift();
  if (w.length >= perMin) return Math.ceil((60_000 - (now - w[0])) / 1000);
  w.push(now); windows.set(key, w);
  if (windows.size > 20_000) windows.clear();
  return 0;
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, spr-tee, spr-tee-enc, spr-tee-ciphertext, x-sync, x-async', 'access-control-expose-headers': 'spr-tee, spr-tee-enc, spr-tee-ciphertext, retry-after', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
const json = (status, error, extra = {}) => new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS, ...extra } });
let turn = 0;

/* the upstream call: { own } for an answer this proxy wrote, { up } for Helius's; the caller always rebuilds the latter */
async function upstream(keys, build) {
  if (!keys.length) return { own: json(503, { code: 'NO_KEY', message: 'the Rings proxy is not configured on this deployment' }) };
  let last = 0;
  for (let a = 0; a < keys.length; a++) {
    const key = keys[(turn + a) % keys.length];
    try {
      const r = await build(key);
      if (r.status === 429 || r.status >= 500) { last = r.status; continue; }
      turn = (turn + a) % keys.length;
      return { up: r };
    } catch (e) { last = e && e.name === 'TimeoutError' ? 504 : 502; }
  }
  return { own: json(502, { code: 'RINGS_UNAVAILABLE', message: `Helius Privacy Rings did not answer (${last || 'no answer'}); try again in a moment` }) };
}
/* audit2 A2-10: an upstream answer is never passed through. A new Response is built from its status, the allowlisted
   headers only, and its body: text bodies are scrubbed of anything key-bearing, binary ones (the prover's encrypted
   envelopes) are copied as bytes. */
const TEXTY = /^(application\/(json|problem\+json)|text\/)/i;
async function rebuild(r, allow) {
  const headers = { 'cache-control': 'no-store', ...CORS };
  for (const h of allow) { const v = r.headers.get(h); if (v !== null) headers[h] = h === 'content-type' ? v.split(',')[0].slice(0, 100) : v.slice(0, 2048); }
  const type = r.headers.get('content-type') || '';
  const status = r.status >= 200 && r.status <= 599 ? r.status : 502;
  if (!type || TEXTY.test(type)) return new Response(scrub(await r.text()), { status, headers: { 'content-type': 'application/json', ...headers } });
  return new Response(await r.arrayBuffer(), { status, headers });
}

/* POST /api/spr/<method>?net= */
export async function sprProxy(req, { keys = keysFromEnv() } = {}) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, { code: 'METHOD', message: 'POST a JSON-RPC body' });
  const url = new URL(req.url);
  const method = url.pathname.split('/').filter(Boolean).pop();
  const net = url.searchParams.get('net') || 'mainnet';
  if (!INDEXER.has(method)) return json(404, { code: 'UNKNOWN_METHOD', message: 'not a Rings indexer read method' });
  if (!NETS.includes(net)) return json(400, { code: 'NETWORK', message: 'net is mainnet or devnet' });
  const wait = limited(req, 'idx', LIMITS.indexerPerMin);
  if (wait) return json(429, { code: 'RATE_LIMITED', message: `too many Rings reads from this address; try again in ${wait} s` }, { 'retry-after': String(wait) });
  const body = await req.text();
  if (body.length > LIMITS.indexerBody) return json(413, { code: 'TOO_LARGE', message: 'request too large' });
  let j; try { j = JSON.parse(body); } catch { return json(400, { code: 'BAD_JSON', message: 'the body is not JSON' }); }
  if (!j || j.jsonrpc !== '2.0' || j.method !== method) return json(400, { code: 'METHOD_MISMATCH', message: 'a JSON-RPC 2.0 body whose method matches the path' });
  const r = await upstream(keys, key => fetch(`https://${net}.helius-rpc.com/v1/spr/${method}?api-key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(LIMITS.timeoutMs) }));
  if (r.own) return r.own;
  return rebuild(r.up, ['content-type']);
}

/* ANY /api/spr-prover/<route>?net=  (rewritten to /api/spr/prover?path=<route>&net= on Vercel) */
export async function proverProxy(req, { keys = keysFromEnv(), route } = {}) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const path = '/' + String(route ?? url.searchParams.get('path') ?? '').replace(/^\/+/, '');
  const net = url.searchParams.get('net') || 'mainnet';
  if (!PROVER_ROUTE.test(path)) return json(404, { code: 'UNKNOWN_ROUTE', message: 'not a Rings prover route' });
  if (!NETS.includes(net)) return json(400, { code: 'NETWORK', message: 'net is mainnet or devnet' });
  if (req.method !== 'GET' && req.method !== 'POST') return json(405, { code: 'METHOD', message: 'GET or POST' });
  const wait = limited(req, 'prv', LIMITS.proverPerMin);
  if (wait) return json(429, { code: 'RATE_LIMITED', message: `too many prover calls from this address; try again in ${wait} s` }, { 'retry-after': String(wait) });
  const body = req.method === 'POST' ? new Uint8Array(await req.arrayBuffer()) : undefined;
  if (body && body.length > LIMITS.proverBody) return json(413, { code: 'TOO_LARGE', message: 'request too large' });
  const q = new URLSearchParams(url.searchParams); q.delete('net'); q.delete('path');
  const headers = {}; for (const h of PASS_UP) { const v = req.headers.get(h); if (v !== null) headers[h] = v; }
  const r = await upstream(keys, key => { q.set('api-key', key); return fetch(`https://${net}.helius-rpc.com/v1/spr${path}?${q}`, { method: req.method, headers, body, signal: AbortSignal.timeout(LIMITS.timeoutMs) }); });
  if (r.own) return r.own;
  return rebuild(r.up, PASS_DOWN);
}
