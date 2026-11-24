---
title: Zero-knowledge circuit
order: 12
summary: The phase 2 circuit, its public inputs, the setup, the browser prover and certify_zk, with measured numbers and the known limits.
---

# The zero-knowledge circuit (phase 2)

Phase 1 trusts the Verifier with the openings of the disclosed notes and with the vault's nullifier key `nk`
([Trust points](trust), item 1). Phase 2 replaces that request with a Groth16 proof. The holder's browser makes the proof,
and the `pof` program checks it itself. The program learns that the subject holds at least the tier in one asset, and
nothing else: no amount, no `nk`, no leaf, no nullifier, and not which ring the money sits in.

**Status: in development, not deployed.** The circuit, a development setup, the browser prover and the on-chain instruction
`certify_zk` are built and tested; the numbers are below and in the [zk test report](https://github.com/liakh10/pof/blob/main/reports/zk.md).
The setup is a **development setup** made on one machine. `certify_zk` stays switched off until the public ceremony
described at the end has run.

## The statement

The public values are `(state_root, null_root, asset, min_amount, ctx, K, R, tag_1..4, ct_1..4, registry_root)`. The prover
knows a ring (`ownerId`, `nk`), the ring owner's registered secret `s`, an ephemeral scalar `r`, and 1 to 4 notes. For every
used note slot:

1. `commitment = Poseidon(3, 0, asset, amount, dataHash, ringTerm, Poseidon(Poseidon(ownerId, Poseidon(nk)), blinding))`.
   This is the Rings note commitment ([RINGS.md](https://github.com/liakh10/pof/blob/main/RINGS.md) §2).
2. The commitment is the leaf at `leafIndex` of the Rings state tree (height 32) under `state_root`.
3. `nullifier = Poseidon(commitment, blinding, nk)` (RINGS §3).
4. The nullifier is **absent** from the Rings indexed nullifier tree (height 40) under `null_root`. A leaf `Poseidon(low, next)`
   of that tree has `low < nullifier < next` as integers. `next = 0` marks the last element, which has no upper bound.
5. `tag = Poseidon("pof:zk:tag:v1", nullifier)`.
6. `ct = nullifier + Poseidon("pof:zk:esc:v1", S.x, S.y, slot)`, where `R = r·B8` and `S = r·K` on Baby Jubjub.

Over the whole proof:
- each `amount < 2^64`, and `Σ amount ≥ min_amount`;
- the used slots come first, and unused slots have `tag = ct = 0`;
- `Poseidon(ownerId, Poseidon("pof:zk:own:v1", s))` is a leaf of the POF owner registry under `registry_root`.

The last line is what makes the proof need the owner and not only `nk` (see "Spend authority" below).

Every hash is Poseidon over BN254 with the circom parameters, which is the Rings hasher itself: the SDK uses
light-poseidon. The tests check circomlib against the Helius SDK value for value. They also recompute real mainnet deposit
leaves with the circuit's commitment formula (`zk/test/parity.test.mjs`).

## Public inputs, and who sets them

| # | input | set by |
|---|---|---|
| 0 | `state_root` | the transaction; it must be in the Rings tree account's 500-root state history |
| 1 | `null_root` | the transaction; it must be the tree's **newest** nullifier root (the one before the cursor at offset 17,224) |
| 2 | `asset` | the program: `Poseidon(mint[0..31], mint[31])` of the asset's mint in `Config` (Rings `hashBytes`) |
| 3 | `min_amount` | the program: the tier's minimum from `Config` |
| 4 | `ctx` | the program: `sha256("pof:zk:ctx:v1" ‖ program ‖ kind ‖ subject_hash ‖ asset ‖ tier ‖ controller ‖ payer ‖ nonce)`, top 3 bits cleared |
| 5, 6 | `K` | the program: the revocation key in force in `ZkConfig` |
| 7, 8 | `R` | the transaction (stored in each note lock) |
| 9 to 12 | `tag_i` | the transaction (stored on the certificate) |
| 13 to 16 | `ct_i` | the transaction (stored in each note lock) |
| 17 | `registry_root` | the transaction; it must be one of the owner registry's last 12 roots |

The program computes `asset`, `min_amount`, `ctx` and `K` itself. So a proof cannot be moved to another subject, controller,
payer, tier, asset or nonce: any change gives other public inputs, and the pairing check fails. Every input must be a
canonical field element (below r). A non-canonical encoding of the same value is refused, so each stored byte string is unique.

**Why only the newest nullifier root.** The nullifier tree only grows. At an older root, a note spent since then is still
absent, and the proof would show it as unspent. If a forester batch lands between proving and submitting, the transaction
fails and the client proves again. Batches are rare (4,999 nullifiers each).

## Spend authority

`nk` and the openings of deposit notes are not secret from everyone: a phase 1 Verifier has seen the `nk` of every vault it
checked, and deposit openings are public chain data once `nk` is known. A proof from those alone would let someone who once
saw `nk` certify with money that is not theirs.

So the circuit also proves knowledge of a secret `s` that the ring owner registered. The owner signs `register_zk_owner`
once with its own key. The program appends `Poseidon(ownerId(signer), Poseidon("pof:zk:own:v1", s))` to the owner registry,
an append-only Poseidon Merkle tree of height 20 kept on chain. The client derives `s` from the vault seed
(`sha256("pof:zk:own:v1" ‖ seed)`), keeps it on the device and never sends it to a Verifier.

What registration shows: that this vault key uses POF phase 2. A certificate does not show which registered owner made it.
The registry is the anonymity set.

What it does not stop: an owner who *wants* to lend its money can hand over `s` and `nk` together. Phase 1 has the same
limit, because the owner can sign for a renter. Revocation still catches the money moving.

## The settle window

A nullifier spent recently waits in the Rings nullifier queue (its PDA exists) before a forester folds it into the tree. The
proof can show absence from the tree, not from the queue, without revealing the nullifier. So a zk certificate **settles**
for `ZK_SETTLE_SLOTS` (150 slots, about a minute) after `certify_zk`:
- it records `issued_slot = certified_slot + 150`;
- `gate` refuses it before that slot with `ZkSettling`. `gate` is behind `require_certificate` and `pof_gate`.

So a program cannot act on it in the same transaction, nor in that minute. During the window, anyone who can show a spend
revokes it with `revoke_spent`.

## Revocation, and why tags are not salted

A zk certificate records the `ZkConfig` address as its `verifier`. `revoke_spent` then checks
`Poseidon("pof:zk:tag:v1", nullifier) == tag` (there is no salt), plus the same chain proofs as phase 1: the nullifier PDA
exists, or a membership path in the nullifier tree.

Tags are deterministic per note, which is a trade-off:
- **For:** revocation needs no keeper. A Rings spend puts the nullifier on chain. Anyone who watches spends computes its tag,
  finds a certificate that carries it, and revokes. The same tag also gives the one-note-one-certificate lock below.
- **Against:** two zk certificates made from the same note carry the same tag, and a later spend of the note is linkable to
  every certificate that carried it, even after the holder revoked. The UI says so. The unlinkable variant (a salted tag
  with an escrowed salt, plus a second note lock value) is the upgrade path. With it, revocation would depend on holders of
  the escrow key.

The escrow (`R`, `ct`) gives the keeper the nullifiers in advance, so it can revoke the moment a nullifier PDA appears. It does
not need to wait to see the spend.

## One note, one live certificate

`certify_zk` creates a `NoteLock` PDA `["znote", tag]` per note, so the same note cannot back two live zk certificates. A lock
address that a stranger pre-funded still works: the program tops it up, then allocates and assigns it.

`release_note_lock` (anyone) closes a lock once its certificate is revoked, expired, closed, or no longer carries the tag. The
rent goes back to whoever paid it.

Across the two paths, the Verifier must refuse a note whose `znote` lock is live; it knows the nullifier and computes the tag.
A signed certificate does not yet create `znote` locks (see Known limits).

## The switch and the key

`set_zk` (admin) can turn `certify_zk` off at once. Turning it on, or changing the revocation key `K`, waits the same delay as
a Verifier key rotation (`Config.params.rotation_delay`).

`K` must be a Baby Jubjub point; its subgroup membership is the key maker's check. Every note lock records the key epoch it
was encrypted under.

`ZkConfig.vk_hash` records the sha256 of the verifying key compiled into the build. A build with a stub verifying key does
not compile, and proofs with points at infinity are refused.

## Numbers (development build)

| | |
|---|---|
| constraints | 93,803 (circom 2.2.2 `--O2`), 18 public inputs, Powers of Tau 2^17 |
| per note | ~21.5k: state path 32 × Poseidon(2), nullifier path 40 × Poseidon(2), the commitment, three 254-bit comparisons |
| shared | ~5k registry path (20 × Poseidon(2)), ~3.5k escrow (one fixed-base, one variable-base Baby Jubjub multiplication) |
| circuit (witness wasm) | 4.6 MB |
| proving key | 57.7 MB (38.5 MB gzipped, as served) |
| proving | see the report: Node about 5 to 7 s for 4 notes on an M-series laptop; the browser figures are in the report |
| `certify_zk` | about 240k to 250k compute units with 1 note, 300k with 4; transactions of 843 bytes (1 note, 1 signer) to 1,230 bytes (4 notes, 2 signers, with a lookup table) |

## The development setup

`zk/scripts/ceremony.sh` runs the setup in two phases:
1. A local Powers of Tau (BN254, 2^17) with two random contributions and a public beacon.
2. A Groth16 phase 2 with two random contributions and a beacon.

Each beacon is the sha256 of a finalized Solana mainnet blockhash, named in the transcript. Every step is verified with
snarkjs. `zk/setup/TRANSCRIPT.md` lists every contribution hash, plus the hashes of the r1cs, the phase 1 output, the proving
key and the verifying key. The program embeds the verifying key (`zk/onchain/src/vk.rs`, generated) and records its sha256.

**Why it is not enough for mainnet.** One machine made every contribution. Whoever ran it could have kept the secrets, and
could forge proofs for this key. That is fine for local tests and devnet, and not for real certificates.

## The public ceremony (before mainnet)

1. Phase 1 from the Perpetual Powers of Tau (a public ceremony with many independent contributors), at 2^17 or above.
2. Phase 2 opened to outside contributors. Each downloads the latest `zkey`, contributes with their own entropy, and
   publishes their contribution hash; the coordinator only sequences. One honest contributor is enough to make the key sound.
3. A final beacon from a future Solana blockhash, fixed in advance.
4. The final key's hash is published and `vk.rs` is regenerated from it. Then the program is rebuilt and its build hash
   published. Only after that does the admin call `set_zk(true, K)`, which itself waits the rotation delay.

## Known limits

- **Subjects.** `certify_zk` takes wallet and badge subjects (their key signs the transaction). X handles still need the
  linker's proof, which this version does not carry into the circuit.
- **Up to 4 notes.** A holder with more small notes merges them in Rings first, or certifies a lower tier.
- **Linkable tags** (above): a deliberate trade-off for keeper-free revocation.
- **Signed and zk certificates on one note.** The zk path locks notes on chain, the Verifier in its own index. Until signed
  certificates also create `znote` locks (a CONTRACT §3 v2 change: the attestation would carry the tags), the Verifier must
  check the `znote` lock of every note it attests.
- **Consensual lending.** The owner can hand over `s` and `nk` (see "Spend authority").
- **Root age.** Any state root in the 500-root history is accepted (about eight hours at today's traffic). The certificate
  records the tree's last update slot, not the root's own slot.
- **Minimum note age.** Phase 1 checks that each note's creating transaction is older than 150 slots. The proof does not; the
  client proves against an older state root for the same effect.
- **The proving key is large** (38.5 MB to download once per device). The proof takes seconds on a laptop and longer on a phone.
- **Groth16 needs a trusted setup per circuit.** Any change to the circuit needs a new phase 2.
