import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import * as sdk from "../dist/index.js";
import { MemoryRpc } from "../dist/testing.js";

async function world() {
  const rpc = new MemoryRpc();
  rpc.slot = 5000;
  const whale = Keypair.generate().publicKey.toBase58();
  const badge = Keypair.generate().publicKey.toBase58();
  const spent = Keypair.generate().publicKey.toBase58();
  await rpc.putCertificate({ subject: sdk.walletSubject(whale), asset: 0, tier: 4, expirySlot: 9000 });
  await rpc.putCertificate({ subject: sdk.walletSubject(whale), asset: 1, tier: 2, expirySlot: 4000 }); // expired by slot
  await rpc.putCertificate({ subject: sdk.xSubject("anon"), asset: 0, tier: 5, expirySlot: 9000 });
  await rpc.putCertificate({ subject: sdk.badgeSubject(badge), asset: 0, tier: 1, expirySlot: 9000 });
  await rpc.putCertificate({ subject: sdk.walletSubject(spent), asset: 0, tier: 3, status: 1, revokedSlot: 4500, expirySlot: 9000 });
  // an account owned by another program at a lookalike address must be ignored
  const client = new sdk.PofClient({ rpc });
  return { rpc, client, whale, badge, spent };
}

test("lookup by wallet, @handle, badge, bare key and hash", async () => {
  const { client, whale, badge } = await world();
  let r = await client.lookup(whale);
  assert.equal(r.slot, 5000);
  assert.equal(r.certificates.length, 2);
  const sol = r.certificates.find((c) => c.asset === 0);
  assert.equal(sol.live, true);
  assert.equal(sol.tierLabel, "≥ 1,000 SOL");
  const usdc = r.certificates.find((c) => c.asset === 1);
  assert.equal(usdc.status, 0);
  assert.equal(usdc.effectiveStatus, "expired");
  r = await client.lookup("@ANON");
  assert.equal(r.certificates[0].subjectKindName, "x");
  assert.equal(r.certificates[0].tier, 5);
  r = await client.lookup(badge);
  assert.equal(r.certificates[0].subjectKindName, "badge");
  r = await client.lookup("hash:" + (await sdk.subjectHashHex(sdk.xSubject("anon"))));
  assert.equal(r.certificates.length, 1);
  assert.equal(r.candidates[0].kind, 1);
  r = await client.lookup(Keypair.generate().publicKey.toBase58());
  assert.equal(r.certificates.length, 0);
  r = await client.lookup(whale, { asset: "SOL" });
  assert.equal(r.certificates.length, 1);
});

test("checkProofOfFunds gives a reason for every no", async () => {
  const { client, whale, spent } = await world();
  assert.equal((await client.checkProofOfFunds({ subject: whale, asset: 0, minTier: 4 })).ok, true);
  assert.equal((await client.checkProofOfFunds({ subject: whale, asset: 0, minTier: 5 })).reason, "below_tier");
  assert.equal((await client.checkProofOfFunds({ subject: whale, asset: 1, minTier: 1 })).reason, "expired");
  assert.equal((await client.checkProofOfFunds({ subject: spent, asset: 0, minTier: 1 })).reason, "revoked_spent");
  assert.equal((await client.checkProofOfFunds({ subject: "@nobody", asset: 0, minTier: 1 })).reason, "no_certificate");
  assert.equal((await client.checkProofOfFunds({ subject: sdk.xSubject("anon"), asset: "SOL", minTier: 5 })).ok, true);
});

test("listCertificates filters and stats", async () => {
  const { client, rpc } = await world();
  assert.equal((await client.listCertificates()).certificates.length, 5);
  assert.equal((await client.listCertificates({ asset: 0 })).certificates.length, 4);
  assert.equal((await client.listCertificates({ asset: 0, tier: 5 })).certificates.length, 1);
  assert.equal((await client.listCertificates({ status: "live" })).certificates.length, 3);
  assert.equal((await client.listCertificates({ minTier: 4 })).certificates.length, 2);
  assert.equal((await client.listCertificates({ subjectKind: 2 })).certificates.length, 1);
  const s = await client.stats();
  assert.equal(s.live, 3);
  assert.equal(s.revokedSpent, 1);
  assert.equal(s.expired, 1);
  assert.equal(s.byAsset.SOL.certifiedMinimum, 1000 + 10000 + 1);
  assert.deepEqual(s.bySubjectKind, { wallet: 1, x: 1, badge: 1 });
  // a foreign-owned account at a certificate address is not a certificate
  const addr = (await sdk.certificateAddress(await sdk.subjectHash(sdk.xSubject("ghost")), 0))[0];
  rpc.put(addr, "11111111111111111111111111111111", new Uint8Array(400));
  assert.equal((await client.lookup("@ghost")).certificates.length, 0);
});

test("rooms with members and their live status", async () => {
  const { client, rpc, whale, spent } = await world();
  const creator = Keypair.generate().publicKey.toBase58();
  const [room] = await sdk.roomAddress(creator, 1);
  rpc.putRoom(room, { creator, id: 1, asset: 0, minTier: 3, memberCount: 3, name: "whales" });
  const c1 = (await sdk.certificateAddress(await sdk.subjectHash(sdk.walletSubject(whale)), 0))[0];
  await rpc.putMember(room, sdk.walletSubject(whale), c1);
  const c2 = (await sdk.certificateAddress(await sdk.subjectHash(sdk.walletSubject(spent)), 0))[0];
  await rpc.putMember(room, sdk.walletSubject(spent), c2);
  const r = await client.getRoomWithMembers(room);
  assert.equal(r.room.name, "whales");
  assert.equal(r.room.minTierLabel, "≥ 100 SOL");
  assert.equal(r.members.length, 2);
  assert.equal(r.members.filter((m) => m.live).length, 1);
  assert.equal(r.members.find((m) => !m.live).certificateStatus, "revoked_spent");
  assert.equal((await client.listRooms()).length, 1);
  assert.equal(await client.getRoom(Keypair.generate().publicKey), null);
});

test("CPI accounts for require_certificate and a pof_gate join instruction", async () => {
  const wallet = Keypair.generate().publicKey;
  const subject = sdk.walletSubject(wallet);
  const r = await sdk.requireCertificateAccounts({ subject, asset: "SOL", minTier: 3 });
  const [cert] = await sdk.certificateAddress(await sdk.subjectHash(subject), 0);
  assert.equal(r.certificate, cert);
  assert.equal(r.accounts[0].pubkey, cert);
  assert.equal(r.accounts[0].isWritable, false);
  assert.equal(r.accounts.at(-1).pubkey, sdk.POF_PROGRAM_ID);
  assert.equal(r.data.length, 8 + 32 + 1 + 1);
  await assert.rejects(sdk.requireCertificateAccounts({ subject, asset: 0, minTier: 9 }));

  const creator = Keypair.generate().publicKey;
  const [room] = await sdk.roomAddress(creator, 7);
  const ix = await sdk.joinRoomInstruction({ room, asset: 0, subject, payer: wallet });
  assert.equal(ix.programId, sdk.POF_GATE_PROGRAM_ID);
  const [member] = PublicKey.findProgramAddressSync(
    [Buffer.from("member"), new PublicKey(room).toBuffer(), Buffer.from(await sdk.subjectHash(subject))], new PublicKey(sdk.POF_GATE_PROGRAM_ID));
  assert.equal(ix.member, member.toBase58());
  const payer = ix.keys.find((k) => k.pubkey === wallet.toBase58());
  assert.equal(payer.isSigner, true);
  const w3 = sdk.toWeb3Instruction(ix, { PublicKey, TransactionInstruction });
  assert.ok(w3 instanceof TransactionInstruction);
  assert.equal(w3.keys.length, ix.keys.length);
});
