---
title: Proof of Funds
order: 1
summary: A live, public certificate that a subject holds at least a tier of SOL or USDC in a Helius Privacy Ring, revoked on chain when the money moves.
---

# Proof of Funds

## Abstract

Proof of Funds (POF) issues a public, on-chain certificate that a **subject** holds **at least** a tier of SOL or USDC in a
Helius Privacy Ring. A subject is a Solana wallet, an X handle, or a fresh badge key. The certificate carries the tier
(for example "at least 1,000 SOL"), never an amount. It stays live only while the notes behind it are unspent: when one of
them is spent, anyone holding that note's revocation pair can prove the spend from chain state, and the program marks the
certificate revoked at that slot.

The protocol has five parts. The holder's browser picks the fewest shielded notes that reach the tier and sends their
openings to the **Verifier**. The Verifier recomputes every commitment, checks that each one is in the Rings state tree
under a root the tree account holds, derives every nullifier and checks that none is spent, checks that the sum reaches
the tier, and signs a fixed 240-byte attestation. The **`pof` program** rebuilds those 240 bytes on chain, checks the
Verifier's ed25519 signature, and writes the certificate. The **transparency log** records every attestation the Verifier
signs in an append-only Merkle log whose signed head is anchored on chain. The **keeper** watches the disclosed nullifiers
and calls `revoke_spent` when one appears; the holder keeps the same revocation pairs, so revocation does not depend on us.

Version 1 has one trusted party for privacy: the Verifier sees the amounts of the notes you disclose and the nullifier key
of the ring they sit in, for the length of one request. It keeps neither. The program does not trust the Verifier with
revocation: a spend is proven from the Rings program's own accounts. Phase 2 replaces the Verifier's view with a
zero-knowledge proof.

## What is private and what is not

| | who can see it |
|---|---|
| The subject (wallet, or the hash of an X handle, or a badge key) | everyone (an X handle is stored as a hash, but anyone can hash a handle and compare) |
| The asset and the tier | everyone |
| Every attestation the Verifier signs, submitted or not, with its subject hash, tier and slots | everyone, permanently, in the transparency log |
| The slots it was issued at, expires at, was revoked at | everyone |
| How many notes back it (1 to 8) | everyone |
| The payer (the wallet itself, or the relayer for handles and badges) and the controller key | everyone |
| The amounts of the disclosed notes | the Verifier, during one request; nobody else |
| The ring the notes sit in, and its nullifier key | the Verifier, during one request; nobody else |
| Which notes back it | the Verifier (during the request) and the registered keepers (as salted nullifiers they watch); nobody else while it is live; one note becomes public if the certificate is revoked by a spend |
| The rest of the ring's balance and history | nobody (POF never sees notes you do not disclose) |
| The wallet that funded a vault ring | everyone, on chain, from the deposit itself (see [Privacy guidance](privacy)) |

POF is not anonymity. A certificate is as private as the subject you choose and the way you fund the ring behind it.

## Reading order

1. [Trust points](trust): what you are trusting, stated first.
2. [Motivation](motivation): why a proof of funds, and why now.
3. [System model](system-model): the parties and what each one holds.
4. [The protocol](protocol): every step, with the exact bytes.
5. [Threat model](threat-model): the adversaries and what stops them.
6. [Revocation](revocation): how a certificate dies.
7. [The transparency log](transparency-log): how anyone audits the Verifier.
8. [Privacy guidance](privacy): how to keep what is private, private.
9. [Fees and the $ROOT holder rule](fees).
10. [Phase 2](phase-2): the zero-knowledge Verifier.
11. [Developers](developers): the API, the SDK, the CPI gate, the bots.
12. [Status](status): what the status page measures.
13. [FAQ](faq) and [Glossary](glossary).

The normative byte layouts live in [`CONTRACT.md`](https://github.com/liakh10/pof/blob/main/CONTRACT.md). The facts about
Privacy Rings that POF relies on, each checked against mainnet reads, live in
[`RINGS.md`](https://github.com/liakh10/pof/blob/main/RINGS.md). Where this paper and the code disagree, the code is what
runs, and the disagreement is a bug: please report it ([Security](https://github.com/liakh10/pof/blob/main/SECURITY.md)).
