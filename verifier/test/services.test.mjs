import { test } from 'node:test';
import assert from 'node:assert/strict';
import { V, ring, makeCtx, pkg, hex } from './helpers.mjs';

const SOL = 1_000_000_000n;
const rej = async (p, code) => { try { await p; assert.fail('expected ' + code); } catch (e) { assert.equal(e.code, code, e.message); return e; } };

async function relayed(c) {
  const r = ring(); c.rings.register(r); const ctl = ring();
  const n = c.rings.note(r, 3n * SOL);
  const link = c.verifier.linkToken('anon', Math.floor(Date.now() / 1000) + 600, ctl.owner);
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
  await rej(c.relayer.certify({ ...body, quote: q.quote.replace(/.$/, ch => (ch === '0' ? '1' : '0')) }), 'BAD_QUOTE');
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

test('linker: one-time code redeemed only with its secret, author and code checked, bound to the controller, the code burns', async () => {
  const c = makeCtx();
  let post = null;
  c.linker = new V.Linker(c.store, (h, e, ctl) => c.verifier.linkToken(h, e, ctl), async () => ({ status: post ? 200 : 404, json: async () => post ? { code: 200, tweet: post } : { code: 404 } }));
  const ctl = ring();
  const s = await c.linker.start('@AnonWhale', ctl.owner);
  assert.match(s.code, /^pof-[a-z2-9]{8}$/); assert.match(s.secret, /^[0-9a-f]{32}$/);
  const now = () => Math.floor(Date.now() / 1000);
  await rej(c.linker.check('anonwhale', '123456789'), 'NO_SECRET');
  await rej(c.linker.check('anonwhale', '123456789', 'ab'.repeat(16)), 'NO_CODE');
  await rej(c.linker.check('anonwhale', 'not a link', s.secret), 'BAD_POST');
  await rej(c.linker.check('anonwhale', 'https://x.com/anonwhale/status/123456789', s.secret), 'POST_NOT_FOUND');
  post = { text: 'hi ' + s.code, author: { screen_name: 'SomeoneElse' }, created_timestamp: now() };
  await rej(c.linker.check('anonwhale', 'https://x.com/anonwhale/status/123456789', s.secret), 'WRONG_AUTHOR');
  post = { text: 'hi pof-aaaaaaaa', author: { screen_name: 'AnonWhale' }, created_timestamp: now() };
  await rej(c.linker.check('anonwhale', '123456789', s.secret), 'CODE_NOT_IN_POST');
  post = { text: 'Linking: ' + s.code.toUpperCase(), author: { screen_name: 'AnonWhale' }, created_timestamp: now() };
  await rej(c.linker.check('anonwhale', '123456789', s.secret, ring().owner), 'LINK_OTHER_CONTROLLER');
  const ok = await c.linker.check('@ANONWHALE', 'https://twitter.com/AnonWhale/status/123456789?s=20', s.secret);
  assert.equal(ok.handle, 'anonwhale'); assert.equal(ok.controller, ctl.owner);
  assert.equal(c.verifier.checkLinkToken('anonwhale', ok.link, ctl.owner), ctl.owner);
  await rej(c.linker.check('anonwhale', '123456789', s.secret), 'NO_CODE');          // burnt
  // a second start does not cancel the first (POF-09)
  const a1 = await c.linker.start('other_one'); await c.linker.start('other_one');
  post = { text: a1.post, author: { screen_name: 'other_one' }, created_timestamp: now() };
  const unb = await c.linker.check('other_one', '1234567', a1.secret);
  assert.equal(unb.controller, null);
  // five wrong tries lock a code
  const s2 = await c.linker.start('third_one');
  post = { text: 'nope', author: { screen_name: 'third_one' }, created_timestamp: now() };
  for (let i = 0; i < 5; i++) await rej(c.linker.check('third_one', '1234567', s2.secret), 'CODE_NOT_IN_POST');
  post = { text: s2.code, author: { screen_name: 'third_one' }, created_timestamp: now() };
  await rej(c.linker.check('third_one', '1234567', s2.secret), 'TOO_MANY_TRIES');
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
  const ctlK = ring().owner;
  const link = c.verifier.linkToken('anon', Math.floor(Date.now() / 1000) + 60, ctlK);
  res = await V.areas.link()(req('/api/link?id=' + encodeURIComponent(link)));
  assert.deepEqual(await res.json(), { verified: true, handle: 'anon', controller: ctlK, expiresAt: Number(link.split('.')[2]) });
  res = await V.areas.link()(req('/api/link/verify?id=anon.1.1.00'));
  assert.equal((await res.json()).verified, false);
  res = await V.areas.keeper()(req('/api/keeper/scan'));
  assert.equal(res.status, 403);
  res = await V.areas.keeper()(req('/api/keeper/scan', { headers: { authorization: 'Bearer cron-test' } }));
  assert.match((await res.json()).skipped, /off before launch/);
  res = await V.areas.relay()(req('/api/relay/nothing'));
  assert.equal(res.status, 404);
  V.setContext(null);
});

test('keeper escrow (POF-01): every kit is sealed to each registered keeper, who can open it and revoke without us', async () => {
  const c = makeCtx({ relayFree: true });
  V.setContext(c);
  const r = ring(); c.rings.register(r);
  const a = c.rings.note(r, 2n * SOL);
  const out = await c.verifier.attest(pkg(c, r, [a]));
  const res = await V.areas.keeper()(new Request('https://pof.test/api/keeper/escrow'));
  const list = await res.json();
  assert.equal(list.entries.length, 1); assert.equal(list.keepers[0].kid, 'witness-test');
  const e = list.entries[0];
  const raw = JSON.stringify(e);
  assert.ok(!raw.includes(out.nullifiers[0]) && !raw.includes(out.salts[0]), 'the escrow listing carries no nullifier or salt in clear');
  const kit = V.openEnvelope(c.witnessSecret, 'witness-test', Buffer.from(e.attestationHash, 'hex'), e.envelopes[0]);
  assert.equal(kit.kit[0].nullifier, out.nullifiers[0]); assert.equal(kit.kit[0].salt, out.salts[0]);
  assert.throws(() => V.openEnvelope(new Uint8Array(32).fill(1), 'witness-test', Buffer.from(e.attestationHash, 'hex'), e.envelopes[0]));
  assert.throws(() => V.openEnvelope(c.witnessSecret, 'other', Buffer.from(e.attestationHash, 'hex'), e.envelopes[0]));
  // the witness revokes with what it opened, through the same permissionless instruction
  await c.chain.certify({ attestation: Buffer.from(out.attestation, 'hex'), signature: Buffer.from(out.signature, 'hex'), logIndex: out.logIndex, hashes: out.hashes.map(h => Buffer.from(h, 'hex')) });
  c.rings.spend(a.nullifier);
  const cert = await c.chain.certificate(V.subjectHash(0, r.owner), 0);
  await c.chain.revokeSpent({ subjectHash: Buffer.from(kit.subjectHash, 'hex'), asset: kit.asset, index: cert.hashes.indexOf(kit.kit[0].h), salt: Buffer.from(kit.kit[0].salt, 'hex'), nullifier: Buffer.from(kit.kit[0].nullifier, 'hex'), tree: kit.tree });
  assert.equal((await c.chain.certificate(V.subjectHash(0, r.owner), 0)).status, 1);
  // expired entries are swept
  assert.equal(await c.escrow.sweep(BigInt(kit.expirySlot) + 10_000n), 1);
  V.setContext(null);
});

test('renew: the holder\'s salts give the same salted hashes, so renew keeps the certificate\'s list', async () => {
  const c = makeCtx();
  const r = ring(); c.rings.register(r);
  const a = c.rings.note(r, 2n * SOL);
  const first = await c.verifier.attest(pkg(c, r, [a]));
  c.rings.slotNow += 1000n; c.rings.headSlot = c.rings.slotNow - 5n;
  const again = await c.verifier.attest({ ...pkg(c, r, [a], { slot: c.rings.slotNow }), salts: first.salts });
  assert.deepEqual(again.hashes, first.hashes);
  assert.ok(V.decodeAttestation(Buffer.from(again.attestation, 'hex')).issuedSlot > V.decodeAttestation(Buffer.from(first.attestation, 'hex')).issuedSlot);
  await rej(c.verifier.attest({ ...pkg(c, r, [a], { slot: c.rings.slotNow }), salts: ['00'] }), 'BAD_LENGTH');
});

test('keeper scan has a time budget and resumes where it stopped', async () => {
  const c = makeCtx();
  for (let i = 0; i < 4; i++) { const r = ring(); c.rings.register(r); await c.verifier.attest(pkg(c, r, [c.rings.note(r, 1n * SOL)])); }
  const a = await c.keeper.scan({ budgetMs: -1 });
  assert.equal(a.complete, false); assert.equal(a.pending, 0);
  const b = await c.keeper.scan();
  assert.equal(b.complete, true); assert.equal(b.pending, 4);
  const last = JSON.parse(Buffer.from(await c.store.get('keeper/last-scan.json')).toString());
  assert.equal(last.complete, true); assert.equal(last.kits, 4);
});

test('relayer: an uncertain certify keeps the payment for the same attestation; a landed one is not refunded', async () => {
  const c = makeCtx();
  const r = ring(); c.rings.register(r); const ctl = ring();
  const out = await c.verifier.attest(pkg(c, r, [c.rings.note(r, 3n * SOL)], { kind: 1, value: 'anon2', proof: c.verifier.linkToken('anon2', Math.floor(Date.now() / 1000) + 600, ctl.owner), relay: true, controller: ctl.owner }));
  const q = await c.relayer.quote();
  c.chain.inbox.push({ signature: 'payU', slot: c.rings.slotNow, lamports: BigInt(q.lamports) });
  const body = { attestation: out.attestation, signature: out.signature, logIndex: out.logIndex, quote: q.quote, hashes: out.hashes };
  const real = c.chain.certify.bind(c.chain);
  c.chain.certify = async () => { throw new V.PofError('CHAIN_UNCERTAIN', 'no confirmation', 504, { signature: 'sigX' }); };
  await rej(c.relayer.certify(body), 'CHAIN_UNCERTAIN');
  assert.ok(await c.store.get('relay/paid/payU'), 'the payment stays bound to this attestation');
  c.chain.certify = real;
  const ok = await c.relayer.certify(body);                           // the same attestation retries with the same payment
  assert.equal(ok.payment, 'payU');
  // a certify that errors after landing is reported as landed, not refunded
  c.chain.certify = async (x) => { await real(x); throw new V.PofError('CHAIN_UNCERTAIN', 'late', 504, { signature: 'sigY' }); };
  const r2 = ring(); c.rings.register(r2);
  const out2 = await c.verifier.attest(pkg(c, r2, [c.rings.note(r2, 3n * SOL)], { kind: 1, value: 'anon3', proof: c.verifier.linkToken('anon3', Math.floor(Date.now() / 1000) + 600, ctl.owner), relay: true, controller: ctl.owner }));
  const q2 = await c.relayer.quote();
  c.chain.inbox.push({ signature: 'payL', slot: c.rings.slotNow, lamports: BigInt(q2.lamports) });
  const res = await c.relayer.certify({ attestation: out2.attestation, signature: out2.signature, logIndex: out2.logIndex, quote: q2.quote, hashes: out2.hashes });
  assert.equal(res.signature, 'sigY');
  assert.ok(await c.store.get('relay/paid/payL'));
});
