/* Stands in for "@lightprotocol/hasher.rs" inside the browser bundle. The SDK calls WasmFactory.loadHasher() with no
   arguments; this version fetches the Poseidon WASM next to the bundle itself (dist/hasher-simd.wasm, or dist/hasher.wasm
   where the browser has no WASM SIMD), reports the download progress, and hands the bytes to the slim hasher.rs build, so
   nothing is inlined as base64 and nothing comes from a CDN. */
import { WasmFactory as Slim, hasWasmSimd } from '@lightprotocol/hasher.rs/slim';

const listeners = new Set();
let source = null;          // bytes, a URL, or null for "next to this bundle"
let state = { phase: 'idle', loaded: 0, total: 0, simd: null, ms: 0 };
const emit = patch => { state = { ...state, ...patch }; for (const fn of listeners) { try { fn(state); } catch {} } };

/* the hasher's load state: { phase: idle | fetching | verifying | compiling | ready | failed, loaded, total, simd, fromCache, ms, error } */
export const hasherState = () => state;
export function onHasherProgress(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); }
/* where the WASM comes from: a base URL ending in "/", a full URL, or the bytes themselves (tests, workers) */
export function setHasherSource(src) { source = src; }

async function fetchWithProgress(url) {
  const r = await fetch(url);
  if (!r.ok) throw Error(`the hasher did not load (${r.status})`);
  const total = Number(r.headers.get('content-length')) || 0;
  emit({ total });
  if (!r.body || !r.body.getReader) { const b = new Uint8Array(await r.arrayBuffer()); emit({ loaded: b.length }); return b; }
  const reader = r.body.getReader(); const parts = []; let loaded = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); loaded += value.length; emit({ loaded }); }
  const out = new Uint8Array(loaded); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/* The published sha256 of each WASM file, written in by tools/build.mjs. A fetched file must match it (a tampered or
   truncated download is refused), and a matching file is kept in the Cache API, so a second visit compiles from disk. */
const SHA = typeof __POF_WASM_SHA256__ !== 'undefined' ? __POF_WASM_SHA256__ : null;
const hexOf = b => Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join('');
async function sha256hex(bytes) { return hexOf(await crypto.subtle.digest('SHA-256', bytes)); }
const CACHE = 'pof-hasher-v1';
async function cached(url, want) {
  try {
    if (typeof caches === 'undefined' || !want) return null;
    const c = await caches.open(CACHE);
    const r = await c.match(url + '#' + want);
    if (!r) return null;
    const b = new Uint8Array(await r.arrayBuffer());
    if ((await sha256hex(b)) !== want) { await c.delete(url + '#' + want); return null; }
    return b;
  } catch { return null; }
}
async function keep(url, want, bytes) {
  try {
    if (typeof caches === 'undefined' || !want) return;
    const c = await caches.open(CACHE);
    for (const k of await c.keys()) if (k.url.split('#')[0] === url && !k.url.endsWith('#' + want)) await c.delete(k);
    await c.put(url + '#' + want, new Response(bytes, { headers: { 'content-type': 'application/wasm' } }));
  } catch {}
}

let pending = null;
async function load() {
  const t0 = Date.now();
  const simd = hasWasmSimd();
  const file = simd ? 'hasher-simd.wasm' : 'hasher.wasm';
  emit({ phase: 'fetching', simd, loaded: 0, total: 0, error: undefined });
  try {
    let bytes;
    if (source instanceof Uint8Array || source instanceof ArrayBuffer) bytes = new Uint8Array(source);
    else {
      const base = source ? String(source) : new URL('./', import.meta.url).href;
      const url = base.endsWith('.wasm') ? base : base + file;
      const want = SHA && SHA[simd ? 'simd' : 'sisd'];
      bytes = await cached(url, want);
      if (bytes) emit({ fromCache: true, loaded: bytes.length, total: bytes.length });
      else {
        emit({ fromCache: false });
        bytes = await fetchWithProgress(url);
        if (want) {
          emit({ phase: 'verifying' });
          const got = await sha256hex(bytes);
          if (got !== want) throw Error(`the hasher file does not match its published hash (got ${got.slice(0, 12)}…)`);
          await keep(url, want, bytes);
        }
      }
    }
    emit({ phase: 'compiling' });
    const opts = simd ? { simd: true, wasm: { simd: { module_or_path: bytes } } } : { simd: false, wasm: { sisd: { module_or_path: bytes } } };
    const hasher = await Slim.loadHasher(opts);
    emit({ phase: 'ready', ms: Date.now() - t0 });
    return hasher;
  } catch (e) {
    pending = null;
    emit({ phase: 'failed', error: String(e && e.message || e) });
    throw e;
  }
}
export class WasmFactory {
  static loadHasher() { return (pending ??= load()); }
  static resetModule() { pending = null; Slim.resetModule(); }
}
