/* JSON-RPC for the POF client. The endpoints are set once by createPofClient (the site's own /api/rpc proxy on mainnet, a
   local validator in the lab); a busy node passes the call on, a verdict of the chain returns at once. */
let RPCS = ['/api/rpc'];
let seq = 0;
export function setRpc(urls) { RPCS = (Array.isArray(urls) ? urls : [urls]).filter(Boolean); }
export const rpcUrls = () => RPCS.slice();
export async function rpc(method, params = []) {
  let last = null;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++seq, method, params }), signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined });
      if (r.status === 429 || r.status >= 500) throw Object.assign(Error(`node answered ${r.status}`), { rotate: true });
      const j = await r.json();
      if (j.error) { const e = Error(j.error.message); e.data = j.error.data; e.code = j.error.code; throw e; }
      return j.result;
    } catch (e) { last = e; if (e.data || (e.code !== undefined && !e.rotate)) throw e; }
  }
  throw last || Error('no node answered');
}
export const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
export const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export async function account(address, commitment = 'confirmed') {
  const r = await rpc('getAccountInfo', [address, { encoding: 'base64', commitment }]);
  return r.value ? { owner: r.value.owner, lamports: r.value.lamports, data: unb64(r.value.data[0]), slot: r.context.slot } : null;
}
export const slot = (commitment = 'confirmed') => rpc('getSlot', [{ commitment }]).then(BigInt);
