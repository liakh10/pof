// Integration on a local validator running this build of pof and pof_gate (sdk/scripts/local-chain.sh).
// The program agent's IDL builder (program/js/pof.mjs) makes the admin, certify and anchor transactions; everything a
// developer touches (reads, CPI accounts, join, the API, MCP, the bots' gate) goes through @pof/sdk and devx code.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import * as web3 from "@solana/web3.js";
import { makePof, sha256 as psha } from "../../../program/js/pof.mjs";
import * as sdk from "../../dist/index.js";

const RPC = process.env.POF_LOCAL_RPC;
const skip = !RPC && "set POF_LOCAL_RPC (run sdk/scripts/local-chain.sh)";
const { Connection, Keypair, Transaction, PublicKey, LAMPORTS_PER_SOL, ComputeBudgetProgram } = web3;

let conn, X, admin, verifier, relayer, holder, smallHolder, creator, client, room, logLeaves = [];
const xController = Keypair.generate();

async function send(ixs, signers, { simulateOnly = false } = {}) {
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...ixs);
  tx.feePayer = signers[0].publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  tx.sign(...signers);
  if (simulateOnly) return conn.simulateTransaction(tx);
  try {
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
    await conn.confirmTransaction(sig, "confirmed");
    return sig;
  } catch (e) {
    const logs = e.logs ?? e.transactionLogs ?? [];
    throw new Error(`${e.message} ${X.reason(logs)}`);
  }
}

async function airdrop(pk, sol = 10) {
  const sig = await conn.requestAirdrop(pk, sol * LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig, "confirmed");
}

/** certify through the program's own builder: the Verifier signs §3, the payer submits. */
async function certify({ kind, value, controller, asset = 0, tier, payer }) {
  const subjectHash = kind === 1 ? psha(Buffer.from("pof:x:" + value)) : psha(Buffer.from((kind === 0 ? "pof:wallet:" : "pof:badge:") + value));
  const slot = await conn.getSlot("confirmed");
  const hs = [crypto.randomBytes(32), crypto.randomBytes(32)].sort(Buffer.compare);
  const att = {
    subject_kind: kind, subject_hash: subjectHash, asset, tier, tree_root: crypto.randomBytes(32), root_slot: BigInt(slot - 5),
    null_hashes: hs, issued_slot: BigInt(slot), expiry_slot: BigInt(slot + 200_000), controller: new PublicKey(controller), nonce: crypto.randomBytes(16),
  };
  const bytes = X.attestationBytes(att, payer.publicKey);
  const sig = crypto.sign(null, bytes, crypto.createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), verifier.secretKey.subarray(0, 32)]), format: "der", type: "pkcs8" }));
  // the §7 leaf for the log this test keeps
  const slotLe = Buffer.alloc(8); slotLe.writeBigUInt64LE(BigInt(slot));
  logLeaves.push(Buffer.concat([Buffer.from([1]), bytes, sig, verifier.publicKey.toBuffer(), Buffer.alloc(32, 1), slotLe]));
  const certificate = X.certPda(subjectHash, asset);
  await send([
    X.signIx(verifier, bytes),
    X.P.ix("certify", { att, log_index: BigInt(logLeaves.length - 1) }, {
      payer: payer.publicKey, certificate, prior_payer: null, holder_token: payer.publicKey,
    }),
  ], [payer]);
  return { subjectHash, certificate: certificate.toBase58() };
}

before(async () => {
  if (skip) return;
  conn = new Connection(RPC, "confirmed");
  X = makePof(web3);
  admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.POF_AUTHORITY, "utf8"))));
  verifier = Keypair.generate();
  relayer = Keypair.generate();
  holder = Keypair.generate();
  smallHolder = Keypair.generate();
  creator = Keypair.generate();
  for (const k of [admin, relayer, holder, smallHolder, creator]) await airdrop(k.publicKey);
  await send([X.P.ix("init_config", { verifier: verifier.publicKey, relayer: relayer.publicKey, dev: admin.publicKey }, { admin: admin.publicKey, program_data: X.K.programData })], [admin]);
  client = new sdk.PofClient({ rpc: RPC });
});

test("the SDK's program ids, PDAs and Config read match the deployed programs", { skip }, async () => {
  assert.equal(sdk.POF_PROGRAM_ID, X.PID.toBase58());
  assert.equal(sdk.POF_GATE_PROGRAM_ID, X.GATE.toBase58());
  assert.equal((await sdk.configAddress())[0], X.K.config.toBase58());
  assert.equal((await sdk.treasuryAddress())[0], X.K.treasury.toBase58());
  const c = await client.getConfig();
  assert.equal(c.activeVerifier, verifier.publicKey.toBase58());
  // the launch build has no zk path: no zk config PDA, no zk instructions in the IDL the SDK decodes with
  assert.equal(await client.zkEnabled(), false);
  assert.equal(sdk.POF_IDL.instructions.some((i) => i.name.includes("zk")), false);
  assert.equal(c.relayer, relayer.publicKey.toBase58());
  assert.equal(c.feeLamports, 10_000_000);
  for (const a of [0, 1]) for (let t = 1; t <= 5; t++)
    assert.equal(BigInt(c.assets[a].mins[t - 1]), BigInt(sdk.tierMinimum(a, t)) * 10n ** BigInt(sdk.ASSETS[a].decimals), `asset ${a} tier ${t}`);
});

test("certificates certified on chain read back through the SDK: wallet and @handle", { skip }, async () => {
  const w = await certify({ kind: 0, value: holder.publicKey.toBase58(), controller: holder.publicKey, tier: 3, payer: holder });
  const x = await certify({ kind: 1, value: "localwhale", controller: xController.publicKey, tier: 5, payer: relayer });
  await certify({ kind: 0, value: smallHolder.publicKey.toBase58(), controller: smallHolder.publicKey, tier: 1, payer: smallHolder });

  const r = await client.lookup(holder.publicKey.toBase58());
  assert.equal(r.certificates.length, 1);
  const c = r.certificates[0];
  assert.equal(c.address, w.certificate);
  assert.equal(c.live, true);
  assert.equal(c.tierLabel, "≥ 100 SOL");
  assert.equal(c.subjectKindName, "wallet");
  assert.equal(c.controller, holder.publicKey.toBase58());
  assert.equal(c.verifier, verifier.publicKey.toBase58());
  assert.equal(c.payer, holder.publicKey.toBase58());
  assert.equal(c.noteCount, 2);
  assert.equal(c.revealed, null);

  const h = await client.lookup("@LocalWhale");
  assert.equal(h.certificates[0].address, x.certificate);
  assert.equal(h.certificates[0].controller, xController.publicKey.toBase58());
  assert.equal((await client.checkProofOfFunds({ subject: "@localwhale", asset: "SOL", minTier: 5 })).ok, true);
  assert.equal((await client.checkProofOfFunds({ subject: holder.publicKey.toBase58(), asset: "SOL", minTier: 4 })).reason, "below_tier");

  const all = await client.listCertificates({ asset: 0 });
  assert.equal(all.certificates.length, 3);
  assert.equal((await client.listCertificates({ tier: 5 })).certificates.length, 1);
  assert.equal((await client.listCertificates({ subjectKind: 1 })).certificates.length, 1);
  const s = await client.stats();
  assert.equal(s.live, 3);
  assert.equal(s.total, 3);
  assert.equal(s.treasury.live, 3);
  assert.equal(BigInt(s.treasury.liveMin[0]), (100n + 10_000n + 1n) * 10n ** 9n);
});

test("require_certificate: the SDK's accounts and data pass the program's CPI gate, and it refuses below tier", { skip }, async () => {
  const subject = sdk.walletSubject(holder.publicKey.toBase58());
  const ok = await sdk.requireCertificateAccounts({ subject, asset: "SOL", minTier: 3 });
  const ix = (r) => new web3.TransactionInstruction({
    programId: new PublicKey(r.programId), data: Buffer.from(r.data),
    keys: r.accounts.slice(0, -1).map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })),
  });
  let sim = await send([ix(ok)], [holder], { simulateOnly: true });
  assert.equal(sim.value.err, null, JSON.stringify(sim.value.logs));
  const ret = Buffer.from(sim.value.returnData.data[0], "base64");
  // CertView { subject_kind u8, tier u8, expiry_slot u64, controller pubkey }
  assert.equal(ret[0], 0);
  assert.equal(ret[1], 3);
  assert.equal(sdk.encodeBase58(ret.subarray(10, 42)), holder.publicKey.toBase58());
  const low = await sdk.requireCertificateAccounts({ subject, asset: "SOL", minTier: 4 });
  sim = await send([ix(low)], [holder], { simulateOnly: true });
  assert.notEqual(sim.value.err, null);
  assert.match(X.reason(sim.value.logs), /TierTooLow/);
});

test("pof_gate: create a room, join with the SDK-built instruction, read members, refuse a small holder", { skip }, async () => {
  const name = Buffer.alloc(32); name.write("local whales");
  room = X.roomPda(creator.publicKey, 1n);
  await send([X.G.ix("create_room", { id: 1n, asset: 0, min_tier: 2, name }, { creator: creator.publicKey, room, pof_config: X.K.config })], [creator]);
  assert.equal((await sdk.roomAddress(creator.publicKey.toBase58(), 1))[0], room.toBase58());

  const join = await sdk.joinRoomInstruction({ room: room.toBase58(), asset: 0, subject: sdk.walletSubject(holder.publicKey.toBase58()), payer: holder.publicKey.toBase58() });
  await send([sdk.toWeb3Instruction(join, web3)], [holder]);
  const xjoin = await sdk.joinRoomInstruction({
    room: room.toBase58(), asset: 0, subject: sdk.xSubject("localwhale"), payer: relayer.publicKey.toBase58(), controller: xController.publicKey.toBase58(),
  });
  await send([sdk.toWeb3Instruction(xjoin, web3)], [relayer, xController]);

  const small = await sdk.joinRoomInstruction({ room: room.toBase58(), asset: 0, subject: sdk.walletSubject(smallHolder.publicKey.toBase58()), payer: smallHolder.publicKey.toBase58() });
  await assert.rejects(send([sdk.toWeb3Instruction(small, web3)], [smallHolder]), /TierTooLow/);

  const r = await client.getRoomWithMembers(room.toBase58());
  assert.equal(r.room.name, "local whales");
  assert.equal(r.room.minTierLabel, "≥ 10 SOL");
  assert.equal(r.room.memberCount, 2);
  assert.equal(r.members.length, 2);
  assert.ok(r.members.every((m) => m.live));
  assert.equal((await client.listRooms()).length, 1);
});

test("revoke_by_holder flips the status everywhere; anyone can then evict the member", { skip }, async () => {
  const subject = sdk.walletSubject(holder.publicKey.toBase58());
  const [cert] = await sdk.certificateAddress(await sdk.subjectHash(subject), 0);
  await send([X.P.ix("revoke_by_holder", {}, { controller: holder.publicKey, certificate: new PublicKey(cert) })], [holder]);
  const c = await client.getCertificate(subject, 0);
  assert.equal(c.statusName, "revoked_by_holder");
  assert.equal(c.live, false);
  assert.ok(c.revokedSlot > 0);
  assert.equal((await client.checkProofOfFunds({ subject: holder.publicKey.toBase58(), asset: 0, minTier: 1 })).reason, "revoked_by_holder");
  let r = await client.getRoomWithMembers(room.toBase58());
  const m = r.members.find((x) => !x.live);
  assert.equal(m.certificateStatus, "revoked_by_holder");
  const ev = await sdk.evictMemberInstruction({ room: room.toBase58(), member: m.address, payer: holder.publicKey.toBase58(), certificate: cert, caller: smallHolder.publicKey.toBase58() });
  await send([sdk.toWeb3Instruction(ev, web3)], [smallHolder]);
  r = await client.getRoomWithMembers(room.toBase58());
  assert.equal(r.members.length, 1);
  const s = await client.stats();
  assert.equal(s.revokedByHolder, 1);
  assert.equal(s.live, 2);
});

test("anchor_log: the head the SDK computes is anchored on chain, and its signature and inclusion proofs verify", { skip }, async () => {
  const hashes = await Promise.all(logLeaves.map((l) => sdk.leafHash(l)));
  const root = await sdk.merkleRoot(hashes);
  const msg = sdk.treeHeadMessage(sdk.POF_PROGRAM_ID, hashes.length, root);
  assert.deepEqual(Buffer.from(msg), X.sthBytes(hashes.length, root));
  await send([X.signIx(verifier, msg), X.P.ix("anchor_log", { size: BigInt(hashes.length), head: Buffer.from(root) }, { caller: relayer.publicKey })], [relayer]);
  const t = await client.getTreasury();
  assert.deepEqual({ treeSize: t.log.treeSize, rootHash: t.log.rootHash }, { treeSize: hashes.length, rootHash: sdk.toHex(root) });
  const sig = crypto.sign(null, msg, crypto.createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), verifier.secretKey.subarray(0, 32)]), format: "der", type: "pkcs8" }));
  const head = { treeSize: hashes.length, rootHash: sdk.toHex(root), signature: sig.toString("hex"), verifierKey: verifier.publicKey.toBase58() };
  for (let i = 0; i < logLeaves.length; i++) {
    const path = (await sdk.inclusionPath(i, hashes)).map(sdk.toHex);
    const v = await sdk.verifyLogEntry({ leaf: logLeaves[i], index: i, proof: { treeSize: hashes.length, rootHash: head.rootHash, path }, head, programId: sdk.POF_PROGRAM_ID, trustedKeys: (await client.verifierKeys({ history: true })).all });
    assert.equal(v.ok, true, JSON.stringify(v.checks));
  }
  // the keys come from chain: the Config and the VerifierSet event that init_config emitted
  const k = await client.verifierKeys({ history: true });
  assert.deepEqual(k.all, [verifier.publicKey.toBase58()]);
  assert.equal(k.fromHistory, true);
});

test("the /v1 API, the MCP tools and the bots' gate read the same local chain", { skip }, async () => {
  const { handleV1 } = await import("../../../api/v1/_core.js");
  const { setClient, clearMemo } = await import("../../../api/v1/_lib.js");
  setClient(null);
  clearMemo();
  const env = { SOLANA_RPC: RPC };
  const get = async (p, q = {}) => JSON.parse((await handleV1({ method: "GET", path: p, query: q, env })).body);
  let r = await get("certificates/@localwhale", { asset: "SOL", minTier: "5" });
  assert.equal(r.check.ok, true);
  assert.equal(r.certificates[0].controller, xController.publicKey.toBase58());
  r = await get(`certificates/${holder.publicKey.toBase58()}`);
  assert.equal(r.certificates[0].status, "revoked_by_holder");
  r = await get("stats");
  assert.equal(r.live, 2);
  assert.equal(r.solCertified, 10_001);
  r = await get("config");
  assert.equal(r.verifier, verifier.publicKey.toBase58());
  assert.equal(r.assets[0].tiers[3].label, "≥ 1,000 SOL");
  r = await get(`rooms/${room.toBase58()}`);
  assert.equal(r.liveMembers, 1);

  const { callTool } = await import("../../../mcp/tools.js");
  const { chainBackend } = await import("../../../mcp/core.js");
  const t = await callTool("check_proof_of_funds", { subject: "@localwhale", asset: "SOL", min_amount: 10_000 }, await chainBackend(env));
  assert.match(t.text, /^YES:/);

  const { evaluate } = await import("../../../bots/gate.js");
  const roomInfo = await client.getRoom(room.toBase58());
  const ok = await evaluate(client, roomInfo, { kind: 1, value: "localwhale" });
  assert.equal(ok.ok, true);
  const no = await evaluate(client, roomInfo, { kind: 0, value: holder.publicKey.toBase58() });
  assert.equal(no.reason, "revoked_by_holder");
});

test("revoke_verifier_key: the SDK reads every certificate it signed as voided at once; void_by_key writes status 4", { skip }, async () => {
  const fresh = Keypair.generate();
  await airdrop(fresh.publicKey);
  const c = await certify({ kind: 0, value: fresh.publicKey.toBase58(), controller: fresh.publicKey, tier: 2, payer: fresh });
  assert.equal((await client.checkProofOfFunds({ subject: fresh.publicKey.toBase58(), asset: 0, minTier: 1 })).ok, true);
  await send([X.P.ix("revoke_verifier_key", { key: verifier.publicKey }, { admin: admin.publicKey })], [admin]);
  const cfg = await client.getConfig();
  assert.ok(cfg.revokedKeys.includes(verifier.publicKey.toBase58()));
  let r = await client.checkProofOfFunds({ subject: fresh.publicKey.toBase58(), asset: 0, minTier: 1 });
  assert.equal(r.reason, "voided", "voided before anyone calls void_by_key");
  assert.equal(r.certificate.statusName, "live");
  // the program agrees: require_certificate refuses it
  const req = await sdk.requireCertificateAccounts({ subject: sdk.walletSubject(fresh.publicKey.toBase58()), asset: 0, minTier: 1 });
  const ix = new web3.TransactionInstruction({ programId: new PublicKey(req.programId), data: Buffer.from(req.data), keys: req.accounts.slice(0, -1).map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })) });
  const sim = await send([ix], [fresh], { simulateOnly: true });
  assert.match(X.reason(sim.value.logs), /KeyRevoked/);
  await send([X.P.ix("void_by_key", {}, { caller: fresh.publicKey, certificate: new PublicKey(c.certificate) })], [fresh]);
  r = await client.checkProofOfFunds({ subject: fresh.publicKey.toBase58(), asset: 0, minTier: 1 });
  assert.equal(r.certificate.statusName, "voided");
  const k = await client.verifierKeys({ history: true, fromCertificates: true });
  assert.equal(k.all.includes(verifier.publicKey.toBase58()), false);
  assert.equal(k.active, null, "the revoked key is still the Config's verifier, and signs nothing");
  const s = await client.stats();
  assert.ok(s.voided >= 1);
});
