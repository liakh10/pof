/* Audit proofs for the Verifier services (pof/verifier). Each test states the SECURE behaviour; it FAILS while the finding
   is open and passes once the fix lands. Findings: pof/reports/audit.md. Run: node --test audit/test/
   The test doubles (MemoryRings, FakeChain, makeCtx) are the verifier's own, imported read-only. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { V, ring, makeCtx, pkg, hex } from '../../verifier/test/helpers.mjs';

const SOL = 1_000_000_000n;
const B = (h) => Buffer.from(h, 'hex');
const land = (c, out) => c.chain.certify({ attestation: B(out.attestation), signature: B(out.signature), logIndex: out.logIndex, hashes: out.hashes.map(B) });
const now = () => Math.floor(Date.now() / 1000);

/* POF-03 (High): the X-handle code is a bearer secret once posted. Whoever reads the public post first redeems it. */
test('POF-03 linker: a third party who only sees the public post cannot redeem the victim\'s code', async () => {
  const c = makeCtx();
  let post = null;
  const linker = new V.Linker(c.store, (h, e) => c.verifier.linkToken(h, e), async () => ({ status: 200, json: async () => ({ code: 200, tweet: post }) }));
  const started = await linker.start('victim');                          // the victim's browser
  post = { text: `Linking @victim to Proof of Funds: ${started.code}`, author: { screen_name: 'victim' }, created_timestamp: now() };
  // the attacker watches X for "Linking @… to Proof of Funds: pof-…" and calls check with nothing but the handle and the post
  let stolen = null;
  try { stolen = await linker.check('victim', 'https://x.com/victim/status/1234567890'); } catch { /* refused: the fix */ }
  assert.equal(stolen, null, 'the attacker got a link id for @victim: ' + (stolen && stolen.link));
});

test('POF-03 linker: a stolen link id lets the attacker certify the handle with the attacker\'s own controller', async () => {
  const c = makeCtx();
  let post = null;
  const linker = new V.Linker(c.store, (h, e) => c.verifier.linkToken(h, e), async () => ({ status: 200, json: async () => ({ code: 200, tweet: post }) }));
  const started = await linker.start('victim');
  post = { text: started.post, author: { screen_name: 'victim' }, created_timestamp: now() };
  let link;
  try { link = (await linker.check('victim', '1234567890')).link; } catch { return; } // fixed upstream: nothing to steal
  const attacker = ring(); c.rings.register(attacker);
  const n = c.rings.note(attacker, 1n * SOL);
  let out = null;
  try { out = await c.verifier.attest(pkg(c, attacker, [n], { kind: 1, value: 'victim', proof: link, controller: attacker.owner })); } catch { /* refused: the fix */ }
  assert.equal(out, null, 'the Verifier signed @victim with the attacker as controller; it squats ["cert", h(@victim), SOL] for 30 days');
});

/* POF-09 (Medium): start() for a handle overwrites the pending code of whoever started first, so anyone can cancel a
   victim's link in a loop. */
test('POF-09 linker: starting a link for a handle does not cancel the code another person already posted', async () => {
  const c = makeCtx();
  let post = null;
  const linker = new V.Linker(c.store, (h, e) => c.verifier.linkToken(h, e), async () => ({ status: 200, json: async () => ({ code: 200, tweet: post }) }));
  const mine = await linker.start('victim');
  await linker.start('victim');                                          // the griefer, from another IP
  post = { text: mine.post, author: { screen_name: 'victim' }, created_timestamp: now() };
  let ok = null, err = null;
  try { ok = await linker.check('victim', '1234567890', mine.secret); } catch (e) { err = e; }
  assert.ok(ok && ok.link, 'the victim\'s posted code was cancelled by a second start(): ' + (err && err.code));
});

/* POF-04 (High): two attest calls that reach NoteLocks.take at the same time both pass the read and both write, so one note
   backs two live certificates. Blob get/put are separate round trips; the delay below models them. */
test('POF-04 locks: one note cannot back two certificates when two attests race', async () => {
  const c = makeCtx();
  const slow = {
    get: async (k) => { const v = await c.store.get(k); await new Promise(r => setTimeout(r, 40)); return v; },
    create: (k, b) => c.store.create(k, b), put: (k, b) => c.store.put(k, b), del: (k) => c.store.del(k), list: (p) => c.store.list(p),
  };
  const locks = new V.NoteLocks(slow, V.sha256(c.sealKey), 300n, c.chain);
  const nf = new Uint8Array(32).fill(9);
  const lock = (s) => ({ subjectHash: s.repeat(64), asset: 0, issuedSlot: 1_000_000, expirySlot: 7_480_000 });
  const r = await Promise.allSettled([locks.take([nf], lock('a'), 1_000_000n), locks.take([nf], lock('b'), 1_000_000n)]);
  const won = r.filter(x => x.status === 'fulfilled').length;
  assert.equal(won, 1, `${won} certificates took the same note`);
});

test('POF-04 locks: end to end, two parallel attests on one note for two handles both get signed', async () => {
  const c = makeCtx();
  const whale = ring(); c.rings.register(whale);
  const n = c.rings.note(whale, 100n * SOL);
  const ctl = ring();
  const exp = now() + 600;
  // a store whose reads are as slow as a Blob round trip
  const get = c.store.get.bind(c.store);
  c.store.get = async (k) => { const v = await get(k); if (k.startsWith('notes/')) await new Promise(r => setTimeout(r, 40)); return v; };
  const a = (h) => c.verifier.attest(pkg(c, whale, [n], { kind: 1, value: h, proof: c.verifier.linkToken(h, exp), tier: 3, controller: ctl.owner }));
  const r = await Promise.allSettled([a('alice'), a('bob')]);
  assert.equal(r.filter(x => x.status === 'fulfilled').length, 1, 'one 100 SOL note was certified for @alice AND @bob');
});

/* POF-05 (High): the keeper drops the kit of a second attestation for the same subject while the first certificate is live.
   The holder then revokes the first one and lands the second: a live certificate the keeper no longer watches. */
test('POF-05 keeper: a certificate landed from a second attestation is still revoked when its note is spent', async () => {
  const c = makeCtx({ relayFree: true });
  const r = ring(); c.rings.register(r);
  const n = c.rings.note(r, 5n * SOL);
  const A = await c.verifier.attest(pkg(c, r, [n]));
  c.rings.slotNow += 5n;
  const Bt = await c.verifier.attest(pkg(c, r, [n]));                   // same subject, same note: the lock lets it through
  await land(c, A);
  await c.keeper.scan();                                                 // a routine cron pass while A is live
  const cert = await c.chain.certificate(V.subjectHash(0, r.owner), 0);
  cert.status = 2;                                                       // revoke_by_holder on A (the controller can, at any time)
  await land(c, Bt);                                                     // B lands within max_attest_age
  c.rings.spend(n.nullifier);                                            // the money moves
  const rep = await c.keeper.scan();
  assert.equal(rep.revoked.length, 1, 'the spent certificate stays live: its kit was deleted while A was live');
});

/* POF-06 (Medium): a kit whose attestation never landed is kept until its 30-day expiry, although the program refuses it
   after max_attest_age (300 slots). Junk kits are free to make (the same note may be re-attested for the same subject) and
   every scan reads every kit in a 60 s function. */
test('POF-06 keeper: kits of attestations that can no longer land are dropped at the next scan', async () => {
  const c = makeCtx();
  const r = ring(); c.rings.register(r);
  const n = c.rings.note(r, 1n * SOL);
  for (let i = 0; i < 5; i++) { await c.verifier.attest(pkg(c, r, [n])); c.rings.slotNow += 1n; }
  c.rings.slotNow += 1_000n;                                             // far past issued + max_attest_age
  const rep = await c.keeper.scan();
  assert.equal(rep.dropped, 5, `${rep.kits - rep.dropped} dead kits kept for ~30 days`);
});

/* POF-08 (Medium): the relayer marks the payment used before its cap and balance checks; a refusal there burns it, while
   the message says "your payment stays valid". */
test('POF-08 relayer: a payment refused for the spend cap or the balance floor can be used again', async () => {
  const c = makeCtx();
  const r = ring(); c.rings.register(r); const ctl = ring();
  const out = await c.verifier.attest(pkg(c, r, [c.rings.note(r, 3n * SOL)], { kind: 1, value: 'anon', proof: c.verifier.linkToken('anon', now() + 600), relay: true, controller: ctl.owner }));
  const q = await c.relayer.quote();
  c.chain.inbox.push({ signature: 'payment1', slot: c.rings.slotNow, lamports: BigInt(q.lamports) });
  const body = { attestation: out.attestation, signature: out.signature, logIndex: out.logIndex, quote: q.quote, hashes: out.hashes };
  c.chain.balance = 10_000_000n;                                         // the relayer is low for a moment
  await assert.rejects(c.relayer.certify(body), (e) => e.code === 'RELAY_LOW' && /stays valid/.test(e.message));
  c.chain.balance = 10_000_000_000n;                                     // refilled
  let res = null, err = null;
  try { res = await c.relayer.certify(body); } catch (e) { err = e; }
  assert.ok(res && res.payment === 'payment1', 'the payment was burnt: ' + (err && err.code));
});

/* POF-02 (High): the Ring owner never signs. Anyone who has a ring's nk and its openings (a lender, or anyone nk leaked to:
   deposit openings are public data) certifies any subject against that ring. */
test('POF-02 verifier: a ring whose owner did not sign anything cannot back another person\'s certificate', async () => {
  const c = makeCtx();
  const whale = ring(); c.rings.register(whale);
  const n = c.rings.note(whale, 10n * SOL);
  const renter = ring();                                                 // a wallet with no funds; the whale only hands over nk + openings
  const s = c.rings.slotNow - 10n;
  const msg = V.subjectMessage({ programId: V.toB58(c.programId), kind: 0, value: renter.owner, ring: whale.owner, asset: 0, tier: 2, payer: renter.owner, slot: s });
  const p = { v: 1, subject: { kind: 0, value: renter.owner, proof: hex(renter.wallet.sign(msg)), slot: String(s) }, asset: 0, tier: 2,
    ring: { owner: whale.owner, nk: hex(whale.nk) }, notes: [n.opening], payer: renter.owner };
  let out = null;
  try { out = await c.verifier.attest(p); } catch { /* refused: the fix (ring owner signature required) */ }
  assert.equal(out, null, 'certified a wallet that holds nothing, from a ring whose owner signed nothing');
});
