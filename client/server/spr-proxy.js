/* The site's proxy to the Helius Privacy Rings indexer, so the browser client never holds the Helius key.
   POST /api/spr/<method>[?net=devnet]  →  https://<net>.helius-rpc.com/v1/spr/<method>?api-key=…   (JSON-RPC body as sent)
   Only the seven read methods of the indexer pass (the SDK's getEncryptedUtxosByTags … getNonInclusionProofs). The prover
   routes are not proxied here: spending (withdraw) uses its own attested, end-to-end encrypted channel (spr-spend.js).
   Web-standard Request → Response, so a Vercel function (api/spr/[method].js) and the lab server share it:
     import { sprProxy } from '../../client/server/spr-proxy.js';
     export default { fetch: req => sprProxy(req, { keys: (process.env.HELIUS_KEYS || '').split(',') }) };
   HELIUS_KEYS: one or more Helius keys, comma separated; a 429 or 5xx moves to the next one. */
const METHODS = new Set(['getEncryptedUtxosByTags', 'getShieldedTransactionsByTags', 'getShieldedTransactionsByNullifiers', 'getShieldedTransactionsBySignature', 'getUserRecords', 'getMerkleProofs', 'getNonInclusionProofs']);
const MAX = 256 * 1024;
let turn = 0;
export async function sprProxy(req, { keys = [], allow = ['mainnet', 'devnet'] } = {}) {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS' };
  const out = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors } });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return out(405, { error: { code: 'METHOD', message: 'POST a JSON-RPC body' } });
  const url = new URL(req.url);
  const method = url.pathname.split('/').filter(Boolean).pop();
  const net = url.searchParams.get('net') || 'mainnet';
  if (!METHODS.has(method)) return out(404, { error: { code: 'UNKNOWN_METHOD', message: 'not a Rings indexer read method' } });
  if (!allow.includes(net)) return out(400, { error: { code: 'NETWORK', message: 'net is mainnet or devnet' } });
  const body = await req.text();
  if (body.length > MAX) return out(413, { error: { code: 'TOO_LARGE', message: 'request too large' } });
  let j; try { j = JSON.parse(body); } catch { return out(400, { error: { code: 'BAD_JSON', message: 'the body is not JSON' } }); }
  if (j.method !== method) return out(400, { error: { code: 'METHOD_MISMATCH', message: 'the body method must match the path' } });
  const usable = keys.map(k => String(k).trim()).filter(Boolean);
  if (!usable.length) return out(503, { error: { code: 'NO_KEY', message: 'the Rings indexer is not configured' } });
  let last = 0;
  for (let a = 0; a < usable.length; a++) {
    const key = usable[(turn + a) % usable.length];
    try {
      const r = await fetch(`https://${net}.helius-rpc.com/v1/spr/${method}?api-key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(20_000) });
      if (r.status === 429 || r.status >= 500) { last = r.status; continue; }
      turn = (turn + a) % usable.length;
      return new Response(await r.text(), { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors } });
    } catch { last = 504; }
  }
  return out(502, { error: { code: 'INDEXER_UNAVAILABLE', message: `the Rings indexer did not answer (${last})` } });
}
