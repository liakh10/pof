/* Rate and abuse limits. Per function instance, a token bucket per client (IP) and route; across instances, coarse counters
   in the store per 10-minute window for the expensive routes (attest, link). A limit answers 429 with when to retry. */
import crypto from 'node:crypto';
import { PofError } from './codec.js';
import { getJson, putJson, type Store } from './store.js';

const buckets = new Map<string, { t: number; n: number }>();
export function bucket(key: string, perMinute: number, burst = perMinute) {
  const now = Date.now(), b = buckets.get(key) || { t: now, n: burst };
  b.n = Math.min(burst, b.n + ((now - b.t) / 60_000) * perMinute); b.t = now;
  if (b.n < 1) { buckets.set(key, b); throw new PofError('RATE_LIMITED', `too many requests; retry in ${Math.ceil((1 - b.n) * 60 / perMinute)} s`, 429, { retryAfterSec: Math.ceil((1 - b.n) * 60 / perMinute) }); }
  b.n -= 1; buckets.set(key, b);
  if (buckets.size > 20_000) buckets.clear();
}

/** a cross-instance cap per 10-minute window. The client is stored only as HMAC(window key, ip), where the window key is
 *  derived from the seal key and the window number: a stored name cannot be tested against an IP without the seal key,
 *  and names from different windows cannot be linked. Windows older than the current one are deleted by the keeper's
 *  sweep (sweepLimits). No raw IP is ever written. */
export async function windowCap(store: Store, route: string, client: string, max: number, key: Uint8Array) {
  const w = Math.floor(Date.now() / 600_000);
  const wk = crypto.createHmac('sha256', key).update('pof:limits:' + w).digest();
  const who = crypto.createHmac('sha256', wk).update(client).digest('hex').slice(0, 32);
  const name = `limits/${route}/${w}/${who}`;
  const c = (await getJson<{ n: number }>(store, name)) || { n: 0 };
  if (c.n >= max) throw new PofError('RATE_LIMITED', `limit of ${max} ${route} requests per 10 minutes reached; retry later`, 429, { retryAfterSec: 600 - Math.floor((Date.now() / 1000) % 600) });
  c.n++; await putJson(store, name, c);
}

export async function sweepLimits(store: Store): Promise<number> {
  const w = Math.floor(Date.now() / 600_000);
  let n = 0;
  for (const k of await store.list('limits/')) { const kw = Number(k.split('/')[2]); if (kw < w) { await store.del(k); n++; } }
  return n;
}
