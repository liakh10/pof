# Test report: phase 2, the zero-knowledge proof of funds (`zk/`)

**Development setup only.** Every proof and every number below comes from a trusted setup made on one machine
(`zk/setup/TRANSCRIPT.md`). Whoever ran it could forge proofs for that key. It is fit for local tests and devnet, and never
for mainnet certificates. The public ceremony that replaces it is described in `docs-src/zk.md` ("The public ceremony").
`certify_zk` is not deployed anywhere, and stays off (`ZkConfig.enabled = false`) until that ceremony has run.

Scope:
- `zk/circuits/pof.circom`: the circuit.
- `zk/js/zk.js`: the circuit inputs, the context hash, the escrow, the proof encoding and the prover call. The rings client
  imports it.
- `zk/scripts/`: build, ceremony, transcript, and the verifying key turned into Rust.
- `zk/bench/`: proving in the browser.
- `zk/onchain/`: the Groth16 verifier over the alt_bn128 syscalls, and the `certify_zk` patch for `pof`. `apply.py` applies
  it to a copy of `program/`; `patch/pof-program.diff` is the same change as a reviewable diff.

Toolchain: Node 20, circom 2.2.2, snarkjs 0.7.5, circomlib 2.0.5, solana-cli 4.1.2 (Agave), Anchor 1.2.0, solana-bn254
3.2.1, Chrome 158 headless.

No mainnet transaction was sent. Mainnet was read for one finalized blockhash per ceremony phase (the beacons). The client's
test vectors were read earlier.

## Summary

| suite | command (from `zk/`) | checks | result |
|---|---|---|---|
| Hashes = Rings (SDK and real mainnet leaves) | `node --test test/parity.test.mjs` | 4 | pass |
| The circuit with snarkjs | `node --test test/circuit.test.mjs` | 12 | pass |
| The on-chain verifier, native, against snarkjs proofs | `npm run test:native` | 5 | pass |
| `certify_zk` on a local validator (`pof/program` at HEAD, zk + quick build) | `zsh onchain/test/run.sh` | 14 | pass (73bcf04) |
| Patched `pof` unit tests (zk module included) | `cargo test -p pof --lib` in the patched copy | 11 | pass |
| The audit's round 3 zk proofs | `node --test audit/zk/` and `cargo test` in `audit/zk-native` | 3 + 1 | pass (they failed before the fixes) |
| Proving in the browser | `node bench/run.mjs` | 5 proofs | all verify |
| The integration end to end (client, Chrome prover, keeper, real non-inclusion paths) | `node ../lab/test/zk-e2e.mjs` | 33 | pass |
| The client zk flow offline, the keeper's escrow and scan | `node --test client/test/zk-flow.test.mjs`, `verifier/test/zk.test.mjs` | 3 + 4 | pass |

## The circuit

| | |
|---|---|
| constraints | **93,803** non-linear (circom `--O2`), 94,082 wires |
| public inputs | 18 (two roots, asset, minimum, context, escrow key, ephemeral point, 4 tags, 4 ciphertexts, registry root) |
| private inputs | 349 |
| notes | 1 to 4 (unused slots are zero) |
| Powers of Tau | 2^17 (131,072) |
| witness wasm | 4.6 MB |
| proving key | 57.7 MB; 38.5 MB gzipped, in git at d7f850b (`setup/pof_final.zkey.gz`). `scripts/fetch-zkey.sh` downloads it from the raw GitHub URL pinned to that commit (not `main`) and checks it against `setup/ZKEY.sha256`. Later keys (the public ceremony) go to a GitHub Release with `scripts/publish-zkey-release.sh`, never into git |
| verifying key | 18 IC points, `VK_HASH f360e497…a406` (in `onchain/src/vk.rs` and `ZkConfig.vk_hash`) |

The statement, the public inputs and who sets each one are in `docs-src/zk.md`.

**Proven against Rings** (`test/parity.test.mjs`):
- circomlib Poseidon equals the Helius SDK hasher for 1, 2, 3, 4 and 7 inputs;
- `hashBytes`, the owner identity and the asset hash equal the SDK;
- the circuit's commitment formula, fed with four real mainnet deposits' public data, gives exactly their leaf hashes.

**The circuit tests** (`test/circuit.test.mjs`). Each "no witness" case means the witness generator hits a failing
constraint, so no proof can exist for it:
- **Valid:** one note above the tier, and four notes summing exactly to the minimum (tags come out ascending). Both prove and
  verify, and the public signals come out in the documented order.
- **Amount below the tier:** no witness.
- **Wrong root:** a state root the notes are not under gives no witness. A valid proof does not verify under another state
  root or another nullifier root.
- **Wrong nk, wrong owner:** no witness.
- **A spent note** (its nullifier in the nullifier tree): no witness.
- **Replay:** a proof does not verify with the context of another subject, payer, tier, asset, controller or nonce, nor with a
  higher minimum.
- **Malformed:** no witness for any of these:
  - a non-bit `enabled`, the first slot unused, or a gap among the used slots;
  - a tag on an unused slot, a wrong tag, or a wrong ciphertext;
  - an ephemeral point that is not `r·B8`;
  - a minimum over u64, a leaf index over 32 bits, or an amount of 2^64;
  - a broken state path or nullifier path;
  - a missing signal.

  The same note twice is refused before proving.
- **Spend authority (ZK-04):** `nk` and the openings without the owner's registered secret give no witness. Neither does
  another registry root, nor another owner's registry entry.
- **The end of the nullifier list (ZK-10):** a nullifier above the last element (`next = 0`) proves absent. That element
  itself is refused.
- **A changed proof** does not verify.
- **The escrow:** the revocation key opens every nullifier from `R` and `ct` and checks it against the tag. Another key is
  refused.

## Proving time

| where | 4 notes (the worst case) |
|---|---|
| Chrome 158 headless, this laptop (10 cores, Apple silicon) | witness ~0.2 s, proof ~4.1 s, **total 4.3 to 4.5 s** (3 runs) |
| the same with the CPU throttled 4x (DevTools emulation) | witness ~0.8 s, proof ~6.5 to 7.0 s, **total 7.3 to 7.8 s** (2 runs) |
| Node 20 (`snarkjs.groth16.fullProve`, while other agents shared the machine) | median 5.5 s, 5.0 to 7.4 s |
| download, once per device | 4.6 MB wasm + 38.5 MB gzipped key (unpacked in the browser with `DecompressionStream`) |

The 4x throttle slows the main thread; snarkjs proves in Web Workers, which DevTools throttles less. So a real mid-range phone
will be slower than the second row. A phone measurement is still to do.

**The module the rings client calls** is `zk/js/zk.js`, ESM with no dependencies:
- `buildInputs(P, { ring, notes, pub, r, registry })` takes `P = fromBytesPoseidon(core.poseidon)` (the SDK hasher the client
  already loads), the note openings and paths, the on-chain roots, and `context(...)`.
- `prove(snarkjs, { input, wasm, zkey, onStage })` returns the proof, the public signals, the timings, and `args`: the
  `certify_zk` arguments as bytes.
- Also `ownerSecretFrom(seed)`, `ownerCommitment` (for `register_zk_owner`), `escrowKeypair` and `openEscrow` (the keeper).

`bench/index.html` is the reference page with a loading state.

## On chain: `certify_zk`

The patch adds these to `pof`:
- **accounts:** `ZkConfig` `["zk"]`, the owner registry `["zkreg"]`, and `NoteLock` `["znote", tag]`;
- **instructions:** `set_zk`, `register_zk_owner`, `certify_zk` and `release_note_lock`;
- **changes to existing code:**
  - `revoke_spent` gets a zk branch (it checks `Poseidon(TAG, nf) == tag`);
  - `gate` refuses a settling zk certificate (ZK-02);
  - `renew` refuses zk certificates.

The Groth16 check is `zk/onchain/src/groth16.rs` over `solana-bn254` (alt_bn128 add, mul and pairing syscalls), with A
negated client side.

**Measured on the local validator** against `program/` at `ad07261` with the patch applied (`onchain/test/last-run.json`):

| instruction | compute units | transaction |
|---|---|---|
| `certify_zk`, 1 note, wallet subject (1 signer) | **239,125 to 248,023** (three runs) | 843 bytes (v0, lookup table for config, treasury, zk config, registry, tree, system) |
| `certify_zk`, 4 notes, badge subject relayed (2 signers) | **296,464 to 305,456** | **1,230 bytes** (2 under the 1,232 limit) |
| `register_zk_owner` (20 Poseidon syscalls) | 31,448 | |
| `set_zk` (the on-curve check of the key, 256-bit arithmetic) | 390,862 | admin only |

The suite (12 checks, `onchain/test/zk-chain.mjs`):
- **set_zk:**
  - an outsider is refused, and so is a key off Baby Jubjub;
  - turning it on waits the rotation delay, and a ready `certify_zk` is refused until then;
  - turning it off is immediate;
  - the vk hash is recorded.
- **Valid certificates:**
  - one note for a wallet subject: live, the `ZkConfig` address as the verifier, the tag stored, and the lock holds the
    escrow, which the keeper opens from chain data to the right nullifier;
  - four notes at tier 2 (10 SOL exactly), a badge subject, relayed by another payer;
  - USDC tier 1, with its lock address pre-funded by a stranger (ZK-07).
- **Wrong root:**
  - a state root not in the history: `ZkStateRootUnknown`;
  - a valid proof against an *older* nullifier root (ZK-01), or a made-up one: `ZkNullRootNotNewest`;
  - an unknown registry root: `ZkRegistryRootUnknown`.
- **Below tier:** a proof against the tier 1 minimum submitted as tier 3 gives `ZkProofInvalid`.
- **Replay:** a proof bound to wallet 3 submitted for wallet 4, or with another payer, or with another nonce, gives
  `ZkProofInvalid`. An X subject is refused.
- **Malformed:**
  - a flipped proof byte: `ZkProofInvalid`;
  - the same proof with a tag + r: `ZkInputNotInField`;
  - reversed or duplicate tags: `NullHashesUnsorted`;
  - missing or misordered locks: `ZkLockMissing`;
  - fewer ciphertexts than tags: `BadNoteCount`.
- **One note, one live certificate:**
  - the same note for another wallet: `ZkNoteLocked`;
  - releasing the lock while the first certificate is live: `ZkNoteStillLive`;
  - after `revoke_by_holder` and a release, the rent goes back to its payer and the other wallet certifies.
- **revoke_spent on a zk certificate:**
  - the note's nullifier PDA exists (a queued spend, exactly the case the settle window is for);
  - the keeper opens the escrow from the lock, and a wrong nullifier is refused;
  - the real one revokes it during the settle window;
  - then the lock is released.
- **Settle window (ZK-02):**
  - `certify_zk` + `require_certificate` in one transaction is refused (`ZkSettling`);
  - the certificate's issued slot is the certify slot + 20 (quick build; 150 in the launch build);
  - the gate passes from that slot.
- **The CPI gate** reads a settled zk certificate like a signed one, and refuses a higher tier.

## Audit round 3: what changed

| finding | fix | test |
|---|---|---|
| ZK-01 Critical: any of 100 nullifier roots | only the newest (before the cursor at 17,224) | audit ZK-01, chain "older nullifier root" |
| ZK-02 High: live in the same instruction | `issued_slot = certified + ZK_SETTLE_SLOTS` (150), `gate` refuses before it | audit ZK-02, chain "settle window" |
| ZK-03 High: stub verifying key | `vk.rs` is generated from the ceremony key; a stub or a point at infinity fails compilation; `set_zk` refuses a zero vk hash; proofs with A, B or C at infinity are refused | audit zk-native, native "zero proof" |
| ZK-04 High: no spend authority | the owner registry: the ring owner signs `register_zk_owner`, and the circuit proves knowledge of the registered secret | audit ZK-04, circuit "spend authority" |
| ZK-05 Medium: old remake rent code | the remake code of `certify` (POF-07), surplus moved after the CPIs | review |
| ZK-06 Medium: signed + zk on one note | **open, cross-part:** the Verifier must check the `znote` lock; signed certificates creating `znote` locks needs CONTRACT §3 v2 | none yet |
| ZK-07 Low: pre-funded lock | top up, allocate and assign when the address holds lamports | chain "USDC … pre-funded" |
| ZK-08 Medium: unsalted tags | kept on purpose and documented (keeper-free revocation); the salted variant is described as the upgrade path | docs |
| ZK-09 Low: `set_zk` without delay | on/key change waits the rotation delay (with POF-17's held delay), off is immediate; on-curve check; key epoch in each lock | chain "set_zk" |
| ZK-10 Info: `next = 0` | the circuit treats `next = 0` as the end of the list | circuit "end of the list" |

## The ceremony

`scripts/ceremony.sh`, with the transcript in `setup/TRANSCRIPT.md`:
- **Phase 1:** `powersoftau new bn128 17`, two random contributions, a beacon (mainnet slot 473,512,657),
  `prepare phase2` and `verify`. It took 28 minutes; the 151 MB output stays out of git, sha256 `cbd476d2…ac52`.
- **Phase 2:** `groth16 setup` over the r1cs, two random contributions, a beacon (mainnet slot 473,521,279), `zkey verify`
  and the exported verifying key. It took 4 minutes.

The entropy came from `/dev/urandom` and was never written. **Labelled a development setup everywhere it appears.**

## Integration (2026-11-25, program 73bcf04, zk build)

Everything below sits behind the switch. The launch program (1c02f89/a3b15d1/73bcf04 without the `zk` feature) has no
`ZkConfig`, so the client's zk flow answers `ZK_OFF` and sends nothing, and the keeper never looks at zk certificates
unless `POF_ZK_ESCROW_KEYS` is set. The site and the launch build behave as before.

| part | files | what it does |
|---|---|---|
| client | `client/zk-flow.js`, `client/zk-idl.js` (from the committed `program/idl/pof-zk.json`, `tools/zk-idl.mjs`), `pof-client.js` (`zkIdentity`: the owner secret from the vault seed), `wallet.js` (`sendVersioned`) | `state()` (`ZkConfig.active(slot)` mirrored: off, pending, on, the key and its epoch), `register()` (`register_zk_owner`: owner, payer, config, treasury, registry, owner record; paid, one per owner), the registry path rebuilt from every `ZkOwner` record and checked against the program's 20 roots, the witness (state paths from the indexer or LocalRings, non-inclusion paths from the indexer at the tree's newest nullifier root, checked before proving), the proof in the page (snarkjs, the 38.5 MB key streamed and unpacked once), `certify()` (`certify_zk` plus one `NoteLock` per tag; notes other certificates hold are skipped; a forester batch between read and send re-proves once), `settle()` (status `settling` until the issued slot), `revoke()` (`revoke_by_holder` + `release_note_lock` in one transaction), `revokeSpent()` (anyone with the kit: `revoke_spent` with the `NoteLock` first), kits sealed under the vault's kit key |
| keeper | `verifier/src/zk.ts`, `keeper.ts` (`scanZk`), `program.ts` (`zkLocks`, `certificatesAt`, `revokeSpent({ zkLock })`) | lists every unspent `NoteLock`, opens each nullifier from `(R, ct)` with the revocation secret of the lock's key epoch, checks it against the tag, asks the Rings source whether it is spent, and revokes with the lock as the first remaining account (PDA path, staged path the same). ZK-06 (`zkLocked` before signing) is unchanged. Bundle `1669327c…6091`, `BUILD.json` regenerated, `node --test` 50/50 incl. build |
| tests | `client/test/zk-flow.test.mjs` (3), `verifier/test/zk.test.mjs` (4), `lab/test/zk-e2e.mjs` (33, results `lab/test/zk-e2e.json`) | below |
| on-chain suite | `zk/onchain/test/run.sh` | now builds `pof/program` at git HEAD with `--features zk,quick` in a scratch copy (no `apply.py`); 14/14 on 73bcf04 |

**Transaction limits.** At most 3 notes by default. A 4-note `certify_zk` is 1,230 of 1,232 bytes even over a lookup table
with two signers, which leaves no room for a priority fee, so it needs `certify({ allowFourNotes: true })` and a lookup
table. A badge (two signers) with 3 notes needs the lookup table too.

**The end-to-end run** (`node lab/test/zk-e2e.mjs`, 33/33): a local validator with the zk build of 73bcf04, Privacy Rings
cloned from mainnet with the tree account read fresh at the start, the real client, the Verifier's keeper. The
non-inclusion paths are **real**: the Helius indexer on mainnet (read-only) answered for each nullifier at mainnet's newest
nullifier root, which is the clone's, and the program accepted them. The spend is the nullifier PDA a real spend leaves
(RINGS §8.3), preloaded at genesis at the address the test predicted from the vault the client then derived.

1. No `ZkConfig` (as on the launch program): `state()` off, `certify` and `register` answer `ZK_OFF`, nothing sent.
   `set_zk` on: still `ZK_OFF` until the rotation delay.
2. Nine shields into the vault; `certify` before registering: `ZK_NOT_REGISTERED`. `register_zk_owner` pays the fee
   (0.01 SOL) to the treasury, a second call is a no-op.
3. Wallet subject, 1 note, proven in Node, `certify_zk` lands; `settling` for 20 slots (quick build; 150 in a real build);
   `require_certificate` refuses (`ZkSettling`), then passes after `settle()`.
4. The keeper without a key ignores zk certificates. With the key it opens the lock, sees the spend and revokes;
   the certificate is `revoked_spent` and its `NoteLock` is marked spent (FZ-18); the gate refuses; a remake is refused by
   the client (lock spent), and by the program with the same nonce (`Replayed`) and with a fresh proof (`ZkNoteLocked`).
5. A badge certificate proven in **headless Chrome**, then revoked by the holder (badge key) with the lock released in the
   same transaction (rent back).
6. The same wallet remade at tier 2 from 3 notes picked by default (the spent note and held notes skipped), legacy.
7. Four notes: refused without the option, refused without a table, then accepted as a version 0 transaction over a lookup
   table with `allowFourNotes`.

| measured (local validator, this laptop) | notes | tx | compute units | proof |
|---|---|---|---|---|
| `register_zk_owner` | | | 60,549 | |
| `certify_zk`, wallet subject, Node | 1 | 993 B legacy | 263,001 | 5.1 s (witness 0.2 s) |
| `certify_zk`, badge (2 signers), headless Chrome | 1 | 1,089 B legacy | 264,591 | 4.3 s (witness 0.2 s) |
| `certify_zk`, wallet subject, Node | 3 | 1,187 B legacy | 286,740 | 5.0 s |
| `certify_zk`, badge (2 signers), Node | 4 | 1,230 B, v0 + lookup table | 318,279 | 4.9 s |
| keeper `revoke_spent` with the `NoteLock` | | | 35,483 | |

The client's transactions add a compute unit limit instruction, so sizes are about 40 bytes above the on-chain suite's.

**What remains before `set_zk(true)` on mainnet:**
- **The public ceremony** (`docs-src/zk.md`), then `vk.rs` regenerated, the build hash published, the key served from a
  GitHub Release (`scripts/publish-zkey-release.sh`).
- **The revocation key**: generate `k` offline, put `K = k·B8` in `set_zk` and `POF_ZK_ESCROW_KEYS=<epoch>:<k>` in the
  keeper's env (the epoch is 1 after the first `set_zk`, +1 at each key change; the keeper keeps old epochs while their
  certificates live).
- **The program upgrade**: `solana program extend` (about +103 KB, about 0.72 SOL) and the upgrade to the zk build.
- **The site**: `zk/` is in `.vercelignore`; the page needs `zk/js/zk.js`, `zk/dist/snarkjs.min.js`, the wasm and the key
  served (or `createZkFlow(pof, { assetBase })` pointed at the release), a `/get` path that calls `zk-flow.js`, and the
  `settling` state shown. The SDK's `POF_ZK_IDL` is older than `pof-zk.json` (no `owner_record`) and `zkEnabled()` checks only
  that `ZkConfig` exists, not that it is on.
- **A real phone measurement**, and a **devnet run** with a real spend (here the spend is the preloaded PDA, and the state
  tree's new leaves are ours on top of the cloned frontier).
- **Out of scope for now**: the relayer for zk badges (the wallet pays, with `allowWalletPayer`), X-handle subjects.

## What remains

- **The public ceremony** before mainnet (`docs-src/zk.md`), then rebuild `vk.rs`, publish the build hash, and `set_zk`.
- ~~The merge into `pof`~~: done (cd51f22, behind the `zk` feature).
- ~~ZK-06 (Verifier side)~~: done (the Verifier refuses a note whose `znote` lock is live). A CONTRACT §3 v2 would let signed
  certificates create the locks too (parked for the zk launch).
- ~~The rings client~~ and ~~the keeper~~: done, see Integration.
- **The API and SDK:** show a settling zk certificate as "settling" (its `issued_slot` is in the future).
- **A real phone measurement.**
- **A devnet run against the real tree**, with a real deposit, a real non-inclusion proof from the indexer, and a real
  spend. The on-chain suite uses synthetic roots; the integration run uses the real mainnet nullifier tree (read-only) and a
  preloaded spend PDA.
- **Not in this version:** X-handle subjects (they need the linker's proof in the circuit), more than 4 notes, unlinkable
  (salted) tags, and the subgroup check of the escrow key on chain.
