/* Stands in for "@lightprotocol/hasher.rs" inside the browser bundle. The SDK calls WasmFactory.loadHasher() with no
   arguments; this version fetches the Poseidon WASM next to the bundle itself (dist/hasher-simd.wasm, or dist/hasher.wasm
   where the browser has no WASM SIMD), reports the download progress, and hands the bytes to the slim hasher.rs build, so
   nothing is inlined as base64 and nothing comes from a CDN. */
import { WasmFactory as Slim, hasWasmSimd } from '@lightprotocol/hasher.rs/slim';

const listeners = new Set();
let source = null;          // bytes, a URL, or null for "next to this bundle"
let state = { phase: 'idle', loaded: 0, total: 0, simd: null, ms: 0 };
const emit = patch => { state = { ...state, ...patch }; for (const fn of listeners) { try { fn(state); } catch {} } };

/* the hasher's load state: { phase: idle | fetching | compiling | ready | failed, loaded, total, simd, ms, error } */
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
      bytes = await fetchWithProgress(base.endsWith('.wasm') ? base : base + file);
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
