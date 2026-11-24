/* Audit round 2: re-tests of the fixes with the CONTRACT §4 v2 package (so a refusal is for the right reason, not for an
   old field layout), positive controls (the honest path still works), and the new findings. Each test states the SECURE
   behaviour; open findings fail. Run: node --test audit/test/ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { V, ring, makeCtx, pkg, hex } from '../../verifier/test/helpers.mjs';

const SOL = 1_000_000_000n;
const now = () => Math.floor(Date.now() / 1000);
const code = async (p) => { try { await p; return 'OK'; } catch (e) { return e.code || e.message; } };

test('control: an honest v2 package (the ring owner signs) is attested', async () => {
  const c = makeCtx();
  const r = ring(); c.rings.register(r);
  assert.equal(await code(c.verifier.attest(pkg(c, r, [c.rings.note(r, 2n * SOL)]))), 'OK');
});

test('POF-02 re-test: a renter who signs ring.proof with his own key is refused with BAD_RING_PROOF', async () => {
  const c = makeCtx();
  const whale = ring(); c.rings.register(whale);
  const renter = ring();
  const n = c.rings.note(whale, 10n * SOL);
  // the whale's ring and nk, a subject that is the renter's wallet, both proofs signed by the renter
  const p = pkg(c, whale, [n], { kind: 0, value: renter.owner, tier: 2, ringSigner: renter.wallet, subjectSigner: renter.wallet });
  p.payer = whale.owner;
  assert.equal(await code(c.verifier.attest(p)), 'BAD_RING_PROOF');
});

test('POF-02 re-test: a ring.proof cannot be moved to another subject, tier or payer (the message binds them)', async () => {
  const c = makeCtx();
  const r = ring(); c.rings.register(r);
  const n = c.rings.note(r, 20n * SOL);
  const p = pkg(c, r, [n], { tier: 1 });
  p.tier = 2;                                                            // same signatures, a higher tier
  assert.equal(await code(c.verifier.attest(p)), 'BAD_RING_PROOF');
});

test('POF-03 re-test: a bound link id stolen from its holder cannot be used with another controller', async () => {
  const c = makeCtx();
  const victimCtl = ring(), attacker = ring(); c.rings.register(attacker);
  const link = c.verifier.linkToken('victim', now() + 600, victimCtl.owner);
  const p = pkg(c, attacker, [c.rings.note(attacker, 1n * SOL)], { kind: 1, value: 'victim', proof: link, controller: attacker.owner });
  assert.equal(await code(c.verifier.attest(p)), 'LINK_OTHER_CONTROLLER');
});

test('POF-03 re-test: an unbound link id (what the bots get) cannot certify', async () => {
  const c = makeCtx();
  const a = ring(); c.rings.register(a);
  const unbound = c.verifier.linkToken('victim', now() + 600, null);
  const p = pkg(c, a, [c.rings.note(a, 1n * SOL)], { kind: 1, value: 'victim', proof: unbound, controller: a.owner });
  p.subject.proof = unbound;                                             // the helper would rebind it; undo that
  assert.equal(await code(c.verifier.attest(p)), 'LINK_UNBOUND');
});

/* POF-26 (Low, new): for an X subject nobody proves control of the controller key. A bound link id that leaks (it is a
   bearer value for its hour: /api/link?id= is public) lets anyone certify the handle with the victim's controller and their
   own funds. The victim's controller can revoke it, so the damage is a false "holds" statement and a 30-day squat until
   the victim notices. Fix: the controller signs the disclosure message too (subject.proof for kind 1 = controller sig,
   the link id moves to subject.link). */
test('POF-26 verifier: a leaked bound link id does not let a stranger certify the handle (controller must sign)', async () => {
  const c = makeCtx();
  const victimCtl = ring(), stranger = ring(); c.rings.register(stranger);
  const link = c.verifier.linkToken('victim', now() + 600, victimCtl.owner);
  // the stranger does not hold the victim's controller key. Round 3 correction: the helper's `signers` map signs for every
  // ring() key the tests made, victimCtl included, so this test must say `controllerSigner: null` (no signature), and a
  // wrong key must fail the same way
  const note = c.rings.note(stranger, 1n * SOL);
  const none = pkg(c, stranger, [note], { kind: 1, value: 'victim', proof: link, controller: victimCtl.owner, controllerSigner: null });
  assert.equal(await code(c.verifier.attest(none)), 'BAD_CONTROLLER_PROOF', 'signed @victim backed by a stranger\'s funds, no controller signature');
  const wrong = pkg(c, stranger, [note], { kind: 1, value: 'victim', proof: link, controller: victimCtl.owner, controllerSigner: stranger.wallet });
  assert.equal(await code(c.verifier.attest(wrong)), 'BAD_CONTROLLER_PROOF', 'a controller signature by another key was accepted');
});

test('control: the controller\'s own signature still certifies the handle', async () => {
  const c = makeCtx();
  const ctl = ring(), r = ring(); c.rings.register(r);
  const link = c.verifier.linkToken('anon', now() + 600, ctl.owner);
  assert.equal(await code(c.verifier.attest(pkg(c, r, [c.rings.note(r, 1n * SOL)], { kind: 1, value: 'anon', proof: link, controller: ctl.owner, controllerSigner: ctl.wallet }))), 'OK');
});

test('POF-08 re-test: a failed certify gives the payment back, a successful one uses it once', async () => {
  const c = makeCtx();
  const r = ring(); c.rings.register(r); const ctl = ring();
  const out = await c.verifier.attest(pkg(c, r, [c.rings.note(r, 3n * SOL)], { kind: 1, value: 'anon', proof: c.verifier.linkToken('anon', now() + 600, ctl.owner), relay: true, controller: ctl.owner }));
  const q = await c.relayer.quote();
  c.chain.inbox.push({ signature: 'pay1', slot: c.rings.slotNow, lamports: BigInt(q.lamports) });
  const body = { attestation: out.attestation, signature: out.signature, logIndex: out.logIndex, quote: q.quote, hashes: out.hashes };
  const real = c.chain.certify.bind(c.chain);
  c.chain.certify = async () => { throw new V.PofError('CHAIN_REJECTED', 'boom', 502); };
  assert.equal(await code(c.relayer.certify(body)), 'CHAIN_REJECTED');
  c.chain.certify = real;
  assert.equal((await c.relayer.certify(body)).payment, 'pay1');
  assert.equal(await code(c.relayer.certify(body)), 'NOT_PAID');
});

test('POF-09 re-test: five wrong checks by a griefer do not lock the holder\'s own code', async () => {
  const c = makeCtx();
  let post = null;
  const linker = new V.Linker(c.store, (h, e, ctl) => c.verifier.linkToken(h, e, ctl), async () => ({ status: 200, json: async () => ({ code: 200, tweet: post }) }));
  const mine = await linker.start('victim');
  const theirs = await linker.start('victim');
  post = { text: 'nope', author: { screen_name: 'victim' }, created_timestamp: now() };
  for (let i = 0; i < 6; i++) await code(linker.check('victim', '1234567', theirs.secret));
  post = { text: mine.post, author: { screen_name: 'victim' }, created_timestamp: now() };
  assert.equal(await code(linker.check('victim', '1234567', mine.secret)), 'OK');
});

/* POF-30 (Medium, round 3): the relayer's payment mark is hex(attestation).slice(0, 64), the first 32 bytes, which are
   "POF1" and the program id: the same for EVERY attestation. Since 302a98f a payment whose mark equals the request's is
   reused ("an earlier try of the same attestation"), so while one relay is in flight any other attestation can ride the
   same payment. */
test('POF-30 relayer: one payment pays for one certificate, even when two different attestations race', async () => {
  const c = makeCtx();
  const mk = async (h) => { const r = ring(); c.rings.register(r); const ctl = ring();
    return c.verifier.attest(pkg(c, r, [c.rings.note(r, 3n * SOL)], { kind: 1, value: h, proof: c.verifier.linkToken(h, now() + 600, ctl.owner), relay: true, controller: ctl.owner, controllerSigner: ctl.wallet })); };
  const A = await mk('alice'), Bx = await mk('bob');
  const q = await c.relayer.quote();
  c.chain.inbox.push({ signature: 'onlyPayment', slot: c.rings.slotNow, lamports: BigInt(q.lamports) });
  const real = c.chain.certify.bind(c.chain);
  c.chain.certify = async (x) => { await new Promise(r => setTimeout(r, 80)); return real(x); }; // a send and its confirmation take time
  const body = (o) => ({ attestation: o.attestation, signature: o.signature, logIndex: o.logIndex, quote: q.quote, hashes: o.hashes });
  const r = await Promise.allSettled([c.relayer.certify(body(A)), c.relayer.certify(body(Bx))]);
  assert.equal(r.filter(x => x.status === 'fulfilled').length, 1, 'one payment relayed two certificates');
});
