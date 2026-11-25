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
71     32   tree_root     the Rings STATE root head of tree 0 (777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor) the Verifier
                          read and proved every disclosed note under (the tree is append-only, so the head holds every
                          earlier note; one root: all notes of one attestation in one tree)
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
  (216,000, about a day; the admin may set 9,000 to 1,512,000), `expiry_slot > now`;
- payer == the signer paying; certify over an existing certificate only when it is not live, with a newer `issued_slot`;
  renew only with the same subject, asset, controller and salted hashes, and a newer `issued_slot`.

2026-11-25 (program): `controller` added at 192 (the bytes are 240 now, the nonce moved to 224): an X-handle certificate
needs a key that can revoke it and join rooms, and the relayer pays for it. `tree_root`/`root_slot` fixed per RINGS §9.
The transparency log leaf (§7) carries these 240 bytes.
2026-11-25 (program, audit round 1): renew refuses an expired certificate (POF-22) and needs the SAME salted hashes, so the
Verifier's renew path must take the holder's old salts back; `log_index` is not signed (POF-18): readers find the log entry by
the attestation bytes (nonce, nullset_hash), never by the index alone; tree_root wording per POF-25.
2026-11-25 (program, POF-01): the launch validity is 216,000 slots (about a day), settable by the admin from 9,000 to
1,512,000 (about a week): a certificate whose keeper missed a spend still dies within a day.

## §4 The disclosure package (owner: verifier; producer: rings client)
What the browser sends to `POST /api/attest`. It carries the openings of the chosen notes only, over TLS; the Verifier keeps
none of it (no amount, no opening, no `nk` is stored or logged; `nk` lives in memory for the one request).

```json
{
  "v": 1,
  "subject": { "kind": 0, "value": "<base58 wallet | handle | base58 badge pubkey>",
               "proof": "<kind 0, 2: the subject key's signature over the disclosure message (omit for kind 0 when the wallet is ring.owner) | kind 1: the link id>",
               "slot": "<u64 decimal: the recent slot named in the disclosure message>" },
  "asset": 0,
  "tier": 3,
  "ring": { "owner": "<base58 Ed25519 key that owns the notes>", "nk": "<hex 31: the ring's nullifier secret>",
            "proof": "<the ring owner's ed25519 signature over the disclosure message (always)>" },
  "notes": [ { "tree": "<base58>", "leafIndex": "<u64 decimal>", "asset": "<base58 mint, SOL = 1111…1111>",
               "amount": "<u64 decimal>", "blinding": "<hex 32>", "sig": "<base58 signature of the transaction that created it>",
               "dataHash": "<hex 32, only if present>", "ringDataHash": "<hex 32, only if present>", "ringProgramId": "<base58, only if present>" } ],
  "payer": "<base58>",
  "relay": true,
  "controller": "<base58, kind 1 only: the key the client keeps to revoke and join rooms>"
}
```
**The disclosure message** is these UTF-8 lines joined with `\n`, signed raw (Phantom `signMessage`, or the vault key in
the client). The **ring owner always signs it** (`ring.proof`): openings plus `nk` alone certify nobody (audit POF-02). For
kind 0 and 2 the subject key signs the same bytes (`subject.proof`); a wallet that is itself `ring.owner` signs once.
```
Proof of Funds: disclosure v2
program: <pof program id base58>
subject: <wallet|x|badge> <value; a handle lowercase, no @>
ring: <ring.owner>
controller: <the §3 controller: the wallet or badge key itself; the client's controller key for kind 1>
asset: <SOL|USDC> tier: <tier>
payer: <payer>
slot: <subject.slot>
```
Signatures are hex (128) or base58. The slot must be within 1,500 slots of the Verifier's read.

**The X link** (`/api/link`): `POST /api/link/start { handle, controller? }` → `{ handle, code, secret, controller,
expiresInSec, post }`: post the `post` text from the handle; keep `secret` in the browser only (the posted code is public).
`POST /api/link/check { handle, post, secret, controller? }` → `{ handle, controller, link, expiresInSec }`. Only the secret's
holder redeems a code (POF-03); a second start never cancels a first (POF-09). The link id is
`<handle>.<controller base58>.<unix expiry>.<hex signature>`, the Verifier's signature over
`"POF-LINK2" ‖ program_id ‖ handle ‖ 0x00 ‖ controller(32) ‖ expiry u64 LE`; it certifies only with that controller. A link
made without a controller is bound to the default key: it proves the handle (bots) but cannot certify.
`GET /api/link?id=<link id>` → `{ verified: true, handle, controller (null when unbound), expiresAt }` or `{ verified: false,
handle, reason }`.

**What the Verifier checks**, in order, each with its own error code (`verifier/src/verify.ts`): the version, asset, tier,
1..8 notes; the ring owner's signature and the subject's (kind 1: the link id, bound to the package's controller); a User
Registry record for `ring.owner` and `Poseidon(nk) == npk`; per note the asset's mint, the commitment recomputed with the SDK
(`ownerUtxoHash`), the indexer's Merkle path re-hashed with the SDK's Poseidon to a root in the tree account's on-chain
history, at the stated leaf index; all notes in one tree; every nullifier derived from `nk` and unspent (no PDA, and the
indexer's non-inclusion path re-hashed to an on-chain nullifier root); each note's creating transaction (`sig`) older than
the minimum age (150 slots); the sum ≥ the tier (never returned); `root_slot` within 9,000 slots; no note behind another live
certificate (a keyed index of nullifiers, no amounts, taken by an atomic create: POF-04). `relay: true` requires `payer` = the relayer.

**The answer**: `{ attestation: hex240, signature: hex64, verifierKey, salts: [hex32], nullifiers: [hex32] (same order as
notes), hashes: [hex32] (sorted, the certificate's list), logIndex: null (the log publishes only certified attestations;
the relayer answers the index, or find the entry by the bytes), attestationId: sha256 hex of the 240 bytes, subjectHash, controller, issuedSlot, expirySlot,
bundleHash, certificate: { seeds } }`. The salts and nullifiers are the holder's own revoke kit: the client saves them.
**Errors**: `{ error: { code, message, details? } }` with the HTTP status; codes are listed in `verifier/README.md`.
`certify` must land within `max_attest_age` (300 slots) of `issued_slot`: pay the relayer before attesting.

2026-11-25 (verifier): the package fixed from RINGS §9 (`ring.owner` + `ring.nk`, per-note `asset` and `sig`), the subject
message with the `ring:` line (vault mode), `controller` for kind 1, the answer and the checks written out.

2026-11-25 (verifier): audit fixes: `ring.proof` required over the disclosure message v2 (adds the controller line; the v1
subject message is gone), the X link takes a secret and binds the controller (`POF-LINK2`), link verify returns `controller`.

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
  (b') staged, for the full 40-level path without a v1 transaction: `open_path(nullifier, next_value, leaf_index, siblings)`
  makes the revoker's buffer PDA `["path", revoker, certificate]` (zero-copy, 1,432 bytes, the revoker pays the rent),
  `stage_path(offset, siblings)` adds levels (only that revoker; no gap), and `revoke_spent_staged(index, salt)` hashes all 40
  levels to one of the tree's 100 nullifier roots AT THAT MOMENT, checks the salted hash, revokes and closes the buffer (rent
  back). `close_path` drops it (its revoker; anyone during the wind-down). Two transactions of 20 levels carry a full path.
  Every spent proof names Rings tree 0 (`777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor`) and nothing else.
  A Verifier-signed "spent" statement is not needed and not accepted.
- The keeper holds `(salt, nullifier)` encrypted at rest; the holder holds a copy. After a revoke, salt and nullifier are public
  (on the certificate: `revealed_index`, `revealed_salt`, `revealed_nullifier`, and in the `Revoked` event).
2026-11-25 (program): revoke_signed with the verifier's POF-REVOKE1 bytes added (no wallet signs a holder's revoke); audit RV-01: valid_until appended (156 bytes).

- `revoke_by_holder`: the controller signs the transaction. `revoke_signed(valid_until)`: the controller signs only these 156
  bytes with ed25519, in an Ed25519 instruction right before, and anyone (the relayer) submits and pays, so no wallet links to
  the handle: `"POF-REVOKE1" (11) ‖ program_id (32) ‖ certificate address (32) ‖ subject_hash (32) ‖ asset u8 (1) ‖
  nullset_hash (32) ‖ issued_slot u64 LE (8) ‖ valid_until u64 LE (8)` (the certificate's own values; a renew or remake needs a
  new signature; refused once the slot is past valid_until, so a signed revoke cannot be held back; suggested window: now +
  1,500 slots). Accounts: caller (signer, pays), config, treasury, certificate, instructions sysvar.

2026-11-25 (program): the on-chain check of revoke_spent fixed (both paths, built and unit-tested against a real mainnet path).
2026-11-25 (verifier): the keeper seals each kit with AES-256-GCM (key name as associated data) in Blob, revokes by the PDA
path and falls back to path (b) when the PDA is gone; one note backs one live certificate (keyed nullifier index).

## §6 Accounts and API (owner: program for accounts, devx for HTTP)
- Program ids: `pof` = `pofP4QRRDXnmDN9CNYiAGHfwMEgM7sLWhVcUMpsbynT`, `pof_gate` = `gatSToJMD8ZPLa85fKj6seYHUtYx4ah3ptZvLkisLPU`.
  IDLs: `program/idl/pof.json`, `program/idl/pof_gate.json` (Anchor; account and event layouts come from them).
- `Certificate` PDA `["cert", subject_hash, [asset]]` (8-byte Anchor discriminator, then): subject_kind u8, subject_hash
  [32], asset u8, tier u8, status u8 (0 live, 1 revoked spent, 2 revoked by holder, 4 voided: its Verifier key was revoked;
  readers show 3 expired when a live byte is past expiry_slot; `expire` then closes the account; a live byte whose `verifier`
  is in Config.revoked_keys reads as voided before anyone calls `void_by_key`), certified_slot, issued_slot, expiry_slot, revoked_slot (u64),
  tree_root [32], root_slot u64, note_count u8, null_hashes [[32]; 8], nullset_hash [32], payer, controller, verifier
  (pubkeys), nonce [16], log_index u64, renewals u32, revealed_index u8 (255 none), revealed_salt [32], revealed_nullifier
  [32], bump u8.
- `Config` PDA `["config"]`: admin, dev, relayer, verifier, next_verifier, next_verifier_slot, root_mint,
  root_token_program, params { fee_lamports, holder_min, validity_slots, max_attest_age, max_root_lag, rotation_delay },
  assets [4] { enabled, mint, decimals, mins [5] } (0 SOL, 1 USDC), paused, closing, launch_slot, held_delay, held_until,
  revoked_keys [4] (`revoke_verifier_key`, admin, at once; such a key signs nothing more). The active verifier key is
  `next_verifier` once `slot >= next_verifier_slot` (and not default), else `verifier`.
- Treasury PDA `["treasury"]` (holds the fees; the public counters): fees_in, fees_out, certified, renewed, revoked_spent,
  revoked_holder, expired, live, live_min [4] (sum of tier minimums of live certificates by asset, base units), open,
  relayed, exempt, voided, log_size, log_head [32], log_slot. `anchor_log` grows the anchored size by at most 10,000,000.
- `pof_gate` Room `["room", creator, id u64 LE]`: creator, id, asset, min_tier, open, name [32], members u32, joined,
  evicted, created_slot. Member `["member", room, subject_hash]`: room, subject_hash, subject_kind, certificate,
  controller, payer, joined_slot.
- CPI: `pof::require_certificate(subject_hash, asset, min_tier)` with the accounts `certificate`, `config` (POF's Config PDA) returns `CertView {
  subject_kind, tier, expiry_slot, controller }` (return data) or fails (NotLive, CertificateExpired, TierTooLow,
  AssetMismatch, BadCertificate, KeyRevoked). Rust consumers can read without CPI: `pof::read_certificate` + `pof::gate(cert,
  config, asset, min_tier, slot)` (crate feature `cpi`). `pof_gate` `join` and `evict` take `pof_config` too.
- Phase 2 (merged from pof/zk, OFF until the admin runs `set_zk(true, key)` and the rotation delay passes; see docs-src/zk.md):
  `ZkConfig` PDA `["zk"]` (`6q7PxLzgUtLHMfCDDHzkU4Ho54rC6b21VZmSFsD6Tsv1`), `ZkRegistry` `["zkreg"]` (the owner registry),
  `NoteLock` `["znote", tag]` (one note behind one live zk certificate). A zk certificate is an ordinary `Certificate` with
  `verifier` = the ZkConfig address, `null_hashes` = the per-note tags `Poseidon("pof:zk:tag:v1", nullifier)` (revoke_spent
  checks the tag instead of the salted hash), `issued_slot` = the slot it settles at (gates refuse it before), `log_index` =
  u64::MAX. Instructions: `set_zk`, `register_zk_owner`, `certify_zk`, `release_note_lock`, `close_zk` (wind-down).
- `PathBuffer` PDA `["path", revoker, certificate]` (zero-copy): revoker, certificate, nullifier [32], next_value [32],
  leaf_index u64, path [[32]; 40], levels u8, bump u8, padding [6].

2026-11-25 (program, fuzz seed 1 + staged path): revoked Verifier keys (Config.revoked_keys, status 4 voided, void_by_key,
require_certificate takes config), the staged membership path, tree 0 pinned, anchor_log step bound, set_roles takes a mint only.
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

**Leaf data** (fixed 377 bytes, all integers little-endian):
```
offset size field
0      1    version        0x01
1      240  attestation    the exact §3 bytes
241    64   signature      the Verifier's ed25519 signature over the attestation
305    32   verifier_key   the ed25519 public key that signed
337    32   bundle_hash    sha256 of the Verifier bundle that produced it (pof/verifier/dist/BUILD.json)
369    8    logged_slot    u64, the slot the Verifier read when it appended the entry
377         total
```
- `leaf_hash = sha256(0x00 ‖ leaf_data)`; `node = sha256(0x01 ‖ left ‖ right)`; the tree over n leaves is RFC 9162 §2.1.1
  (split at the largest power of two below n); the empty tree's root is `sha256("")`.
- Inclusion proofs are RFC 9162 §2.1.3 audit paths (`index`, `tree_size`, `path: [hex32]`), checked with the §2.1.3.2
  algorithm. Consistency proofs between two sizes are RFC 9162 §2.1.4.
- **Signed tree head**: the Verifier signs with the same ed25519 key the 80 bytes
  `"POF-STH1" (8) ‖ program_id (32) ‖ tree_size u64 (8) ‖ root_hash (32)`. JSON: `{ treeSize, rootHash, slot, signature,
  verifierKey }` (`slot` is informational, not signed: the anchor below fixes the time).
- **Anchor on chain**: `anchor_log(size, head)` after an Ed25519 instruction over the 80-byte signed head; the program keeps
  the newest head in the Treasury (`log_size`, `log_head`, `log_slot`) and emits `LogAnchored`. The keeper anchors when the
  log grew (cron, off before launch). Anyone can match a head to a slot and check any entry against it.
- **Entry id**: the leaf index (u64, from 0). **Only certified attestations are published** (audit A2-06): the Verifier
  holds each signed leaf privately; the relayer publishes it when its certify lands, the keeper when it sees the certificate
  on chain. `certify` therefore carries `log_index` = u64::MAX (unknown) and readers match the leaf by the attestation
  bytes (POF-18).
2026-11-25 (verifier): publish-on-landing (A2-06); the §4 answer's `logIndex` is null.
- HTTP (served by `pof/api/attest/log*`, devx may proxy under `/v1/log/*`): `GET /api/attest/log?head` → STH JSON;
  `GET /api/attest/log?entry=<i>` → `{ index, leaf: hex377, leafHash, attestation, signature, verifierKey, bundleHash, loggedSlot }`; `GET /api/attest/log?proof=<i>&size=<n>` →
  `{ index, treeSize, rootHash, leafHash, path: [hex] }`; `GET /api/attest/log?consistency=<m>&size=<n>` →
  `{ first, second, firstRoot, secondRoot, path }`; `GET /api/attest/log?from=<i>&to=<j>` → entries (≤ 256).
  The X linker: `GET /api/link?id=<link id>` → `{ verified, handle, expiresAt }` or `{ verified: false, handle, reason }`.

2026-11-25 (verifier): §7 added: RFC 9162 hashing as devx proposed, 345-byte leaf, 80-byte signed head, memo anchor.
2026-11-25 (verifier): the leaf is 377 bytes now (it embeds the 240-byte §3); offsets above updated; anchor_log takes the 80-byte STH.

## §8 Log witnesses (owner: devx; consumers: site /log and /status, anyone running a witness)
A witness is an independent monitor of the §7 log (`witness/`, run by anyone with `node witness/run.js`). Each step it:
fetches the signed head; requires its key to be one the `pof` Config lists now or listed before (`VerifierSet` events),
never the key the head names; requires it to extend the last head it verified (an RFC 9162 consistency proof; a smaller
size, or the same size with another root, is an alarm); requires it to agree with the head anchored in the Treasury by
`anchor_log` (equal, a consistent prefix, or a consistent extension); and only then cosigns it.

- **Cosignature**: ed25519 by the witness key over the 88 bytes
  `"POF-WIT1" (8) ‖ program_id (32) ‖ tree_size u64 LE (8) ‖ root_hash (32) ‖ timestamp u64 LE (8, unix seconds)`.
- **Document** (what `GET /v1/witness` serves and the site shows): `{ v: 1, witness: { name, key }, programId, updatedAt,
  latest, heads: [{ witnessKey, treeSize, rootHash, timestamp, signature, verifierKey, verifierSignature, anchor: {
  treeSize, rootHash, slot, relation: equal|prefix|ahead, consistent } }], alarms: [{ kind, detail, at }], stats }`.
  Alarm kinds: `log_unreachable`, `unknown_key`, `bad_signature`, `log_shrank`, `equivocation`, `inconsistent`,
  `anchor_mismatch` (none of these heads is cosigned), `unlogged_certificate` (a Verifier-signed certificate whose
  attestation is in no log entry after a grace of 1,500 slots, found by its signed bytes, never by its unsigned
  `log_index`; zk certificates are skipped) and `split_view` (a peer witness cosigned a head no consistency proof joins to
  this one). `peers: [{ url, key, treeSize, ok, error? }]` and `notes` (e.g. `misindexed`) are informational.
- A head is accepted only when signed by the key the Config has **active** at that moment; keys from the `VerifierSet`
  history and from certificates are for checking old entries, never new heads.
- Key: `node witness/keygen.js` writes `~/.config/pof/witness.json` (64-byte Solana keypair format, mode 600) and prints
  only the public key. `@pof/sdk` exports `cosignMessage` and `verifyCosignature`.

2026-11-25 (devx): §8 added.
2026-11-25 (devx): audit W-01..W-03: heads by the active key only, the monitor finds leaves by their bytes and alarms on
`u64::MAX`, gossip with peer witnesses (`split_view`). The project's own witness is not an independent party.
