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

## §2 Assets and tiers (owner: program)
| asset | u8 | tiers (index: minimum) |
|---|---|---|
| SOL | 0 | 1: ≥ 1 · 2: ≥ 10 · 3: ≥ 100 · 4: ≥ 1,000 · 5: ≥ 10,000 SOL |
| USDC | 1 | 1: ≥ 100 · 2: ≥ 1,000 · 3: ≥ 10,000 · 4: ≥ 100,000 · 5: ≥ 1,000,000 USDC |

The tier table lives in the program's `Config` so a new asset can be added without a redeploy.

## §3 The attestation bytes (owners: program + verifier, both must agree)
The Verifier signs these exact bytes with ed25519. `certify` and `renew` rebuild them on chain from the instruction args and
the accounts, and check them against the Ed25519 program instruction before it (instructions sysvar).

```
offset size field
0      4    domain        "POF1"
4      32   program_id    the pof program id (binds the signature to one deployment)
36     1    subject_kind  §1
37     32   subject_hash  §1
69     1    asset         §2
70     1    tier          §2
71     32   tree_root     the Rings tree root the notes were checked against   TBD(rings): one root or one per tree
103    8    root_slot     u64 LE, the slot that root was read at
111    1    note_count    1..=8
112    32   nullset_hash  sha256 of the sorted salted nullifier hashes (§5)
144    8    issued_slot   u64 LE
152    8    expiry_slot   u64 LE (issued + validity, validity from Config)
160    32   payer         the account that pays the fee and the rent (relayer or holder)
192    16   nonce         random, so two attestations never collide
208         total
```

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
- `revoke_spent(i, salt, nullifier)`: anyone. The program recomputes `h_i` and checks that `nullifier` is spent on the Rings
  program. **TBD(rings):** the exact on-chain check (a nullifier PDA's existence and owner, or another account).
- The keeper holds `(salt, nullifier)` encrypted at rest; the holder holds a copy. After a revoke, salt and nullifier are public.

## §6 Accounts and API (owner: program for accounts, devx for HTTP)
- `Certificate` PDA `["cert", subject_hash, [asset]]`: subject_kind, subject_hash, asset, tier, status (0 live, 1 revoked
  spent, 2 revoked by holder, 3 expired), certified_slot, expiry_slot, revoked_slot, note_count, nullifier hashes, payer,
  log_index, verifier key used.
- `Config` PDA `["config"]`; treasury PDA `["treasury"]`; `pof_gate` Room `["room", creator, id]`, Member `["member", room,
  subject_hash]`.
- HTTP: `GET /v1/certificates/:subject` → `{ subject, kind, asset, tier, tierLabel, status, certifiedSlot, expirySlot,
  revokedSlot, address, logIndex }`. The rest are in POF.md (devx).
