---
title: Glossary
order: 41
summary: The terms used across the paper, in one place.
---

# Glossary

**Anchor.** A signed tree head of the transparency log submitted to the program's `anchor_log`; its size, root and slot
are kept in the Treasury. The log must always extend the anchored head.

**Attestation.** The 240 bytes the Verifier signs with ed25519 (CONTRACT §3), rebuilt and checked on chain by `certify`.

**Badge.** A subject kind (2): a fresh ed25519 key made for one certificate, linked to nothing else.

**Bundle hash.** sha256 of the Verifier's deterministic build (`verifier/dist/pof-verifier.mjs`), carried in every log entry.

**Certificate.** The program account `["cert", subject_hash, [asset]]`: the tier, status, slots and salted nullifier
hashes for one subject and one asset.

**Commitment.** The Poseidon hash that is a note's leaf in the Rings state tree, computed from its asset, amount, owner and
blinding.

**Controller.** The key that may revoke a certificate and join Rooms with it: the wallet, the badge key, or a key derived
from the vault for an X handle.

**Deposit (shield).** Moving SOL or USDC from a public balance into a ring. Public: depositor, amount and recipient.

**Disclosure package.** The JSON the browser sends to the Verifier (CONTRACT §4): the subject proof, the ring owner and
`nk`, and the openings of the chosen notes.

**Expiry slot.** The slot after which a certificate reads as expired; at most `validity_slots` after its issue slot.

**Indexer.** Helius's service for Rings data: Merkle paths, non-inclusion paths, transactions. The Verifier re-checks its
paths against on-chain roots.

**Keeper.** A service that holds the revoke pairs (escrowed to its X25519 key), watches the disclosed nullifiers and calls
`revoke_spent`. Registered keepers are listed in `verifier/keepers.json`; the project's keeper also anchors the log.

**Kit (revoke kit).** For one certificate: each disclosed note's salt and nullifier, plus sealed openings. Kept by the
holder and the keeper.

**Leaf (log).** The 377 bytes of one transparency log entry (CONTRACT §7).

**Live.** Status byte live and the current slot at most the expiry slot.

**`nk` (nullifier key).** A ring's 31-byte secret that derives its notes' nullifiers. Cannot spend; never rotates.

**Note.** A shielded amount of one asset in a ring: one leaf of the Rings state tree.

**Nullifier.** `Poseidon(commitment, blinding, nk)`. Published by the Rings program, as a PDA, when the note is spent.

**Nullifier PDA.** `["nullifier", tree, nullifier]` under the Rings pool program: 11 bytes, first byte 8. Its existence
proves the spend.

**Opening.** What a note's commitment is computed from: asset, amount, blinding, leaf index, optional data fields.

**Payer.** The key that pays the fee and the rent of a certificate: the wallet, or the relayer.

**Privacy Ring (ring).** A Helius shielded account space owned by an Ed25519 key; amounts and assets inside are encrypted.

**Relayer.** The key that submits `certify` for X-handle and badge subjects after the holder pays it.

**Renew.** A fresh attestation over the same notes, subject and controller; extends a live certificate.

**Room.** A `pof_gate` account with an asset and a minimum tier; members join with a live certificate.

**Salt / salted nullifier hash.** A random 32 bytes per disclosed note; the certificate stores
`sha256("pof:null:" ‖ salt ‖ nullifier)`, so the nullifier stays hidden until it is shown.

**Signed tree head (STH).** The Verifier's signature over `"POF-STH1" ‖ program id ‖ size ‖ root`.

**Slot.** Solana's unit of time and the only clock in POF.

**State root.** The root of the Rings state tree; the tree account keeps the last 500.

**Subject.** What a certificate is about: a wallet (0), an X handle (1) or a badge (2), stored as a hash (CONTRACT §1).

**Tier.** A floor in a fixed table: SOL 1, 10, 100, 1,000, 10,000; USDC 100 to 1,000,000.

**Transparency log.** The append-only Merkle log of every attestation, RFC 9162 hashing.

**Vault.** The ring the client certifies from, separate from the wallet's own ring. Its spending key is derived from one
wallet signature over the vault message (or is random, with a passphrase backup, for wallets that do not sign
deterministically).

**Verifier.** The off-chain service that checks a disclosure package and signs the attestation. Keeps no amount, opening
or `nk`.

**Witness.** An independent monitor of the transparency log that checks each signed head against the chain and the heads
before it, cosigns it, and records alarms (CONTRACT §8).
