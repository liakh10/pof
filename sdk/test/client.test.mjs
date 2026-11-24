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

test("Config and Treasury decode; stats prefer the program's own counters", async () => {
  const { client, rpc } = await world();
  const v = Keypair.generate().publicKey.toBase58();
  const nv = Keypair.generate().publicKey.toBase58();
  await rpc.putConfig({
    admin: v, verifier: v, next_verifier: nv, next_verifier_slot: 6000,
    params: { fee_lamports: 10_000_000, holder_min: 1_000_000_000_000n, validity_slots: 6_480_000, max_attest_age: 300, max_root_lag: 9000, rotation_delay: 216000 },
    assets: [
      { enabled: true, mint: "So11111111111111111111111111111111111111112", decimals: 9, mins: [1e9, 1e10, 1e11, 1e12, 1e13] },
      { enabled: true, mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, mins: [1e8, 1e9, 1e10, 1e11, 1e12] },
      { enabled: false, mint: "11111111111111111111111111111111", decimals: 0, mins: [0, 0, 0, 0, 0] },
      { enabled: false, mint: "11111111111111111111111111111111", decimals: 0, mins: [0, 0, 0, 0, 0] },
    ],
  });
  const c = await client.getConfig();
  assert.equal(c.activeVerifier, v, "before the rotation slot");
  rpc.slot = 6000;
  assert.equal((await client.getConfig()).activeVerifier, nv, "after it");
  assert.equal(c.feeLamports, 10_000_000);
  assert.equal(c.assets[0].mins[3], "1000000000000");
  // every tier minimum in the SDK's table matches the launch Config (CONTRACT §2)
  for (const a of [0, 1]) for (let t = 1; t <= 5; t++)
    assert.equal(BigInt(c.assets[a].mins[t - 1]), BigInt(sdk.tierMinimum(a, t)) * 10n ** BigInt(sdk.ASSETS[a].decimals));

  rpc.slot = 5000;
  await rpc.putTreasury({ certified: 12, revoked_spent: 4, revoked_holder: 1, expired: 2, live: 3, log_size: 9, log_head: new Uint8Array(32).fill(7), log_slot: 4900 });
  const t = await client.getTreasury();
  assert.deepEqual(t.log, { treeSize: 9, rootHash: "07".repeat(32), slot: 4900 });
  const s = await client.stats();
  assert.equal(s.total, 12);
  assert.equal(s.revokedSpent, 4);
  assert.equal(s.expired, 2);
  assert.equal(s.live, 3);
});

test("verifierKeys: Config keys, plus every key VerifierSet events ever named (history)", async () => {
  const { client, rpc } = await world();
  const old = Keypair.generate().publicKey.toBase58();
  const cur = Keypair.generate().publicKey.toBase58();
  const nxt = Keypair.generate().publicKey.toBase58();
  await rpc.putConfig({ verifier: cur, next_verifier: nxt, next_verifier_slot: 99999 });
  const ev = (verifier, next) => {
    const disc = sdk.POF_IDL.events.find((e) => e.name === "VerifierSet").discriminator;
    const body = Buffer.concat([Buffer.from(disc), new PublicKey(verifier).toBuffer(), new PublicKey(next).toBuffer(), Buffer.alloc(8)]);
    return `Program data: ${body.toString("base64")}`;
  };
  const [cfg] = await sdk.configAddress();
  rpc.history.set(cfg, [
    { signature: "s3", logs: ["Program log: Instruction: SetVerifier", ev(cur, nxt)] },
    { signature: "s2", logs: [ev(old, cur)] },
    { signature: "s1", logs: [ev(old, "11111111111111111111111111111111")] },
  ]);
  const now = await client.verifierKeys();
  assert.deepEqual(new Set(now.all), new Set([cur, nxt]));
  assert.equal(now.current, cur);
  const h = await client.verifierKeys({ history: true });
  assert.deepEqual(new Set(h.all), new Set([cur, nxt, old]));
  assert.equal(h.fromHistory, true);
  assert.equal(sdk.decodeEvents([ev(old, cur), "Program data: !!!", "nothing"]).length, 1);
});
