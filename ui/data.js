/* The data layer every page reads through. In production it is the chain and our public endpoints:
     /api/rpc          a Solana JSON-RPC proxy (the key stays on the server)
     /v1/*             the read API (cached certificates, rooms, stats, config)
     /api/attest/log   the Verifier's transparency log (entries, proofs, signed heads)
   plus @pof/sdk in the page for anything we prove in the browser (certificate reads, log proofs, trusted keys from the
   chain's Config, never from the log).

   Fixture mode exists for development only: it is reachable on localhost with ?fixture in the URL and builds a small
   in-memory chain (the SDK's MemoryRpc) and a log with real signatures, so every code path runs. It never loads on a
   deployed site. */
import * as sdk from '/sdk/dist/index.js';

const CFG = window.POF || {};
export const PROGRAM = CFG.PROGRAM || sdk.POF_PROGRAM_ID;
export const GATE = CFG.GATE || sdk.POF_GATE_PROGRAM_ID;
export const LIVE = !!CFG.LIVE;
export { sdk };

const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
export const FIXTURE = LOCAL && (new URLSearchParams(location.search).has('fixture') || sessionStorage.getItem('pof:fixture') === '1');
if (FIXTURE) sessionStorage.setItem('pof:fixture', '1');

export class DataError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

async function getJson(url) {
  let r;
  try { r = await fetch(url, { headers: { accept: 'application/json' } }); }
  catch { throw new DataError('offline', 'The network did not answer. Check the connection and try again.', 0); }
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || j.error) throw new DataError(j?.error?.code || `http_${r.status}`, j?.error?.message || `The server answered ${r.status}.`, r.status);
  return j;
}
async function rpcCall(method, params = []) {
  const r = await fetch('/api/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || j.error) throw new DataError('rpc', j?.error?.message || 'The Solana RPC did not answer.', r.status);
  return j.result;
}

function liveSource() {
  let client = null;
  const chain = () => (client ||= new sdk.PofClient({ rpc: new sdk.Rpc(new URL('/api/rpc', location.href).href, { commitment: 'confirmed', timeoutMs: 15000 }), programId: PROGRAM, gateProgramId: GATE }));
  const q = o => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, v); const s = p.toString(); return s ? `?${s}` : ''; };
  return {
    mode: 'live',
    slot: () => rpcCall('getSlot', [{ commitment: 'confirmed' }]).then(Number),
    stats: () => getJson('/v1/stats'),
    config: () => getJson('/v1/config'),
    list: (o = {}) => getJson('/v1/certificates' + q(o)),
    lookup: (subject, o = {}) => getJson(`/v1/certificates/${encodeURIComponent(subject)}` + q(o)),
    rooms: () => getJson('/v1/rooms'),
    room: addr => getJson(`/v1/rooms/${encodeURIComponent(addr)}`),
    log: {
      head: () => getJson('/api/attest/log?head'),
      entry: i => getJson(`/api/attest/log?entry=${i}`),
      proof: (i, size) => getJson(`/api/attest/log?proof=${i}${size ? `&size=${size}` : ''}`),
      consistency: (m, n) => getJson(`/api/attest/log?consistency=${m}${n ? `&size=${n}` : ''}`),
      range: (from, to) => getJson(`/api/attest/log?from=${from}&to=${to}`),
      witness: () => getJson('/v1/witness'),
    },
    verifierFacts: () => getJson('/api/attest'),
    chain,
    rpc: rpcCall,
  };
}

let current = null;
/** the one data source of this page */
export async function source() {
  if (current) return current;
  if (FIXTURE) { const { fixtureSource } = await import('./fixture.js'); current = await fixtureSource(); }
  else current = liveSource();
  return current;
}

/** the keys allowed to sign attestations and heads, read from the chain's Config (never from the log) */
export async function trustedKeys(src) {
  const k = await src.chain().verifierKeys({ history: false }).catch(() => null);
  return k ? k.all : [];
}

/** verify one log entry in this browser: leaf, signature, trusted key, inclusion in the signed head */
export async function verifyEntry(src, index, { head } = {}) {
  head ||= await src.log.head();
  if (index >= head.treeSize) throw new DataError('not_found', `The log has ${head.treeSize} entries; there is no entry ${index} yet.`, 404);
  const [entry, proof, keys] = await Promise.all([src.log.entry(index), src.log.proof(index, head.treeSize), trustedKeys(src)]);
  const v = await sdk.verifyLogEntry({ leaf: entry.leaf, index, proof: { treeSize: proof.treeSize, rootHash: proof.rootHash, path: proof.path }, head, programId: PROGRAM, trustedKeys: keys });
  return { ...v, entry, proof, head, keys };
}

/** a slot clock: one RPC read every few seconds, interpolated at 400 ms a slot between reads */
export function slotClock(src, onTick, { every = 4000 } = {}) {
  let base = null, at = 0, stop = false, last = 0;
  const read = async () => { try { const s = await src.slot(); base = s; at = performance.now(); } catch {} };
  const loop = () => {
    if (stop) return;
    if (base !== null) {
      const s = base + Math.floor((performance.now() - at) / 400);
      if (s !== last) { last = s; onTick(s); }
    }
    requestAnimationFrame(loop);
  };
  read().then(loop);
  const id = setInterval(read, every);
  return { stop() { stop = true; clearInterval(id); }, now: () => last };
}
