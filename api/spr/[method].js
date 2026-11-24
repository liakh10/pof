// /api/spr/<method>: the Helius Privacy Rings indexer proxy (the seven read methods), and /api/spr/prover?path=<route>
// (the rewrite of /api/spr-prover/<route>): the prover proxy for withdrawals. The Helius key comes from HELIUS_KEYS and stays
// here. Logic and limits: client/server/spr-proxy.js (RINGS.md §10).
import { sprProxy, proverProxy } from '../../client/server/spr-proxy.js';
const handle = req => (new URL(req.url).pathname.replace(/\/+$/, '').endsWith('/prover') ? proverProxy(req) : sprProxy(req));
export const GET = handle;
export const POST = handle;
export const OPTIONS = handle;
