/* The proxies live, through the lab server (node lab/serve.mjs): the SDK's own prover client attests the Helius Nitro
   enclave through /api/spr-prover, and the SDK indexer reads through /api/spr, on devnet and mainnet (read-only, no key in
   the page). Run: node client/test/proxy-live.mjs [http://localhost:5491] */
import fs from 'node:fs';
globalThis.isSecureContext ??= true;
const BASE = process.argv[2] || 'http://localhost:5491';
const X = await import('../dist/spr-spend.js');
const S = await import('../dist/spr.js');
S.setHasherSource(fs.readFileSync(new URL('../dist/hasher-simd.wasm', import.meta.url)));
await S.initializePoseidon();
let pass = 0, total = 0;
const ok = (c, n, x = '') => { total++; if (c) { pass++; console.log('  ok   ' + n); } else console.log('  FAIL ' + n + '  ' + String(x).replace(/api-key=[^&\s"]+/g, 'api-key=…').slice(0, 300)); };
for (const net of ['devnet', 'mainnet']) {
  try {
    const c = new X.SprClient({ solanaRpcUrl: `${BASE}/api/rpc?net=${net}`, indexerUrl: `${BASE}/api/spr?net=${net}`, proverUrl: `${BASE}/api/spr-prover?net=${net}`, proverTee: X.SignedTeePolicy.forNetwork(net), allowInsecureHttp: true });
    const a = await c.attestProver();
    ok(a && a.platform === 'aws-nitro', `${net}: the prover enclave attests through the proxy (${a && a.platform})`);
  } catch (e) { ok(false, `${net}: prover attestation through the proxy`, (e.code || '') + ' ' + JSON.stringify(e.details || {}) + ' ' + (e.message || '')); }
  try {
    const ix = new S.SprIndexer(new S.SprApi({ url: `${BASE}/api/spr?net=${net}` }));
    const n = new Uint8Array(32); n[31] = 5;
    const r = await ix.getNonInclusionProofs('777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor', [n]);
    ok(r.proofs[0].path.length === 40, `${net}: an indexer read through the proxy (nullifier-tree path, 40 levels)`);
  } catch (e) { ok(false, `${net}: indexer through the proxy`, e.code + ' ' + e.message); }
}
const page = await fetch(`${BASE}/api/spr/getUserRecords`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getUserRecords', params: { owners: ['11111111111111111111111111111111'] } }) }).then(r => r.text());
ok(!/api-key/i.test(page), 'no key in what the page receives');
console.log(`${pass}/${total} passed`);
process.exit(pass === total ? 0 : 1);
