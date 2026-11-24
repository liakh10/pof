import { test } from 'node:test';
import assert from 'node:assert/strict';
import { V, ring, makeCtx, pkg, hex } from './helpers.mjs';

const SOL = 1_000_000_000n;
const rej = async (p, code) => { try { await p; assert.fail('expected ' + code); } catch (e) { assert.equal(e.code, code, e.message); return e; } };

async function relayed(c) {
  const r = ring(); c.rings.register(r); const ctl = ring();
  const n = c.rings.note(r, 3n * SOL);
  const link = c.verifier.linkToken('anon', Math.floor(Date.now() / 1000) + 600);
  const out = await c.verifier.attest(pkg(c, r, [n], { kind: 1, value: 'anon', proof: link, relay: true, controller: ctl.owner }));
  return { r, n, out };
}

test('relayer: quote → exact payment → certify; the payment cannot be used twice; bad inputs refused', async () => {
  const c = makeCtx();
  const { out } = await relayed(c);
  const q = await c.relayer.quote();
  assert.equal(BigInt(q.lamports) - BigInt(q.parts.tag), 13_010_000n);
  assert.equal(q.payTo, c.relayerSigner.address);
  const body = { attestation: out.attestation, signature: out.signature, logIndex: out.logIndex, quote: q.quote, hashes: out.hashes };
  await rej(c.relayer.certify(body), 'NOT_PAID');
  c.chain.inbox.push({ signature: 'payWrong', slot: c.rings.slotNow, lamports: BigInt(q.lamports) - 1n });
  await rej(c.relayer.certify(body), 'NOT_PAID');
  c.chain.inbox.push({ signature: 'payRight', slot: c.rings.slotNow, lamports: BigInt(q.lamports) });
  const r = await c.relayer.certify(body);
  assert.equal(r.payment, 'payRight'); assert.ok(r.certificate);
  assert.equal(c.chain.sent.filter(x => x.kind === 'certify').length, 1);
  await rej(c.relayer.certify(body), 'NOT_PAID');                       // payRight is used
  await rej(c.relayer.certify({ ...body, quote: q.quote.replace(/.$/, '0') }), 'BAD_QUOTE');
  await rej(c.relayer.certify({ ...body, signature: '00'.repeat(64) }), 'BAD_SIGNATURE');
  await rej(c.relayer.certify({ ...body, hashes: [...out.hashes].reverse().concat(['11'.repeat(32)]) }), 'BAD_HASHES');
});

test('relayer: wallet subjects are not relayed; the rolling cap and the balance floor hold', async () => {
  const c = makeCtx({ relayFree: true });
  const r = ring(); c.rings.register(r);
  const w = await c.verifier.attest(pkg(c, r, [c.rings.note(r, 2n * SOL)]));
  await rej(c.relayer.certify({ attestation: w.attestation, signature: w.signature, logIndex: w.logIndex, hashes: w.hashes }), 'RELAY_NOT_FOR_WALLETS');
  const { out } = await relayed(c);
  const body = { attestation: out.attestation, signature: out.signature, logIndex: out.logIndex, hashes: out.hashes };
  await c.store.put('relay/spend.json', new TextEncoder().encode(JSON.stringify([[Math.floor(Date.now() / 1000), String(999_000_000n)]])));
  await rej(c.relayer.certify(body), 'RELAY_CAP');
  await c.store.put('relay/spend.json', new TextEncoder().encode(JSON.stringify([[Math.floor(Date.now() / 1000) - 90_000, String(999_000_000n)]])));
  c.chain.balance = 10_000_000n;
  await rej(c.relayer.certify(body), 'RELAY_LOW');
  c.chain.balance = 10_000_000_000n;
  assert.ok((await c.relayer.certify(body)).signature);
});

test('keeper: a live certificate is revoked the moment a disclosed note is spent, with the right index', async () => {
  const c = makeCtx({ relayFree: true });
  const r = ring(); c.rings.register(r);
  const a = c.rings.note(r, 1n * SOL), b = c.rings.note(r, 1n * SOL);
  const out = await c.verifier.attest(pkg(c, r, [a, b]));
  // not certified yet: the kit waits
  let rep = await c.keeper.scan();
  assert.deepEqual([rep.kits, rep.live, rep.dropped, rep.revoked.length], [1, 0, 0, 0]);
  await c.chain.certify({ attestation: Buffer.from(out.attestation, 'hex'), signature: Buffer.from(out.signature, 'hex'), logIndex: out.logIndex, hashes: out.hashes.map(h => Buffer.from(h, 'hex')) });
  rep = await c.keeper.scan();
  assert.deepEqual([rep.live, rep.revoked.length], [1, 0]);
  c.rings.spend(b.nullifier);
  rep = await c.keeper.scan();
  assert.equal(rep.revoked.length, 1);
  const want = out.hashes.indexOf(hex(V.saltedNullifier(Buffer.from(out.salts[1], 'hex'), b.nullifier)));
  assert.equal(rep.revoked[0].index, want);
  const cert = await c.chain.certificate(V.subjectHash(0, r.owner), 0);
  assert.equal(cert.status, 1);
  assert.equal((await c.keeper.names()).length, 0, 'the kit is gone after the revoke');
  assert.ok(!JSON.stringify(rep).includes(hex(b.nullifier)), 'the report carries no nullifier');
});

test('keeper: kits of attestations that never landed are dropped after expiry; revoked ones at once', async () => {
  const c = makeCtx();
  const r = ring(); c.rings.register(r);
  await c.verifier.attest(pkg(c, r, [c.rings.note(r, 1n * SOL)]));
  c.rings.slotNow += 7_000_000n;
  const rep = await c.keeper.scan();
  assert.equal(rep.dropped, 1);
});

test('linker: one-time code, author and code checked through the post, the code burns', async () => {
  const c = makeCtx();
  let post = null;
  c.linker = new V.Linker(c.store, (h, e) => c.verifier.linkToken(h, e), async () => ({ status: post ? 200 : 404, json: async () => post ? { code: 200, tweet: post } : { code: 404 } }));
  const s = await c.linker.start('@AnonWhale');
  assert.match(s.code, /^pof-[a-z2-9]{8}$/);
  await rej(c.linker.check('anonwhale', 'not a link'), 'BAD_POST');
  await rej(c.linker.check('anonwhale', 'https://x.com/anonwhale/status/123456789'), 'POST_NOT_FOUND');
  post = { text: 'hi ' + s.code, author: { screen_name: 'SomeoneElse' }, created_timestamp: Math.floor(Date.now() / 1000) };
  await rej(c.linker.check('anonwhale', 'https://x.com/anonwhale/status/123456789'), 'WRONG_AUTHOR');
  post = { text: 'hi pof-aaaaaaaa', author: { screen_name: 'AnonWhale' }, created_timestamp: Math.floor(Date.now() / 1000) };
  await rej(c.linker.check('anonwhale', '123456789'), 'CODE_NOT_IN_POST');
  post = { text: 'Linking: ' + s.code.toUpperCase(), author: { screen_name: 'AnonWhale' }, created_timestamp: Math.floor(Date.now() / 1000) };
  const ok = await c.linker.check('@ANONWHALE', 'https://twitter.com/AnonWhale/status/123456789?s=20');
  assert.equal(ok.handle, 'anonwhale');
  c.verifier.checkLinkToken('anonwhale', ok.link);
  await rej(c.linker.check('anonwhale', '123456789'), 'NO_CODE');          // burnt
  // five wrong tries lock the code
  const s2 = await c.linker.start('other_one');
  post = { text: 'nope', author: { screen_name: 'other_one' }, created_timestamp: Math.floor(Date.now() / 1000) };
  for (let i = 0; i < 5; i++) await rej(c.linker.check('other_one', '1234567'), 'CODE_NOT_IN_POST');
  post = { text: s2.code, author: { screen_name: 'other_one' }, created_timestamp: Math.floor(Date.now() / 1000) };
  await rej(c.linker.check('other_one', '1234567'), 'TOO_MANY_TRIES');
});

test('HTTP: routes answer JSON, every rejection has a code, limits answer 429, cron routes need the secret', async () => {
  const c = makeCtx();
  V.setContext(c);
  const r = ring(); c.rings.register(r);
  const req = (path, init = {}) => new Request('https://pof.test' + path, { headers: { 'x-real-ip': '203.0.113.' + (init.ip || 1), 'content-type': 'application/json' }, ...init });
  let res = await V.areas.attest()(req('/api/attest'));
  assert.equal(res.status, 200);
  const info = await res.json();
  assert.equal(info.verifierKey, c.signer.address); assert.equal(info.bundleHash, hex(V.bundleHash()));
  res = await V.areas.attest()(req('/api/attest', { method: 'POST', body: 'nope' }));
  assert.equal(res.status, 400); assert.equal((await res.json()).error.code, 'BAD_JSON');
  res = await V.areas.attest()(req('/api/attest', { method: 'POST', body: JSON.stringify(pkg(c, r, [c.rings.note(r, 2n * SOL)])), ip: 2 }));
  const ok = await res.json();
  assert.equal(res.status, 200, JSON.stringify(ok)); assert.equal(ok.attestation.length, 480);
  res = await V.areas.log()(req('/api/attest/log?proof=0'));
  assert.equal((await res.json()).treeSize, 1);
  res = await V.areas.log()(req('/api/attest/log?proof=x'));
  assert.equal((await res.json()).error.code, 'BAD_QUERY');
  res = await V.areas.log()(req('/api/attest/log'));
  const head = await res.json();
  assert.ok(V.verifySig(Buffer.from(head.signature, 'hex'), V.sthBytes(c.programId, head.treeSize, Buffer.from(head.rootHash, 'hex')), c.signer.publicKey));
  // the per-client bucket: 6 attests a minute
  let last;
  for (let i = 0; i < 8; i++) last = await V.areas.attest()(req('/api/attest', { method: 'POST', body: '{}', ip: 9 }));
  assert.equal(last.status, 429); assert.ok(last.headers.get('retry-after'));
  // link verify through the rewrite path
  const link = c.verifier.linkToken('anon', Math.floor(Date.now() / 1000) + 60);
  res = await V.areas.link()(req('/api/link?id=' + encodeURIComponent(link)));
  assert.deepEqual(await res.json(), { verified: true, handle: 'anon', expiresAt: Number(link.split('.')[1]) });
  res = await V.areas.link()(req('/api/link/verify?id=anon.1.00'));
  assert.equal((await res.json()).verified, false);
  res = await V.areas.keeper()(req('/api/keeper/scan'));
  assert.equal(res.status, 403);
  res = await V.areas.keeper()(req('/api/keeper/scan', { headers: { authorization: 'Bearer cron-test' } }));
  assert.match((await res.json()).skipped, /off before launch/);
  res = await V.areas.relay()(req('/api/relay/nothing'));
  assert.equal(res.status, 404);
  V.setContext(null);
});
