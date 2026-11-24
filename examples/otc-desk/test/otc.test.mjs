// The OTC desk on a local validator: an order is taken only with a live certificate of at least 100 SOL whose
// controller signs; a stale order can be closed by anyone once the certificate is revoked.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { makePof, sha256 as psha } from "../../../program/js/pof.mjs";
import * as sdk from "../../../sdk/dist/index.js";

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../sdk/package.json"));
const web3 = require("@solana/web3.js");
const { Connection, Keypair, Transaction, PublicKey, LAMPORTS_PER_SOL, ComputeBudgetProgram, TransactionInstruction, SystemProgram } = web3;
const RPC = process.env.POF_LOCAL_RPC;
const skip = !RPC && "set POF_LOCAL_RPC (run examples/otc-desk/test/run.sh)";
const IDL = JSON.parse(fs.readFileSync(new URL("../idl/otc_desk.json", import.meta.url), "utf8"));
const DESK = new PublicKey(IDL.address);

let conn, X, verifier, alice, bob, mallory;

async function send(ixs, signers) {
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...ixs);
  tx.feePayer = signers[0].publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  tx.sign(...signers);
  try {
    const sig = await conn.sendRawTransaction(tx.serialize());
    await conn.confirmTransaction(sig, "confirmed");
    return sig;
  } catch (e) {
    throw new Error(`${e.message} ${X.reason(e.logs ?? e.transactionLogs ?? [])}`);
  }
}
const secretDer = (kp) => crypto.createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), kp.secretKey.subarray(0, 32)]), format: "der", type: "pkcs8" });

async function certifyWallet(kp, tier) {
  const value = kp.publicKey.toBase58();
  const subjectHash = psha(Buffer.from("pof:wallet:" + value));
  const slot = await conn.getSlot("confirmed");
  const att = {
    subject_kind: 0, subject_hash: subjectHash, asset: 0, tier, tree_root: crypto.randomBytes(32), root_slot: BigInt(slot - 5),
    null_hashes: [crypto.randomBytes(32)], issued_slot: BigInt(slot), expiry_slot: BigInt(slot + 200_000), controller: kp.publicKey, nonce: crypto.randomBytes(16),
  };
  const bytes = X.attestationBytes(att, kp.publicKey);
  void secretDer;
  await send([X.signIx(verifier, bytes), X.P.ix("certify", { att, log_index: 0n }, { payer: kp.publicKey, certificate: X.certPda(subjectHash, 0), prior_payer: null, holder_token: kp.publicKey })], [kp]);
  return subjectHash;
}

/** place_order built from the example's IDL with @pof/sdk's IDL encoder and account resolver. */
async function placeOrder(trader, subjectOwner, orderId, side = "Buy") {
  const subjectHash = await sdk.subjectHash(sdk.walletSubject(subjectOwner.publicKey.toBase58()));
  const { certificate } = await sdk.requireCertificateAccounts({ subject: subjectHash, asset: "SOL", minTier: 3 });
  const id = Buffer.alloc(8); id.writeBigUInt64LE(BigInt(orderId));
  const [order] = PublicKey.findProgramAddressSync([Buffer.from("order"), trader.publicKey.toBuffer(), id], DESK);
  const [pofConfig] = await sdk.configAddress();
  const keys = sdk.resolveAccounts(IDL, "place_order", { trader: trader.publicKey.toBase58(), certificate, pof_config: pofConfig, order: order.toBase58(), pof_program: sdk.POF_PROGRAM_ID, system_program: SystemProgram.programId.toBase58() });
  const data = sdk.encodeInstruction(IDL, "place_order", { subject_hash: subjectHash, order_id: BigInt(orderId), side: { kind: side }, amount: 250n * 10n ** 9n, price: 150_000_000n });
  await send([new TransactionInstruction({ programId: DESK, keys: keys.map((k) => ({ ...k, pubkey: new PublicKey(k.pubkey) })), data: Buffer.from(data) })], [trader]);
  return { order, certificate };
}

before(async () => {
  if (skip) return;
  conn = new Connection(RPC, "confirmed");
  X = makePof(web3);
  const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.POF_AUTHORITY, "utf8"))));
  verifier = Keypair.generate();
  alice = Keypair.generate(); // 100+ SOL certificate
  bob = Keypair.generate(); // 10+ SOL certificate
  mallory = Keypair.generate(); // no certificate
  for (const k of [admin, alice, bob, mallory]) await conn.confirmTransaction(await conn.requestAirdrop(k.publicKey, 10 * LAMPORTS_PER_SOL), "confirmed");
  await send([X.P.ix("init_config", { verifier: verifier.publicKey, relayer: admin.publicKey, dev: admin.publicKey }, { admin: admin.publicKey, program_data: X.K.programData })], [admin]);
  await certifyWallet(alice, 3);
  await certifyWallet(bob, 2);
});

test("a trader with a live ≥ 100 SOL certificate places an order; the order records the certificate", { skip }, async () => {
  const { order, certificate } = await placeOrder(alice, alice, 1);
  const acc = await conn.getAccountInfo(order);
  assert.ok(acc);
  assert.equal(acc.owner.toBase58(), DESK.toBase58());
  const o = sdk.decodeAccount(IDL, "Order", acc.data);
  assert.equal(o.trader, alice.publicKey.toBase58());
  assert.equal(o.certificate, certificate);
  assert.equal(o.tier, 3);
  assert.equal(o.amount, 250n * 10n ** 9n);
});

test("refused: a certificate below tier 3, no certificate, and someone else's certificate", { skip }, async () => {
  await assert.rejects(placeOrder(bob, bob, 1), /TierTooLow/);
  await assert.rejects(placeOrder(mallory, mallory, 1), /BadCertificate|AccountNotInitialized|account/i);
  await assert.rejects(placeOrder(mallory, alice, 2), /NotYourCertificate/);
});

test("expire_order: refused while the certificate passes, allowed by anyone once it is revoked", { skip }, async () => {
  const { order, certificate } = await placeOrder(alice, alice, 7, "Sell");
  const [pofConfig] = await sdk.configAddress();
  const expire = (caller) => {
    const keys = sdk.resolveAccounts(IDL, "expire_order", { caller: caller.publicKey.toBase58(), order: order.toBase58(), trader: alice.publicKey.toBase58(), certificate, pof_config: pofConfig });
    return send([new TransactionInstruction({ programId: DESK, keys: keys.map((k) => ({ ...k, pubkey: new PublicKey(k.pubkey) })), data: Buffer.from(sdk.encodeInstruction(IDL, "expire_order", {})) })], [caller]);
  };
  await assert.rejects(expire(mallory), /CertificateStillLive/);
  await send([X.P.ix("revoke_by_holder", {}, { controller: alice.publicKey, certificate: new PublicKey(certificate) })], [alice]);
  await expire(mallory);
  assert.equal(await conn.getAccountInfo(order), null);
});
