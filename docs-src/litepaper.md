---
title: Proof of Funds, the litepaper
order: 99
pdf: true
summary: The protocol paper in two pages.
---

# Proof of Funds

**A live, public certificate that a subject holds at least a tier of SOL or USDC in a Helius Privacy Ring. It never shows
the amount, and it is revoked on chain when the notes behind it are spent.**

## The problem

On a public chain, the way to prove you can pay is to show the wallet, and with it the whole history. Finance solved the
same problem long ago with a *proof of funds* letter: a trusted party states that a client holds at least a sum, without
handing over the statement. Since Helius Privacy Rings went live, balances inside a ring are encrypted. That makes a proof of
funds both possible and needed: the balance can no longer be shown by pointing at it.

## The certificate

A certificate is a program account `["cert", subject_hash, [asset]]`. Its subject is a Solana wallet, an X handle (stored as
a hash) or a fresh badge key. It records the asset, the tier (SOL: 1 to 10,000; USDC: 100 to 1,000,000, in powers of ten),
the slots it was issued and expires at, and the salted hashes of the nullifiers of the 1 to 8 notes behind it. It never
records an amount. Anyone can read it; other programs gate on it with one CPI, `require_certificate(subject_hash, asset,
min_tier)`; on-chain Rooms and Telegram and Discord bots gate communities on it.

## How it is issued

1. The holder's browser derives a **vault ring** from one wallet signature, registers it and shields funds into it.
2. It picks the fewest notes, each at least 150 slots old, that reach the tier, and sends their openings, the vault's
   nullifier key and a signed subject statement to the **Verifier**.
3. The Verifier recomputes each commitment with the Rings hasher, re-hashes the indexer's Merkle path to a root the tree
   account holds on chain, derives each nullifier and proves it unspent (no nullifier PDA, and a non-inclusion path to an
   on-chain nullifier root), checks the sum reaches the tier and that no note backs another live certificate. It then
   signs 240 bytes: domain, program id, subject, asset, tier, the tree root and its slot, the note count, the hash of the
   sorted salted nullifier hashes, issue and expiry slots, payer, controller, nonce.
4. It appends the attestation to a public **transparency log** (RFC 9162 Merkle hashing, signed tree heads anchored on
   chain with `anchor_log`) and returns the salts and nullifiers to the holder as a revoke kit.
5. `certify` rebuilds the 240 bytes on chain and checks them against an Ed25519-program instruction by the active
   Verifier key, within 300 slots of issue. For an X handle or a badge, a **relayer** submits it, so the holder's wallet
   signs nothing public.

## How it dies

Every Rings spend creates a nullifier PDA. Whoever holds a disclosed note's salt and nullifier (the keeper, the holder)
calls `revoke_spent`: the program recomputes the salted hash and checks the spend from the Rings accounts alone, either the
PDA or a membership path in the nullifier tree to an on-chain root. The certificate is revoked at that slot and the pair
becomes public. The controller can revoke at any time without revealing anything; anyone can close a certificate after
its expiry slot.

## What you trust

- **The Verifier sees the disclosed amounts and the vault's nullifier key** for one request, and can link subject, vault
  and funding wallet. The code keeps none of it; every signature is in the public log with the hash of the code that
  made it. A false attestation is detectable, not impossible.
- **Revocation on spend needs the salts.** Only the holder and the keeper have them, so in practice it depends on the
  keeper running. Expiry bounds the damage; the status page shows the keeper's last run.
- **The admin** can pause, rotate the Verifier key after a delay counted in slots, set the fee under a hard cap, and, as
  upgrade authority, upgrade the program.
- **Helius**: the Rings programs, the tree, and the indexer (its paths are re-checked against on-chain roots; note
  creation slots are taken from it). Rings is new and its SDK is alpha.
- **X and fxtwitter** for the handle check.
- **Control is not ownership**: borrowed funds certify, until they move.
- **Not anonymity**: deposits are public, so timing and amounts can pair a vault with a certificate.

## Fees

A fee per certify and renew (0.01 SOL at launch, capped at 0.25 SOL by the program) to the Treasury; the certificate's rent
is returned at expiry. A payer holding 1,000,000 $POF in its canonical token account pays no fee. The Treasury's counters
are public; its surplus goes to the dev key in Config.

## Phase 2

A Groth16 circuit over the same Poseidon proves membership, non-spending, the tier and an escrow of each nullifier to a
revocation key, so the program checks the statement itself and nobody sees an amount or a nullifier key. In development in
`zk/`, not deployed.

## Read further

The full paper (`/docs`), `CONTRACT.md` (every byte), `RINGS.md` (the Rings facts, checked on mainnet), `reports/` (tests
and the internal security review), and the source at github.com/liakh10/pof.
