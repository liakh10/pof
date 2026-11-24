/* client/server/spr-proxy.js with a stubbed upstream: the allowlists, the key never leaking, key rotation on 429, the
   per-address window, the prover header pass-through, size caps. No network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { sprProxy, proverProxy, LIMITS, keysFromEnv } from '../server/spr-proxy.js';
const KEYS = ['key-one-SECRET', 'key-two-SECRET'];
let calls = [];
const stub = answer => { calls = []; globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return answer(String(url), init, calls.length); }; };
const rpcBody = m => JSON.stringify({ jsonrpc: '2.0', id: 'x', method: m, params: {} });
let ip = 0;
const req = (url, init = {}) => new Request(url, { ...init, headers: { 'content-type': 'application/json', 'x-real-ip': '10.0.0.' + (++ip % 250), ...(init.headers || {}) } });

test('indexer: a read method passes with the key added upstream and never echoed', async () => {
  stub(url => new Response(JSON.stringify({ jsonrpc: '2.0', id: 'x', result: { echo: url } }), { status: 200 }));
  const r = await sprProxy(req('https://pof.test/api/spr/getMerkleProofs?net=devnet', { method: 'POST', body: rpcBody('getMerkleProofs') }), { keys: KEYS });
  assert.equal(r.status, 200);
  assert.match(calls[0].url, /^https:\/\/devnet\.helius-rpc\.com\/v1\/spr\/getMerkleProofs\?api-key=key-one-SECRET$/);
  const text = await r.text();
  assert.ok(!text.includes('SECRET'), 'the key is scrubbed from what the page sees');
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
});
test('indexer: unknown methods, a body for another method, a bad network and a GET are refused before any upstream call', async () => {
  stub(() => { throw Error('must not be called'); });
  for (const [u, init, code] of [
    ['https://pof.test/api/spr/sendTransaction', { method: 'POST', body: rpcBody('sendTransaction') }, 404],
    ['https://pof.test/api/spr/getMerkleProofs', { method: 'POST', body: rpcBody('getUserRecords') }, 400],
    ['https://pof.test/api/spr/getMerkleProofs?net=testnet', { method: 'POST', body: rpcBody('getMerkleProofs') }, 400],
    ['https://pof.test/api/spr/getMerkleProofs', { method: 'GET' }, 405],
    ['https://pof.test/api/spr/getMerkleProofs', { method: 'POST', body: 'x'.repeat(LIMITS.indexerBody + 1) }, 413],
  ]) assert.equal((await sprProxy(req(u, init), { keys: KEYS })).status, code, u);
  assert.equal(calls.length, 0);
});
test('a 429 from one key moves to the next; no key at all is a clear 503', async () => {
  stub((url, init, n) => new Response('{}', { status: n === 1 ? 429 : 200 }));
  const r = await sprProxy(req('https://pof.test/api/spr/getUserRecords', { method: 'POST', body: rpcBody('getUserRecords') }), { keys: KEYS });
  assert.equal(r.status, 200); assert.equal(calls.length, 2); assert.notEqual(calls[0].url, calls[1].url);
  const none = await sprProxy(req('https://pof.test/api/spr/getUserRecords', { method: 'POST', body: rpcBody('getUserRecords') }), { keys: [] });
  assert.equal(none.status, 503); assert.equal((await none.json()).error.code, 'NO_KEY');
});
test('the per-address window answers 429 with retry-after', async () => {
  stub(() => new Response('{}', { status: 200 }));
  const mk = () => new Request('https://pof.test/api/spr/getUserRecords', { method: 'POST', body: rpcBody('getUserRecords'), headers: { 'x-real-ip': '192.0.2.7' } });
  let last;
  for (let i = 0; i <= LIMITS.indexerPerMin; i++) last = await sprProxy(mk(), { keys: KEYS });
  assert.equal(last.status, 429); assert.ok(Number(last.headers.get('retry-after')) > 0);
});
test('prover: only its routes, the TEE headers pass both ways, the body is forwarded byte for byte', async () => {
  stub((url, init) => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'spr-tee': '1', 'spr-tee-enc': 'abc', 'content-type': 'application/octet-stream', 'set-cookie': 'no' } }));
  const body = new Uint8Array([9, 8, 7, 6]);
  const r = await proverProxy(new Request('https://pof.test/api/spr/prover?path=prove/transfer_2_2/indexed&net=devnet', { method: 'POST', body, headers: { 'spr-tee': '1', 'spr-tee-enc': 'zz', 'x-sync': 'true', cookie: 'drop', 'x-real-ip': '198.51.100.1' } }), { keys: KEYS });
  assert.equal(r.status, 200);
  assert.match(calls[0].url, /^https:\/\/devnet\.helius-rpc\.com\/v1\/spr\/prove\/transfer_2_2\/indexed\?api-key=key-/);
  assert.deepEqual(new Uint8Array(calls[0].init.body), body);
  assert.equal(calls[0].init.headers['spr-tee-enc'], 'zz'); assert.equal(calls[0].init.headers['x-sync'], 'true'); assert.equal(calls[0].init.headers.cookie, undefined);
  assert.equal(r.headers.get('spr-tee-enc'), 'abc'); assert.equal(r.headers.get('set-cookie'), null);
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), new Uint8Array([1, 2, 3]));
  const status = await proverProxy(new Request('https://pof.test/api/spr/prover?path=prove/k/status&jobId=abc_1&net=devnet', { headers: { 'x-real-ip': '198.51.100.2' } }), { keys: KEYS });
  assert.equal(status.status, 200); assert.match(calls[1].url, /\/prove\/k\/status\?jobId=abc_1&api-key=/);
  for (const bad of ['../etc', 'prove/../x', 'admin', 'prove/a/b/c']) assert.equal((await proverProxy(new Request('https://pof.test/api/spr/prover?path=' + bad, { headers: { 'x-real-ip': '198.51.100.3' } }), { keys: KEYS })).status, 404, bad);
});
test('keys come from HELIUS_KEYS or HELIUS_API_KEY', () => {
  assert.deepEqual(keysFromEnv({ HELIUS_KEYS: ' a, b ,,' }), ['a', 'b']);
  assert.deepEqual(keysFromEnv({ HELIUS_API_KEY: 'c' }), ['c']);
  assert.deepEqual(keysFromEnv({}), []);
});

test('A2-10: an upstream answer is always rebuilt: no raw headers, key-bearing URLs scrubbed, even with its own CORS header', async () => {
  stub(() => new Response(JSON.stringify({ error: { message: 'see https://mainnet.helius-rpc.com/v1/spr/x?api-key=key-one-SECRET' } }), { status: 400, headers: { 'content-type': 'application/json', 'access-control-allow-origin': 'https://evil.example', 'set-cookie': 'a=b', 'x-upstream': 'leak' } }));
  const r = await sprProxy(req('https://pof.test/api/spr/getUserRecords', { method: 'POST', body: rpcBody('getUserRecords') }), { keys: KEYS });
  assert.equal(r.status, 400);
  assert.equal(r.headers.get('access-control-allow-origin'), '*'); assert.equal(r.headers.get('set-cookie'), null); assert.equal(r.headers.get('x-upstream'), null);
  assert.ok(!(await r.text()).includes('SECRET'));
  stub(() => new Response('upstream says api-key=key-two-SECRET', { status: 200, headers: { 'content-type': 'text/plain', 'access-control-allow-origin': '*' } }));
  const p = await proverProxy(new Request('https://pof.test/api/spr/prover?path=health', { headers: { 'x-real-ip': '203.0.113.9' } }), { keys: KEYS });
  assert.ok(!(await p.text()).includes('SECRET'));
});
