// node lab/serve.mjs [--port 5491]: the lab server. Serves pof/ statically (lab/, client/), and on the side:
//   POST /api/rpc[?net=local|devnet|mainnet]   JSON-RPC: local → the Rings clone (lab/rings-local, :35899); devnet and mainnet →
//                                              Helius with a key from ~/.config/helius/site_keys (never sent to the page).
//                                              Mainnet is read-only here: sendTransaction, requestAirdrop and simulate are refused.
//   POST /api/spr/<method>?net=devnet|mainnet  the Rings indexer proxy (client/server/spr-proxy.js)
//   ANY  /api/spr-prover/<route>?net=           the Rings prover proxy (same file), for withdrawals
//   POST /api/attest                           the real Verifier (verifier/dist) over LocalRings on the local clone, with a
//                                              throwaway signing key made at start; local network only
//   POST /api/link/start|check                 the real Linker; POST /lab/x-post simulates posting the code from the handle
//   GET|POST /api/relay/credits, POST /api/relay/certify   the Verifier's blind credits (house-ring receipt simulated by
//                                              POST /lab/house-received); certify checks and spends the credit, submits nothing
//   GET  /lab/cloned-tree                      the tree account bytes the local validator was started with (base64)
// Local use only: it binds 127.0.0.1.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const port = Number(process.argv[process.argv.indexOf('--port') + 1]) || 5491;
const LOCAL = process.env.POF_LOCAL_RPC || 'http://127.0.0.1:35899';
const PROGRAM = process.env.POF_PROGRAM || 'pofP4QRRDXnmDN9CNYiAGHfwMEgM7sLWhVcUMpsbynT';
const keys = (() => { try { return fs.readFileSync(process.env.HOME + '/.config/helius/site_keys', 'utf8').split('\n').map(s => s.trim()).filter(Boolean); } catch { return []; } })();
const { sprProxy, proverProxy } = await import('../client/server/spr-proxy.js');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8' };
const clonedFile = path.join(here, 'rings-local/.run/cloned-tree.b64');

/* the Verifier, built once, for the local network */
globalThis.isSecureContext ??= true;
let verifier = null, linker = null, credits = null, relayerKey = null, labPins = null;
const houseReceived = new Map();
const xPost = { handle: '', text: '' };
async function localVerifier() {
  if (verifier) return verifier;
  const V = await import('../verifier/dist/pof-verifier.mjs');
  const { LocalRings, jsonRpc } = await import('../client/localtree.js');
  const S = await import('../client/dist/spr.js');
  S.setHasherSource(fs.readFileSync(path.join(root, 'client/dist/hasher-simd.wasm')));
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'pof-lab-verifier-'));
  const signer = V.signerFromSeed(new Uint8Array(crypto.randomBytes(32)));
  const programId = V.fromB58(PROGRAM, 32, 'program');
  const cloned = fs.existsSync(clonedFile) ? new Uint8Array(Buffer.from(fs.readFileSync(clonedFile, 'utf8'), 'base64')) : null;
  const rings = new LocalRings(jsonRpc(LOCAL), { cloned });
  const minAge = BigInt(process.env.POF_MIN_AGE_SLOTS || 0);
  relayerKey = V.signerFromSeed(new Uint8Array(crypto.randomBytes(32)));
  verifier = new V.Verifier({ programId, minAgeSlots: minAge, validitySlots: 6_480_000n, subjectProofSlots: 1500n, maxRootAgeSlots: 1_000_000n, maxRootLagSlots: 1_000_000n, relayer: relayerKey.address, mints: { 0: V.ASSETS[0].mint, 1: V.ASSETS[1].mint }, bundleHash: V.bundleHash() }, signer, rings, new V.TransparencyLog(new V.FsStore(dir), signer, programId), null, null);
  // relay credits: the Verifier's own Credits (blind RSA) with a throwaway key; the house ring's receipt is simulated by
  // POST /lab/house-received (on devnet and mainnet it is a real private transfer the relayer's Ring decrypts)
  const jwk = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'jwk' });
  const h = x => Buffer.from(x, 'base64url').toString('hex');
  const ck = V.creditKeyFromJson(JSON.stringify({ n: h(jwk.n), e: h(jwk.e), d: h(jwk.d) }));
  labPins = { kid: ck.kid, n: ck.n, e: ck.e, houseRing: 'LabHouseRing11111111111111111111111111111111' };
  credits = new V.Credits(new V.FsStore(dir), ck, { received: async sig => houseReceived.get(sig) || null }, 'LabHouseRing11111111111111111111111111111111', 10_000_000n, [5, 20]);
  // the real Linker; X itself is simulated: POST /lab/x-post stands in for posting the code from the handle
  linker = new V.Linker(new V.FsStore(dir), (h, exp, ctl) => verifier.linkToken(h, exp, ctl), async () => new Response(JSON.stringify({ tweet: { author: { screen_name: xPost.handle }, text: xPost.text, created_timestamp: Math.floor(Date.now() / 1000) } }), { status: 200 }));
  console.log('lab verifier key', signer.address, '· min note age', String(minAge), 'slots');
  return verifier;
}

const READ_ONLY = /^(get|is|minimumLedgerSlot)/;
async function rpcProxy(net, body) {
  const j = JSON.parse(body || '{}');
  const calls = Array.isArray(j) ? j : [j];
  if (net === 'mainnet' && calls.some(c => !READ_ONLY.test(String(c.method)))) return { status: 403, body: JSON.stringify({ jsonrpc: '2.0', id: j.id ?? null, error: { code: -32601, message: 'the lab never writes to mainnet' } }) };
  const url = net === 'local' ? LOCAL : `https://${net}.helius-rpc.com/?api-key=${keys[0]}`;
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  return { status: r.status, body: await r.text() };
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const send = (status, body, type = 'application/json') => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
  try {
    const bodyBuf = await new Promise(r => { const parts = []; req.on('data', c => parts.push(c)); req.on('end', () => r(Buffer.concat(parts))); });
    const body = bodyBuf.toString('utf8');
    if (url.pathname === '/api/rpc' && req.method === 'POST') { const r = await rpcProxy(url.searchParams.get('net') || 'local', body); return send(r.status, r.body); }
    if (url.pathname.startsWith('/api/spr-prover/')) {
      const hdr = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') hdr.set(k, v);
      const r = await proverProxy(new Request(url.href, { method: req.method, headers: hdr, body: req.method === 'POST' ? bodyBuf : undefined }), { keys, route: url.pathname.slice('/api/spr-prover'.length) });
      const out = {}; r.headers.forEach((v, k) => (out[k] = v)); res.writeHead(r.status, out); return res.end(Buffer.from(await r.arrayBuffer()));
    }
    if (url.pathname.startsWith('/api/spr/')) {
      const r = await sprProxy(new Request(url.href, { method: req.method, headers: { 'content-type': 'application/json' }, body: req.method === 'POST' ? body : undefined }), { keys });
      return send(r.status, await r.text());
    }
    if (url.pathname === '/lab/house-received' && req.method === 'POST') { const j = JSON.parse(body); houseReceived.set(j.signature, { lamports: BigInt(j.lamports), signers: j.signers }); return send(200, '{"ok":true}'); }
    if (url.pathname.startsWith('/api/relay/')) {
      try {
        await localVerifier(); const fn = url.pathname.split('/').pop(); const j = body ? JSON.parse(body) : {};
        if (fn === 'credits') return send(200, JSON.stringify(req.method === 'GET' ? credits.offer() : await credits.claim(j)));
        // the lab chain has no POF program: the relayer checks the credit (the Verifier's own code) and stops before submitting
        if (fn === 'certify') { await credits.spend(j.credit, j.attestation); return send(200, JSON.stringify({ signature: 'lab-not-submitted', certificate: null, note: 'the lab has no POF program; the credit was checked and spent' })); }
        if (fn === 'revoke') return send(503, JSON.stringify({ error: { code: 'PROGRAM_NOT_READY', message: 'the lab has no POF program' } }));
        return send(404, JSON.stringify({ error: { code: 'NOT_FOUND' } }));
      } catch (e) { return send(e.status || 400, JSON.stringify({ error: { code: e.code || 'ERROR', message: String(e.message || e) } })); }
    }
    if (url.pathname === '/lab/x-post' && req.method === 'POST') { const j = JSON.parse(body); xPost.handle = String(j.handle || ''); xPost.text = String(j.text || ''); return send(200, '{"ok":true}'); }
    if ((url.pathname === '/api/link/start' || url.pathname === '/api/link/check') && req.method === 'POST') {
      try { await localVerifier(); const j = JSON.parse(body); const r = url.pathname.endsWith('start') ? await linker.start(j.handle, j.controller) : await linker.check(j.handle, j.post, j.secret, j.controller); return send(200, JSON.stringify(r)); }
      catch (e) { return send(e.status || 400, JSON.stringify({ error: { code: e.code || 'ERROR', message: String(e.message || e) } })); }
    }
    if (url.pathname === '/api/attest' && req.method === 'GET') { const v = await localVerifier(); return send(200, JSON.stringify({ verifierKey: v.key, program: PROGRAM, relayer: relayerKey.address, minAgeSlots: Number(v.cfg.minAgeSlots), note: 'the lab Verifier: local clone only; the relayer checks credits but submits nothing' })); }
    if (url.pathname === '/api/attest' && req.method === 'POST') {
      try { const v = await localVerifier(); return send(200, JSON.stringify(await v.attest(JSON.parse(body)))); }
      catch (e) { return send(e.status || 400, JSON.stringify({ error: { code: e.code || 'ERROR', message: String(e.message || e), details: e.details } })); }
    }
    if (url.pathname === '/lab/cloned-tree') return fs.existsSync(clonedFile) ? send(200, fs.readFileSync(clonedFile, 'utf8'), 'text/plain') : send(404, 'run lab/rings-local/prep.mjs', 'text/plain');
    if (url.pathname === '/lab/config') { await localVerifier(); return send(200, JSON.stringify({ program: PROGRAM, local: LOCAL, helius: keys.length > 0, creditPins: labPins })); }
    let file = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
    if (!file.startsWith(root) || /\/(\.run|node_modules|\.git)(\/|$)/.test(file)) return send(404, 'not found', 'text/plain');
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) return send(404, 'not found', 'text/plain');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  } catch (e) { send(500, JSON.stringify({ error: { code: 'LAB', message: String(e.message || e).replace(/api-key=[^&\s"]+/g, 'api-key=…') } })); }
}).listen(port, '127.0.0.1', () => console.log(`POF lab on http://localhost:${port}/lab/`));
