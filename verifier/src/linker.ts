/* The X-handle linker (subject kind 1). start: a one-time code for a handle (only its hash is kept, 30 minutes).
   check: the holder posts the code from the handle; we read the post through fxtwitter (author, text, time), and on a
   match return a link id: the Verifier's own signature over (handle, expiry), so /api/attest needs no stored state.
   The code is burnt on success and after 5 wrong tries. The check relies on X (and fxtwitter) telling the truth: a trust
   point, written in /docs. */
import crypto from 'node:crypto';
import { PofError } from './codec.js';
import { normalHandle } from './contract.js';
import { getJson, putJson, type Store } from './store.js';

const CODE_TTL = 30 * 60, LINK_TTL = 60 * 60, MAX_TRIES = 5;
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';

export type Fetcher = (url: string) => Promise<{ status: number; json(): Promise<any> }>;

export class Linker {
  constructor(private store: Store, private issue: (handle: string, exp: number) => string, private fetcher: Fetcher = (u) => fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; pof-linker/1)' }, signal: AbortSignal.timeout(8000) })) {}

  async start(handleIn: unknown) {
    const handle = normalHandle(String(handleIn ?? ''));
    let code = 'pof-';
    for (const b of crypto.randomBytes(8)) code += ALPHA[b % ALPHA.length];
    const now = Math.floor(Date.now() / 1000);
    await putJson(this.store, `link/${sha(handle)}`, { code: sha(code), issuedAt: now, tries: 0 });
    return { handle, code, expiresInSec: CODE_TTL, post: `Linking @${handle} to Proof of Funds: ${code}`, next: 'post this from the handle (it can be deleted after the check), then send the post link to /api/link/check' };
  }

  async check(handleIn: unknown, postIn: unknown) {
    const handle = normalHandle(String(handleIn ?? ''));
    const m = String(postIn ?? '').match(/(?:^|\/status(?:es)?\/)(\d{5,25})(?:\D|$)/) || String(postIn ?? '').match(/^(\d{5,25})$/);
    if (!m) throw new PofError('BAD_POST', 'send the link to the post (x.com/<handle>/status/<id>) or its id');
    const key = `link/${sha(handle)}`;
    const rec = await getJson<{ code: string; issuedAt: number; tries: number }>(this.store, key);
    const now = Math.floor(Date.now() / 1000);
    if (!rec || rec.issuedAt + CODE_TTL < now) throw new PofError('NO_CODE', 'no live code for that handle: start again');
    if (rec.tries >= MAX_TRIES) throw new PofError('TOO_MANY_TRIES', 'too many wrong tries for this code: start again', 429);
    let r;
    try { r = await this.fetcher(`https://api.fxtwitter.com/status/${m[1]}`); } catch { throw new PofError('X_UNAVAILABLE', 'the post could not be read right now (fxtwitter did not answer); try again in a minute', 503); }
    const j = r.status === 200 ? await r.json().catch(() => null) : null;
    const t = j?.tweet;
    const fail = async (code: string, msg: string) => { rec.tries++; await putJson(this.store, key, rec); throw new PofError(code, msg); };
    if (!t) return fail('POST_NOT_FOUND', 'that post could not be read: is it public, and is the account public?');
    if (String(t.author?.screen_name || '').toLowerCase() !== handle) return fail('WRONG_AUTHOR', `that post is not from @${handle}`);
    const codes = String(t.text || t.raw_text?.text || '').toLowerCase().match(/pof-[a-z0-9]{8}/g) || [];
    if (!codes.some(c => sha(c) === rec.code)) return fail('CODE_NOT_IN_POST', 'the post does not contain the current code');
    if (Number(t.created_timestamp) < rec.issuedAt - 60) return fail('POST_TOO_OLD', 'that post is older than the code');
    await this.store.del(key);
    const exp = now + LINK_TTL;
    return { handle, link: this.issue(handle, exp), expiresInSec: LINK_TTL, note: 'use link as subject.proof with kind 1 in /api/attest; the post can be deleted now' };
  }
}
