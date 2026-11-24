import { test } from 'node:test';
import assert from 'node:assert/strict';
import { V, ring, makeCtx, pkg, hex, spr } from './helpers.mjs';

const SOL = 1_000_000_000n;
const code = async (p, c) => { try { await p; assert.fail('expected ' + c); } catch (e) { assert.equal(e.code, c, e.message); return e; } };

test('happy path: two notes reach tier 2, the answer carries no amount and the signature verifies', async () => {
  const c = makeCtx(); const r = ring(); c.rings.register(r);
  const a = c.rings.note(r, 6n * SOL), b = c.rings.note(r, 4n * SOL);
  const out = await c.verifier.attest(pkg(c, r, [a, b], { tier: 2 }));
  const att = Buffer.from(out.attestation, 'hex');
  assert.equal(att.length, 240); assert.equal(V.toB58(V.decodeAttestation(new Uint8Array(att)).controller), r.owner);
  assert.ok(V.verifySig(Buffer.from(out.signature, 'hex'), att, c.signer.publicKey));
  const d = V.decodeAttestation(new Uint8Array(att));
  assert.equal(d.tier, 2); assert.equal(d.asset, 0); assert.equal(d.noteCount, 2); assert.equal(d.subjectKind, 0);
  assert.equal(hex(d.subjectHash), hex(V.subjectHash(0, r.owner)));
  assert.equal(hex(d.programId), hex(c.programId));
  assert.equal(V.toB58(d.payer), r.owner);
  assert.equal(d.expirySlot - d.issuedSlot, 6_480_000n);
  assert.equal(hex(d.treeRoot), hex(c.rings.history.at(-1)));
  assert.equal(d.rootSlot, c.rings.headSlot);
  // the nullifiers are the SDK's own
  assert.deepEqual(new Set(out.nullifiers), new Set([hex(a.nullifier), hex(b.nullifier)]));
  // salted hashes and the nullset hash
  const hs = out.salts.map((s, i) => V.saltedNullifier(Buffer.from(s, 'hex'), Buffer.from(out.nullifiers[i], 'hex')));
  assert.deepEqual(out.hashes, V.sortHashes(hs).map(hex));
  assert.equal(hex(d.nullsetHash), hex(V.nullsetHash(V.sortHashes(hs))));
  // no amount anywhere in the answer
  const s = JSON.stringify(out);
  for (const n of ['6000000000', '4000000000', '10000000000']) assert.ok(!new RegExp(`[^0-9a-f]${n}[^0-9a-f]`).test(s.replace(/"(logIndex|issuedSlot|expirySlot)":\d+/g, '')), n);
  assert.equal(out.logIndex, null, 'nothing is public before the certificate lands (A2-06)');
  assert.equal((await c.log.head()).treeSize, 0);
});

test('the log entry is the §7 leaf of exactly this attestation, published once, when it is certified (A2-06)', async () => {
  const c = makeCtx(); const r = ring(); c.rings.register(r);
  const out = await c.verifier.attest(pkg(c, r, [c.rings.note(r, 2n * SOL)]));
  assert.equal((await c.log.head()).treeSize, 0);
  await c.chain.certify({ attestation: Buffer.from(out.attestation, 'hex'), signature: Buffer.from(out.signature, 'hex'), logIndex: 0, hashes: out.hashes.map(h => Buffer.from(h, 'hex')) });
  await c.keeper.scan();                                                // the keeper sees it on chain and publishes it
  await c.keeper.scan();                                                // once
  assert.equal((await c.log.head()).treeSize, 1);
  out.logIndex = await c.log.publish(out.attestationId);
  assert.equal(out.logIndex, 0);
  const e = await c.log.entry(out.logIndex);
  assert.equal(e.attestation, out.attestation); assert.equal(e.signature, out.signature);
  assert.equal(e.verifierKey, hex(c.signer.publicKey)); assert.equal(e.bundleHash, hex(V.bundleHash()));
  assert.equal(e.leaf.length, 377 * 2);
  const p = await c.log.proof(out.logIndex);
  assert.ok(V.merkle.verifyInclusion(Buffer.from(e.leafHash, 'hex'), p.index, p.treeSize, p.path.map(x => Buffer.from(x, 'hex')), Buffer.from(p.rootHash, 'hex')));
});

test('the keeper kit is sealed at rest: no nullifier or salt readable in the store', async () => {
  const c = makeCtx(); const r = ring(); c.rings.register(r);
  const out = await c.verifier.attest(pkg(c, r, [c.rings.note(r, 2n * SOL)]));
  const names = await c.keeper.names(); assert.equal(names.length, 1);
  const raw = Buffer.from(await c.store.get(names[0])).toString('latin1');
  assert.ok(!raw.includes(out.nullifiers[0]) && !raw.includes(out.salts[0]));
  const kit = await c.keeper.read(names[0]);
  assert.equal(kit.kit[0].nullifier, out.nullifiers[0]);
  assert.ok(!/[^0-9a-f]2000000000[^0-9a-f]/.test(JSON.stringify(kit)) && !('amount' in kit.kit[0]));
  // a sealed kit moved to another name does not open
  await c.store.put('keeper/kits/x/y', await c.store.get(names[0]));
  await assert.rejects(c.keeper.read('keeper/kits/x/y'));
});

test('rejections, each with its own code', async () => {
  const c = makeCtx(); const r = ring(); c.rings.register(r);
  const n = c.rings.note(r, 2n * SOL);
  const ok = () => pkg(c, r, [n]);
  await code(c.verifier.attest({ ...ok(), v: 2 }), 'BAD_VERSION');
  await code(c.verifier.attest({ ...ok(), tier: 9 }), 'BAD_TIER');
  await code(c.verifier.attest({ ...ok(), asset: 7 }), 'BAD_ASSET');
  await code(c.verifier.attest(pkg(c, r, [n], { tier: 2 })), 'BELOW_TIER');
  await code(c.verifier.attest({ ...ok(), notes: [] }), 'BAD_NOTES');
  await code(c.verifier.attest({ ...ok(), notes: Array(9).fill(n.opening) }), 'BAD_NOTES');
  await code(c.verifier.attest({ ...ok(), notes: [n.opening, n.opening] }), 'DUPLICATE_NOTES');
  // wrong amount: the commitment does not exist in the tree
  await code(c.verifier.attest({ ...ok(), notes: [{ ...n.opening, amount: String(3n * SOL) }] }), 'NOT_IN_TREE');
  await code(c.verifier.attest({ ...ok(), notes: [{ ...n.opening, blinding: '00'.repeat(32) }] }), 'NOT_IN_TREE');
  await code(c.verifier.attest({ ...ok(), notes: [{ ...n.opening, leafIndex: '5' }] }), 'NOT_IN_TREE');
  await code(c.verifier.attest({ ...ok(), notes: [{ ...n.opening, asset: V.ASSETS[1].mint }] }), 'WRONG_ASSET');
  // somebody else's nk
  const other = ring(); c.rings.register(other);
  await code(c.verifier.attest({ ...ok(), ring: { ...ok().ring, nk: hex(other.nk) } }), 'NULLIFIER_KEY_MISMATCH');
  await code(c.verifier.attest({ ...ok(), ring: { ...ok().ring, nk: 'zz' } }), 'BAD_HEX');
  // unregistered owner
  const lone = ring();
  await code(c.verifier.attest(pkg(c, lone, [n])), 'NO_RING');
  // wrong subject signature, stale subject slot
  await code(c.verifier.attest({ ...ok(), ring: { ...ok().ring, proof: hex(other.wallet.sign(new Uint8Array(3))) } }), 'BAD_RING_PROOF');
  await code(c.verifier.attest({ ...ok(), ring: { owner: r.owner, nk: hex(r.nk) } }), 'BAD_BASE58');
  await code(c.verifier.attest({ ...ok(), subject: { ...ok().subject, proof: hex(other.wallet.sign(new Uint8Array(3))) } }), 'BAD_SUBJECT_PROOF');
  // a signature over another tier does not carry over
  await code(c.verifier.attest({ ...ok(), ring: pkg(c, r, [n], { tier: 2 }).ring }), 'BAD_RING_PROOF');
  await code(c.verifier.attest(pkg(c, r, [n], { slot: c.rings.slotNow - 5000n })), 'SUBJECT_PROOF_STALE');
  // relay with the wrong payer
  await code(c.verifier.attest({ ...ok(), relay: true }), 'BAD_PAYER');
  // the note's creating transaction is not the one named
  await code(c.verifier.attest({ ...ok(), notes: [{ ...n.opening, sig: c.rings.note(r, 1n).opening.sig }] }), 'BAD_NOTES');
  // indexer down: nothing signed
  c.rings.fail.spent = true;
  await code(c.verifier.attest(ok()), 'INDEXER_UNAVAILABLE');
  c.rings.fail.spent = false;
  assert.equal((await c.log.head()).treeSize, 0, 'no rejection reached the log');
});

test('a spent note and a too-new note are refused', async () => {
  const c = makeCtx(); const r = ring(); c.rings.register(r);
  const a = c.rings.note(r, 2n * SOL);
  c.rings.spend(a.nullifier);
  await code(c.verifier.attest(pkg(c, r, [a])), 'NOTE_SPENT');
  const b = c.rings.note(r, 2n * SOL, { ageSlots: 20n });
  const e = await code(c.verifier.attest(pkg(c, r, [b])), 'NOTE_TOO_NEW');
  assert.equal(e.details.waitSlots, 130);
});

test('a note whose root fell out of the on-chain history is refused', async () => {
  const c = makeCtx(); const r = ring(); c.rings.register(r);
  const a = c.rings.note(r, 2n * SOL);
  c.rings.history = [new Uint8Array(32).fill(9)];
  await code(c.verifier.attest(pkg(c, r, [a])), 'NOT_IN_TREE');
});

test('vault mode: a wallet subject certified from a separate vault ring; both the vault and the wallet sign', async () => {
  const c = makeCtx(); const vault = ring(); c.rings.register(vault); const main = ring();
  const n = c.rings.note(vault, 2n * SOL);
  const p = pkg(c, vault, [n], { kind: 0, value: main.owner, subjectSigner: main.wallet });
  p.payer = main.owner;
  await code(c.verifier.attest(p), 'BAD_RING_PROOF'); // the payer line changed: both signatures must be over the final bytes
  const s = c.rings.slotNow - 3n;
  const msg = V.disclosureMessage({ programId: V.toB58(c.programId), kind: 0, value: main.owner, ring: vault.owner, controller: main.owner, asset: 0, tier: 1, payer: main.owner, slot: s });
  const q = { v: 1, subject: { kind: 0, value: main.owner, proof: hex(main.wallet.sign(msg)), slot: String(s) }, asset: 0, tier: 1, ring: { owner: vault.owner, nk: hex(vault.nk), proof: hex(vault.wallet.sign(msg)) }, notes: [n.opening], payer: main.owner };
  const out = await c.verifier.attest(q);
  assert.equal(out.subjectHash, hex(V.subjectHash(0, main.owner)));
  // without the wallet's own signature, the vault alone cannot name a wallet
  const r2 = c.rings.note(vault, 2n * SOL);
  await code(c.verifier.attest({ ...q, subject: { ...q.subject, proof: undefined }, notes: [r2.opening] }), 'BAD_SUBJECT_PROOF');
  // and the wallet's signature cannot be replayed for another ring
  const other = ring(); c.rings.register(other);
  const n2 = c.rings.note(other, 2n * SOL);
  await code(c.verifier.attest({ ...q, ring: { owner: other.owner, nk: hex(other.nk), proof: hex(other.wallet.sign(msg)) }, notes: [n2.opening] }), 'BAD_RING_PROOF');
});

test('X handle subject: a link id from the Verifier, case-insensitive, expiry enforced, other handles refused', async () => {
  const c = makeCtx(); const r = ring(); c.rings.register(r);
  const n = c.rings.note(r, 2n * SOL);
  const ctl = ring();
  const link = c.verifier.linkToken('@SomeAnon', Math.floor(Date.now() / 1000) + 600, ctl.owner);
  await code(c.verifier.attest(pkg(c, r, [n], { kind: 1, value: '@someanon', proof: link, relay: true, controller: null })), 'BAD_BASE58');
  const out = await c.verifier.attest(pkg(c, r, [n], { kind: 1, value: '@someanon', proof: link, relay: true, controller: ctl.owner }));
  assert.equal(out.controller, ctl.owner);
  assert.equal(out.subjectHash, hex(V.subjectHash(1, 'someanon')));
  assert.equal(V.toB58(V.decodeAttestation(Buffer.from(out.attestation, 'hex')).payer), c.relayerSigner.address);
  const m = c.rings.note(r, 2n * SOL);
  await code(c.verifier.attest(pkg(c, r, [m], { kind: 1, value: 'otheranon', proof: link, relay: true, controller: ctl.owner })), 'BAD_SUBJECT_PROOF');
  // a link id issued for one controller does not certify with another (POF-03)
  await code(c.verifier.attest(pkg(c, r, [m], { kind: 1, value: 'someanon', proof: link, relay: true, controller: r.owner })), 'LINK_OTHER_CONTROLLER');
  const old = c.verifier.linkToken('someanon', Math.floor(Date.now() / 1000) - 1, ctl.owner);
  await code(c.verifier.attest(pkg(c, r, [m], { kind: 1, value: 'someanon', proof: old, relay: true, controller: ctl.owner })), 'LINK_EXPIRED');
  const forged = link.slice(0, -4) + '0000';
  await code(c.verifier.attest(pkg(c, r, [m], { kind: 1, value: 'someanon', proof: forged, relay: true, controller: ctl.owner })), 'BAD_SUBJECT_PROOF');
  // an unbound link (the bots' kind) cannot certify
  // the controller must sign too: a leaked bound link id alone certifies nobody (POF-26)
  const noSig = pkg(c, r, [m], { kind: 1, value: 'someanon', proof: link, relay: true, controller: ctl.owner }); delete noSig.subject.controllerProof;
  await code(c.verifier.attest(noSig), 'BAD_CONTROLLER_PROOF');
  const wrongSig = pkg(c, r, [m], { kind: 1, value: 'someanon', proof: link, relay: true, controller: ctl.owner }); wrongSig.subject.controllerProof = hex(r.wallet.sign(Buffer.from('x')));
  await code(c.verifier.attest(wrongSig), 'BAD_CONTROLLER_PROOF');
  const unbound = c.verifier.linkToken('someanon', Math.floor(Date.now() / 1000) + 600);
  assert.equal(c.verifier.checkLinkToken('someanon', unbound), null);
  await code(Promise.resolve().then(() => c.verifier.checkLinkToken('someanon', unbound, ctl.owner)), 'LINK_UNBOUND');
});

test('badge subject: signed by the badge key', async () => {
  const c = makeCtx(); const r = ring(); c.rings.register(r); const badge = ring();
  const n = c.rings.note(r, 2n * SOL);
  const s = c.rings.slotNow;
  const out = await c.verifier.attest(pkg(c, r, [n], { kind: 2, value: badge.owner, subjectSigner: badge.wallet, relay: true, slot: s }));
  await code(c.verifier.attest(pkg(c, r, [c.rings.note(r, 2n * SOL)], { kind: 2, value: badge.owner, subjectSigner: r.wallet, relay: true, slot: s })), 'BAD_SUBJECT_PROOF');
  assert.equal(out.subjectHash, hex(V.subjectHash(2, badge.owner)));
});

test('one note backs one live certificate; the same subject may renew', async () => {
  const c = makeCtx(); const r = ring(); c.rings.register(r);
  const n = c.rings.note(r, 2n * SOL);
  await c.verifier.attest(pkg(c, r, [n]));
  await c.verifier.attest(pkg(c, r, [n]));          // same subject, same asset: allowed
  const link = c.verifier.linkToken('whale', Math.floor(Date.now() / 1000) + 600);
  await code(c.verifier.attest(pkg(c, r, [n], { kind: 1, value: 'whale', proof: link, relay: true })), 'NOTE_IN_USE');
  // once the certify window passes with no certificate on chain, the note is free again
  c.rings.slotNow += 10_000n; c.rings.headSlot = c.rings.slotNow - 5n;
  const s = c.rings.slotNow;
  await c.verifier.attest(pkg(c, r, [n], { kind: 1, value: 'whale', proof: link, relay: true, slot: s }));
});

test('USDC tiers use 6 decimals and the USDC mint', async () => {
  const c = makeCtx(); const r = ring(); c.rings.register(r);
  const n = c.rings.note(r, 1_000n * 1_000_000n, { asset: V.ASSETS[1].mint });
  const out = await c.verifier.attest(pkg(c, r, [n], { asset: 1, tier: 2 }));
  assert.equal(V.decodeAttestation(Buffer.from(out.attestation, 'hex')).asset, 1);
  await code(c.verifier.attest(pkg(c, r, [c.rings.note(r, 999n * 1_000_000n, { asset: V.ASSETS[1].mint })], { asset: 1, tier: 2 })), 'BELOW_TIER');
});

test('the wallet subject signature passes as base58 too', async () => {
  const c = makeCtx(); const r = ring(); c.rings.register(r);
  const p = pkg(c, r, [c.rings.note(r, 2n * SOL)]);
  p.ring.proof = V.toB58(Buffer.from(p.ring.proof, 'hex'));
  assert.ok(p.ring.proof.length > 64);
  const out = await c.verifier.attest(p);
  assert.equal(out.subjectHash, hex(V.subjectHash(0, r.owner)));
});

test('a Rings write between the slot read and the tree read does not refuse (issued at the later read)', async () => {
  const c = makeCtx(); const r = ring(); c.rings.register(r);
  const n = c.rings.note(r, 2n * SOL);
  const th = c.rings.treeHead.bind(c.rings);
  c.rings.treeHead = async (t) => { const h = await th(t); return { ...h, headSlot: c.rings.slotNow + 3n, slot: c.rings.slotNow + 4n }; };
  const out = await c.verifier.attest(pkg(c, r, [n]));
  const a = V.decodeAttestation(Buffer.from(out.attestation, 'hex'));
  assert.ok(a.rootSlot <= a.issuedSlot); assert.equal(a.issuedSlot, c.rings.slotNow + 4n);
});
