/* Rate and abuse limits. Per function instance, a token bucket per client (IP) and route; across instances, coarse counters
   in the store per 10-minute window for the expensive routes (attest, link). A limit answers 429 with when to retry. */
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

export async function windowCap(store: Store, route: string, client: string, max: number) {
  const w = Math.floor(Date.now() / 600_000);
  const key = `limits/${route}/${w}/${client.replace(/[^0-9a-fA-F:.]/g, '').slice(0, 64) || 'unknown'}`;
  const c = (await getJson<{ n: number }>(store, key)) || { n: 0 };
  if (c.n >= max) throw new PofError('RATE_LIMITED', `limit of ${max} ${route} requests per 10 minutes reached; retry later`, 429, { retryAfterSec: 600 - Math.floor((Date.now() / 1000) % 600) });
  c.n++; await putJson(store, key, c);
}
