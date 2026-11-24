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
