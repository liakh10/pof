import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import * as sdk from "../../sdk/dist/index.js";
import { makeWorld, makeLog, startChainServer, rand } from "../../api/v1/_test/fixtures.mjs";
import { main } from "../pof.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(here, "..", "pof.js");
const exec = promisify(execFile);
let w, log, chain, loggedCert;

/** A certificate whose on-chain bytes are exactly those of log leaf 3 (what a real certify leaves behind). */
async function certificateFromLeaf(rpc, leafBytes, index) {
  const l = sdk.parseLeaf(leafBytes);
  const a = l.attestation;
  const hash = sdk.fromHex(a.subjectHash);
  const [addr, bump] = await sdk.certificateAddress(hash, a.asset);
  rpc.put(addr, sdk.POF_PROGRAM_ID, sdk.encodeAccountPartial(sdk.POF_IDL, "Certificate", {
    subject_kind: a.subjectKind, subject_hash: hash, asset: a.asset, tier: a.tier, status: 0, certified_slot: a.issuedSlot, issued_slot: a.issuedSlot,
    expiry_slot: a.expirySlot, tree_root: sdk.fromHex(a.treeRoot), root_slot: a.rootSlot, note_count: a.noteCount, nullset_hash: sdk.fromHex(a.nullsetHash),
    payer: a.payer, controller: a.controller, verifier: l.verifierKey, nonce: sdk.fromHex(a.nonce), log_index: index, revealed_index: 255, bump,
  }));
  return { addr, subjectHash: a.subjectHash };
}

before(async () => {
  w = await makeWorld();
  log = await makeLog(6);
  await w.rpc.putConfig({ verifier: log.verifierKey });
  loggedCert = await certificateFromLeaf(w.rpc, log.leaves[3], 3);
  const root5 = sdk.toHex(await sdk.merkleRoot(log.hashes.slice(0, 5)));
  await w.rpc.putTreasury({ live: 4, certified: 6, log_size: 5, log_head: sdk.fromHex(root5), log_slot: 4800 });
  chain = await startChainServer(w.rpc, log);
});
after(() => chain.close());

const run = async (args) => {
  try {
    const r = await exec(process.execPath, [bin, ...args, "--rpc", chain.url, "--log", chain.logUrl]);
    return { code: 0, out: r.stdout, err: r.stderr };
  } catch (e) {
    return { code: e.code, out: e.stdout, err: e.stderr };
  }
};

test("pof check: yes, no with the reason, a gate threshold, JSON, and exit codes", async () => {
  let r = await run(["check", "@anon"]);
  assert.equal(r.code, 0);
  assert.match(r.out, /@anon {2}YES/);
  assert.match(r.out, /≥ 10,000 SOL\s+LIVE/);
  r = await run(["check", w.whale, "--asset", "SOL", "--min-tier", "5"]);
  assert.equal(r.code, 1);
  assert.match(r.out, /NO \(needs ≥ 10,000 SOL: below_tier\)/);
  r = await run(["check", w.spent]);
  assert.equal(r.code, 1);
  assert.match(r.out, /REVOKED_SPENT\s+at slot 4500/);
  r = await run(["check", rand(), "--json"]);
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(r.out).reason, "no_certificate");
  r = await run(["check", "!!bad"]);
  assert.equal(r.code, 2);
  r = await run(["check", "@anon", "--min-tier", "3"]);
  assert.equal(r.code, 2);
  assert.match(r.err, /--min-tier needs --asset/);
});

test("pof check --verify-log: the certificate is tied to the signed log entry by its bytes, not by its index", async () => {
  let r = await run(["check", `hash:${loggedCert.subjectHash}`, "--verify-log"]);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /log entry 3: verified, holds this certificate's signed attestation/);
  // a certificate whose log index points at another entry
  r = await run(["check", "@anon", "--verify-log"]);
  assert.equal(r.code, 1);
  assert.match(r.out, /NOT verified \(.*nonce/);
});

test("pof rooms, config, stats", async () => {
  let r = await run(["rooms", w.room]);
  assert.equal(r.code, 0);
  assert.match(r.out, /1 of 2 members live/);
  assert.match(r.out, /evictable .* revoked_spent/);
  r = await run(["rooms"]);
  assert.match(r.out, /"whales"/);
  r = await run(["config"]);
  assert.match(r.out, new RegExp(`verifier ${log.verifierKey}`));
  r = await run(["stats"]);
  assert.match(r.out, /4 live/);
});

test("pof log head | proof | verify, against keys and the anchor from chain", async () => {
  let r = await run(["log", "head"]);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /is listed in the program's Config/);
  assert.match(r.out, /anchored on chain: size 5/);
  r = await run(["log", "proof", "3", "--certificate", loggedCert.addr]);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /VERIFIED/);
  assert.match(r.out, /matches/);
  r = await run(["log", "proof", "2", "--certificate", loggedCert.addr]);
  assert.equal(r.code, 1);
  assert.match(r.out, /does NOT match/);
  r = await run(["log", "verify"]);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /log size 6: VERIFIED/);
  assert.match(r.out, /anchor on chain: size 5 at slot 4800: matches the log/);
  // the program lists another key: everything the log signed fails
  await w.rpc.putConfig({ verifier: rand() });
  r = await run(["log", "verify"]);
  assert.equal(r.code, 1);
  assert.match(r.out, /head signed by a listed key: false/);
  r = await run(["log", "head"]);
  assert.equal(r.code, 1);
  assert.match(r.out, /is NOT listed/);
  await w.rpc.putConfig({ verifier: log.verifierKey });
});

test("pof watch prints the state, then each change: tier up, revoked with its slot, closed", async () => {
  const subject = sdk.walletSubject(rand());
  await w.rpc.putCertificate({ subject, asset: 0, tier: 2, expirySlot: 9000 });
  const lines = [];
  const steps = [
    async () => w.rpc.putCertificate({ subject, asset: 0, tier: 3, expirySlot: 9000 }),
    async () => {},
    async () => w.rpc.putCertificate({ subject, asset: 0, tier: 3, status: 1, revokedSlot: 5001, expirySlot: 9000 }),
    async () => {
      const [a] = await sdk.certificateAddress(await sdk.subjectHash(subject), 0);
      w.rpc.accounts.delete(a);
    },
  ];
  let i = 0;
  const code = await main(["watch", `wallet:${subject.value}`, "--rpc", chain.url, "--max-events", "4"], {
    out: (s) => lines.push(s), err: () => {}, env: {}, fetch,
    sleep: async () => { if (steps[i]) await steps[i++](); },
  });
  assert.equal(code, 0);
  assert.equal(lines.length, 4);
  assert.match(lines[0], /now .*≥ 10 SOL\s+LIVE/);
  assert.match(lines[1], /changed .*≥ 100 SOL\s+LIVE/);
  assert.match(lines[2], /REVOKED .*at slot 5001/);
  assert.match(lines[3], /closed/);
});
