# Proof of Funds: the shared contract

Every part of POF (program, browser client, verifier, keeper, API, SDK, MCP, bots, site) codes against this file.
Each section has an owner. Only the owner changes it, adds a dated line at the end of the section, and tells the consumers.
The first draft (2026-11-24) is the lead's. Anything marked **TBD(rings)** waits for the facts in `RINGS.md`.

## §1 Subjects (owner: program)
A certificate is about a subject. The subject is never stored in clear when it is a handle.

| kind | u8 | meaning | subject_hash |
|---|---|---|---|
| wallet | 0 | a Solana wallet | `sha256("pof:wallet:" ‖ base58(pubkey))` |
| x | 1 | an X handle, proven with a posted code | `sha256("pof:x:" ‖ lowercase(handle without @))` |
| badge | 2 | a fresh badge key made for this certificate | `sha256("pof:badge:" ‖ base58(pubkey))` |

The program recomputes the kind 0 and 2 hashes on chain from the attestation's `controller` (§3).
2026-11-25 (program): unchanged from the draft; on-chain check of kinds 0 and 2 added.

## §2 Assets and tiers (owner: program)
| asset | u8 | tiers (index: minimum) |
|---|---|---|
| SOL | 0 | 1: ≥ 1 · 2: ≥ 10 · 3: ≥ 100 · 4: ≥ 1,000 · 5: ≥ 10,000 SOL |
| USDC | 1 | 1: ≥ 100 · 2: ≥ 1,000 · 3: ≥ 10,000 · 4: ≥ 100,000 · 5: ≥ 1,000,000 USDC |

The tier table lives in the program's `Config` so a new asset can be added without a redeploy (`set_asset`: a free slot
takes a new table; a table already set can only be enabled or disabled, so issued tiers never change meaning). Asset ids 2
and 3 are free. The minimums are in base units (lamports; USDC with 6 decimals). These asset ids are POF's, not the Rings
asset ids (Rings: SOL 1, USDC 3).
2026-11-25 (program): unchanged from the draft; set_asset rule and base units stated.

## §3 The attestation bytes (owners: program + verifier, both must agree)
The Verifier signs these exact bytes with ed25519. `certify` and `renew` rebuild them on chain from the instruction args and
the accounts, and check them against the Ed25519 program instruction right before it (instructions sysvar; exactly one
signature, its signature, key and message all inside that instruction).

```
offset size field
0      4    domain        "POF1"
4      32   program_id    the pof program id (binds the signature to one deployment)
36     1    subject_kind  §1
37     32   subject_hash  §1
69     1    asset         §2
70     1    tier          §2
71     32   tree_root     the Rings STATE root of tree 0 (777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor) at which every
                          disclosed note was found (one root: all notes of one attestation in one tree)
103    8    root_slot     u64 LE, the u64 at tree offset 120 read with that root
111    1    note_count    1..=8
112    32   nullset_hash  sha256 of the sorted salted nullifier hashes (§5)
144    8    issued_slot   u64 LE, the slot the Verifier read when it signed
152    8    expiry_slot   u64 LE
160    32   payer         the signer that pays the fee and the rent (relayer or holder)
192    32   controller    the key that may revoke the certificate and join rooms with it: the wallet itself (kind 0), the
                          badge key itself (kind 2), a key the holder's client keeps for an X handle (kind 1)
224    16   nonce         random, so two attestations never collide
240         total
```
What the program checks on chain besides the signature (Config parameters, launch values):
- kind 0 / 2: `subject_hash == §1 hash of controller` (base58 on chain); kind 1: controller is not the default key;
- asset enabled, `1 <= tier <= ` the asset's tier count; `1 <= note_count <= 8`; salted hashes strictly ascending;
- `issued_slot <= now`, `now - issued_slot <= max_attest_age` (300 slots); `root_slot <= issued_slot`,
  `issued_slot - root_slot <= max_root_lag` (9,000); `issued_slot < expiry_slot <= issued_slot + validity_slots`
  (6,480,000, about 30 days), `expiry_slot > now`;
- payer == the signer paying; certify over an existing certificate only when it is not live, with a newer `issued_slot`;
  renew only with the same subject, asset, controller and salted hashes, and a newer `issued_slot`.

2026-11-25 (program): `controller` added at 192 (the bytes are 240 now, the nonce moved to 224): an X-handle certificate
needs a key that can revoke it and join rooms, and the relayer pays for it. `tree_root`/`root_slot` fixed per RINGS §9.
The transparency log leaf (§7) carries these 240 bytes.

## §4 The disclosure package (owner: verifier; producer: rings client)
What the browser sends to `POST /api/attest`. It carries the openings of the chosen notes only, over TLS, never stored.

```json
{
  "v": 1,
  "subject": { "kind": 0, "value": "<base58 wallet | handle | base58 badge pubkey>", "proof": "<wallet signature | link id | badge signature>" },
  "asset": 0,
  "tier": 3,
  "notes": [ { "opening": "TBD(rings): the fields that recompute the commitment", "leafIndex": 0, "tree": "<pubkey>" } ],
  "payer": "<base58>",
  "relay": true
}
```
The answer: `{ attestation: <hex 208 bytes>, signature: <hex 64>, verifierKey, salts: [hex], nullifiers: [hex], logIndex }`.
The salts and nullifiers go back to the browser, which saves them (the holder's own revoke kit).

## §5 Salted nullifiers and revocation (owner: verifier, with program)
- For each disclosed note: `salt` = 32 random bytes; `h = sha256("pof:null:" ‖ salt ‖ nullifier)`.
- The certificate stores the sorted list of `h` (up to 8). `nullset_hash = sha256(h_1 ‖ … ‖ h_n)`.
- `revoke_spent(i, salt, nullifier, membership?)`: anyone. The program recomputes `h_i` and checks that `nullifier` is spent on
  the Rings program (RINGS §3), by one of two proofs from chain state alone; an absent or closed PDA is never read as unspent:
  (a) no `membership`: the account at `PDA(["nullifier", tree, nullifier], ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW)`
  exists, is owned by that program, is 11 bytes and data[0] == 8 (accounts: `tree`, `nullifier_account`);
  (b) `membership = { leaf_index u64, next_value [32], path [[32]] }`: leaf `Poseidon(nullifier, next_value)` at
  `leaf_index`, siblings from the leaf up (at most 40; levels left out are empty subtrees, so 16 levels while the tree has
  under 65,536 nullifiers), hashes to one of the 100 nullifier roots at offset 17,232 of the tree account. About 35k CU.
  A Verifier-signed "spent" statement is not needed and not accepted.
- The keeper holds `(salt, nullifier)` encrypted at rest; the holder holds a copy. After a revoke, salt and nullifier are public
  (on the certificate: `revealed_index`, `revealed_salt`, `revealed_nullifier`, and in the `Revoked` event).

2026-11-25 (program): the on-chain check of revoke_spent fixed (both paths, built and unit-tested against a real mainnet path).

## §6 Accounts and API (owner: program for accounts, devx for HTTP)
- Program ids: `pof` = `pofP4QRRDXnmDN9CNYiAGHfwMEgM7sLWhVcUMpsbynT`, `pof_gate` = `gatSToJMD8ZPLa85fKj6seYHUtYx4ah3ptZvLkisLPU`.
  IDLs: `program/idl/pof.json`, `program/idl/pof_gate.json` (Anchor; account and event layouts come from them).
- `Certificate` PDA `["cert", subject_hash, [asset]]` (8-byte Anchor discriminator, then): subject_kind u8, subject_hash
  [32], asset u8, tier u8, status u8 (0 live, 1 revoked spent, 2 revoked by holder; readers show 3 expired when a live byte
  is past expiry_slot; `expire` then closes the account), certified_slot, issued_slot, expiry_slot, revoked_slot (u64),
  tree_root [32], root_slot u64, note_count u8, null_hashes [[32]; 8], nullset_hash [32], payer, controller, verifier
  (pubkeys), nonce [16], log_index u64, renewals u32, revealed_index u8 (255 none), revealed_salt [32], revealed_nullifier
  [32], bump u8.
- `Config` PDA `["config"]`: admin, dev, relayer, verifier, next_verifier, next_verifier_slot, root_mint,
  root_token_program, params { fee_lamports, holder_min, validity_slots, max_attest_age, max_root_lag, rotation_delay },
  assets [4] { enabled, mint, decimals, mins [5] } (0 SOL, 1 USDC), paused, closing, launch_slot. The active verifier key is
  `next_verifier` once `slot >= next_verifier_slot` (and not default), else `verifier`.
- Treasury PDA `["treasury"]` (holds the fees; the public counters): fees_in, fees_out, certified, renewed, revoked_spent,
  revoked_holder, expired, live, live_min [4] (sum of tier minimums of live certificates by asset, base units), open,
  relayed, exempt, log_size, log_head [32], log_slot.
- `pof_gate` Room `["room", creator, id u64 LE]`: creator, id, asset, min_tier, open, name [32], members u32, joined,
  evicted, created_slot. Member `["member", room, subject_hash]`: room, subject_hash, subject_kind, certificate,
  controller, payer, joined_slot.
- CPI: `pof::require_certificate(subject_hash, asset, min_tier)` with the one account `certificate` returns `CertView {
  subject_kind, tier, expiry_slot, controller }` (return data) or fails (NotLive, CertificateExpired, TierTooLow,
  AssetMismatch, BadCertificate). Rust consumers can read without CPI: `pof::read_certificate` + `pof::gate` (crate feature `cpi`).
- HTTP (devx; the full schema is `api/openapi.json`, served at `/v1/openapi.json`). Read-only, CORS `*`, CDN-cached
  (`s-maxage` 5 to 15 s). Errors are `{ error: { code, message } }` with 400 / 404 / 502 / 503.
  - `GET /v1/certificates/:subject` (subject = `@handle`, `x:h`, `wallet:<b58>`, `badge:<b58>`, a bare key tried as wallet
    and badge, or a 64-hex subject hash; `?asset=SOL|USDC&minTier=n` adds a gate `check: { ok, reason }`) →
    `{ query, slot, subjects: [{ kind, value, subjectHash }], live, certificates: [Certificate] }`. No certificate is a 200
    with an empty list.
  - `Certificate` = `{ address, subject, kind, subjectHash, asset, assetId, tier, tierLabel, status, statusOnChain, live,
    certifiedSlot, expirySlot, revokedSlot, logIndex, noteCount, payer, verifierKey }`. `status` is effective at `slot`
    (a live byte past `expiry_slot` reads `expired`); `subject` is null in lists (the chain holds only the hash).
  - `GET /v1/certificates?asset=&tier=&minTier=&status=&kind=&limit=&cursor=` → `{ slot, total, nextCursor, certificates }`.
  - `GET /v1/rooms`, `GET /v1/rooms/:room` → the room plus `members: [{ subjectHash, certificate, certificateStatus, tier,
    live }]`, where live = the certificate is live and meets the room's asset and tier.
  - `GET /v1/stats` → `{ slot, live, total, revoked, revokedSpent, revokedByHolder, expired, solCertified, usdcCertified,
    byAsset, bySubjectKind, log }` (the "certified" sums are tier minimums, never amounts).
  - `GET /v1/log/head`, `GET /v1/log/proof/:id`: proxied from §7 `/api/attest/log` and verified with the SDK on the way
    (`verified`, `checks`), so a reader still can, and should, check again with `@pof/sdk`.

2026-11-25 (devx): HTTP part of §6 fixed: shapes above; one subject answers with a list of certificates (one per asset).

## §7 The transparency log (owner: verifier; consumers: devx SDK, site /log)
An append-only Merkle log of every attestation the Verifier signs, per RFC 9162 (Certificate Transparency v2) hashing.
It holds no amounts, no openings, no nullifiers, no salts: only the §3 bytes (which carry the salted `nullset_hash`).

**Leaf data** (fixed 345 bytes, all integers little-endian):
```
offset size field
0      1    version        0x01
1      208  attestation    the exact §3 bytes
209    64   signature      the Verifier's ed25519 signature over the attestation
273    32   verifier_key   the ed25519 public key that signed
305    32   bundle_hash    sha256 of the Verifier bundle that produced it (pof/verifier/dist/BUILD.json)
337    8    logged_slot    u64, the slot the Verifier read when it appended the entry
345         total
```
- `leaf_hash = sha256(0x00 ‖ leaf_data)`; `node = sha256(0x01 ‖ left ‖ right)`; the tree over n leaves is RFC 9162 §2.1.1
  (split at the largest power of two below n); the empty tree's root is `sha256("")`.
- Inclusion proofs are RFC 9162 §2.1.3 audit paths (`index`, `tree_size`, `path: [hex32]`), checked with the §2.1.3.2
  algorithm. Consistency proofs between two sizes are RFC 9162 §2.1.4.
- **Signed tree head**: the Verifier signs with the same ed25519 key the 80 bytes
  `"POF-STH1" (8) ‖ program_id (32) ‖ tree_size u64 (8) ‖ root_hash (32)`. JSON: `{ treeSize, rootHash, slot, signature,
  verifierKey }` (`slot` is informational, not signed: the anchor below fixes the time).
- **Anchor on chain**: a Memo-program instruction with the UTF-8 text `pof:log:<tree_size>:<root_hash hex>` inside every
  relayed `certify` transaction, and a periodic memo from the keeper (off before launch). Anyone can match a head to a slot.
- **Entry id**: the leaf index (u64, from 0). `logIndex` in the §4 answer and on the Certificate is this index.
- HTTP (served by `pof/api/attest/log*`, devx may proxy under `/v1/log/*`): `GET /api/attest/log?head` → STH JSON;
  `GET /api/attest/log?entry=<i>` → `{ index, leaf: hex345, leafHash }`; `GET /api/attest/log?proof=<i>&size=<n>` →
  `{ index, treeSize, rootHash, path: [hex] }`; `GET /api/attest/log?from=<i>&to=<j>` → entries (≤ 256).

2026-11-25 (verifier): §7 added: RFC 9162 hashing as devx proposed, 345-byte leaf, 80-byte signed head, memo anchor.
