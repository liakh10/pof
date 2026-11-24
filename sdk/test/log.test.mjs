import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import * as sdk from "../dist/index.js";

const H = (...p) => new Uint8Array(crypto.createHash("sha256").update(Buffer.concat(p.map((x) => Buffer.from(x)))).digest());

// Reference RFC 9162 implementation, written independently of the SDK (sync node:crypto).
function mth(leaves) {
  if (leaves.length === 0) return H(Buffer.alloc(0));
  if (leaves.length === 1) return H([0], leaves[0]);
  let k = 1; while (k * 2 < leaves.length) k *= 2;
  return H([1], mth(leaves.slice(0, k)), mth(leaves.slice(k)));
}
function subproof(m, D, b) {
  const n = D.length;
  if (m === n) return b ? [] : [mth(D)];
  let k = 1; while (k * 2 < n) k *= 2;
  if (m <= k) return [...subproof(m, D.slice(0, k), b), mth(D.slice(k))];
  return [...subproof(m - k, D.slice(k), false), mth(D.slice(0, k))];
}
const leafData = (i) => { const b = Buffer.alloc(377); b[0] = 1; b.writeUInt32LE(i, 1); return new Uint8Array(b); };

test("inclusion proofs verify for every index of trees 1..33, and fail when tampered", async () => {
  for (let n = 1; n <= 33; n++) {
    const leaves = Array.from({ length: n }, (_, i) => leafData(i));
    const hashes = await Promise.all(leaves.map((l) => sdk.leafHash(l)));
    const root = await sdk.merkleRoot(hashes);
    assert.deepEqual(Buffer.from(root), Buffer.from(mth(leaves)), `root n=${n}`);
    for (let i = 0; i < n; i++) {
      const path = await sdk.inclusionPath(i, hashes);
      assert.equal(await sdk.verifyInclusion({ leafHash: hashes[i], index: i, treeSize: n, path, rootHash: root }), true, `n=${n} i=${i}`);
      if (n > 1) {
        assert.equal(await sdk.verifyInclusion({ leafHash: hashes[(i + 1) % n], index: i, treeSize: n, path, rootHash: root }), false);
        const bad = path.map((p, j) => (j === 0 ? H(p) : p));
        assert.equal(await sdk.verifyInclusion({ leafHash: hashes[i], index: i, treeSize: n, path: bad, rootHash: root }), false);
        // (a path alone does not bind the tree size for left-side leaves; the signed tree head binds size and root together)
        assert.equal(await sdk.verifyInclusion({ leafHash: hashes[i], index: i, treeSize: n, path: path.slice(1), rootHash: root }), false);
      }
    }
  }
  assert.equal(await sdk.verifyInclusion({ leafHash: "00".repeat(32), index: 3, treeSize: 3, path: [], rootHash: "00".repeat(32) }), false);
  assert.deepEqual(Buffer.from(await sdk.merkleRoot([])), Buffer.from(H(Buffer.alloc(0))));
});

test("consistency proofs verify for every pair of sizes up to 20", async () => {
  const leaves = Array.from({ length: 20 }, (_, i) => leafData(i));
  for (let n2 = 1; n2 <= 20; n2++) {
    for (let n1 = 1; n1 <= n2; n1++) {
      const D = leaves.slice(0, n2);
      const proof = n1 === n2 ? [] : subproof(n1, D, true);
      const root1 = mth(leaves.slice(0, n1));
      const root2 = mth(D);
      assert.equal(await sdk.verifyConsistency({ size1: n1, size2: n2, root1, root2, proof }), true, `${n1}->${n2}`);
      if (n1 < n2) assert.equal(await sdk.verifyConsistency({ size1: n1, size2: n2, root1: H(root1), root2, proof }), false);
    }
  }
});

test("signed tree heads and full log entries verify (CONTRACT §7)", async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "jwk" }).x;
  const vkBytes = Buffer.from(raw, "base64url");
  const verifierKey = sdk.encodeBase58(vkBytes);
  const att = sdk.buildAttestation({
    programId: sdk.POF_PROGRAM_ID, subjectKind: 0, subjectHash: "aa".repeat(32), asset: 0, tier: 2, treeRoot: "bb".repeat(32),
    rootSlot: 1, noteCount: 1, nullsetHash: "cc".repeat(32), issuedSlot: 2, expirySlot: 3, payer: verifierKey, controller: verifierKey, nonce: "dd".repeat(16),
  });
  const sig = crypto.sign(null, att, privateKey);
  const leaf = Buffer.concat([Buffer.from([1]), att, sig, vkBytes, Buffer.alloc(32, 7), Buffer.from(new BigUint64Array([555n]).buffer)]);
  assert.equal(leaf.length, 377);
  const parsed = sdk.parseLeaf(leaf);
  assert.equal(parsed.loggedSlot, 555);
  assert.equal(parsed.attestation.tier, 2);
  assert.equal(parsed.verifierKey, verifierKey);

  const others = Array.from({ length: 6 }, (_, i) => leafData(i));
  const all = [...others.slice(0, 4), new Uint8Array(leaf), ...others.slice(4)];
  const hashes = await Promise.all(all.map((l) => sdk.leafHash(l)));
  const root = sdk.toHex(await sdk.merkleRoot(hashes));
  const path = (await sdk.inclusionPath(4, hashes)).map(sdk.toHex);
  const msg = sdk.treeHeadMessage(sdk.POF_PROGRAM_ID, all.length, root);
  assert.equal(msg.length, 80);
  const head = { treeSize: all.length, rootHash: root, slot: 600, signature: crypto.sign(null, msg, privateKey).toString("hex"), verifierKey };
  assert.equal(await sdk.verifyTreeHead(head, sdk.POF_PROGRAM_ID), true);
  assert.equal(await sdk.verifyTreeHead({ ...head, treeSize: 8 }, sdk.POF_PROGRAM_ID), false);

  const T = [verifierKey];
  const ok = await sdk.verifyLogEntry({ leaf, index: 4, proof: { treeSize: all.length, rootHash: root, path }, head, programId: sdk.POF_PROGRAM_ID, trustedKeys: T });
  assert.equal(ok.ok, true, JSON.stringify(ok.checks));
  // POF-13: the key a leaf names about itself is never enough
  const noKeys = await sdk.verifyLogEntry({ leaf, index: 4, proof: { treeSize: all.length, rootHash: root, path }, head, trustedKeys: [] });
  assert.equal(noKeys.ok, false);
  assert.equal(noKeys.checks.keyTrusted, false);
  assert.equal(noKeys.checks.attestationSigned, true);
  const wrongIdx = await sdk.verifyLogEntry({ leaf, index: 3, proof: { treeSize: all.length, rootHash: root, path }, head, trustedKeys: T });
  assert.equal(wrongIdx.ok, false);
  assert.equal(wrongIdx.checks.included, false);
  const forged = Buffer.from(leaf); forged[71] ^= 1;
  assert.equal(parsed.attestation.controller, verifierKey);
  const f = await sdk.verifyLogEntry({ leaf: forged, index: 4, proof: { treeSize: all.length, rootHash: root, path }, trustedKeys: T });
  assert.equal(f.checks.attestationSigned, false);
  const untrusted = await sdk.verifyLogEntry({ leaf, index: 4, proof: { treeSize: all.length, rootHash: root, path }, head, trustedKeys: ["11111111111111111111111111111111"] });
  assert.equal(untrusted.checks.keyTrusted, false);
  assert.equal(untrusted.checks.headSigned, false);
});

test("consistencyProof matches the RFC 9162 reference and verifies for every pair up to 24", async () => {
  const leaves = Array.from({ length: 24 }, (_, i) => leafData(i));
  const hashes = await Promise.all(leaves.map((l) => sdk.leafHash(l)));
  for (let n2 = 1; n2 <= 24; n2++)
    for (let n1 = 1; n1 < n2; n1++) {
      const p = await sdk.consistencyProof(n1, hashes.slice(0, n2));
      assert.deepEqual(p.map((x) => Buffer.from(x).toString("hex")), subproof(n1, leaves.slice(0, n2), true).map((x) => Buffer.from(x).toString("hex")));
      assert.equal(await sdk.verifyConsistency({ size1: n1, size2: n2, root1: await sdk.merkleRoot(hashes.slice(0, n1)), root2: await sdk.merkleRoot(hashes.slice(0, n2)), proof: p }), true);
    }
  assert.deepEqual(await sdk.consistencyProof(0, hashes), []);
  await assert.rejects(sdk.consistencyProof(30, hashes));
});

test("witness cosignatures (CONTRACT §8) sign 88 bytes and verify", async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const witnessKey = sdk.encodeBase58(Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url"));
  const msg = sdk.cosignMessage(sdk.POF_PROGRAM_ID, 9, "ab".repeat(32), 1_800_000_000);
  assert.equal(msg.length, 88);
  assert.equal(Buffer.from(msg.slice(0, 8)).toString(), "POF-WIT1");
  const c = { witnessKey, treeSize: 9, rootHash: "ab".repeat(32), timestamp: 1_800_000_000, signature: crypto.sign(null, msg, privateKey).toString("hex") };
  assert.equal(await sdk.verifyCosignature(c, sdk.POF_PROGRAM_ID), true);
  assert.equal(await sdk.verifyCosignature({ ...c, timestamp: 1 }, sdk.POF_PROGRAM_ID), false);
  assert.equal(await sdk.verifyCosignature({ ...c, rootHash: "cd".repeat(32) }, sdk.POF_PROGRAM_ID), false);
});

test("auditLog downloads a log, recomputes it, and catches a bad entry, a wrong head and a mismatched anchor", async () => {
  const { makeLog } = await import("../../api/v1/_test/fixtures.mjs");
  const log = await makeLog(300); // more than one page of 256
  const reader = new sdk.LogReader(log.base, log.fetch);
  const anchorRoot = sdk.toHex(await sdk.merkleRoot(log.hashes.slice(0, 120)));
  const trustedKeys = [log.verifierKey];
  let r = await sdk.auditLog({ reader, programId: sdk.POF_PROGRAM_ID, trustedKeys, anchor: { treeSize: 120, rootHash: anchorRoot, slot: 1 } });
  assert.equal(r.ok, true, JSON.stringify(r.checks));
  assert.equal(r.checks.entriesSigned, 300);
  assert.equal(r.checks.anchorMatches, true);
  r = await sdk.auditLog({ reader, programId: sdk.POF_PROGRAM_ID, trustedKeys: [sdk.encodeBase58(crypto.randomBytes(32))] });
  assert.equal(r.checks.headSigned, false, "a head signed by a key the chain does not list fails");
  assert.equal(r.checks.entriesSigned, 0);
  r = await sdk.auditLog({ reader, programId: sdk.POF_PROGRAM_ID, trustedKeys, anchor: { treeSize: 120, rootHash: "00".repeat(32), slot: 1 } });
  assert.equal(r.checks.anchorMatches, false);
  assert.equal(r.ok, false);
  await log.append(1, { badSig: true });
  r = await sdk.auditLog({ reader, programId: sdk.POF_PROGRAM_ID, trustedKeys });
  assert.deepEqual(r.checks.entriesBad, [300]);
  await log.signHead(301, "11".repeat(32)); // a head that does not match its entries
  r = await sdk.auditLog({ reader, programId: sdk.POF_PROGRAM_ID, trustedKeys });
  assert.equal(r.checks.headSigned, true);
  assert.equal(r.checks.rootRecomputed, false);
});

test("matchCertificateLeaf ties a certificate to its leaf by the signed bytes (POF-18)", async () => {
  const { makeLog } = await import("../../api/v1/_test/fixtures.mjs");
  const log = await makeLog(2);
  const leaf = sdk.parseLeaf(log.leaves[1]);
  const a = leaf.attestation;
  const cert = { subjectHash: a.subjectHash, asset: a.asset, tier: a.tier, nullsetHash: a.nullsetHash, nonce: a.nonce, payer: a.payer, controller: a.controller, issuedSlot: a.issuedSlot, expirySlot: a.expirySlot, verifier: leaf.verifierKey };
  assert.deepEqual(sdk.matchCertificateLeaf(cert, leaf), { matches: true, mismatched: [] });
  assert.deepEqual(sdk.matchCertificateLeaf({ ...cert, tier: 5, nonce: "00".repeat(16) }, leaf).mismatched, ["tier", "nonce"]);
  assert.equal(sdk.matchCertificateLeaf(cert, sdk.parseLeaf(log.leaves[0])).matches, false);
});
