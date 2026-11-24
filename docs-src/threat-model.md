---
title: Threat model
order: 6
summary: What the Verifier learns and keeps, every adversary we designed against, what stops each one, what is left, and what phase 2 removes.
---

# Threat model

This page covers the off-chain half of POF: the Verifier, its transparency log, the relayer, the keeper and the X-handle
linker (`verifier/`, `api/attest`, `api/relay`, `api/keeper`, `api/link`). The program's own checks are in
[Protocol](protocol) and [Revocation](revocation); the trust points they rest on are in [Trust points](trust). Every claim
below names the code that enforces it and the test that proves it (`reports/verifier.md`).

## What a certificate claims

At `issued_slot`, the Verifier saw one to eight notes in the Helius Privacy Rings state tree, owned by a ring whose owner
signed this exact request, all unspent, each older than the minimum age, summing to at least the tier; and it bound that
statement to one subject, one controller key and one payer. Afterwards, the certificate is live until one of those notes
is spent (anyone with the salt can then prove it on chain), its controller revokes it, or it expires.

It does **not** claim the money is the subject's own (only that whoever asked controls the ring), the total balance of
the ring, or how long the money was held before the note was made.

## What the Verifier learns

For one request, over TLS:

| item | why it is needed |
|---|---|
| each disclosed note's **amount**, blinding, asset, leaf index and creating transaction | to recompute the commitment and prove it is in the tree |
| the ring owner's public key and its signature | to prove the ring's owner asked for this certificate (audit POF-02) |
| the ring's **nullifier key `nk`** | to derive each note's nullifier itself; a nullifier the holder merely claimed could be one that never appears, and the certificate would never die |
| the subject, its signature or X link id, the controller and its signature, the payer | to bind the statement |
| the client's IP address (HTTP) | rate limits |

From these the operator can link the subject to the vault ring, and the vault to the public deposit that funded it.
`nk` lets its holder see **when** each deposit into that ring is later spent and read the ring's merge outputs; it cannot
spend, and it cannot read transfer notes (RINGS.md §5). This is why the client certifies from a separate vault ring.

## What the Verifier keeps

Nothing it is shown about money. `nk` lives in memory for the request: its key bytes are zeroed when the request ends
(`verify.ts`, `finally`) and the request body is dropped with it (JavaScript gives no stronger guarantee over strings).
The process writes only these, to a private Vercel Blob store:

| prefix | content | at rest |
|---|---|---|
| `log/e/<i>` | the 377-byte §7 leaf: the §3 bytes, the signature, the key, the bundle hash, the slot | public by design (the log) |
| `keeper/kits/<subject>-<asset>/<attestation hash>` | per disclosed note: the salted hash, the salt, the nullifier | AES-256-GCM, key `POF_SEAL_KEY`, the blob name as associated data |
| `escrow/<subject>-<asset>/<attestation hash>.json` | the same kit, sealed to each registered keeper's X25519 key | X25519 + HKDF + AES-256-GCM per keeper |
| `notes/<HMAC(nf)>/<gen>` | which subject and asset a note currently backs, and until which slot | the name is a keyed hash of the nullifier; no amount |
| `link/<h(handle)>/<h(secret)>` | the hash of a pending X code, its time, tries and controller | hashes only, 30 minutes |
| `relay/paid/<payment signature>`, `relay/spend.json` | which payment paid which attestation; the relayer's spend in the last 24 hours | |
| `limits/<route>/<window>/<HMAC>` | a request count | the client is `HMAC(window key, ip)`, the window key derived from the seal key and rotated every 10 minutes; old windows are deleted by the keeper's sweep; no raw IP is written |
| `keeper/last-scan.json`, `keeper/cursor`, `log/anchored` | the keeper's last pass | |

No amount, no opening, no `nk`, no blinding is written anywhere, and no request body is logged. An internal error logs a
reference id and a stack with RPC keys scrubbed.

## Adversaries and what stops them

### A holder who wants a certificate the money does not support

| attack | what stops it | where |
|---|---|---|
| claim an amount the note does not hold | the commitment is recomputed from the opening with the SDK's hasher; a wrong amount is a different commitment, which is not in the tree | `verify.ts` NOT_IN_TREE; tests "rejections" |
| point at a commitment that is not in the tree, or one under a forged root | the indexer's path is re-hashed with the SDK's Poseidon; the root must be one of the 500 in the tree account | `verify.ts`, `rings.ts decodeTreeAccount` |
| certify spent notes | the nullifier is derived from `nk` here; its PDA must be absent, and the indexer's non-inclusion path must reach an on-chain nullifier root | `rings.ts spent`, `checkNonInclusion` |
| give a fake nullifier so the certificate never dies | the holder never gives nullifiers; `Poseidon(nk)` must equal the `npk` in the owner's registry record | NULLIFIER_KEY_MISMATCH |
| certify someone else's ring (a public deposit's opening is public data) | the ring owner signs the disclosure message; without that key nothing is signed | BAD_RING_PROOF (POF-02) |
| back many subjects with one note | a keyed index of nullifiers; a lock is an atomic create of the next generation, so two parallel requests cannot both take it | `locks.ts` NOTE_IN_USE (POF-04) |
| shield and certify in the same minute, so the certificate dates the shield | a minimum note age (150 slots by default) from the creating transaction's slot | NOTE_TOO_NEW |
| borrow, certify, return ("rent a whale") | not preventable from openings. The return is a spend, the spend revokes the certificate on chain, and the card reads live status | keeper, program `revoke_spent` |
| spend between attestation and certify | the program refuses an attestation older than `max_attest_age` (300 slots); the keeper still watches the kit and revokes once it lands | `keeper.ts` |
| replay an old attestation | `issued_slot` age, a random nonce, and certify over a live certificate is refused unless newer | program |
| land a second attestation of the same subject after revoking the first, so nobody watches it | the keeper keeps every kit per attestation until it can no longer land or its certificate dies, never because a sibling is live | `keeper.ts` (POF-05) |

### A third party

| attack | what stops it | where |
|---|---|---|
| redeem the X code someone posted (it is public) | check needs the secret that `start` returned only to the starter's browser | NO_SECRET (POF-03) |
| use a leaked link id to certify the handle with their own money | a link id is bound to one controller, and the controller signs the disclosure message | LINK_OTHER_CONTROLLER, BAD_CONTROLLER_PROOF (POF-03, POF-26) |
| cancel a victim's pending code by starting again, or by wrong tries | each start is its own record, tries count per record | POF-09 |
| drain the relayer | it serves only paid, signed attestations for X and badge subjects; a rolling 24-hour cap and a balance floor; a payment is used once and given back only when the certify surely did not land | `relayer.ts` (POF-08, POF-28) |
| flood the Verifier | a per-instance token bucket per client and route, a store-backed cap per 10 minutes per client, a 16 KB body cap; the expensive checks run after the cheap ones | `limits.ts`, `app.ts` |
| read someone's holdings from the log or the escrow | the log holds the §3 bytes (subject hash, tier, salted nullset); the escrow holds sealed envelopes | §7, `escrow.ts` |
| test whether a known nullifier backs a certificate | the certificate stores `sha256("pof:null:" ‖ salt ‖ nf)` with a 32-byte random salt; the lock index is an HMAC | CONTRACT §5 |

### A source that lies

- **The Helius indexer.** It cannot invent membership or non-membership: both paths are re-hashed here and must end at
  roots the tree account holds on chain. It is trusted for two things: the slot of a note's creating transaction (the
  minimum age) and liveness (if it refuses to answer, nothing is signed).
- **The RPC node.** The tree account, the registry record and the nullifier PDAs are read from it. A lying node could hide a
  nullifier PDA. Mitigation: `SOLANA_RPC` takes several nodes; the non-inclusion check is a second, independent source for
  the same fact.
- **X and fxtwitter.** The handle check believes the post's author and text. A compromised X account can be linked by
  whoever controls it, which is what the certificate says.

### The operator, or someone who takes its keys

- **Records what it sees.** Not detectable from outside. The code is open, the bundle is reproducible and its hash is in
  every log entry and on `/status`, so a changed binary is visible; a dishonest operator running the published code and
  also copying memory is not. This is the first trust point, and phase 2 removes it.
- **Signs a false attestation.** Possible with the key. Every signature the Verifier makes goes into the append-only log
  with the bundle hash, and the log head is anchored on chain by `anchor_log`; a false attestation is permanent and
  attributable. Witnesses cosign heads (CONTRACT §8), so a forked log is caught.
- **Steals the Verifier key.** Rotation is `set_verifier` with a delay in slots; every attestation names the key that
  signed it. The key never leaves `~/.config/pof` (600) and the Vercel env, and is never printed.
- **Takes the seal key.** It opens the keeper's kits: salts and nullifiers of live certificates, which let it revoke them
  early (harmless to holders' money) and link a spend to a certificate. No amounts.
- **Stops the keeper.** Revocation then waits for someone else holding a kit: the holder (the client keeps its own), any
  registered keeper reading the escrow (`scripts/witness-keeper.mjs`), and in the worst case expiry, which is one day at
  launch (POF-01). `revoke_spent` is permissionless; it needs only the salt and the nullifier.

## What is left

- The Verifier sees the amounts of the disclosed notes and the ring's `nk`, and can link subject, vault and funding wallet.
- The minimum age relies on the indexer's slot for the creating transaction.
- A certificate shows control of a ring at a slot, not ownership. Borrowed money certifies until it moves.
- If every keeper and the holder are offline, a spent certificate stays live until it expires (at most `validity_slots`).
- If Helius ever closes nullifier PDAs before a keeper acts, revocation needs the nullifier-tree membership path, which
  the program accepts and the keeper builds from the indexer (`rings.ts nullifierMembership`).

## What phase 2 removes

A zero-knowledge range proof (see [Phase 2](phase-2)) proves, in the browser, that some notes in the tree, owned by the
prover's ring and unspent at a root, sum to at least the tier, and outputs only the salted nullifier hashes. The program
verifies it. Then:

- nobody sees an amount, an opening or `nk`; the Verifier's view, the first trust point, is gone;
- the Verifier's key, and with it the false-attestation and key-theft cases, are gone: the program checks the proof;
- the linkage of subject, vault and funding wallet by the operator is gone;
- what stays: the indexer and RPC for state reads, X for handles, the keepers for timely revocation, and expiry as the
  bound.
