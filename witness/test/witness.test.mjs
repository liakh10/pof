import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import * as sdk from "../../sdk/dist/index.js";
import { makeWorld, makeLog, startChainServer } from "../../api/v1/_test/fixtures.mjs";
import { Witness, signerFromSecret, checkWitnessDoc } from "../witness.js";
import { MemoryState } from "../store.js";

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));

function newSecret() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return Uint8Array.from([...Buffer.from(privateKey.export({ format: "jwk" }).d, "base64url"), ...Buffer.from(publicKey.export({ format: "jwk" }).x, "base64url")]);
}

async function setup(n = 5) {
  const w = await makeWorld();
  const log = await makeLog(n);
  await w.rpc.putConfig({ verifier: log.verifierKey });
  const state = new MemoryState();
  let t = 1_800_000_000;
  const witness = new Witness({
    reader: new sdk.LogReader(log.base, log.fetch), client: w.client, signer: signerFromSecret(newSecret()), state, name: "test", now: () => t++,
  });
  return { w, log, state, witness };
}

test("cosigns a good head, follows growth with consistency proofs, refreshes an unchanged head", async () => {
  const { log, witness } = await setup(5);
  let r = await witness.step();
  assert.equal(r.ok, true);
  assert.equal(r.cosignature.treeSize, 5);
  assert.equal(await sdk.verifyCosignature(r.cosignature, sdk.POF_PROGRAM_ID), true);
  await log.append(7);
  r = await witness.step();
  assert.equal(r.ok, true);
  assert.equal(r.cosignature.treeSize, 12);
  r = await witness.step();
  assert.equal(r.ok, true);
  assert.equal(r.doc.heads.length, 2, "an unchanged head refreshes its row");
  assert.equal(r.doc.stats.cosigned, 3);
  const chk = await checkWitnessDoc(r.doc);
  assert.deepEqual(chk, { ok: true, checked: 2, bad: [] });
  const forged = structuredClone(r.doc);
  forged.heads[1].rootHash = "00".repeat(32);
  assert.deepEqual((await checkWitnessDoc(forged)).bad, [1]);
});

test("alarms: equivocation, a shrinking log, a forked history, an unknown key, a bad signature; none is cosigned", async () => {
  const { log, witness, w } = await setup(6);
  assert.equal((await witness.step()).ok, true);
  await log.signHead(6, "ab".repeat(32));
  let r = await witness.step();
  assert.equal(r.kind, "equivocation");
  await log.signHead(4);
  r = await witness.step();
  assert.equal(r.kind, "log_shrank");
  // rewrite history: entry 2 replaced, then the log grows; the consistency proof cannot reach the head the witness holds
  log.leaves[2] = log.makeLeaf(99);
  log.hashes[2] = await sdk.leafHash(log.leaves[2]);
  await log.append(3);
  r = await witness.step();
  assert.equal(r.kind, "inconsistent");
  assert.equal(r.doc.stats.cosigned, 1);
  assert.equal(r.doc.last.treeSize, 6, "the last verified head stays");
  // a key the program does not list
  await w.rpc.putConfig({ verifier: sdk.encodeBase58(crypto.randomBytes(32)) });
  r = await witness.step();
  assert.equal(r.kind, "unknown_key");
  await w.rpc.putConfig({ verifier: log.verifierKey });
  log.sth = { ...log.sth, signature: "00".repeat(64) };
  r = await witness.step();
  assert.equal(r.kind, "bad_signature");
  assert.equal(r.doc.alarms.length, 5);
});

test("checks the head against the anchor on chain: equal, prefix, ahead, and a mismatch", async () => {
  const { log, witness, w } = await setup(8);
  const rootAt = async (k) => sdk.toHex(await sdk.merkleRoot(log.hashes.slice(0, k)));
  await w.rpc.putTreasury({ log_size: 5, log_head: sdk.fromHex(await rootAt(5)), log_slot: 4000 });
  let r = await witness.step();
  assert.equal(r.ok, true);
  assert.deepEqual({ ...r.cosignature.anchor }, { treeSize: 5, rootHash: await rootAt(5), slot: 4000, relation: "prefix", consistent: true });
  await w.rpc.putTreasury({ log_size: 8, log_head: sdk.fromHex(await rootAt(8)), log_slot: 4100 });
  r = await witness.step();
  assert.equal(r.cosignature.anchor.relation, "equal");
  // the chain saw a newer head (the log is lagging but consistent)
  await log.append(2);
  await log.signHead(8);
  await w.rpc.putTreasury({ log_size: 10, log_head: sdk.fromHex(await rootAt(10)), log_slot: 4200 });
  r = await witness.step();
  assert.equal(r.ok, true);
  assert.equal(r.cosignature.anchor.relation, "ahead");
  await w.rpc.putTreasury({ log_size: 8, log_head: crypto.randomBytes(32), log_slot: 4300 });
  r = await witness.step();
  assert.equal(r.kind, "anchor_mismatch");
});

test("keygen writes a 600 key, prints only the public key, never overwrites; run.js cosigns against a real HTTP log and RPC", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pof-witness-"));
  const file = path.join(dir, "k", "witness.json");
  const a = await run(process.execPath, [path.join(here, "..", "keygen.js"), file]);
  const secret = Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8")));
  assert.equal(secret.length, 64);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const pub = sdk.encodeBase58(secret.subarray(32));
  assert.match(a.stdout, new RegExp(`witness public key: ${pub}`));
  assert.equal(a.stdout.includes(sdk.encodeBase58(secret)), false);
  assert.equal(a.stdout.includes(JSON.stringify([...secret])), false);
  const b = await run(process.execPath, [path.join(here, "..", "keygen.js"), file]);
  assert.match(b.stdout, /exists/);
  assert.deepEqual(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))), secret);

  const w = await makeWorld();
  const log = await makeLog(4);
  await w.rpc.putConfig({ verifier: log.verifierKey });
  const chain = await startChainServer(w.rpc, log);
  const out = path.join(dir, "witness.json");
  try {
    const r = await run(process.execPath, [path.join(here, "..", "run.js"), "--log", chain.logUrl, "--rpc", chain.url, "--key", file, "--out", out, "--name", "ci"]);
    assert.match(r.stdout, /cosigned size 4/);
    const doc = JSON.parse(fs.readFileSync(out, "utf8"));
    assert.equal(doc.witness.key, pub);
    assert.equal((await checkWitnessDoc(doc)).ok, true);
  } finally {
    await chain.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("monitor: a certificate whose log entry does not hold its attestation raises unlogged_certificate", async () => {
  const w = await makeWorld();
  const log = await makeLog(6);
  await w.rpc.putConfig({ verifier: log.verifierKey });
  const witness = new Witness({ reader: new sdk.LogReader(log.base, log.fetch), client: w.client, signer: signerFromSecret(newSecret()), state: new MemoryState(), monitorCertificates: true });
  const r = await witness.step();
  assert.equal(r.ok, true, "the head itself is still cosigned");
  const bad = r.doc.alarms.filter((a) => a.kind === "unlogged_certificate");
  assert.ok(bad.length >= 1);
  assert.ok(bad[0].detail.mismatched.includes("nonce"));
  const again = await witness.step();
  assert.equal(again.doc.alarms.filter((a) => a.kind === "unlogged_certificate").length, bad.length, "each certificate is checked once");
});

async function certFromLeaf(rpc, leafBytes, logIndex, { verifier } = {}) {
  const l = sdk.parseLeaf(leafBytes);
  const a = l.attestation;
  const hash = sdk.fromHex(a.subjectHash);
  const [addr, bump] = await sdk.certificateAddress(hash, a.asset);
  rpc.put(addr, sdk.POF_PROGRAM_ID, sdk.encodeAccountPartial(sdk.POF_IDL, "Certificate", {
    subject_kind: a.subjectKind, subject_hash: hash, asset: a.asset, tier: a.tier, certified_slot: a.issuedSlot, issued_slot: a.issuedSlot,
    expiry_slot: a.expirySlot, note_count: a.noteCount, nullset_hash: sdk.fromHex(a.nullsetHash), payer: a.payer, controller: a.controller,
    verifier: verifier ?? l.verifierKey, nonce: sdk.fromHex(a.nonce), log_index: logIndex, revealed_index: 255, bump,
  }));
  return addr;
}

test("W-01: an unlogged attestation cannot hide behind log_index = u64::MAX; a misindexed one is found by its bytes; zk is skipped", async () => {
  const { MemoryRpc } = await import("../../sdk/dist/testing.js");
  const rpc = new MemoryRpc();
  rpc.slot = 10_000;
  const client = new sdk.PofClient({ rpc });
  const log = await makeLog(5);
  await rpc.putConfig({ verifier: log.verifierKey });
  const MAX = 18446744073709551615n;
  // signed by the Verifier but never appended: its leaf exists only here
  const hidden = await certFromLeaf(rpc, log.makeLeaf(77), MAX);
  // logged at 3, but certify was told 0
  const misindexed = await certFromLeaf(rpc, log.leaves[3], 0);
  // a zk certificate
  await certFromLeaf(rpc, log.makeLeaf(78), MAX, { verifier: "6q7PxLzgUtLHMfCDDHzkU4Ho54rC6b21VZmSFsD6Tsv1" });
  const witness = new Witness({ reader: new sdk.LogReader(log.base, log.fetch), client, signer: signerFromSecret(newSecret()), state: new MemoryState(), monitorCertificates: true });
  const r = await witness.step();
  const unlogged = r.doc.alarms.filter((a) => a.kind === "unlogged_certificate");
  assert.equal(unlogged.length, 1);
  assert.equal(unlogged[0].detail.certificate, hidden);
  assert.deepEqual(r.doc.notes, [{ kind: "misindexed", certificate: misindexed, claimed: 0, actual: 3 }]);
  // inside the grace period the same case waits
  rpc.slot = 300 + 1000;
  const w2 = new Witness({ reader: new sdk.LogReader(log.base, log.fetch), client, signer: signerFromSecret(newSecret()), state: new MemoryState(), monitorCertificates: true });
  const r2 = await w2.step();
  assert.equal(r2.doc.alarms.filter((a) => a.kind === "unlogged_certificate").length, 0);
  assert.equal(Object.values(r2.doc.monitored).filter((v) => v === "pending").length, 1);
});

test("W-02: a head signed by a retired key is not cosigned, even though that key signed old entries", async () => {
  const { log, witness, w } = await setup(4);
  assert.equal((await witness.step()).ok, true);
  const next = signerFromSecret(newSecret());
  await w.rpc.putConfig({ verifier: log.verifierKey, next_verifier: next.publicKey, next_verifier_slot: 4000 }); // slot 5000: rotated
  const r = await witness.step();
  assert.equal(r.kind, "unknown_key");
  assert.deepEqual(r.detail.allowed, [next.publicKey]);
});

test("W-03: gossip with other witnesses; a peer shown another log raises split_view", async () => {
  const { log, w } = await setup(6);
  const mk = (peers, fetchImpl) => new Witness({ reader: new sdk.LogReader(log.base, log.fetch), client: w.client, signer: signerFromSecret(newSecret()), state: new MemoryState(), peers, fetch: fetchImpl });
  const peer = mk([]);
  const peerDoc = (await peer.step()).doc;
  await log.append(3);
  const docs = { "https://a.test/w.json": peerDoc };
  const f = async (u) => new Response(JSON.stringify(docs[u]), { status: 200 });
  let r = await mk(["https://a.test/w.json"], f).step();
  assert.equal(r.ok, true);
  assert.equal(r.doc.peers[0].ok, true, "the peer's older head is a prefix of ours");
  // a peer that was shown a different log of the same size, with a valid cosignature over it
  const evil = await mk([]).step().then((x) => x.doc);
  const forked = structuredClone(evil);
  const secret = newSecret();
  const s = signerFromSecret(secret);
  const root = "ee".repeat(32);
  const ts = 1_800_000_000;
  forked.witness.key = s.publicKey;
  forked.latest = { witnessKey: s.publicKey, treeSize: 9, rootHash: root, timestamp: ts, signature: sdk.toHex(s.sign(sdk.cosignMessage(sdk.POF_PROGRAM_ID, 9, root, ts))) };
  forked.heads = [forked.latest];
  docs["https://b.test/w.json"] = forked;
  r = await mk(["https://b.test/w.json"], f).step();
  assert.ok(r.doc.alarms.some((a) => a.kind === "split_view"));
  // a peer document with a forged cosignature is not trusted at all
  docs["https://c.test/w.json"] = { ...forked, heads: [{ ...forked.latest, signature: "00".repeat(64) }] };
  r = await mk(["https://c.test/w.json"], f).step();
  assert.equal(r.doc.peers[0].error, "bad cosignatures");
});
