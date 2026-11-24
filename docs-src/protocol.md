---
title: The protocol
order: 5
summary: Every step from a wallet to a live certificate, with the exact bytes the Verifier signs and the program rebuilds.
---

# The protocol

The normative layouts are in [`CONTRACT.md`](https://github.com/liakh10/pof/blob/main/CONTRACT.md) (§1 subjects, §2 tiers,
§3 the attestation, §4 the disclosure package, §5 revocation, §6 accounts and HTTP, §7 the log). This page walks through
them in the order they are used. Byte strings in quotes are UTF-8; `‖` is concatenation; integers are little-endian unless
marked otherwise; Poseidon is BN254 with the circom parameters, exactly the Rings SDK hasher.

## Step 0. A vault ring

The client asks the wallet to sign one plain-text message:

```
Proof of Funds vault key
wallet: <wallet address>
This signature makes your POF vault, a separate Privacy Ring for certificates. Sign it only on Proof of Funds.
```

The vault's Ed25519 seed is `sha256("pof/vault/v1" ‖ signature)`. From it the Rings SDK derives the vault's nullifier key
`nk` (31 bytes) and its viewing key. Signing the same message again on any device rebuilds the same vault. The client can
also use the wallet's own ring (the Rings derivation signature, RINGS.md §6), but then the Verifier sees the main ring's
`nk`; the vault is the default.

The vault is registered once in the Rings User Registry (record PDA `["zolana/registry/v0", owner]`, 100 bytes, rent
0.00115824 SOL). The wallet pays; the vault key co-signs. The record publishes the vault's nullifier public key
`npk = Poseidon(nk)` and its viewing public key.

Funds enter the vault with a proofless Rings deposit from the wallet. **The deposit is public**: the depositing wallet, the
amount, and the vault as recipient are in the transaction. What happens after the deposit is private.

## Step 1. Notes and their age

The client syncs the vault's notes through the indexer and decrypts them. For a chosen asset and tier it picks the
**fewest notes** whose amounts reach the tier minimum, using only notes whose creating transaction is at least
**150 slots** old (the Verifier refuses younger ones with `NOTE_TOO_NEW` and says how many slots to wait). At most 8 notes,
all in tree 0.

For each note, the commitment is (RINGS.md §2):

```
ownerHash  = Poseidon( hashBytes(0x53 ‖ ownerKey), Poseidon(nk) )
commitment = Poseidon( 3, treeId, hashBytes(mint), amount,
                       dataHash or 0,
                       Poseidon( ringDataHash or 0, ringProgramId ? hashBytes(ringProgramId) : 0 ),
                       Poseidon( ownerHash, blinding ) )
nullifier  = Poseidon( commitment, blinding, nk )
```

## Step 2. The subject proof

**Wallet (kind 0) and badge (kind 2).** The subject key signs these lines, joined with `\n`:

```
Proof of Funds: subject proof
program: <pof program id>
subject: <wallet|badge> <value>
ring: <vault owner key>
asset: <SOL|USDC> tier: <tier>
payer: <payer>
slot: <a recent slot>
```

The `ring:` line binds the subject to the ring the notes sit in. The slot must be within 1,500 slots of the Verifier's read.
A badge key is made fresh in the page; its secret is kept, sealed, in the kit.

**X handle (kind 1).**
1. `POST /api/link/start {handle}` returns a one-time code `pof-xxxxxxxx` (it lives 30 minutes; only its hash is stored).
2. The holder posts it from the handle.
3. `POST /api/link/check {handle, post}`: the linker reads the post through fxtwitter, checks that the author is the
   handle, that the post contains the live code and is not older than the code, and returns a **link id**: the Verifier's
   own ed25519 signature over the handle and an expiry one hour ahead. After 5 wrong tries the code is burnt.

The link id is the subject proof; no handle state is stored. The client also derives the X certificate's **controller**
key, `Ed25519(sha256(ctlSeed ‖ "x:" ‖ handle))` with `ctlSeed = sha256("pof:ctl:v1" ‖ vault seed)`.

## Step 3. The disclosure package

`POST /api/attest` with (CONTRACT §4):

```json
{
  "v": 1,
  "subject": { "kind": 0, "value": "<wallet | handle | badge key>", "proof": "<signature | link id>", "slot": "<slot>" },
  "asset": 0, "tier": 3,
  "ring": { "owner": "<vault owner key>", "nk": "<hex 31>" },
  "notes": [ { "tree": "777pvSGe…", "leafIndex": "…", "asset": "<mint>", "amount": "…", "blinding": "<hex 32>",
               "sig": "<transaction that created the note>" } ],
  "payer": "<wallet, or the relayer>", "relay": false,
  "controller": "<kind 1 only>"
}
```

The body is at most 16,384 bytes. Requests are rate-limited per client (6 a minute, 30 per 10-minute window).

## Step 4. What the Verifier checks

In this order, each failure with its own code (`verifier/src/verify.ts`):

1. Version 1; a known asset and tier; 1 to 8 notes; for kind 1 a controller that is not the default key, for kinds 0 and 2
   no controller other than the subject key. With `relay: true`, the payer must be the relayer.
2. The subject proof: the signature over the subject message by the subject key, with a fresh slot
   (`BAD_SUBJECT_PROOF`, `SUBJECT_PROOF_STALE`), or a link id this Verifier issued, unexpired, for this handle
   (`LINK_EXPIRED`).
3. The ring: a User Registry record exists for `ring.owner` (`NO_RING`) and `Poseidon(nk)` equals its `npk`
   (`NULLIFIER_KEY_MISMATCH`).
4. The tree: one read of the tree account gives the current state root, its slot (the u64 at offset 120), the 500-root
   history and the 100 nullifier roots. The root must be no older than the program accepts (`ROOT_TOO_OLD`: 9,000 slots).
5. Each note: the mint matches the asset (`WRONG_ASSET`), all notes in one tree (`MIXED_TREES`), no duplicates, and the
   commitment is recomputed with the SDK's own hasher.
6. Membership: the indexer's 32-level Merkle path for each commitment is re-hashed here with Poseidon; it must reach a
   root that is in the tree account's on-chain history, at the stated leaf index (`NOT_IN_TREE`).
7. Unspent: each nullifier is derived here from `nk`, so no note can be certified under a nullifier it will never
   publish. A nullifier is spent if its PDA `["nullifier", tree, nf]` exists under the Rings program; otherwise the
   indexer's 40-level non-inclusion path is re-hashed and must reach one of the on-chain nullifier roots
   (`NOTE_SPENT`, `NULLIFIER_UNPROVEN`).
8. Age: each note's creating transaction (from the indexer) created that commitment at that leaf, at least 150 slots ago
   (`NOTE_TOO_NEW`).
9. The sum of the amounts reaches the tier minimum (`BELOW_TIER`). The sum is compared, never returned.
10. One note, one certificate: a keyed index `HMAC(seal key, nullifier)` refuses a note already behind another live
    certificate for a different subject or asset (`NOTE_IN_USE`).

## Step 5. Salts, hashes and the 240 bytes

For each note the Verifier draws a 32-byte random `salt` and computes
`h = sha256("pof:null:" ‖ salt ‖ nullifier)`. The hashes are sorted ascending; `nullset_hash = sha256(h_1 ‖ … ‖ h_n)`.
Then it signs, with ed25519, exactly these bytes (CONTRACT §3):

| offset | size | field |
|---|---|---|
| 0 | 4 | `"POF1"` |
| 4 | 32 | the `pof` program id |
| 36 | 1 | subject kind |
| 37 | 32 | subject hash: `sha256("pof:wallet:" ‖ base58)`, `sha256("pof:x:" ‖ lowercase handle)`, `sha256("pof:badge:" ‖ base58)` |
| 69 | 1 | asset (0 SOL, 1 USDC) |
| 70 | 1 | tier (1 to 5) |
| 71 | 32 | the Rings state root of tree 0 the notes were found under |
| 103 | 8 | that root's slot (u64) |
| 111 | 1 | note count |
| 112 | 32 | `nullset_hash` |
| 144 | 8 | issued slot (the slot the Verifier read) |
| 152 | 8 | expiry slot (issued + 6,480,000) |
| 160 | 32 | payer |
| 192 | 32 | controller |
| 224 | 16 | random nonce |

Then it appends a 377-byte leaf to the transparency log (§7: `0x01 ‖ attestation ‖ signature ‖ verifier key ‖
bundle hash ‖ logged slot`), hands the keeper the sealed pairs `(h, salt, nullifier)`, zeroes `nk`, and answers:

```
{ attestation (hex 240 B), signature, verifierKey, salts[], nullifiers[], hashes[] (sorted), logIndex,
  subjectHash, controller, issuedSlot, expirySlot, bundleHash, certificate: { seeds } }
```

The salts and nullifiers are the holder's **revoke kit**. The client stores the kit locally, with the openings sealed under a
key derived from the vault, and can export it as a file.

## Step 6. Submitting `certify`

The program refuses an attestation older than **300 slots** (`max_attest_age`), so submission follows at once.

- **Wallet subject.** The wallet sends one transaction: an Ed25519-program instruction carrying the Verifier's signature,
  key and the 240-byte message, immediately followed by `certify(attestation, log_index)`. The wallet is the payer.
- **X handle or badge.** The holder asks `GET /api/relay/quote` for the exact lamports (the fee, the certificate rent, a
  network fee, and a few unique lamports that tag the payment), pays that amount to the relayer from any wallet or as a
  Ring withdrawal, then calls `POST /api/relay/certify` with the attestation, its hashes, the log index and the quote. The
  relayer finds the matching unused payment, checks its rolling 24-hour spend cap and balance floor, and submits the same
  two instructions as payer.

## Step 7. What the program checks

`certify` rebuilds the 240 bytes from its arguments, its accounts and its own program id, and requires that the
instruction right before it is an Ed25519-program instruction with exactly one signature, whose key is the **active**
Verifier key in Config and whose message equals the rebuilt bytes. It also checks, by itself:

- kinds 0 and 2: the subject hash is the §1 hash of the controller; kind 1: the controller is not the default key;
- the asset is enabled and the tier exists in its table; 1 to 8 salted hashes, strictly ascending;
- `issued_slot ≤ now`, `now − issued_slot ≤ 300`; `root_slot ≤ issued_slot`, `issued_slot − root_slot ≤ 9,000`;
  `issued_slot < expiry_slot ≤ issued_slot + 6,480,000`, `expiry_slot > now`;
- not paused, not winding down;
- an existing certificate account is replaced only if it is no longer live and the new attestation is newer; its rent goes
  back to its previous payer.

It takes the fee ([Fees](fees)), writes the certificate at `["cert", subject_hash, [asset]]`, updates the Treasury counters
and emits `Certified`.

## Step 8. Renew

`renew` takes a fresh attestation over the **same notes** (the same salted hashes), the same subject, asset and
controller, with a newer issued slot. The Verifier re-checks everything in Step 4; the program updates the root, the slots
and the tier, and charges the fee again.

## Step 9. Reading and gating

Anyone reads the certificate account. A certificate is **live** when its status byte is live and the current slot is at
most its expiry slot. Other programs call `require_certificate(subject_hash, asset, min_tier)`, which fails unless the
certificate is live, unexpired, of that asset and at least that tier, and returns `{ subject_kind, tier, expiry_slot,
controller }`. Rooms (`pof_gate`) use exactly that. See [Developers](developers).
