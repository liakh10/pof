# Proof of Funds: on-chain fuzz and property testing

Status: **round 1 complete on `a3b15d1`**, both the launch build (no phase 2) and the zk build (`certify_zk`, cargo feature `zk`); open items in §5. Reviewer: the POF `fuzz` agent, a second reviewer independent of
the `audit` agent, working only on the on-chain programs `pof` and `pof_gate`. It wrote none of the program code and changed none of
it: every finding below went to the program owner, who fixed it in their own commits. Everything here can be re-run from `pof/fuzz/`
(§8).

## 1. Scope and snapshots

The program changed seven times while the fuzzer ran. Each run therefore names the exact source it tested. `fuzz/build.sh` builds a
snapshot of one commit in the scratchpad, never in `pof/program`, and records the sha256 of every source file in
`fuzz/results/snapshot.json`.

| run | program commit | what it added | seed | cases | invariant checks | unexpected |
|---|---|---|---|---|---|---|
| 1 | `73d71dd` | POF-07/17/22 fixes | 1 | 9,666 | 29 | 27 (see note) |
| 2 | `74654cb` | `revoke_signed` (POF-REVOKE1, 156 bytes) | 2 | 10,803 | 33 | 3 (findings FZ-04, FZ-06) |
| 3 | `187914b` | fixes for FZ-01..04 and FZ-06 (revoked keys, `void_by_key`, tree 0 pinned, anchor step bound, mint-only `set_roles`, the staged 40-level path) | 3 | 10,645 | 34 | 1 (a harness bug, fixed) |
| 4 | `187914b` | the same, a second seed | 4 | 10,345 | 34 | 2 (finding FZ-08) + 1 harness slip (fixed) |
| dev | `cd51f22` | `certify_zk` merged (always on), fixes for FZ-05, FZ-07, FZ-08, FZ-09 | 50, 51 | zk suite only | | finding FZ-18 (real proofs) |
| 5 | `1c02f89` launch build | phase 2 behind the cargo feature `zk` (off at launch) | 5 | 10,868 | 36 | 0 |
| 5 | `a3b15d1` zk build | fixes for FZ-18 (spent note lock, new nonce), ZK-11 (paid owner records), RK-01 | 5 | 11,441 | 37 | 1 (finding FZ-19) |
| 6 | `a3b15d1` launch build | the same commit without `zk`, a short pass (SCALE 0.3) | 6 | 9,273 | 22 | 0 |

Note on run 1: 24 of the 27 were the harness's own fault (a signer or writable flag removed from an account that was also the fee
payer does not change the message; fixed by a separate fee payer). The other 3 were findings. Every "unexpected" row is kept in
`fuzz/results/run-<seed>-<commit>.json` (and `repro-<commit>.json` for §5) with the case name, what was wanted and what came back.

In scope: every instruction of `pof` in both builds (31 in the launch build, 37 with `zk`: `certify_zk`, `set_zk`,
`register_zk_owner`, `release_note_lock`, `close_zk` and the zk paths of `revoke_spent`) and all 8 of `pof_gate`; the Ed25519
precompile as `certify`, `renew`, `anchor_log` and `revoke_signed` read it through the instructions sysvar; the Rings spent proofs
(PDA, membership path, staged path); the Groth16 path with real proofs; and the `require_certificate` CPI as other programs call it.
Not in scope: the circuit itself and the trusted setup (pof/zk's own reports), the off-chain Verifier, client, API and bots
(`reports/audit.md`).

## 2. Method

**Engine: a seeded JavaScript (Node ESM) fuzzer against a real local validator** (`solana-test-validator` 4.1.2, Agave). LiteSVM
and Mollusk were considered and not used: neither was installed on the machine, adding them means downloading new packages, and the
validator gives the exact runtime the programs meet on mainnet, including the Ed25519 precompile, the `sol_poseidon` syscall,
transaction size limits and version 1 transactions. Speed was not a problem: a simulation with `replaceRecentBlockhash` costs 2 to 3
ms, so most suites run tens of thousands of cases in seconds. Three properties make the validator usable as a fuzz target:

- `simulateTransaction` returns the bank slot it ran at. Every slot-dependent outcome (stale, expired, rotation switch) is judged
  against a model evaluated **at that exact slot**, so boundaries are tested exactly, not with margins.
- Simulation runs the Ed25519 precompile (checked: a corrupt signature with a valid layout fails in simulation with
  `InvalidSignature`, and again when sent). A case that must fail but simulates ok is also sent for real before it counts.
- Every transaction is unique (the compute-unit limit carries a counter). Two identical transactions under one blockhash share a
  signature, and the second would silently never run.

**Determinism.** All keys, notes, salts, nonces, mutations and random walks come from a xoshiro256** generator seeded by `SEED`.
The genesis state comes from a fixed prep seed. Only the slot timing of the chain is not reproducible, and the model reads it.

**Genesis** (`fuzz/prep.mjs`, `fuzz/chain.sh`): the Rings accounts the program suite cloned read-only from mainnet (tree 0 with its
real nullifier root history, the protocol config, the spent-PDA fixtures); a synthetic indexed nullifier tree of height 40 built with
the SDK's Poseidon (leaves at indexes 0, 1, 2, 3, 77, 2^39 + 12345 and 2^40 − 1) whose roots are written into the fuzzer's copy of
tree 0 and into forged tree accounts (owned by the Privacy Program with discriminator 1; and look-alikes with discriminator 0, one
byte short, system-owned); spent nullifier PDAs under tree 0, under a forged tree and under the protocol config, plus five
look-alikes at the right addresses (first byte 7, 12 bytes, 10 bytes, system-owned, registry-owned); and POF's `Config` and
`Treasury` written at genesis with the fuzzer's parameters (since POF-17 a lowered rotation delay is held for the old one, so a chain
started with launch parameters cannot rotate in test time).

**The hostile program** (`fuzz/hostile/`, Anchor, loaded only on the fuzz chain): a fake POF whose `require_certificate` has the same
Anchor discriminator and answers "tier 5" for anything; a consumer that does not pin POF's program id; a careful consumer that checks
the return data's program id and compares the CPI answer with a direct `read_certificate` + `gate`; `certify` through a CPI with a
program PDA as payer, once and twice under one signature; and a program-controlled X-handle certificate that joins a room through a
CPI and revokes itself between two `require_certificate` calls in one instruction.

### The suites (`fuzz/suites/`)

| suite | what it does | cases (seed 3) |
|---|---|---|
| attest | every byte of the 240 signed bytes mutated (3 values per offset); every instruction field mutated under the original signature; 1,500 random attestations (kinds 0..255, controllers incl. the default key, assets 0..255, tiers 0..255, 0..10 notes, unsorted and repeated hashes, issue, root and expiry slots at and around every bound, u64 extremes) judged against a model of `check_attestation` | 2,312 |
| ed25519 | count 0 / 2 (both orders), each index field by number, at another instruction, at `u16::MAX − 1`; message length ±1; trailing data; account metas on the precompile instruction; the signature after `certify`, two before, at index 0; data inside a memo; a key offset into the message; the sysvar replaced; 400 random header mutations (any that simulates ok is sent) | 406 |
| revoke | `revoke_spent` path (a) against every forged and look-alike account; path (b) every leaf, every path length 0..41, each sibling level and each leaf-index bit flipped, index ≥ 2^40 and u64::MAX, values ≥ the field modulus, a level-1 node presented as a leaf, roots at history slots 0, 50 and 99, the real mainnet 16-level path, the real 40-level path in v0 and v1 | 283 |
| revsig | `revoke_signed`: every byte of the 156 signed bytes; `valid_until` past, now, u64::MAX; another signer, the Verifier's key; X's message on Y; a message from before a renew or a remake; replay | 328 |
| accounts | every account of 22 canonical calls replaced by each of 22 interesting accounts, writable made read-only, read-only made writable, signer removed, every pair made duplicates | 2,389 |
| data | instruction data truncated at every length, 1/8/64 trailing bytes, discriminator and every argument byte changed, vector lengths 0..2^32 − 1, option tags 2..255 | 2,377 |
| orderings | revoke/remake, certify/revoke/certify, double revocations, join/revoke/evict, renew/revoke, expire/remake inside one transaction; conflicting transactions raced into the same slot | 43 |
| donations | lamports sent to revoked, empty and future certificate, member, room and treasury addresses before remakes, expiry and withdrawal (POF-07) | 23 |
| gate | rooms against revoked, expired, closed, re-issued (same and other controller, lower tier) certificates; creator controls; the hostile program | 45 |
| admin | pause, parameter bounds, fee cap, withdraw limits, re-init, close before closing | 20 |
| rotation | the switch slot by slot (old key ok iff slot < switch, judged per simulation); the POF-17 hold; a 40-step random walk of `set_params`/`set_verifier`/`apply_verifier`/waits compared field by field with a model, plus the delay promise (no key takes over before t + E(t) of any earlier observation) | 2,146 |
| machine | a 300-step random walk over 6 subjects (certify, renew, both revokes, expire, join, evict, leave, donations, waits) with a model of every outcome evaluated at the landing slot | 202 |
| staged | `open_path` / `stage_path` / `revoke_spent_staged` / `close_path`: the real 40-level path and the synthetic leaf 2^40 − 1 in chunks; partial staging, gaps, overflow, empty writes; another revoker; buffers swapped between certificates; a wrong level rewritten; renew, remake and holder revoke while a buffer is open | 32 |
| void | `revoke_verifier_key`, `void_by_key`, the key check in `check_signed`, `require_certificate`, `join` and `evict`; renew and remake after a revocation; the key list full | 22 |
| cu, holder | worst-case compute units and transaction sizes (§4); the $ROOT exemption | 12 |
| zk | `certify_zk` with REAL Groth16 proofs (snarkjs, the development setup in `pof/zk/setup`, the zk agent's fixture scenarios placed in our tree 0's root histories): every public input and argument of a valid proof changed in turn (kind, asset, tier, nonce, payer, controller, the three roots, ephemeral key, each tag and ciphertext, a tag + r, 32 proof bytes); lock accounts missing, extra, read-only, at another tag; the settle window slot by slot; the same note for another subject; renew and revoke_signed of a zk certificate; revoke_spent by tag, then the same proof replayed and a fresh proof of the spent note; the ZkConfig as a revoked key; 4 notes with a lookup table; `set_zk` off at once | 214 (zk build) |
| winddown | the anchor step bound, `close_begin`, expire and evict everything, `close_config` with a staged buffer open, release every note lock and `close_zk` (zk build), `release_room`, nothing left | 85 to 110 |

**Invariants**, checked after every state-changing suite and every 15 steps of the random walk, over every account the two programs
own: `Treasury.open` = certificate accounts; `live` = certificates with status live = `certified − revoked_spent − revoked_holder −
expired − voided`; `live_min[a]` = the sum of tier minimums of live certificates of asset a; every certificate at its PDA, at or above
rent, with 1..8 notes, a revealed note when revoked as spent; the treasury's free lamports ≥ `fees_in − fees_out`; every room's
member count = its member accounts; every member at its PDA. 225 invariant checks over runs 1 to 6: none broke.

### The program's own suites, re-run

| commit | unit (cargo test) | suite (test.mjs) | wind-down (closing.mjs) |
|---|---|---|---|
| `73d71dd` | 7/7 | 20 of 20 pass up to the rotation test, which then waits about 216,000 slots: the test lowered the launch delay 216,000 → 40, and the POF-17 fix (correctly) holds the old delay. A test bug, not a program bug; fixed in `b605c03` (quick build launches at 40). Log: `fuzz/results/suite-73d71dd-hang.log` | not reached |
| `1c02f89`, `a3b15d1` | the program agent's own runs: unit 8/8 (+12/12 with zk), suite 35/35, wind-down 7/7, zk on-chain 13/13 (`reports/program.md`) | | |
| `187914b` | 7/7 | **34/34, twice** (`fuzz/results/suite-187914b-{1,2}.log`) | 3/7 twice: every account wind-down check passes (POF and pof_gate own nothing afterwards, every payer got exactly its rent back); the 4 failures are the last step, closing the programs themselves through sol-ops, which needs the program-id keypairs that the fuzzer deliberately does not copy out of `pof/program/target/deploy` |

## 3. Coverage

**Instructions.** Every instruction of both programs was called canonically and adversarially: `pof` (31 at `187914b`): init_config
(re-init only, the first init is covered by the program suite), set_roles, set_params, set_fee, set_asset, set_verifier,
apply_verifier, set_paused, certify, renew, revoke_spent, open_path, stage_path, revoke_spent_staged, close_path, revoke_by_holder,
revoke_signed, expire, anchor_log, require_certificate, revoke_verifier_key, void_by_key, withdraw_fees, close_begin, close_config;
in the zk build also certify_zk, set_zk, register_zk_owner, release_note_lock, close_zk; `pof_gate` (8): create_room, set_room, join, evict, leave, close_room, release_room.

**Error branches.** Every error variant a call returned was recorded per instruction (`coverage` in the results). Final runs: the
launch build reaches 44 of its variants (the zk ones cannot occur there), the zk build 55 of 63 `pof` variants, and `pof_gate` 9 of
9. The ones never reached, and why:

| variant | why |
|---|---|
| NotUpgradeAuthority | `init_config` runs once at genesis in the fuzz chain; the program suite covers it on a bare chain |
| NoVerifier | unreachable while a verifier key is set (genesis sets one; nothing clears it) |
| PayerMismatch | defined in `errors.rs`, used nowhere: the payer is bound through the signed bytes (AttestationMismatch) |
| AssetMismatch | unreachable through `require_certificate`: the PDA is derived from the asset first (BadCertificate) |
| Overflow | would need `live_min` sums near 2^64 |
| ZkSubjectKind | the certificate PDA of `certify_zk` is derived from the kind first: a kind other than 0 or 2 fails its seeds (ConstraintSeeds) |
| ZkRegistryFull | needs 2^20 registrations |
| ZkNoVerifyingKey | the build always compiles a verifying key in |
| (RootSet, BadHolderAccount, Replayed, RenewMismatch, RoomShut, Closing) | not reached in run 3; reached in run 5 by the tests added after it |

## 4. Compute units and transaction sizes

Top-level units of the instruction itself (from the program's own `consumed` log line), worst case built on purpose, run 3
(`187914b`). Size is the whole transaction in bytes, v0, one signer, with a compute-unit limit instruction.

| instruction (worst case) | CU | tx bytes |
|---|---|---|
| certify: wallet subject (base58 of the controller on chain), 8 notes, new, fee, PDA bump 249 (6 extra tries; ≈1,500 CU each) | 75,876 | 1,183 |
| certify: remake over a revoked certificate holding a donation, prior payer refunded, surplus moved, fee, 8 notes | 74,659 | 1,215 |
| certify: $ROOT holder (ATA derivation + token read), 8 notes | 67,531 | 1,215 |
| renew, 8 notes, fee | 58,757 | 1,174 |
| revoke_spent (a) nullifier PDA | 28,338 | 451 |
| revoke_spent (b) membership, 16 levels (real mainnet path) | 64,626 | 976 |
| revoke_spent_staged, 40 levels (after open_path 17,908 CU / 908 B and two stage_path ≈4,434 CU / 643 B) | 64,751 | 418 |
| revoke_signed | 36,200 | 664 |
| revoke_by_holder | 24,491 | 319 |
| expire | 23,207 | 352 |
| anchor_log | 28,429 | 587 |
| pof_gate join (incl. the require_certificate CPI, 21,256) | 44,034 | 451 |
| pof_gate evict (expired certificate) | 38,772 | 385 |
| pof_gate create_room / set_room / leave / close_room | 29,027 / 23,863 / 11,563 / 6,377 | ≤ 361 |
| admin calls (set_params, set_fee, set_paused, set_verifier, set_roles, withdraw_fees) | 13,968 to 18,433 | ≤ 327 |
| **zk build** (`a3b15d1`): certify_zk, 1 note (Groth16 + note lock), lookup table | 247,820 | 843 |
| certify_zk, 4 notes, badge subject, separate payer, lookup table | **301,823** | **1,230** |
| set_zk, first call (creates ZkConfig and the registry; Baby Jubjub on-curve check) | **395,524** | 417 |
| register_zk_owner (20-level Poseidon append, owner record, fee) | 64,335 | 514 |

Every instruction of the launch build stays under 80k CU, far from the 200k default and the 1.4M cap. In the zk build
`certify_zk` (248k to 302k) and the first `set_zk` (396k) pass the 200k default per instruction: the client and the admin must set a
compute-unit limit (FZ-21). A membership revoke costs about 64k CU, not
"about 35k" as CONTRACT §5 and RINGS §3 say (FZ-15).

**Transaction sizes** (limit 1,232 bytes for legacy and v0):

| transaction | bytes |
|---|---|
| revoke_spent membership, 16 / 20 / 24 levels | 976 / 1,104 / **1,232** |
| revoke_spent membership, 25+ levels (v0) | does not fit |
| revoke_spent membership, 40 levels as a version 1 transaction | 1,714: **refused by the Agave 4.1.2 RPC** (raw limit 1,232 for every version) |
| staged 40-level revoke: open_path, 2 × stage_path, revoke_spent_staged | 4 transactions, ≤ 908 each |
| certify as `verifier/src/program.ts` sends it (legacy, Ed25519 + certify), 8 notes | 1,141 |
| certify, 8 notes, plus the CONTRACT §7 memo and a CU limit + price (v0 / legacy) | **1,316 / 1,314** |
| certify, 8 notes, memo, CU limit + price, holder pays and the relayer pays the fee (2 signers) | **1,412** |
| two certify instructions in one transaction (even with 1 note each) | does not fit |
| certify_zk, 4 notes, with the lookup table and a compute-unit limit (2 signers) | **1,230** (2 bytes to spare) |
| certify_zk, 4 notes, without the lookup table | does not fit |

## 5. Findings

| id | severity | title | where | status |
|---|---|---|---|---|
| FZ-01 | Medium | Certificates signed by a leaked or retired Verifier key stay live for every gate after pause and rotation | `73d71dd` lib.rs:452 `gate`, :360 `check_signed` | **fixed** in `187914b` (`revoke_verifier_key`, `void_by_key`, key check in `gate` and `check_signed`); repro FIXED |
| FZ-02 | Low | One signed head of size 2^64 − 1 ends on-chain log anchoring for good, across rotations | `73d71dd` lib.rs:790 | **fixed** in `187914b` lib.rs:918 (step ≤ 10,000,000); repro FIXED |
| FZ-03 | Low | Spent proofs accept any Privacy Program account as `tree` | `73d71dd` ext.rs:195, :275 | **fixed** in `187914b` ext.rs:208, :289 (tree 0 pinned); repro FIXED |
| FZ-04 | Low | `set_roles` accepts a token account as the $ROOT mint, and the mint can be set once | `73d71dd` lib.rs:524 | **fixed** in `187914b` (`ext::is_mint`); repro FIXED |
| FZ-05 | Low | `revoke_signed` puts no upper bound on `valid_until` | `187914b` lib.rs:886 | **fixed** in `cd51f22` (window ≤ 9,000 slots; 8,990 ok, 9,010 refused); repro FIXED |
| FZ-06 | Low | The 40-level membership path cannot be submitted: v0 fits 24 levels, and v1 over 1,232 bytes is refused | `73d71dd` ext.rs:275; RINGS §3 | **fixed** in `187914b` (staged path, lib.rs:815..870); repro FIXED |
| FZ-07 | Info | A kind 0 or kind 2 attestation whose controller is the default key is accepted | `187914b` lib.rs:429 | **fixed** in `cd51f22` (NotController for every kind); repro FIXED |
| FZ-08 | Low | `close_config` succeeds with a staged path buffer open; `close_path` then needs the closed config, so the buffer and its rent are stranded | `187914b` lib.rs:983..985, :1121 | **fixed** in `cd51f22` (`Treasury.paths`, close_config waits for 0); repro FIXED |
| FZ-09 | Low | `revoked_keys` holds 4 keys and nothing removes one | `187914b` lib.rs:939 | **fixed** in `cd51f22` (8 entries, reusable `VALIDITY_MAX` after revocation; `a3b15d1` RK-01: never for the active key); repro FIXED |
| FZ-10 | Info | The new key's renew revives a certificate signed by a revoked key that nobody voided yet | `187914b` lib.rs:759..767 | open (by design?) |
| FZ-11 | Info | The $ROOT exemption is read at the instant of certify: a balance borrowed in the same transaction counts | lib.rs `is_holder` | open |
| FZ-12 | Info | A relayed certify with 8 notes plus the CONTRACT §7 memo and a priority fee does not fit 1,232 bytes | CONTRACT §7; `verifier/src/program.ts` | open |
| FZ-13 | Info | Trailing instruction bytes are ignored; `log_index` is not signed (POF-18) | every instruction (Anchor) | open (known) |
| FZ-14 | Info | Donation accounting: a same-payer remake sends the payer's own donation to the treasury; a donation to an empty certificate address is a gift to whoever certifies there; `fees_out` can exceed `fees_in` | lib.rs `certify`, `withdraw_fees` | open (harmless) |
| FZ-15 | Info | A membership revoke costs about 64k CU, not "about 35k" | CONTRACT §5, RINGS §3 | open (docs) |
| FZ-16 | Info | The program suite at `73d71dd` could not finish (its rotation test waited out the POF-17 hold) | `73d71dd` test/test.mjs | **fixed** in `b605c03` |
| FZ-17 | Info | A consumer that does not pin POF's program id accepts a fake POF | integrators (pof_gate is fine) | open (docs) |
| FZ-18 | Medium | zk build: a zk certificate revoked as spent is remade by replaying its own proof and passes the gates after the settle window | `cd51f22` zk.rs:451..514 (remake path) | **fixed** in `a3b15d1` (spent note lock, new nonce, zk.rs:504, :574); repro FIXED |
| FZ-19 | Low | zk build: the paid ZkOwner records have no close path; after the wind-down POF still owns them and their rent is stranded | `a3b15d1` zk.rs:670..683, lib.rs:1082 `close_zk` | open |
| FZ-20 | Info | One note can back a Verifier certificate and a zk certificate at the same time (two lock schemes) | design: Verifier note index vs ["znote", tag] | open |
| FZ-21 | Info | zk build compute and size margins: certify_zk up to 302k CU and the first set_zk 396k CU (over the 200k default); 4 notes fit 1,230 of 1,232 bytes only with the lookup table and no compute-unit price | `a3b15d1` | open (client/docs) |

Critical: 0. High: 0. Medium: 2 (both fixed). Low: 8 (7 fixed). Info: 11 (2 fixed).

### FZ-01 · Medium · fixed · Certificates of a leaked Verifier key outlive the incident
At `73d71dd`, the response to a leaked Verifier key was "pause, then rotate". Pause stops new certifies, but every certificate the
key already signed stays live until its expiry (up to `validity_slots`, about 30 days at launch then, 1 day now). `gate()` and
`require_certificate` never look at `cert.verifier`. Nothing on chain can end them: `revoke_by_holder` needs the controller (the
attacker's key), `revoke_spent` needs a spent nullifier (the attacker chose the salted hashes, so they never will be). So the forged
certificates pass every room for their whole life.
- **Repro:** `fuzz/repro.mjs` FZ-01, and the rotation suite (a tier-5 certificate of the outgoing key passes `require_certificate`
  after the switch, while paused).
- **Fix (done in `187914b`):** `revoke_verifier_key` (admin, immediate), `void_by_key` (anyone), and the key check in `gate`,
  `check_signed`, `join` and `evict`. Verified by the void suite: certify, anchor_log and join with the revoked key are refused with
  `KeyRevoked`, the member is evictable at once, `void_by_key` sets status 4, a certificate of a key that is not revoked gives
  `KeyNotRevoked`, and the invariants hold with `voided` counted.

### FZ-02 · Low · fixed · The anchored log could be frozen by one signature
`anchor_log` only required `size > log_size`. One head of size 2^64 − 1, signed by the active key (a leaked key, or a Verifier bug),
made every later head fail `LogNotGrowing`; pause does not cover `anchor_log`, and rotation does not reset `log_size`. Shown in the
wind-down suite at `73d71dd` and `74654cb`. **Fix (done):** at most 10,000,000 entries per step; with FZ-01 a revoked key cannot
anchor at all. The bound and the bound + 1 are both tested.

### FZ-03 · Low · fixed · `tree` was checked for its owner only
Path (a) derived the nullifier PDA under whatever `tree` account was passed, and path (b) read roots from any Privacy Program account
whose byte 0 is 1. A spent PDA under the protocol config revoked a certificate (repro FZ-03). Only the Privacy Program creates those
accounts, and the revoker must know the note's salt, so this was defence in depth, not an exploit. **Fix (done):** tree 0 is pinned in
both proofs; a forged tree and the protocol config now give `BadRingsAccounts`.

### FZ-04 · Low · fixed · A token account accepted as the $ROOT mint
`set_roles` checked "owned by a token program and at least 82 bytes", which a 165-byte token account passes, and the root mint can be
set only once (`RootSet`). An admin slip would have disabled the holder exemption for good. **Fix (done):** `ext::is_mint` (82 bytes,
or a Token-2022 mint with account type 1 at 165, initialized).

### FZ-05 · Low · fixed in `cd51f22` · `valid_until` had no upper bound
`revoke_signed` refuses a message past `valid_until`, but nothing caps how far ahead `valid_until` may be: a POF-REVOKE1 message with
`valid_until = 2^64 − 1` revokes the certificate whenever its holder submits it, for the certificate's whole life (repro FZ-05). The
design goal ("a signed revoke cannot be held back for later") then depends on every client choosing `now + 1,500`. A phishing page
that gets a wallet to sign such bytes holds a revoke for that certificate until the next renew or remake.
- **Fix:** `require!(valid_until <= slot + MAX_REVOKE_WINDOW)` (for example 9,000 slots), in `revoke_signed` before the signature
  check.

### FZ-06 · Low · fixed · The full-depth membership path could not be sent
The membership proof takes up to 40 siblings. A v0 transaction fits 24 levels (exactly 1,232 bytes); the full path is 1,714 bytes as
a version 1 transaction, and the local Agave 4.1.2 RPC refuses any transaction over 1,232 raw bytes, whatever its version. RINGS §3
counted on v1 carrying 4,096 bytes; that is not what this runtime accepts. Today the mainnet nullifier tree needs 16 levels (55k
leaves), so path (b) worked up to 2^24 nullifiers and failed silently beyond. **Fix (done):** the staged path. The staged suite
revokes with the real 40-level mainnet path and with the synthetic leaf 2^40 − 1 in 4 transactions of at most 908 bytes, and the
buffer rent comes back to the revoker to the lamport.

### FZ-07 · Info · fixed in `cd51f22` · The default key as controller
For kinds 0 and 2 the program checks `subject_hash == §1 hash of controller` but not `controller != default`. A certificate of the
subject `sha256("pof:wallet:11111111111111111111111111111111")` with the default controller is accepted; nobody can ever
`revoke_by_holder` or `revoke_signed` it, or join a room with it. The Verifier would have to sign it. **Fix:** `require_keys_neq!(a.controller, Pubkey::default())` for every kind.

### FZ-08 · Low · fixed in `cd51f22` · A staged buffer survived the wind-down
`close_config` checks `treasury.open == 0`, which counts certificates only. A `PathBuffer` opened before (or during) the wind-down is
still there afterwards, and `close_path` cannot close it any more because its `config` account (seeds `["config"]`, deserialized)
is gone: `AccountNotInitialized`. The buffer, its 10,857,600 lamports of rent and a POF-owned account stay forever (repro FZ-08:
close_begin, expire everything, close_config ok, close_path refused, buffer still there). wind-down.mjs closes the buffers it finds
first, but one opened between that sweep and `close_config` (open_path needs only a live certificate) is stranded.
- **Fix:** count open buffers in the treasury (`open_path` +1, `revoke_spent_staged`/`close_path` −1) and require 0 in
  `close_config`; or take `config` in `ClosePath` as an unchecked account at the PDA and treat an empty one as "closing" (as
  `pof_gate::release_room` does).

### FZ-09 · Low · fixed in `cd51f22` · Four revoked keys, then none
`revoke_verifier_key` writes into a fixed `[Pubkey; 4]` and nothing ever removes an entry (`BadParams` when full, repro FZ-09). After
four revocations (leaks, or simply retiring each rotated key as the docs suggest) a fifth leaked key can be paused but not revoked,
and its certificates cannot be voided: FZ-01 comes back.
- **Fix:** let the admin drop a revoked key once every certificate it signed is past `issued + validity_slots` (record the revocation
  slot), or keep revoked keys in their own PDAs (`["revoked", key]`) passed to `gate` as an optional account.

### FZ-18 · Medium · fixed in `a3b15d1` · A spent zk certificate came back by replaying its own proof
In the zk build (`cd51f22`), `certify_zk` over an existing certificate that is not live remade it with no replay check, and the
existing note lock was reused as long as it named the same certificate. So after `revoke_spent` had shown the note spent, the holder
could submit the **same** proof again: it still verified (the proof is bound to controller, payer, tier and nonce, not to time), the
nullifier root it used was still the newest (on mainnet the forester folds nullifiers in batches, so it rarely moves), and the note
lock let it through. The certificate came back live, settled after 150 slots, and passed every gate until someone revoked it again.
Shown with real Groth16 proofs in the zk suite (dev runs 50 and 51): the replayed certificate passed `require_certificate` after the
settle window. A fresh proof of the same queued spend worked too.
- **Fix (done in `a3b15d1`):** `revoke_spent` (and the staged revoke) of a zk certificate marks its note lock spent; a spent lock is
  never released outside the wind-down, and `certify_zk` refuses a spent lock (`ZkNoteLocked`); a remake must carry a new nonce
  (`Replayed`). Verified at `a3b15d1`: the replay is refused with `Replayed`; a fresh proof of the spent note, for the same subject and
  for another, gives `ZkNoteLocked`; `release_note_lock` of the spent lock gives `ZkNoteStillLive`; `revoke_spent` without the lock,
  or with another tag's lock, gives `ZkLockMissing`.
- **Left by design:** the nonce check compares with the replaced certificate's nonce only, so proof A can come back after a proof B
  remake. That matters only for a note that is not spent (a spent one is locked for good), and the holder could prove it again anyway.

### FZ-19 · Low · open · ZkOwner records are never closed
`register_zk_owner` (ZK-11, `a3b15d1`) creates a paid record `["zkowner", owner]` per ring owner. No instruction closes it: not
`close_zk`, not the wind-down. After `close_config` the program still owns every record and their payers' rent is stranded (the
wind-down suite on the zk build: 3 accounts left after everything else closed). `close_config` does not count them, so the wind-down
"owns nothing afterwards" promise fails silently.
- **Fix:** close the records during the wind-down (`close_zk` taking them as remaining accounts, or a `close_owner_record` allowed
  while `config.closing`, rent back to the payer recorded in the record), and count them like staged paths.

### FZ-20 · Info · One note, two kinds of lock
A Verifier certificate stores salted hashes and the Verifier keeps its own keyed note index off chain; a zk certificate stores tags
and locks them on chain (`["znote", tag]`). Nothing joins the two, so one note can back one live certificate of each kind at the same
time. If "one note backs one live certificate" should hold across both, the Verifier should also refuse a note whose `["znote",
Poseidon(TAG_DOMAIN, nullifier)]` lock is live (it knows the nullifier).

### FZ-21 · Info · zk compute and size margins
`certify_zk` costs 247,820 CU with one note and 301,823 with four; the first `set_zk` costs 395,524 (the Baby Jubjub on-curve check
in 256-bit limbs). All pass the 200k default per instruction, so clients must set a compute-unit limit, as the zk agent's client
does. The four-note form is 1,230 bytes with the lookup table and a compute-unit limit: a compute-unit price instruction no longer
fits; without the table it does not fit at all.

### FZ-10 · Info · The new key can revive a revoked key's certificate
`renew` does not refuse a certificate whose `verifier` is revoked. Until someone calls `void_by_key`, a fresh attestation of the same
notes by the new key renews it, and it passes the gates again (void suite). That needs the honest new Verifier to re-check real notes,
so it is not a bypass; but if the intent is "every certificate of a revoked key is dead", `renew` should require
`!is_revoked_key(cert.verifier)` (or void it first).

### FZ-11 · Info · The $ROOT exemption can be borrowed
`is_holder` reads the payer's ATA balance when `certify` runs. Moving 1,000,000 $ROOT into the payer's account and back inside one
transaction makes the certify fee-free (holder suite). The cost is the fee (0.01 SOL) against a flash loan or a round-trip swap.
Document it, or snapshot holdings.

### FZ-12 · Info · Relayed certify sizes
The relayer sends legacy `[Ed25519, certify]` (1,141 bytes with 8 notes). CONTRACT §7 still says every relayed certify carries a memo
anchor; with 8 notes that memo plus a compute-unit price makes 1,314 to 1,316 bytes, which does not fit, and a two-signer form (the
holder pays, the relayer pays the fee) is 1,412. Keep anchoring in `anchor_log` (as the verifier does) and fix the §7 text, or cap
relayed certifies at the note count that fits.

### FZ-13 to FZ-17 · Info
- **FZ-13:** every instruction accepts trailing bytes after its arguments (Anchor deserializes from the front); `certify`'s
  `log_index` changes freely (it is not signed, POF-18). Readers must match log entries by the attestation bytes.
- **FZ-14:** donations cannot hurt anyone after POF-07 (the remake costs exactly rent + fee + signatures for every donation size
  tried, 1 lamport to 250 SOL), but: a same-payer remake moves that payer's own donation to the treasury as fees; a donation to an
  address before the certificate exists means the certifier pays no rent and gets the whole amount back at `expire`; a treasury
  donation is withdrawn as fees, so `fees_out` may exceed `fees_in`.
- **FZ-15:** the membership revoke is about 64k CU (16 levels: 64,626), not about 35k as CONTRACT §5 and RINGS §3 say. Fine within
  limits; fix the text.
- **FZ-16:** see §2 (the suite at `73d71dd`).
- **FZ-17:** Anchor's CPI return check compares the return data with the program id the caller put in its `CpiContext`. A consumer
  that takes POF's program id from an unchecked account accepts the hostile program's fake answer (tier 5 for a random subject).
  `pof_gate` pins POF with `Program<Pof>` and refuses the fake (`InvalidProgramId`). The SDK and `/developers` should say: pin
  `pofP4QR…` and pass POF's config.

## 6. What held up

Checked hard and found sound at every snapshot:
- **The signed bytes.** No mutation at any of the 240 offsets, of any instruction field, of the payer or of the program id passed;
  1,500/1,500 random attestations matched the model at the exact bank slot, every boundary (issue age, root lag, validity, expiry,
  tier count per asset, 1..8 notes, strict ordering) exactly where CONTRACT §3 puts it.
- **The Ed25519 check.** Only "one signature, all three indexes u16::MAX, in the instruction right before the top-level one" passes.
  400 random header mutations: none landed. Account metas on the precompile instruction and trailing data are parsed correctly. A
  router program cannot reuse one signature for two certificates (the second CPI fails), and `certify` through a CPI with a PDA payer
  still binds the payer the Verifier signed. The same holds for `revoke_signed` (156 offsets) and `anchor_log`.
- **Spent proofs.** Path (a) refuses every look-alike; path (b) refuses every single-bit change of any sibling and of any leaf-index
  bit, a leaf index ≥ 2^40, out-of-field values (no panic), and a level-1 node presented as a leaf (the fixed 40-level fold blocks the
  second-preimage trick). The staged path is bound to (revoker, certificate) by its seeds and to the note by the salted hash; swapping
  buffers between certificates, another revoker, gaps, overflow and partial staging all fail; it survives renew, and after a remake it
  revokes only if the remade certificate carries the same spent note.
- **Accounts and data.** 2,389 account mutations and 2,377 data mutations: every success was a position free by design (the caller of
  a permissionless call, `holder_token` while no mint is set, `prior_payer` when unused, the member's rent payer) or a read-only
  account made writable.
- **Lifecycle and counters.** No ordering inside one transaction, no race in one slot, and no step of the 300-step walks broke an
  invariant. Exactly one of two racing certifies, revokes, expires or evict/leave lands.
- **Rotation.** The key switches exactly at `next_verifier_slot` (old key ok through slot − 1, new key from the slot); 40-step random
  walks matched a model of `set_params`/`set_verifier` field by field, and the POF-17 promise held for every proposal against every
  earlier observation.
- **certify_zk** (zk build, real proofs). Every public input the program rebuilds is bound: changing the kind, asset, tier, nonce,
  payer, controller, any root, the ephemeral key, any tag or ciphertext, or any proof byte breaks the proof or a check before it;
  a non-canonical tag (tag + r) is refused before the pairing; lock accounts must be exactly the tags' PDAs, writable, in order; a
  zk certificate fails every gate until its settle slot, exactly; renew refuses it; the ZkConfig can be revoked as a key to stop
  every zk certificate at once.
- **pof_gate.** Join refuses revoked, expired, closed, other-asset, other-subject, wrong-controller and shut-room cases; evict
  refuses while the certificate is good and accepts every way it stops being good; a program-controlled certificate that revokes
  itself between two checks gets "no" the second time.

## 7. Limits of this round
- The zk suite uses the development trusted setup and the zk agent's fixture scenarios (deterministic test rings and trees), placed
  in our copy of tree 0. It tests what the program checks around the proof; the circuit's soundness is the zk agent's report.
- The zk suite makes 8 real proofs per run (about 7 s each), so its mutations of a valid proof are simulated against one proof.
- Mainnet's acceptance of version 1 transactions over 1,232 bytes was not tested (no mainnet transactions). The staged path makes it
  irrelevant for POF.
- Deep leaves (index ≥ 2^30) could only be exercised through the staged path; the direct path covers 24 levels.
- Error-branch coverage, not instruction-level branch coverage: the BPF binary was not instrumented.

## 8. How to re-run
```
zsh fuzz/build.sh                     # or SNAP_REF=<commit> zsh fuzz/build.sh; FEATURES=zk for the zk build; writes results/snapshot.json
node fuzz/prep.mjs                    # genesis accounts (deterministic; after build.sh, it reads the snapshot's IDL)
zsh fuzz/chain.sh                     # own validator: RPC 52899, ledger in the scratchpad; refuses when 3 validators run
SEED=1 node fuzz/fuzz.mjs [suite …]   # results/run-<seed>.json; SCALE=0.3 for a quick pass
node fuzz/repro.mjs                   # one test per finding: REPRODUCED or FIXED, results/repro.json
zsh fuzz/chain.sh stop                # also deletes the ledger
zsh fuzz/suite.sh 2                   # the program's own suites on the snapshot, twice (results/suite-runs.txt)
```

## 9. Changes
- 2026-11-25 · fuzz · round 1 on `73d71dd`, `74654cb` and `187914b` (seeds 1 to 4, 41,459 cases, 130 invariant checks): 17 findings (1 Medium, 7 Low, 9 Info), 6 fixed by the program
  owner during the round and confirmed by `fuzz/repro.mjs`.
- 2026-11-25 · fuzz · final seeds on `1c02f89` (launch build) and `a3b15d1` (zk and launch builds): 31,582 more cases, 95 more invariant
  checks; FZ-05, FZ-07, FZ-08, FZ-09 confirmed fixed (`cd51f22`); new FZ-18 (Medium, fixed in `a3b15d1`), FZ-19 (Low, open), FZ-20,
  FZ-21 (Info). Totals: 73,041 cases, 225 invariant checks, 21 findings.
