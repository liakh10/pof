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

  const ok = await sdk.verifyLogEntry({ leaf, index: 4, proof: { treeSize: all.length, rootHash: root, path }, head, programId: sdk.POF_PROGRAM_ID });
  assert.equal(ok.ok, true, JSON.stringify(ok.checks));
  const wrongIdx = await sdk.verifyLogEntry({ leaf, index: 3, proof: { treeSize: all.length, rootHash: root, path }, head });
  assert.equal(wrongIdx.ok, false);
  assert.equal(wrongIdx.checks.included, false);
  const forged = Buffer.from(leaf); forged[71] ^= 1;
  assert.equal(parsed.attestation.controller, verifierKey);
  const f = await sdk.verifyLogEntry({ leaf: forged, index: 4, proof: { treeSize: all.length, rootHash: root, path } });
  assert.equal(f.checks.attestationSigned, false);
  const untrusted = await sdk.verifyLogEntry({ leaf, index: 4, proof: { treeSize: all.length, rootHash: root, path }, head, trustedKeys: ["11111111111111111111111111111111"] });
  assert.equal(untrusted.checks.headSigned, false);
});
