---
title: Zero-knowledge circuit
order: 12
summary: The phase 2 circuit, its public inputs, the setup, the browser prover and certify_zk, with measured numbers and the known limits.
---

# The zero-knowledge circuit (phase 2)

Phase 1 trusts the Verifier with the openings of the disclosed notes and with the vault's nullifier key `nk`
([Trust points](trust), item 1). Phase 2 replaces that request with a Groth16 proof made in the holder's browser and
checked by the `pof` program itself. The program learns that the subject holds at least the tier in one asset, and nothing
else: no amount, no `nk`, no owner key, no leaf, no nullifier.

**Status: in development, not deployed.** The circuit, a development setup, the browser prover and the on-chain
instruction `certify_zk` are built and tested (numbers below). The setup is a **development setup** made on one machine.
`certify_zk` stays switched off on mainnet until the public ceremony described at the end has run.

## The statement

For public values `(state_root, null_root, asset, min_amount, ctx, K, R, tag_1..4, ct_1..4)` the prover knows a ring
(`ownerId`, `nk`), an ephemeral scalar `r`, and 1 to 4 notes `(amount, blinding, dataHash, ringTerm, leafIndex, paths)` such
that, for every used note slot:

1. `commitment = Poseidon(3, 0, asset, amount, dataHash, ringTerm, Poseidon(Poseidon(ownerId, Poseidon(nk)), blinding))`,
   the Rings note commitment ([RINGS.md](https://github.com/liakh10/pof/blob/main/RINGS.md) §2);
2. the commitment is the leaf at `leafIndex` of the Rings state tree (height 32) under `state_root`;
3. `nullifier = Poseidon(commitment, blinding, nk)` (RINGS §3);
4. the nullifier is **absent** from the Rings indexed nullifier tree (height 40) under `null_root`: a leaf
   `Poseidon(low, next)` of that tree has `low < nullifier < next` as integers;
5. `tag = Poseidon("pof:zk:tag:v1", nullifier)`;
6. `ct = nullifier + Poseidon("pof:zk:esc:v1", S.x, S.y, slot)` where `R = r·B8` and `S = r·K` on Baby Jubjub;

and, over all notes: `amount < 2^64` each, `Σ amount ≥ min_amount`, used slots come first, unused slots have `tag = ct = 0`.

Every hash is Poseidon over BN254 with the circom parameters. That is the Rings hasher itself (the SDK uses
light-poseidon): the tests check circomlib against the Helius SDK value for value, and recompute real mainnet deposit
leaves with the circuit's commitment formula (`zk/test/parity.test.mjs`).

## Public inputs, and who sets them

| # | input | set by |
|---|---|---|
| 0 | `state_root` | the transaction; the program requires it to be in the Rings tree account's 500-root state history |
| 1 | `null_root` | the transaction; the program requires it to be in the tree's 100-root nullifier history |
| 2 | `asset` | the program: `Poseidon(mint[0..31], mint[31])` of the asset's mint in `Config` (Rings `hashBytes`) |
| 3 | `min_amount` | the program: the tier's minimum from `Config` |
| 4 | `ctx` | the program: `sha256("pof:zk:ctx:v1" ‖ program ‖ kind ‖ subject_hash ‖ asset ‖ tier ‖ controller ‖ payer ‖ nonce)`, top 3 bits cleared |
| 5, 6 | `K` | the program: the revocation key in `ZkConfig` |
| 7, 8 | `R` | the transaction (stored in each note lock) |
| 9 to 12 | `tag_i` | the transaction (stored on the certificate) |
| 13 to 16 | `ct_i` | the transaction (stored in each note lock) |

Because the program computes `asset`, `min_amount`, `ctx` and `K` itself, a proof cannot be moved to another subject,
controller, payer, tier, asset or nonce: any change gives other public inputs and the pairing check fails. Inputs must be
canonical field elements (below r); a non-canonical encoding of the same value is refused, so the byte strings the program
stores are unique.

## Why the escrow

A nullifier spent recently sits in the Rings nullifier queue (a PDA) before a forester folds it into the nullifier tree, in
batches of 4,999. The proof can show absence from the tree, not from the queue, without revealing the nullifier. So the
proof also encrypts each nullifier to the revocation key `K`, and the circuit forces the encryption to be correct. The
keeper holds `k` (with `K = k·B8`); it reads `R` and `ct` from the note lock, recovers each nullifier, checks it against the
tag, and calls `revoke_spent` the moment the nullifier PDA appears, including right after certify for a note that was already
in the queue. The keeper learns nullifiers, which only matter at the moment of a spend, and never an amount or `nk`.

## One note, one live certificate

Tags are deterministic per note. `certify_zk` creates a `NoteLock` PDA `["znote", tag]` per note, so the same note cannot back
two live certificates. `release_note_lock` (anyone) closes a lock once its certificate is revoked, expired, closed or no
longer carries the tag, and returns the rent to whoever paid it.

## Revocation

A zk certificate records the `ZkConfig` address as its `verifier`. `revoke_spent` then checks
`Poseidon("pof:zk:tag:v1", nullifier) == tag` (no salt) and the same chain proofs as phase 1: the nullifier PDA exists, or a
membership path in the nullifier tree. The nullifier becomes public at that point, as in phase 1.

## Numbers (development build)

| | |
|---|---|
| constraints | 88,474 (circom 2.2.2 `--O2`), 17 public inputs, Powers of Tau 2^17 |
| per note | ~21.5k: state path 32 × Poseidon(2), nullifier path 40 × Poseidon(2), the commitment, three 254-bit range checks |
| escrow | ~3.5k (one fixed-base and one variable-base Baby Jubjub multiplication) |
| circuit wasm | see [the zk report](https://github.com/liakh10/pof/blob/main/reports/zk.md) |
| proving key | see the report |
| proving time | see the report (browser and Node) |
| `certify_zk` | see the report (compute units, transaction size) |

## The development setup

`zk/scripts/ceremony.sh` runs a local Powers of Tau (BN254, 2^17) with two random contributions and a public beacon, then a
Groth16 phase 2 with two random contributions and a beacon. The beacon is the sha256 of a finalized Solana mainnet blockhash,
named in the transcript. Every step is verified with snarkjs; `zk/setup/TRANSCRIPT.md` lists every contribution hash, and
the hashes of the r1cs, the phase 1 output, the proving key and the verifying key. The program embeds the verifying key
(`zk/onchain/src/vk.rs`, generated) and records its sha256 in `ZkConfig.vk_hash`.

**Why it is not enough for mainnet.** One machine made every contribution. Whoever ran it could have kept the secrets and
could forge proofs for this key. That is acceptable for local tests and devnet, and not for real certificates.

## The public ceremony (before mainnet)

1. Phase 1 from the Perpetual Powers of Tau (a public ceremony with many independent contributors), at 2^17 or above.
2. Phase 2 opened to outside contributors: each downloads the latest `zkey`, contributes with their own entropy, and publishes
   their contribution hash; the coordinator only sequences. At least one honest contributor makes the key sound.
3. A final beacon from a future Solana blockhash fixed in advance.
4. The final key's hash is published, `vk.rs` is regenerated from it, the program is rebuilt and its build hash published,
   and only then does the admin call `set_zk(true, K)`.

## Known limits

- **Subjects.** `certify_zk` takes wallet and badge subjects (their key signs the transaction). X handles still need the
  linker's proof, which this version does not carry into the circuit.
- **Up to 4 notes.** A holder with more small notes merges them in Rings first, or certifies a lower tier.
- **The keeper sees nullifiers.** It cannot see amounts or `nk`, but it can link a certificate to a later spend, as the
  holder of the salts can in phase 1. A threshold of keepers is the upgrade path.
- **Root age.** The program accepts any state root in the 500-root history (about eight hours at today's traffic), and the
  certificate records the tree's last update slot, not the root's own slot.
- **Minimum note age.** Phase 1 checks each note's creating transaction is older than 150 slots. The proof does not; the
  client should prove against an older root, which gives the same guarantee.
- **The proving key is large** (tens of MB) and is downloaded once per device; the circuit runs in a Web Worker.
- **Groth16 needs a trusted setup per circuit.** Any change to the circuit needs a new phase 2.
