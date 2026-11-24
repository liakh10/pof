import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { PublicKey, Keypair, TransactionInstruction } from "@solana/web3.js";
import * as sdk from "../dist/index.js";

test("base58 round-trips and matches web3.js", () => {
  for (let i = 0; i < 200; i++) {
    const b = crypto.randomBytes(32);
    if (i % 10 === 0) b.fill(0, 0, i % 4);
    const s = sdk.encodeBase58(b);
    assert.equal(s, new PublicKey(b).toBase58());
    assert.deepEqual(Buffer.from(sdk.decodeBase58(s)), b);
  }
  assert.throws(() => sdk.decodeBase58("0OIl"));
  assert.equal(sdk.isAddress("11111111111111111111111111111111"), true);
  assert.equal(sdk.isAddress("abc"), false);
});

test("isOnCurve and PDAs match web3.js", async () => {
  for (let i = 0; i < 40; i++) {
    const kp = Keypair.generate();
    assert.equal(sdk.isOnCurve(kp.publicKey.toBytes()), true);
    const prog = Keypair.generate().publicKey;
    const seeds = [Buffer.from("cert"), crypto.randomBytes(32), Buffer.from([i % 2])];
    const [want, wantBump] = PublicKey.findProgramAddressSync(seeds, prog);
    const [got, bump] = await sdk.findProgramAddress(seeds.map((s) => new Uint8Array(s)), prog.toBase58());
    assert.equal(got, want.toBase58());
    assert.equal(bump, wantBump);
    assert.equal(sdk.isOnCurve(want.toBytes()), false);
  }
});

test("subject hashes follow CONTRACT §1", async () => {
  const w = Keypair.generate().publicKey.toBase58();
  const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
  assert.equal(await sdk.subjectHashHex(sdk.walletSubject(w)), sha("pof:wallet:" + w));
  assert.equal(await sdk.subjectHashHex(sdk.badgeSubject(w)), sha("pof:badge:" + w));
  assert.equal(await sdk.subjectHashHex(sdk.xSubject("@Some_Anon")), sha("pof:x:some_anon"));
  // a web3.js PublicKey is accepted as is
  assert.equal(await sdk.subjectHashHex(sdk.walletSubject(new PublicKey(w))), sha("pof:wallet:" + w));
  assert.throws(() => sdk.xSubject("not a handle!"));
  assert.throws(() => sdk.xSubject("sixteen_chars_xx"));
});

test("parseSubjectQuery reads what people type", () => {
  const w = Keypair.generate().publicKey.toBase58();
  let q = sdk.parseSubjectQuery("@Anon");
  assert.deepEqual(q, { type: "subjects", subjects: [{ kind: 1, value: "anon" }] });
  q = sdk.parseSubjectQuery(w);
  assert.equal(q.subjects.length, 2);
  assert.deepEqual(q.subjects.map((s) => s.kind), [0, 2]);
  assert.deepEqual(sdk.parseSubjectQuery("badge:" + w).subjects, [{ kind: 2, value: w }]);
  assert.deepEqual(sdk.parseSubjectQuery("wallet:" + w).subjects, [{ kind: 0, value: w }]);
  assert.equal(sdk.parseSubjectQuery("ab".repeat(32)).type, "hash");
  assert.equal(sdk.parseSubjectQuery("x:anon").subjects[0].kind, 1);
  assert.equal(sdk.parseSubjectQuery("anon").subjects[0].kind, 1);
  assert.throws(() => sdk.parseSubjectQuery("!!"));
  assert.throws(() => sdk.parseSubjectQuery(""));
});

test("assets, tiers and labels follow CONTRACT §2", () => {
  assert.equal(sdk.tierLabel(0, 4), "≥ 1,000 SOL");
  assert.equal(sdk.tierLabel(1, 5), "≥ 1,000,000 USDC");
  assert.equal(sdk.parseAsset("usdc"), 1);
  assert.equal(sdk.parseAsset("0"), 0);
  assert.throws(() => sdk.parseAsset("BONK"));
  assert.throws(() => sdk.tierMinimum(0, 6));
});

test("Certificate layout: encode, decode, offsets, effective status", async () => {
  const subject = sdk.walletSubject(Keypair.generate().publicKey);
  const hash = await sdk.subjectHash(subject);
  const data = sdk.encodeAccountPartial(sdk.POF_IDL, "Certificate", {
    subject_kind: 0, subject_hash: hash, asset: 0, tier: 3, status: 0, certified_slot: 100, issued_slot: 120, expiry_slot: 200, revoked_slot: 0,
    note_count: 2, null_hashes: Array.from({ length: 8 }, (_, i) => new Uint8Array(32).fill(i + 1)), controller: subject.value,
    payer: "11111111111111111111111111111111", log_index: 7, verifier: "11111111111111111111111111111111", revealed_index: 255, bump: 254,
  });
  const c = sdk.decodeCertificate("x", data);
  assert.equal(c.subjectHash, sdk.toHex(hash));
  assert.equal(c.tierLabel, "≥ 100 SOL");
  assert.equal(c.nullifierHashes.length, 2);
  assert.equal(c.revokedSlot, null);
  assert.equal(c.logIndex, 7);
  assert.equal(c.controller, subject.value);
  assert.equal(c.issuedSlot, 120);
  assert.equal(c.revealed, null);
  assert.equal(sdk.POF_IDL_IS_DRAFT, false);
  assert.equal(sdk.POF_PROGRAM_ID, "pofP4QRRDXnmDN9CNYiAGHfwMEgM7sLWhVcUMpsbynT");
  assert.equal(sdk.effectiveStatus(c, 150), "live");
  assert.equal(sdk.effectiveStatus(c, 200), "live", "live through the expiry slot, as on chain");
  assert.equal(sdk.effectiveStatus(c, 201), "expired");
  assert.equal(sdk.isLive(c, 200), true);
  assert.equal(data[sdk.layout.certificate.offset("asset")], 0);
  assert.equal(data[sdk.layout.certificate.offset("tier")], 3);
  assert.throws(() => sdk.decodeCertificate("x", new Uint8Array(data.length)), /not a Certificate/);
  assert.throws(() => sdk.decodeCertificate("x", data.slice(0, 50)), /too short/);
});

test("attestation bytes follow CONTRACT §3", () => {
  const a = {
    programId: sdk.POF_PROGRAM_ID, subjectKind: 1, subjectHash: "11".repeat(32), asset: 0, tier: 4, treeRoot: "22".repeat(32),
    rootSlot: 12345, noteCount: 3, nullsetHash: "33".repeat(32), issuedSlot: 12400, expirySlot: 99999,
    payer: Keypair.generate().publicKey.toBase58(), controller: Keypair.generate().publicKey.toBase58(), nonce: "44".repeat(16),
  };
  const b = sdk.buildAttestation(a);
  assert.equal(b.length, 240);
  assert.equal(sdk.encodeBase58(b.slice(192, 224)), a.controller);
  assert.equal(Buffer.from(b.slice(224)).toString("hex"), a.nonce);
  assert.equal(Buffer.from(b.slice(0, 4)).toString(), "POF1");
  assert.equal(b[70], 4);
  assert.equal(Buffer.from(b).readBigUInt64LE(103), 12345n);
  assert.equal(Buffer.from(b).readBigUInt64LE(152), 99999n);
  assert.deepEqual(sdk.parseAttestation(b), a);
});
