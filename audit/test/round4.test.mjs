/* Audit round 4: blind relay credits, the relayed revoke. Each test states the SECURE behaviour; open findings fail. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { V, ring, makeCtx, hex } from '../../verifier/test/helpers.mjs';
import * as B from '../../verifier/lib/blind.mjs';

const code = async (p) => { try { await p; return 'OK'; } catch (e) { return e.code || e.message; } };
function rsa() {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const j = privateKey.export({ format: 'jwk' }); const h = (x) => Buffer.from(x, 'base64url').toString('hex');
  return V.creditKeyFromJson(JSON.stringify({ n: h(j.n), e: h(j.e), d: h(j.d) }));
}
const tok = () => crypto.randomBytes(32).toString('hex');

async function bought() {
  const c = makeCtx();
  const key = rsa();
  const holder = ring();
  const tx = '5'.repeat(88);
  const credits = new V.Credits(c.store, key, { received: async (s) => (s === tx ? { lamports: 50_000_000n, signers: [holder.owner] } : null) }, c.relayerSigner.address, 10_000_000n, [5, 20]);
  const offer = credits.offer();
  const tokens = Array.from({ length: 5 }, tok);
  const bl = await Promise.all(tokens.map(t => B.blind(offer.key, t)));
  const blinded = bl.map(x => x.blinded);
  const proof = hex(holder.wallet.sign(V.claimMessage({ signature: tx, owner: holder.owner, kid: key.kid, blinded })));
  return { c, key, holder, tx, credits, offer, tokens, bl, blinded, proof };
}

test('control: a paid bundle claims, unblinds, verifies; a token spends once', async () => {
  const s = await bought();
  const r = await s.credits.claim({ signature: s.tx, owner: s.holder.owner, blinded: s.blinded, proof: s.proof });
  const sig0 = B.unblind(s.offer.key, r.signatures[0], s.bl[0].r);
  assert.equal(await B.verifyCredit(s.offer.key, s.tokens[0], sig0), true);
  await s.credits.spend({ kid: s.key.kid, token: s.tokens[0], signature: sig0 }, 'a'.repeat(64));
  assert.equal(await code(s.credits.spend({ kid: s.key.kid, token: s.tokens[0], signature: sig0 }, 'b'.repeat(64))), 'CREDIT_USED');
  // racing spends of one token for two attestations: exactly one wins
  const sig1 = B.unblind(s.offer.key, r.signatures[1], s.bl[1].r);
  const race = await Promise.allSettled([s.credits.spend({ kid: s.key.kid, token: s.tokens[1], signature: sig1 }, 'c'.repeat(64)), s.credits.spend({ kid: s.key.kid, token: s.tokens[1], signature: sig1 }, 'd'.repeat(64))]);
  assert.equal(race.filter(x => x.status === 'fulfilled').length, 1);
});

/* CR-02 (Medium): the claim record keeps only { count, kid }. A claim whose answer is lost (a dropped connection, a closed
   tab) cannot be repeated: the resume gets ALREADY_CLAIMED and the holder has paid for credits it never received. RSA
   signing is deterministic, so re-signing the SAME blinded values for the same transfer creates no new credit. */
test('CR-02 credits: a claim repeated with the same transfer and the same blinded values returns the same signatures', async () => {
  const s = await bought();
  const first = await s.credits.claim({ signature: s.tx, owner: s.holder.owner, blinded: s.blinded, proof: s.proof });
  let again = null, err = null;
  try { again = await s.credits.claim({ signature: s.tx, owner: s.holder.owner, blinded: s.blinded, proof: s.proof }); } catch (e) { err = e; }
  assert.deepEqual(again && again.signatures, first.signatures, 'the paid bundle is lost on a retry: ' + (err && err.code));
  // and other blinded values for the same transfer still get nothing
  const other = await Promise.all(Array.from({ length: 5 }, tok).map(t => B.blind(s.offer.key, t)));
  const ob = other.map(x => x.blinded);
  const op = hex(s.holder.wallet.sign(V.claimMessage({ signature: s.tx, owner: s.holder.owner, kid: s.key.kid, blinded: ob })));
  assert.equal(await code(s.credits.claim({ signature: s.tx, owner: s.holder.owner, blinded: ob, proof: op })), 'ALREADY_CLAIMED');
});

test('control: the relayed revoke bytes bind the certificate, its nullset and issue slot (POF-REVOKE1, 148 bytes)', () => {
  const pid = new Uint8Array(32).fill(1), cert = new Uint8Array(32).fill(2), sh = new Uint8Array(32).fill(3), ns = new Uint8Array(32).fill(4);
  const b = V.revokeBytes(pid, cert, sh, 1, ns, 77n);
  assert.equal(b.length, 148);
  assert.equal(Buffer.from(b.subarray(0, 11)).toString(), 'POF-REVOKE1');
  assert.notDeepEqual(Buffer.from(V.revokeBytes(pid, cert, sh, 1, ns, 78n)), Buffer.from(b), 'a renew (new issued slot) needs a new signature');
});
