# Proof of Funds: internal security review

Status: **round 5, final for the launch build** (2026-11-25). The launch program `1c02f89` ships **without** phase 2: `certify_zk` is behind the cargo feature `zk`, and the launch IDL has no zk instruction. Every Critical and High of rounds 1 to 3 is fixed and re-tested. One new Medium (ZK-11) is in the zk build only. What remains open is listed in §6 and in the table.
Reviewer: the POF `audit` agent. It did not write any of the code reviewed here and edits none of it; fixes are made by the owners of each part.

## 1. Scope

| part | paths | commits reviewed |
|---|---|---|
| on-chain programs | `program/programs/pof`, `program/programs/pof_gate` (Anchor 1.2) | `54aa589` |
| Verifier, transparency log, keeper, relayer, X linker, limits | `verifier/src/*`, `api/attest/*`, `api/relay/*`, `api/keeper/*`, `api/link/*` | `47bc6ce`, `9034e44`, `b0edfcc`, `4b22ca5` |
| browser client, indexer proxy | `client/pof-client.js`, `client/wallet.js`, `client/server/spr-proxy.js` | `6189906`, `ec99afb` |
| public read API, SDK, MCP, bots | `api/v1/*`, `sdk/src/*`, `mcp/*`, `api/mcp.js`, `bots/*`, `api/bots.js` | `82a06d2`, `7402298`, `4b00ca8`, `ec99afb` |
| shared contract | `CONTRACT.md` §1 to §7, `RINGS.md` | `457d9a3`, `ec99afb` |

Repository head at the end of round 1: `cf763b5` (the audit's own proof tests).

**Round 2** re-reviewed the fix commits below. It re-ran the round 1 proofs and added `audit/test/round2.test.mjs`. That file has positive controls and v2-package re-tests, so a refusal is proven to happen for the right reason.

| part | commits re-reviewed |
|---|---|
| Verifier fixes and CONTRACT §4 v2 | `d84df76`, `0387b66` |
| client fixes | `d9bec9f`; proxies `084ea11` |
| devx fixes (SDK, `/v1`, MCP, bots), log witness, CONTRACT §8 | `39e02d9`, `5906c78` |
| `/api/status` | `c51636c` |
| docs paper and litepaper (only the claims that touch findings) | `c0fd4df` |
| program fixes for POF-07, POF-17 and POF-22 | **uncommitted** working-tree diff of `program/programs/pof/src/lib.rs`, read only |

Repository head at the end of round 2: `5906c78`.

**Round 3** reviewed the following commits.

| part | commits |
|---|---|
| zk circuit, JS prover, ceremony scripts, `certify_zk` patch | `62937c7` (`zk/circuits/pof.circom`, `zk/js/zk.js`, `zk/onchain/*`, `zk/scripts/*`, `docs-src/zk.md`) |
| log witness and certificate monitor | `39e02d9`, `6780b93` (`witness/*`) |
| verifier fixes: keeper escrow, renew, POF-26, POF-28 | `035f6a6`, `302a98f` |
| program fixes: POF-07, POF-17, POF-22 | `73d71dd` |

**Round 4** reviewed the following.

| part | commits |
|---|---|
| blind relay credits (RSA-FDH, claim v2), relayed revoke | `432b0cd` (`verifier/lib/blind.mjs`, `verifier/src/credits.ts`, `/api/relay/credits`, `/api/relay/revoke`); client `b22ca29` |
| POF-30 fix; issue-slot race (ROOT_TOO_OLD) | `11b629a`; `3033364` |
| witness W-01 to W-03 | `f359010` |
| program `revoke_signed` (POF-REVOKE1, 148 bytes) | **uncommitted** working tree of `program/programs/pof/src/lib.rs`, read only |
| launch and wind-down scripts | `program/launch.mjs`, `program/wind-down.mjs`, `program/ops.mjs` at `73d71dd`, key handling and defaults only; not run |

**Round 5** reviewed the following. `reports/audit2.md` (A2-*) and `reports/fuzz.md` (FZ-*) were read first, and their findings are not repeated here.

| part | commits |
|---|---|
| program: launch build without zk; staged membership revoke; revoked verifier keys; `revoke_signed` v2; fuzz fixes; zk fixes behind the feature | `cd51f22`, `1c02f89` |
| circuit fixes (ZK-04 owner registry, ZK-10 last element) | `d7f850b`, merged in `cd51f22` |
| verifier: ZK-06, internal header, parallel attest, A2-02/03/05/06, CR-01 to CR-04, RV-01 | `b2c7905`, `7a7d6c3`, `15049b6`, `131ae54`, `e2407c3`, `2a36df1`, `e0f3faa` |
| client: A2-01, A2-03, encrypted kits, credit pins per network | `ef02393`, `d43099b` |

Circuit tests compute the witness with the committed wasm (`$POF_ZK_OUT/build/pof_js/pof.wasm`); circom's `===` checks are asserts in the witness generator. The on-chain Groth16 verifier was tested natively through solana-bn254 (arkworks). The validator suite of `certify_zk` was **not** run by the reviewer, and the proving key was still being generated, so no full proof was made.

**Not covered in this round** (stated so that nobody reads silence as a pass):
- `zk/bench`, `zk/dist/snarkjs.min.js` (vendored) and the browser prover's worker. Only the circuit, `zk/js/zk.js` as the input builder, and the on-chain patch were reviewed in round 3;
- the trusted setup: `zk/scripts/ceremony.sh` is a development ceremony on one machine and says so. A mainnet ceremony has not happened, so it could not be reviewed;
- the public site, `/docs` and the film (not built yet);
- `launch.mjs`, `preflight`, `wind-down.mjs`, `program/ops.mjs` and the deploy and key scripts;
- the soundness of Helius Privacy Rings itself (its Groth16 circuits, the prover TEE, the forester, the indexer). POF treats these as trusted. Section 6 lists the assumptions.
- the vendored SDK bundles in `client/dist/` (third-party code, only their use was reviewed);
- dynamic testing of the programs on a validator. The program findings come from reading the code. The programs' own test suites were not re-run by the reviewer.

## 2. Method

1. Read the threat model from `CONTRACT.md` and `RINGS.md`. Then read every file in scope line by line, adversarially, with one question per component: what does an attacker gain by calling this with inputs of their choosing, in an order of their choosing, concurrently?
2. On chain: the instructions sysvar parsing (index, offsets, which pubkey and message are compared), PDA seeds and collisions, owner and type checks, close and re-init paths, lamport flows, the fee exemption, the rotation delay and the CPI surface.
3. Off chain: input validation, the binding between each proof and the party that presents it, races on the Blob store (which has no transactions), lifetimes of stored state, secrets at rest and in errors, cost amplification, SSRF and CORS.
4. Privacy: what the chain, the relayer, the Verifier operator and the transparency log can link.
5. Where a finding can be shown in code, there is a **failing test** in `audit/test/` that states the secure behaviour. It fails while the finding is open and passes once the fix lands. Run it with `node --test audit/test/` from `pof/`. At `cf763b5` it fails 9 of 9.

## 3. Summary

| severity | round 1 | of those still open after round 2 | new in round 2 |
|---|---|---|---|
| Critical | 0 | 0 | 0 |
| High | 4 | 0 | 0 |
| Medium | 10 | 4 open or partly fixed (POF-01, POF-11, POF-12, POF-14); POF-07 fix uncommitted | 1 (POF-27) |
| Low | 7 | 3 open (POF-16, POF-19, POF-20 residual); POF-17 fix uncommitted | 2 (POF-26, POF-28) |
| Informational | 4 | 2 open (POF-23, POF-25); POF-22 partly fixed in the uncommitted diff | 1 (POF-29) |

**Round 3.** zk path: 1 Critical (ZK-01), 3 High (ZK-02, ZK-03, ZK-04), 3 Medium (ZK-05, ZK-06, ZK-08), 2 Low (ZK-07, ZK-09), 1 Info (ZK-10). Witness: 1 Medium (W-01), 2 Low (W-02, W-03). Verifier: 1 new Medium (POF-30).
Round 1 and 2 rows still open after round 3: POF-11, POF-12, POF-14, POF-16, POF-19, POF-23, POF-25 and POF-27 open; POF-01 and POF-20 partly fixed.

**Round 4.** Credits and revoke: 2 Medium (CR-01, CR-02), 3 Low (CR-03, CR-04, RV-01), 3 Info (CR-05, W-04, LW-01). Fixed: POF-27, POF-30, W-01, W-02, W-03; POF-12 partly. Round 4 tests: `audit/test/round4.test.mjs` 2 of 3 pass (the failure is CR-02); `audit/test/` round 1 and 2 now 19 of 19 (POF-30 fixed).

**Round 5 (final for launch).** The launch program carries no zk code. Every Critical and High finding is fixed and re-tested. New: ZK-11 Medium (zk build only) and RK-01 Info. All audit suites pass: `audit/test` 22/22, `audit/zk` 3/3, `audit/zk-native` 1/1, `audit2/test` 6/6.

Proof tests at round 3:
- `audit/test/` (round 1 and 2): 18 of 19 pass; the failure is POF-30.
- `audit/zk/`: 3 of 3 fail (ZK-01, ZK-02, ZK-04).
- `audit/zk-native` (Rust): 1 of 1 fails (ZK-03).
- Round 3 correction: the verifier agent said round 2's POF-26 test failed because of the test, not the code. That was checked and is correct. The test helper signs `controllerProof` for every key the tests create, the victim's controller included, so the "attacker" held the victim's key. The test now passes `controllerSigner: null`, and also a wrong key, and expects exactly `BAD_CONTROLLER_PROOF`. A positive control was added.

Proof tests at `5906c78`:
- `audit/test/verifier-services.test.mjs`: 9 of 9 pass (was 0 of 9).
- `audit/test/round2.test.mjs`: 7 of 8 pass. The open one is POF-26.

No finding lets anyone mint a certificate without real, unspent funds in a Privacy Ring, or move anyone's money. The program's signature check, PDA derivations, spent-nullifier proofs and fee rules held up under review. The serious problems are all off chain:
- whose funds may back whose certificate (POF-02, POF-03);
- whether one note can back several certificates (POF-04);
- whether a certificate really dies when its money moves (POF-05, POF-06, POF-01).

## 4. Findings

| id | severity | title | where | status |
|---|---|---|---|---|
| POF-01 | Medium | Spend-revocation is custodial in practice | design: CONTRACT §5, `verifier/src/keeper.ts` | partly fixed `035f6a6`: kits sealed to every registered keeper (public escrow, `witness-keeper.mjs`) and validity cut to 216,000 slots (about a day). `keepers.json` lists only POF's own key, so in practice revocation still has one operator |
| POF-02 | **High** | The ring owner never consents; nk + openings certify any subject | `verifier/src/verify.ts:128-136` | **fixed** `d84df76` + `0387b66` (ring.proof over the v2 message); re-tested |
| POF-03 | **High** | X-handle code redeemable by whoever reads the post first | `verifier/src/linker.ts:29-50`, `verify.ts:82-89` | **fixed** `d84df76` (start secret, link id bound to the controller), `39e02d9` (bots check the controller signature); re-tested; see POF-26 |
| POF-04 | **High** | Note-lock race: one note behind several live certificates | `verifier/src/locks.ts:26-34` | **fixed** `d84df76` (create-if-absent generations); re-tested; see POF-28 |
| POF-05 | **High** | Keeper deletes the kit of a later attestation; spent certificate stays live | `verifier/src/keeper.ts:42-47` | **fixed** `d84df76`; re-tested |
| POF-06 | Medium | Dead kits kept 30 days; the keeper scan can be flooded past its 60 s limit | `verifier/src/keeper.ts:44`, `vercel.json` | **fixed** `d84df76` + `302a98f` (scan time budget with a resume cursor) |
| POF-07 | Medium | Remaking a certificate pays the prior payer every lamport in the PDA | `program/programs/pof/src/lib.rs:621-629` | **fixed** `73d71dd` for `certify`; **re-introduced** in `certify_zk` (ZK-05) |
| POF-08 | Medium | The relayer burns a payment when it refuses for cap or balance | `verifier/src/relayer.ts:64-79` | **fixed** `d84df76`; re-tested; see POF-28 |
| POF-09 | Medium | Anyone can cancel or lock out another person's pending X code | `verifier/src/linker.ts:20-26,37,42` | **fixed** `d84df76` (a record per start, tries per code); re-tested |
| POF-10 | Medium | The client seals kits (badge secret, amounts) under a key derived from nk, which the Verifier sees | `client/pof-client.js:68,85,266` | **fixed** `d9bec9f` (kitKey from the vault seed; old kits re-sealed) |
| POF-11 | Medium | The vault spending key comes from a phishable signMessage, and is lost with a non-deterministic signer | `client/pof-client.js:19,60-62` | partly fixed `d9bec9f` (domain-separated message, double-sign determinism check, random key with a passphrase backup); residual: the domain is a constant string, so phishing the message stays possible; see POF-27 |
| POF-12 | Medium | Privacy: wallet, vault and handle are linkable on chain and by the operator | `client/pof-client.js:126,291-296,301`; design | partly fixed: relay credits (blind RSA, bought by a private transfer) `432b0cd` + `b22ca29` remove the payment-next-to-certify link; open items: CR-01 (key not pinned), CR-05 (buy-to-spend timing), the vault funding link (docs `5e82f9f` now say so) |
| POF-13 | Medium | `/v1` "verified" log answers trust the key the log itself names | `api/v1/_lib.js:180-182`, `sdk/src/log.ts:142,207` | **fixed** `39e02d9` (keys from Config and VerifierSet history, `keyTrusted`) |
| POF-14 | Medium | Paid upstreams (Helius indexer and prover, RPC) behind open, unauthenticated endpoints | `client/server/spr-proxy.js`, `mcp/core.js:61`, `api/mcp.js` | **fixed**: Vercel Firewall rules on project `pof`, re-read from the active config (version 2, 2026-11-25 00:37 UTC). Heavy paths `^/(api/(attest|relay|link|keeper|spr|spr-prover|card|share|mcp)|mcp|link)(/|$)` capped at 30 a minute per IP; read API `^/(v1|api/(rpc|status|v1|witness)|c)(/|$)` at 120; bot webhooks `^/api/bots(/|$)` at 120. MCP batch and size caps `39e02d9`; shared status reads `fb1e902` |
| POF-15 | Low | Bot sweep re-checks only the first 500 grants and members | `bots/sweep.js:17,37` | **fixed** `39e02d9` (cursor), diff read |
| POF-16 | Low | Relayer: an attestation can be replayed for 30 days, and payments are found in the last 60 signatures only | `verifier/src/relayer.ts:57`, `verifier/src/program.ts` `incoming` | mostly fixed `ef02393` + verifier (A2-03: a per-quote reference in a Memo); residual: no early `max_attest_age` check before the RPC reads |
| POF-17 | Low | The verifier rotation delay can be cut to 9,000 slots without delay | `lib.rs:530-536,565-576` | **fixed** `73d71dd` |
| POF-18 | Low | `log_index` is not signed; the certificate stores what the submitter says | `lib.rs:599,652` | **fixed** `39e02d9` (SDK matches the certificate to its leaf by signed bytes), diff read |
| POF-19 | Low | Non-inclusion accepted against any of the last 100 nullifier roots | `verifier/src/rings.ts:117,181-189` | open |
| POF-20 | Low | Service URLs derived from the Host header when env is unset | `api/bots.js:19,34`, `api/v1/index.js:10`, `api/v1/_lib.js:160-163` | mostly fixed `39e02d9` (`POF_LOG_URL` required in production; bots no longer call the link URL); residual: `/api/status` uses the Host header unless `POF_STATUS_ORIGIN` is set |
| POF-21 | Low | Discord `/pof-setup` lets a Manage Roles user hand out roles above their own | `bots/discord.js:88-95` | **fixed** `39e02d9` (role position check) |
| POF-22 | Info | `renew` is unreachable, and accepts an expired certificate | `lib.rs:680-713`; no Verifier path | **fixed** `035f6a6` (renew with the holder's salts) + `73d71dd` (renew refuses past expiry) |
| POF-23 | Info | Revocation latency is the keeper's cron period, not "seconds" | `RINGS.md` §3, keeper cron | open (the litepaper now points to the keeper's last run on /status) |
| POF-24 | Info | Creator-chosen room names flow into MCP answers and Discord messages | `mcp/tools.js:201,208`, `bots/*` | **fixed** `39e02d9` (MCP quotes names as untrusted text) |
| POF-25 | Info | The signed `tree_root` is the current head, not the root the notes were found at | `verifier/src/verify.ts:199` | open |
| POF-26 | Low | X subjects: nobody proves control of the controller key, so a leaked bound link id certifies the handle with a stranger's funds | `verifier/src/verify.ts` (kind 1 branch), CONTRACT §4 v2 | **fixed** `302a98f` (controllerProof); re-tested, see the round 3 correction in §3 |
| POF-27 | Medium | A random vault seed (non-deterministic wallets) rests in plain text in localStorage | `client/pof-client.js` `deriveVault` (`pof:vaultseed:v2:<wallet>`) | **fixed** `b22ca29` (the random seed is kept in a PBKDF2-600k + AES-GCM passphrase box; plain legacy copies are migrated and deleted). Residual: an XSS still reads the unlocked seed in memory, so the CSP is still needed (site) |
| POF-28 | Low | Lock generations are walked one Blob read at a time; a payment is released after a certify that may have landed | `verifier/src/locks.ts` `newest`, `verifier/src/relayer.ts` catch | **fixed** `302a98f` (lock tombstones with a head hint; refund only a certify that surely did not land), but see POF-30 |
| POF-29 | Info | The uncommitted Config layout change (held_delay, held_until) must ship with `pof_gate`, the IDLs and the SDK together | `lib.rs` Config, `pof_gate` `read_pof_config` | **fixed** `73d71dd` + `6ee8fa6` (IDLs and SDK 0.2.0 refreshed) |
| POF-30 | Medium | Relayer: the payment mark is the same for every attestation, so racing requests share one payment | `verifier/src/relayer.ts` (`mark = hex(att).slice(0, 64)`) | **fixed** `11b629a` (marks bound to sha256 of the whole attestation); re-tested |
| ZK-01 | **Critical** | `certify_zk` accepts any of the 100 nullifier roots, so a note spent long ago proves "unspent" at an older root | `zk/onchain/src/zk.rs` `check_roots` (`(0..NULL_ROOTS).any`) | **fixed** `cd51f22` (only the newest nullifier root, cursor - 1); re-tested |
| ZK-02 | **High** | A zk certificate is live in the same instruction; queued (unfolded) spends pass, so a same-transaction gate admits spent funds | `zk.rs` `handle_certify_zk`; design (`docs-src/zk.md` "Why the escrow") | **fixed** `cd51f22` (a zk certificate settles: `issued_slot = slot + 150`, and `gate` refuses before it); re-tested |
| ZK-03 | **High** | The committed verifying key is a zero placeholder: an all-zero proof verifies for any statement | `zk/onchain/src/vk.rs`, `groth16.rs` | **fixed** `cd51f22` (a real development key in `vk.rs`; `set_zk` refuses `VK_HASH = 0`); the zero proof is refused (Rust test re-pointed at the program's copy) |
| ZK-04 | **High** | The zk path proves knowledge of nk and openings, not spend authority (POF-02 is back for phase 2) | `zk/circuits/pof.circom` (`ownerId` free), `zk.rs` | **fixed** `d7f850b`/`cd51f22` (owner registry: the ring owner signs `register_zk_owner`, the circuit proves the registered secret); re-tested. Residual: the same as phase 1, an owner may lend on purpose; see ZK-11 |
| ZK-05 | Medium | `certify_zk` still pays the prior payer every lamport in the PDA (POF-07 regression) | `zk.rs` `handle_certify_zk`, prior payer branch | **fixed** `cd51f22` (prior payer gets the rent-exempt minimum) |
| ZK-06 | Medium | One note can back a Verifier-signed certificate and a zk certificate at the same time | `verifier/src/locks.ts` vs `zk.rs` `["znote", tag]` | **fixed** one way `b2c7905` (the Verifier refuses a note with a live `znote` lock); the reverse is an accepted, documented limit (`9881592`) |
| ZK-07 | Low | A note lock PDA pre-funded with 1 lamport can never be created again (`create_account` refuses), so that note cannot be zk-certified | `zk.rs` lock creation | **fixed** `cd51f22` (top up, allocate, assign) |
| ZK-08 | Medium | Privacy: unsalted tags link every zk certificate of a note and the later spend, after holder revoke or expiry too | `pof.circom` `tag`, `zk.rs` | **accepted risk**: tags kept unsalted on purpose for keeper-free revocation, documented in `docs-src/zk.md` |
| ZK-09 | Low | `set_zk` changes the escrow key and the switch at once, with no delay and no curve check | `zk.rs` `handle_set_zk` | **fixed** `cd51f22` (on, and key changes, wait the rotation delay; on-curve check; escrow epochs) |
| ZK-10 | Info | Completeness and setup: nf above the largest folded value; development ceremony on one machine | `pof.circom` `below`, `zk/scripts/ceremony.sh` | completeness **fixed** (`nextValue = 0` is the last element); setup: development ceremony only, so zk stays out of the launch build |
| W-01 | Medium | The certificate monitor skips any certificate whose unsigned `log_index` is past the log head, so an unlogged attestation hides by passing `u64::MAX` | `witness/witness.js` `monitor` | **fixed** `f359010` (the leaf is found by its signed bytes; unlogged and `u64::MAX` certificates alarm after a grace period) |
| W-02 | Low | Heads signed by any past verifier key are cosigned | `witness/witness.js` `allowedKeys` | **fixed** `f359010` (heads accepted only from the active key) |
| W-03 | Low | No gossip between witnesses, and the project runs its own: a split view shown to different witnesses goes unseen | design, CONTRACT §8 | **fixed** `f359010` (peer gossip, `split_view` alarm); see W-04 |
| CR-01 | Medium | The client takes the credit key (and the house ring) from the relayer's live offer, so a relayer can give each buyer its own key and recognise the spend by `kid` | `client/pof-client.js` `credits.prepare` (`o.key`), `verifier/src/credits.ts` `offer` | **fixed** `2a36df1` + `e2407c3` + client (key and house ring pinned per network in the build, e = 65537, 3072 bits or more, fingerprint shown) |
| CR-02 | Medium | A claim whose answer is lost cannot be repeated (`ALREADY_CLAIMED`): the holder paid and holds no credits | `verifier/src/credits.ts` `claim` (record keeps only count and kid) | **fixed** `2a36df1` (the same blinded set gets the same signatures); re-tested |
| CR-03 | Low | The RSA signing is JavaScript BigInt square-and-multiply: not constant time, no RSA blinding, no CRT | `verifier/lib/blind.mjs` `modPow`, `signBlinded` | **fixed** `2a36df1` (OpenSSL `RSA_NO_PADDING`, with CRT and blinding) |
| CR-04 | Low | A credit-key rotation voids every unspent credit (`OLD_CREDIT_KEY`) | `credits.ts` `spend` | **fixed** `2a36df1` (retired keys still verify) |
| CR-05 | Info | What still links credits: the claim names the vault, and a spend soon after a purchase links by time | design | open |
| RV-01 | Low | The relayed revoke is sent without checking the signature first; a signed revoke never expires | `verifier/src/relayer.ts` `revoke`; `lib.rs` `revoke_bytes` | **fixed** `2a36df1` + `cd51f22` (checked before sending; v2 156 bytes with `valid_until`, at most 9,000 slots ahead) |
| W-04 | Info | Gossip trusts the key a peer document names, and the monitor reads the whole log to index nonces | `witness/witness.js` `gossip`, `monitor` | open |
| LW-01 | Info | When phase 2 ships, `wind-down.mjs` must close `ZkConfig` and every `["znote", tag]` lock before it closes the program | `program/wind-down.mjs` | **fixed** `cd51f22` (`close_zk`; the wind-down releases note locks and closes staged paths) |
| ZK-11 | Medium (zk build only) | Anyone can append to the owner registry for a transaction fee, and a proof must use one of its last 12 roots: a few registrations a minute make every honest proof stale | `zk.rs` `handle_register_zk_owner`, `REG_ROOTS = 12` | open (not in the launch build) |
| RK-01 | Info | A revoked-key entry is reused after `VALIDITY_MAX` even when that key is still the verifier or the proposed one | `lib.rs` `revoke_verifier_key` | open |

### POF-01 · Medium · Spend-revocation is custodial in practice
`revoke_spent` is permissionless on chain, but it needs a note's secret `salt` and its `nullifier`. Only two parties hold them:
- the holder, who has no reason to revoke their own certificate;
- POF's keeper, which keeps them sealed with `POF_SEAL_KEY` in Blob.

So in practice, "dies the moment the money moves" depends on one operator's cron, store and key. If the keeper stops, misses a kit (POF-05, POF-06), loses its key or is paused, a spent certificate stays live until `expiry_slot` (up to about 30 days).
**Fix (pick and document one):**
- (a) Say it plainly on /docs as a trust point, and publish keeper health on /status: kits watched, last scan slot, revocation latency.
- (b) Give the kits to more than one independent keeper, encrypted to each one.
- (c) Make the salt public. Anyone could then test every new nullifier PDA against every live certificate, making revocation truly permissionless. This costs the privacy of "revoke by holder, then spend": the old certificate becomes linkable to the later spend.

### POF-02 · High · The ring owner never consents
`verify.ts` checks three things: the subject's signature, a User Registry record for `ring.owner`, and `Poseidon(nk) == npk`. The `ring.owner` key (the Ed25519 key that can spend the notes) signs nothing.

The subject message names the ring, but a name is not consent. So anyone who has a ring's `nk` and the openings of its notes can certify any wallet, handle or badge against that ring's funds. That includes:
- a whale who lends `nk` for a fee, keeping both the spend key and the money ("rent a whale", RINGS §7);
- anyone `nk` leaked to. For deposit notes the openings are public chain data (RINGS §5), so `nk` alone is enough.

`nk` never rotates, so a leak is permanent. Because of the note locks, the attacker can also block the real owner from certifying with those notes.
- **Exploit:** a test with a whale ring and an empty "renter" wallet. The renter signs a subject message naming the whale's ring and gets a signed tier 2 attestation.
- **Proof:** `audit/test/verifier-services.test.mjs`, test `POF-02`.
- **Fix:** when `ring.owner != subject wallet`, require a second ed25519 signature by `ring.owner` over the same §4 subject message. In vault mode the client holds the vault key and signs in the page with no wallet prompt. Add a `ring_proof` field in CONTRACT §4. Lending a certificate then means handing over the key that spends the funds.

### POF-03 · High · X-handle code redeemable by whoever reads the post first
How the linker works today:
- `Linker.start(handle)` returns a code, and the holder posts it publicly.
- `Linker.check(handle, post)` returns a link id (the Verifier's signature over handle and expiry) to **any caller**. Nothing binds the check to the browser that started it.
- The link id is a bearer credential for one hour. `/api/attest` accepts it with **any** `controller`.

**Exploit:**
1. A bot watches X for `Linking @… to Proof of Funds: pof-…`.
2. It calls `/api/link/check` with the victim's post before the victim does, and gets the link id. The victim then gets `NO_CODE`.
3. It certifies `@victim` with its own 1 SOL and its own controller.
4. The PDA `["cert", h(@victim), SOL]` is now the attacker's until expiry (`AlreadyLive` for the victim, about 30 days).
5. The attacker's controller can `join` Rooms as `@victim`, and the attacker can link `@victim` to a Telegram or Discord account through `/link`.

- **Proof:** tests `POF-03` (both fail).
- **Fix:**
  - `start` returns a random `secret` and stores `sha(secret)` with the code; `check` requires it.
  - Sign the controller into the link id: `linkTokenBytes(..., controller)`. `/api/attest` then requires `p.controller` to equal the linked one, and the bots' `/link` requires the same.
  - Bots and `/api/link?id=` must never log a link id.

### POF-04 · High · Note-lock race
`NoteLocks.take` reads every `notes/<hmac(nf)>` blob, then writes them all. Blob has no transaction, and `put` overwrites. Two `/api/attest` calls on the same note that reach `take` together both see no binding lock, so both get signed.

The window is several Blob round trips wide, and attest requests spend seconds in indexer calls before `take`, so a script firing parallel requests hits it easily.
- **Proof:** tests `POF-04`. The second test is end to end: one 100 SOL note is signed for both `@alice` and `@bob`.
- **Fix:**
  - Take each lock with `store.create` (create-if-absent; Blob supports `allowOverwrite: false`). On `false`, read the lock and decide.
  - Replace an expired lock with a conditional write (the Blob `ifMatch` etag), or a key that includes the lock's epoch.
  - Release the locks taken so far if a later step fails.

### POF-05 · High · Keeper deletes the kit of a later attestation
In `keeper.ts:46`, a kit whose certificate exists but is "not mine" is deleted as soon as that certificate is live. The Verifier lets one subject and asset re-attest the same notes (the lock allows it), and attestations land in any order.

**Exploit:**
1. Get attestations A and B on the same note for the same subject.
2. Land A. Wait for one keeper pass, which deletes B's kit.
3. `revoke_by_holder` A, then land B (within 300 slots of B's issue).
4. Certificate B is live with no kit anywhere but the holder's. The holder spends, and B stays live up to about 30 days.

- **Proof:** test `POF-05`.
- **Fix:**
  - Never delete a kit while its attestation can still land (`slot <= issued_slot + max_attest_age`).
  - Afterwards, delete it only when no certificate carries its `nullset_hash`.
  - Better: drive the scan from on-chain live certificates. For each one, look up its kit by `nullset_hash`, and alert on any live certificate without a kit.

### POF-06 · Medium · Dead kits kept 30 days; the scan can be flooded
A kit whose certificate never landed is kept until `expirySlot`, about 30 days. But the program refuses that attestation after `max_attest_age`, 300 slots.

Making kits is nearly free: the same note can be attested for the same subject over and over, within 30 attests per IP per 10 minutes. Every scan reads and decrypts every kit, and does 1 or 2 RPC or indexer calls per live one, inside a 60 s function (`vercel.json`). Kits are scanned in name order (subject hash), and badge keys can be ground for low hashes. So junk scanned first can push the real kits past the time limit, and they are never checked.
- **Proof:** test `POF-06`.
- **Fix:**
  - Drop kits at `issued + max_attest_age` when they did not land.
  - Scan with a time budget and a rotating cursor.
  - Cap attests per subject and asset.
  - Report the oldest unscanned live kit on /status.

### POF-07 · Medium · Remaking a certificate pays the prior payer every lamport in the PDA
`certify` over a revoked or expired certificate with a new payer transfers `cert.lamports()` from the new payer to the prior payer (`lib.rs:624-628`). Anyone can send lamports to a PDA.

**Exploit against the relayer:**
1. The attacker self-pays a badge certificate, then `revoke_by_holder`s it.
2. The attacker sends X SOL to the certificate PDA.
3. The attacker pays a normal relay quote (about 0.013 SOL) for a fresh attestation of the same badge.
4. The relayer's transaction pays X + rent to the attacker as prior payer.
5. The X stays locked in the PDA until `expire`, up to about 30 days, then returns to the relayer.

The attacker gets their X back at once, so the attack costs nothing. It can lock almost the whole relayer balance. It also trips the 24 h cap (`relayer.ts` records the actual spend), which stops relaying for everyone. A self-paying holder can likewise be forced to front any amount.
- **Fix (program):**
  - Have the new payer pay the prior payer only `Rent::minimum_balance(8 + Certificate::INIT_SPACE)`.
  - `shift` any surplus from the PDA (the program owns it) to the prior payer.
- **Fix (relayer):** simulate before sending, and refuse when the balance delta exceeds the quote.

### POF-08 · Medium · The relayer burns a payment it refuses
`relayer.ts:70` marks `relay/paid/<sig>` used before the cap and balance checks (`:78-79`) and before the chain call. A `RELAY_CAP` or `RELAY_LOW` refusal, or a failed `certify`, therefore consumes the payment. The error text tells the user "your payment stays valid".
- **Proof:** test `POF-08`.
- **Fix:**
  - Check the cap and balance first.
  - Mark the payment with a pending record bound to the attestation, and release it if the transaction fails. Or allow re-use by the same attestation hash, which the marker already stores.

### POF-09 · Medium · Cancel or lock out someone's X code
Two problems:
- `start(handle)` overwrites `link/<sha(handle)>`, so a second `start` from anyone cancels the pending code.
- The 5-wrong-tries counter is per handle, so five bogus `check`s from anyone lock it.

Either one lets a griefer block a handle from linking in a loop, across IPs.
- **Proof:** test `POF-09`.
- **Fix:** key pending codes by `(handle, sha(secret))` from POF-03, and keep tries per code.

### POF-10 · Medium · Kits sealed under a key the Verifier can rebuild
`kitKey = sha256("pof:kit:v1" ‖ nk)` (`pof-client.js:68,85`). The Verifier receives `nk` in every attest (CONTRACT §4). The sealed part of a kit holds the openings (amounts) and, for badges, the **badge secret**, which is the certificate's controller.

So the Verifier operator, or anyone `nk` leaks to, can open any exported kit file. They learn the amounts, and they can revoke or join Rooms as the badge. The client's own comment (line 66-67) states this rule for `ctlSeed`, but `kitKey` breaks it.
- **Fix:** derive `kitKey` from the vault seed (or the Ring derivation signature) like `ctlSeed`, never from `nk`. Re-seal existing kits on next open.

### POF-11 · Medium · Vault key from a phishable signature
The vault's Ed25519 **spending** key is `sha256("pof/vault/v1" ‖ signMessage(VAULT_MESSAGE(wallet)))`. Two problems follow:
- Any page that gets the user to sign that same plain-text message learns the vault key and can withdraw the vault. The message warns "Sign it only on Proof of Funds", but wallets do not enforce it.
- A wallet whose signatures are not deterministic (some MPC and smart wallets) gives a different vault on every derivation. Funds shielded into the first vault are then unrecoverable, because the seed is wiped and never stored.

**Fix:**
- Use Sign-In-With-Solana (`signIn` with `domain` and `uri`) so that wallets check the origin, or include the origin in the message.
- On the first derivation, sign twice, and refuse to continue if the two signatures differ.
- Before the first shield, offer an export of the vault seed, encrypted under a passphrase.

### POF-12 · Medium · Privacy: wallet, vault and handle are linkable
- `shield()` deposits from the wallet with `viewTag = vault owner` (line 126). Deposit data is public (RINGS §6), so the wallet-to-vault link is on chain from the first shield. `fundVault` adds a second, plain SOL transfer from the wallet to the vault.
- `certify()` defaults `payer` to the connected wallet and `relay = false` for every subject kind (line 301). An X or badge certificate paid that way stores the wallet in `Certificate.payer`, in the `Certified` event and in the public log leaf. That links the handle to the wallet in plain sight.
- After `revoke_spent`, the revealed nullifier links the certificate to the vault's spend, and so to the wallet. The keeper does this automatically on every spend.
- The Verifier operator always learns handle, vault and (through deposits) wallet together. The indexer proxy sees which IP syncs which vault tag.

**Fix:**
- Default to `relay: true` for kinds 1 and 2, and refuse a wallet payer there unless the user explicitly overrides.
- Document on /docs that vault mode isolates `nk`, not identity. Offer "shield from a fresh wallet", or a Ring-to-vault private transfer, as the unlinkable path.
- Default the UI to "revoke first, then move".
- Document what the operator learns, as a trust point.

### POF-13 · Medium · "Verified" log answers trust the log's own key
- `verifiedHead` calls `sdk.verifyTreeHead(head)`, which checks the signature against `head.verifierKey`, a key the head names itself.
- `verifyLogEntry` defaults `trustedKeys` to `[leaf.verifierKey]`, again a key the leaf names itself.

`/v1/log/head` (`signatureValid`), `/v1/log/proof/:id` (`verified`) and `/v1/stats` therefore report true for a log signed by any key. That covers a substituted `POF_LOG_URL`, or a Verifier key that was never in the program Config.
- **Fix:**
  - Pass `trustedKeys` = the Config's `verifier` and `next_verifier`, plus past keys from the `VerifierSet` events.
  - Return `keyTrusted` as a separate check.
  - In the README example, show `trustedKeys` as required.

### POF-14 · Medium · Paid upstreams behind open endpoints
- `client/server/spr-proxy.js` forwards the seven indexer methods with POF's Helius key, under `CORS *` and with no authentication. The working copy adds the prover (4 MB bodies) and a per-instance limit of 240 to 300 a minute. A per-instance limit does not bound a fleet of Vercel instances.
- The hosted MCP (`/mcp`) accepts unbounded JSON-RPC batches (`mcp/core.js:61`) up to 256 KB. Each `get_room` runs a `getProgramAccounts`.

Any third-party site can spend POF's Helius quota through these, and the prover proxy also spends paid proving.
- **Fix:**
  - Vercel Firewall rate rules on `/api/spr*`, `/api/rpc`, `/mcp` and `/api/attest`.
  - Allow only POF's origin on the proxies.
  - Cap MCP batches (for example, at 10).
  - Put a daily spend alert on the Helius keys.

### POF-15 · Low · Bot sweep stops at 500
`sweep` takes `.slice(0, max)` of a sorted list, so grants and members past the first 500 are never re-checked, and revoked members keep their role or seat. **Fix:** a cursor stored between runs, or iterate everything with a time budget.

### POF-16 · Low · Relayer amplification
- `relayer.certify` checks `expirySlot`, not `issuedSlot + max_attest_age`. So one valid attestation lets a caller replay `/api/relay/certify` for 30 days, and each call runs up to 60 `getTransaction` reads.
- `incoming()` looks at the last 60 signatures only, so dust transfers to the public relayer address push real payments out of view.

**Fix:**
- Refuse attestations older than `max_attest_age` before any RPC call.
- Match payments by a memo, or by a per-quote deposit address, instead of scanning.

### POF-17 · Low · Rotation delay can be shortened at once
`set_params` changes `rotation_delay` with no delay, down to `ROTATION_MIN` (9,000 slots, about an hour), then `set_verifier` proposes a key. So the advertised 216,000-slot delay is a default, not a guarantee. The admin is also the upgrade authority, which is the larger trust point.
**Fix:** put parameter changes behind the same delay, or forbid lowering `rotation_delay` while a proposal is pending. On /docs, state that the upgrade authority can change everything.

### POF-18 · Low · `log_index` unsigned
`certify(att, log_index)` stores whatever index the submitter passes. **Fix:** readers must verify by the leaf's attestation bytes, not by the index (the SDK can find the entry by `nullset_hash` and `nonce`). Alternatively, reserve the index before signing and put it inside the bytes in a v2 layout.

### POF-19 · Low · Non-inclusion at an old nullifier root
`checkNonInclusion` accepts any of the 100 recorded nullifier roots. A stale or wrong indexer answer at an older root hides a spend that was folded since, if its PDA was also closed. Today no PDA has ever been closed (RINGS §3).
**Fix:** require the current root (`cursor - 1`), or require the PDA to be absent at the same read slot.

### POF-20 · Low · Host-derived service URLs
- The bots build `${proto}://${host}/api/link` from request headers when `POF_X_LINK_URL` is unset, and trust its `{verified, handle}`.
- `/v1` builds the log URL the same way when `POF_LOG_URL` is unset.

On Vercel the Host header is constrained, but a self-hosted or proxied deployment would let a request point these at an attacker's server.
**Fix:** require both env vars in production, or call the Verifier in process.

### POF-21 · Low · Discord role escalation inside a guild
`/pof-setup` accepts any role id from a member with Manage Roles. Through `/pof-verify`, the bot then grants that role, which may sit above the member's own. **Fix:** refuse roles at or above the invoking member's highest role, and document a low bot role.

### POF-22 · Info · `renew` unreachable
The Verifier makes fresh salts on every attest and has no renew path. The program's `renew` requires the same salted hashes, so it cannot be used. `renew` also does not check `slot <= expiry_slot`. **Fix:** add a Verifier renew that takes the old salts from the holder, or remove the instruction.

### POF-23 · Info · Revocation latency
RINGS §3 says the keeper revokes "within seconds". With a Vercel cron, the latency is the cron period plus RPC time. **Fix:** state the real figure on /docs and /status.

### POF-24 · Info · Untrusted room names
Room names are creator-chosen bytes. They go into MCP tool output that agents read (a prompt-injection surface), and into Discord messages, where masked links render. **Fix:** in MCP output, label room names as untrusted data. Strip `[`, `]` and URLs in Discord.

### POF-25 · Info · Signed root
CONTRACT §3 says `tree_root` is "the root at which every disclosed note was found". The Verifier signs the current head, which also contains every note because the tree is append-only. Harmless. Align the contract text.

## 4b. Round 2: re-review of the fixes, and new findings

**How the fixes were re-tested.** The round 1 proofs (`audit/test/verifier-services.test.mjs`) now pass 9 of 9. A refusal-type test can pass for the wrong reason, for example when a field layout changes. So `audit/test/round2.test.mjs` re-states them with the v2 package:
- a positive control: an honest v2 package is still attested;
- POF-02 must fail with exactly `BAD_RING_PROOF`, and a ring.proof cannot be moved to another tier;
- POF-03 must fail with exactly `LINK_OTHER_CONTROLLER` and `LINK_UNBOUND`;
- POF-08: a failed certify gives the payment back, and the payment then works exactly once;
- POF-09: five wrong tries by a griefer do not lock the holder's code.

All of these pass.

**What the new code was checked for:**
- **ring.proof domain and replay.** The v2 disclosure message starts with its own line (`Proof of Funds: disclosure v2`), distinct from the vault message, the bots' link message and the Rings derivation message. It binds the program, subject, ring, controller, asset, tier, payer and a slot within 1,500 slots. Capturing a package lets a replayer re-attest the same subject, controller and payer within about 10 minutes. That gives them nothing, since the controller is the holder's. No issue.
- **Link secret storage.** 128-bit secret, kept in the starter's tab (`sessionStorage`). Only `sha256(secret)` is stored server side, as part of the Blob path. No issue.
- **Note locks.** The race is closed by create-if-absent generations, and the rollback on failure is sound. See POF-28 for the cost.
- **Keeper.** A kit is never dropped for a sibling attestation, and is dropped once it can no longer land. Correct. The scan still has no time budget (residual of POF-06).
- **Relayer.** All checks now run before the payment is touched. See POF-28 for the release path.
- **Program diff (uncommitted):**
  - POF-07: the surplus goes to the treasury after the CPIs, and the prior payer gets exactly the rent-exempt minimum. Correct.
  - POF-17: lowering `rotation_delay` is held for the old delay. A proposal inside that window waits at least the old delay, and the lowering is visible as a `ConfigSet` event. Correct.
  - POF-22: `renew` now refuses past expiry.
- **`/api/status`.** Errors are scrubbed of URLs and `api-key`, the cron route needs the secret, and the answers are CDN cached. Residuals are listed under POF-14 and POF-20.
- **The SVG badge** escapes every interpolated field. Serving it with `content-security-policy: default-src 'none'` would make that a second line of defence.

**POF-12 is still linkable, after the fix.**
1. The vault is funded by a public transfer from the wallet (`fundVault`), and each shield is a public deposit from the wallet whose view tag is the vault address (RINGS §6).
2. The relay fee is now paid by a vault withdrawal signed by the vault key, as fee payer, for the quote's exact amount. That amount carries a unique tag of up to 99,999 lamports, and it reaches the relayer seconds before the relayer certifies the handle.

So an observer still links handle to vault to wallet. The `payer` field no longer names the wallet, but the chain does.
**Fix options:**
- Pay the relayer by a Rings private transfer to a relayer ring, matched by an encrypted memo;
- or let the relayer front the fee, and take it later from a pool that cannot be linked;
- and, in both cases, fund the vault only through Rings, never by a plain transfer.

Until then, /docs should say that vault mode isolates `nk`, not identity.

### POF-26 · Low · The controller of an X certificate never signs
For kind 1, the link id binds a controller, and the ring owner signs the disclosure message. Nothing proves that the party asking holds the controller's key. A bound link id is a bearer value for its hour (`/api/link?id=` verifies it publicly). Whoever obtains one can certify the handle with **their own funds** and the victim's controller.

The victim's controller can `revoke_by_holder` it, so the damage is limited to two things:
- a false "@victim holds ≥ X" statement;
- a squat of the PDA until the victim notices.

- **Proof:** `round2.test.mjs`, test POF-26 (fails).
- **Fix:** for kind 1, require the controller's signature over the disclosure message, and move the link id to its own field.

### POF-27 · Medium · Random vault seed in plain text in localStorage
When a wallet does not sign deterministically, `deriveVault` makes a random vault key and stores it as hex at `pof:vaultseed:v2:<wallet>` in `localStorage`. That key is the spending key of the vault. Any script running on the POF origin can read it and withdraw the vault:
- an XSS anywhere on the domain (the site, `/link`, `/lab`, `/docs` and the API all share it);
- a compromised dependency;
- a malicious extension with page access.

**Fix:**
- Keep the stored seed encrypted under a key the wallet must re-derive (for example, from a second signature), or as a non-extractable WebCrypto key.
- Ship a strict Content-Security-Policy on every page of the origin.
- Serve `/lab` from another origin, or not at all, in production.

### POF-28 · Low · Two costs of the round 1 fixes
- **Lock generations.** `NoteLocks.newest` reads generations one by one, up to 1,000, on every take and for every note. Re-attesting one subject's notes adds a generation each time, so a holder's own retries slowly make every later attest on those notes slower (and fail closed after 1,000). **Fix:** keep a head pointer, or delete stale generations once they can no longer bind.
- **Payment release.** The relayer releases a payment when `chain.certify` throws. A confirmation timeout can throw after the transaction actually landed, and the released payment could then pay for a second relay within the quote's 30-minute life. **Fix:** before releasing, look up the signature's status.

### POF-29 · Info · A Config layout change ships as a set
The uncommitted program diff adds `held_delay` and `held_until` to `Config`. `pof_gate` deserializes `pof::Config` from the crate (`read_pof_config`), and the SDK and API decode it from the IDL. Rebuild `pof_gate`, re-export both IDLs, and run `sdk` `sync-idl` in the same change. Re-run the local-validator suite (`sdk` integration, `program/test`) before deploy.

## 4c. Round 3: the zero-knowledge path (phase 2) and the witness

### The circuit itself
The constraint system was read line by line for under-constrained signals. Nothing in it lets a witness lie about what it states:
- **Assignments.** There is no `<--` anywhere; every assignment is `<==`. Each `===` checks either a public input or a gated equality.
- **Index bits.** Merkle index bits come from `Num2Bits(32)` and `Num2Bits(40)`, so they are boolean. The selector `left = cur + b·(sib - cur)` is correct.
- **Ranges.** Each amount is `Num2Bits(64)`, so the sum of four is below 2^66; `minAmount` is `Num2Bits(64)`; `GreaterEqThan(66)` therefore cannot wrap.
- **Disabled slots.** `enabled` is boolean, the used slots come first, and each slot contributes `enabled · amount`. A disabled slot adds 0, and its `tag` and `ct` must be 0. No padding inflates the sum.
- **Non-inclusion comparison.** It uses `Num2Bits_strict` halves, so a value cannot alias `x + p`. `LessThan(127)` gets inputs below 2^127.
- **Bindings.** `ownerId`, `dataHash`, `ringTerm` and `blinding` are free, but each is bound by the commitment's membership in the state tree. One `nk` and one `ownerId` serve every slot.
- **The same note twice** gives the same nullifier and the same tag. The program requires strictly ascending tags, so it refuses that.
- **Poseidon.** Arity and parameters match the Rings hasher; the team's `parity.test.mjs` checks this against the SDK and against mainnet leaves.
- **Escrow.** `R = r·B8` and `S = r·K`, with K pinned by the program. `ct = nf + Poseidon(ESC, S, slot)`, so whoever holds k always opens the escrow.
- **Public inputs** are rebuilt by the program in the circuit's order (0 to 8, then the tags, then the cts). `ctx` is `sha256` with its top 3 bits cleared, so it is below r. It binds program, kind, subject, asset, tier, controller, payer and nonce, so a proof cannot be replayed for another subject or payer. The controller signs the transaction.
- **The verifier** requires canonical inputs (below r) and leaves point validation to the syscalls.

The findings are where the circuit meets the chain.

### ZK-01 · Critical · Any of the 100 nullifier roots
`check_roots` (`zk.rs:164-176`) accepts `null_root` if it is **any** of the 100 nullifier roots the tree account keeps. The indexed nullifier tree only grows. At a root from before a nullifier was folded in, that nullifier is absent, and the circuit proves exactly that.

Mainnet has folded about 11 batches, and all of them sit inside the 100-root window. So today **any note ever spent** in Rings can be proven unspent: a prover keeps (or rebuilds) a non-inclusion path at an old root. The docs advise proving against an older root to show note age. That is right for the *state* root only, never for the nullifier root.

The keeper would still revoke such a certificate (its escrowed nullifier has a PDA). That brings us back to ZK-02: anything that gates in the same transaction is exploited. After the revoke, the note lock is released, and the same spent note can be certified again with a new nonce, without end.
- **Proof:** `audit/zk/circuit-audit.test.mjs` ZK-01. A spent note yields a valid witness at the older root, and `check_roots` accepts it.
- **Fix:** accept only the **newest** nullifier root (the one at cursor - 1, offset 17,224). A forester batch between proving and landing makes the transaction fail, and the client re-proves. Batches are rare (about 5,000 nullifiers).

### ZK-02 · High · Queued spends, and live in the same instruction
Even at the newest root, a nullifier that is spent but still in the Rings input queue (its PDA exists, not folded yet; batches of 4,999, so days at today's traffic) is absent from the tree. The design leaves this to the keeper, which decrypts the escrow and revokes. But `certify_zk` sets `status = LIVE` at once.

A program that calls `certify_zk` and then `require_certificate` (or `pof_gate::join`, or the OTC example) **in the same transaction** therefore acts on funds that were already spent, before any keeper can look.
- **Proof:** ZK-02 test (it reads the instruction: live in the same instruction).
- **Fix:** a zk certificate becomes live only `settle_slots` after `certified_slot` (for example 150), and the keeper or anyone with the nullifier can revoke it during that window. `require_certificate` must refuse a certificate in its settle window. Also publish the keeper's latency.

### ZK-03 · High · Placeholder verifying key verifies everything
`zk/onchain/src/vk.rs` is all zeros ("PLACEHOLDER until scripts/vk-rs.mjs runs"). For the alt_bn128 syscalls, (0,0) is the point at infinity. Every pairing then equals 1, so a 256-byte proof of zeros verifies **any** public inputs. `apply.py` copies this file into the program as it is.

A build made before `vk-rs.mjs` runs, and deployed with `set_zk(enabled = true)`, lets anyone mint any certificate. `vk_hash = 0` is recorded, but nothing refuses it.
- **Proof:** `audit/zk-native` (`cargo test`) verifies a zero proof against the committed key.
- **Fix:**
  - A `const` assertion (or a `build.rs`) that fails compilation when `VK_HASH` is zero or any VK point is the identity.
  - `set_zk` refuses to enable while `vk_hash` is zero.
  - `verify` refuses an A or C at infinity.

### ZK-04 · High · Spend authority is not part of the statement
The witness needs `nk`, the openings and the paths. `ownerId` is the public hash of the ring owner's public key. No secret of the owner is required, and the ring owner never signs (the controller does). This is POF-02 again, in phase 2.

A whale that hands over `nk` and its openings lends a certificate while keeping the money. For deposit notes, the openings are public chain data once `nk` is known.
- **Proof:** ZK-04 test (a witness from `ownerId` and `nk` alone).
- **Fix options:**
  - (a) Prove knowledge of a secret that the owner's spend key derives (for example the vault seed, committed as a registered POF key). Cheap in-circuit, but it needs a registration.
  - (b) Require an Ed25519 signature by the owner over `ctx`. That reveals the owner, so it is only acceptable where linkability is accepted.
  - (c) Document that phase 2 proves control of `nk` and the openings, not ownership, and price it into what consumers rely on.

### ZK-05 · Medium · POF-07 again, in `certify_zk`
`handle_certify_zk` remakes an existing certificate with `let rent = cert.to_account_info().lamports()`. That is the code `73d71dd` fixed in `certify`, and it is still the old version here. A donation to the certificate PDA makes the new payer fund the prior payer. **Fix:** share one remake helper between `certify` and `certify_zk`.

### ZK-06 · Medium · Double counting across the two paths
The Verifier's lock is `HMAC(seal key, nf)` in Blob; the zk lock is the PDA `["znote", Poseidon(TAG, nf)]` on chain. Neither sees the other, so the same note can back one signed certificate and one zk certificate at once.
**Fix:**
- The Verifier computes the tag from `nf` and refuses a note whose `znote` lock is live.
- `certify` (the signed path) creates `znote` locks too. The attestation would then carry the tags: a CONTRACT §3 v2 field.

### ZK-07 · Low · Lock PDA pre-funding
A lock is created with `system_program::create_account`, which fails if the address already holds lamports. Once a note's tag is public (its first certificate) and the lock has been released, anyone can send 1 lamport to `["znote", tag]`. That note can then never be zk-certified again.
**Fix:** transfer, `allocate` and `assign` (what Anchor's `init` does) when the account has lamports.

### ZK-08 · Medium · Unsalted tags link certificates and spends
`tag = Poseidon(TAG, nf)` is deterministic per note. Two consequences:
- Every zk certificate made from the same note carries the same tag, so a wallet certificate and a badge certificate from one note are linked.
- When the note is spent, ever, anyone who sees the nullifier links it to every certificate that carried that tag. "Revoke by holder, then move" no longer hides it.

The upside is real: anyone watching new nullifier PDAs can call `revoke_spent`, so zk revocation is permissionless and does not depend on a keeper (POF-01). Decide and document. If unlinkability matters more, add a per-certificate salt inside the circuit (`tag = Poseidon(TAG, nf, salt)`, salt escrowed), and keep note uniqueness with a second, nonce-free lock value.

### ZK-09 · Low · `set_zk` without delay
The admin can swap the escrow key K, or switch `certify_zk` on and off, at once. There is no on-curve or subgroup check for K, and existing certificates stay encrypted to the old key (the keeper must keep every k).
**Fix:** put K changes behind the rotation delay, check that K is on the curve, and keep a history of K.

### ZK-10 · Info · Completeness and setup
- The circuit needs `nf < next` strictly. If Rings marks the end of the list with `next = 0` (as the verifier's JS assumes), a note whose nullifier is above the largest folded value cannot be proven. Check this against the real tree layout.
- The setup is a development ceremony on one machine (stated in `ceremony.sh`). Whoever ran it can forge proofs, so it must never be enabled on mainnet.

### The witness (fuller pass)
`witness/witness.js` does the following correctly: it checks the head's key against Config, refuses a shrinking or equivocating log, checks RFC 9162 consistency from its last head, checks against the on-chain anchor, cosigns under its own key and domain, and keeps its key file at mode 600.
- **W-01 · Medium.** The certificate monitor (the POF-18 safeguard: every certificate must have its signed leaf in the log) skips any certificate whose `logIndex >= treeSize`, because it is "not in the log yet". `log_index` is not signed and is chosen by the submitter. An attestation the Verifier signed but never logged, which is exactly what the monitor exists to catch, is therefore submitted with `log_index = u64::MAX` and is never checked. zk certificates use `u64::MAX` legitimately.
  **Fix:** for a certificate whose `verifier` is not `ZK_CONFIG`, alarm when its index is not in the log after a grace period, or find its leaf by its signed bytes instead of by the index.
- **W-02 · Low.** `allowedKeys` takes every key from the `VerifierSet` history, so a retired (possibly leaked) key can still sign a new head that the witness cosigns. **Fix:** accept only the key active at the head's anchor slot, plus a proposed key once its slot has come.
- **W-03 · Low.** One witness compares only with its own history. If the log shows different heads to different witnesses, no single witness sees it, and the project's own witness cron is not independent. **Fix:** witnesses publish and cross-check each other's cosigned heads (the CT gossip pattern), and /docs says that POF's own witness is not an independent party.

### POF-30 · Medium · One payment, several relays (verifier, round 3)
`302a98f` lets a payment be reused when its stored mark equals the request's: "an earlier try of the same attestation". The mark is `hex(att).slice(0, 64)`, the first 32 bytes of the attestation, which are `POF1` and the program id, the same for every attestation. While one relay is in flight (send plus confirmation take seconds), a second request with another attestation and the same quote takes the same payment.
- **Proof:** `round2.test.mjs` POF-30 (two attestations, one payment, both relayed).
- **Fix:** mark with `sha256(attestation)`, and compare the full value.

## 4d. Round 4: blind relay credits, the relayed revoke, remaining fixes

### Blind relay credits (`verifier/lib/blind.mjs`, `credits.ts`, client `b22ca29`)
What was checked, and holds up:
- **Key and hashing.** RSA 3072 (`scripts/keys.mjs`), a key used for credits only. The message is `MGF1-SHA256("pof:credit:v1" ‖ token)`, cut to one byte under the modulus; it has its own domain, and its multiplicative structure is unusable.
- **Unblinding.** The holder blinds with r coprime to n, unblinds, and **verifies each signature before keeping it**, so a bad signature cannot tag a holder.
- **Purchase.** A purchase must be a private SOL transfer into the house ring, of exactly `unit × count`, in a transaction the claimer signed. The claim message, signed by the vault key, binds the transfer, owner, kid and the blinded set. A transfer is claimed once (create-if-absent).
- **Double spend.** A spent token is a create-if-absent key bound to `sha256(attestation)`. Racing spends of one token: exactly one wins (tested). A retry of the same attestation after an uncertain send may use its own credit again, and a surely-failed certify returns the credit.
- **Storage.** Tokens and blinding factors are kept sealed in the vault store; a token never travels with its purchase.

**CR-01 · Medium · Key not pinned.** The client blinds against whatever `{ n, e, kid }` (and `houseRing`) the relayer's offer returns. A relayer that wants to link can:
- give each buyer its own key, and recognise the buyer when a credit is spent (by `kid`, or by which key verifies);
- serve a degenerate e or n that makes the blinding leak.

That undoes the property the credits exist for: being unlinkable even against the relayer.
**Fix:**
- Pin the credit public key and the house ring address in the client build (and in the Verifier's published bundle, as `keepers.json` is), and refuse any other offer.
- Require `e = 65537`, and a modulus length of 3072 bits or more.
- Show the pinned kid on /status.

**CR-02 · Medium · A lost claim answer loses the bundle.** The claim record stores only `{ count, kid }`. If the answer never reaches the client, its `resume()` gets `ALREADY_CLAIMED`, and the paid credits are gone.
- **Proof:** `round4.test.mjs` CR-02.
- **Fix:** store `sha256(blinded set)` with the claim. A repeat with the same transfer and the same blinded values gets the same signatures again; RSA is deterministic, so this mints nothing new. Anything else stays refused.

**CR-03 · Low · Signing in BigInt.** `modPow` branches on the bits of d, and V8 BigInt arithmetic is not constant time. There is no RSA blinding and no CRT (a 3072-bit signature costs hundreds of ms, and a bundle of 20 several seconds). Claims are paid, so gathering timing samples is expensive. **Fix:** sign with `crypto.privateDecrypt({ key, padding: RSA_NO_PADDING })` (OpenSSL, with blinding and CRT); keep `blind.mjs` for the client side.

**CR-04 · Low · Rotation voids credits.** `spend` refuses any kid but the current one. **Fix:** keep the retired public keys for verification for as long as credits are honoured, and announce rotations.

**CR-05 · Info · What still links.** The relayer knows which vault bought how many credits, and when (the claim names the owner). A credit spent minutes after its purchase links the two by time. Bundles of 5 and 20 at a fixed price are good. The client should spend the first credit of a bundle only after a random delay, and the docs (`5e82f9f`) should keep saying so.

### Relayed revoke (`revoke_signed`, `/api/relay/revoke`)
`revoke_signed` is in the program working tree, not committed. Read as it is:
- The 148 bytes are `"POF-REVOKE1"` ‖ program ‖ certificate address ‖ subject hash ‖ asset ‖ nullset hash ‖ issue slot.
- They are checked through the same `signed_before` (exactly one signature, all offsets inside the Ed25519 instruction), against `cert.controller`, and only while the certificate is live.
- A renew or remake changes `nullset_hash` and `issued_slot`, so an old signature cannot revoke the new certificate. The domain is distinct from every other signed message in POF.

**RV-01 · Low.**
- `/api/relay/revoke` builds and sends the transaction without first checking the signature against the certificate's controller. Preflight catches a bad one, but it costs an RPC simulation per call. Verify locally first.
- A signed revoke never expires. A holder who prepares one in advance and then loses it has given anyone a revoke button for as long as that attestation stands. Optionally add a `valid_until` slot.
- The client should report "revoked" only after it sees the revocation on chain, never on the relayer's word, before it moves any funds.

### Other fixes
- **POF-30** fixed (`11b629a`): the payment and credit marks are bound to `sha256` of the whole attestation, and the race test passes.
- **Issue-slot race** (`3033364`): the attestation is issued at the later of the slot read and the tree read, so `root_slot <= issued_slot` always holds. Correct. The note-age check uses that later slot, which is more lenient by at most a few slots. Harmless.
- **W-01 to W-03** fixed (`f359010`). **W-04 · Info:**
  - Gossip accepts a peer document signed by whatever key it names. Pin the peer witness keys in the operator's configuration, and check the verifier signature carried in a peer's `latest`, so that a `split_view` alarm is evidence and not just a claim.
  - `byNonce` reads every log entry once per step. Cache it across steps.
- **Launch and wind-down scripts** (key handling).
  - What is fine: keys are read from the given files, base58 or JSON. The `pump` mint key is ground in a 0700 temporary folder and saved with mode 600. No secret and no Helius key is printed by the script's own lines. `--dry` simulates everything. `--buy` defaults to 0. Both scripts stop unless the wallet is the admin and the upgrade authority.
  - **Info:** an uncaught web3.js error could print the RPC URL, which carries the Helius key; wrap the top level and scrub `api-key=`. `launch.mjs` only prints a NOTE when the Config's verifier differs from `~/.config/pof/verifier.json`. Stop there instead, because a mismatched key makes every attestation fail after launch.
  - **LW-01 · Info:** once phase 2 ships, `wind-down.mjs` must close `ZkConfig` and every `["znote", tag]` lock (their rent belongs to their payers) **before** step 7 closes the program, or that rent is lost for good.

## 4e. Round 5: the launch build, and the final statuses

**Suites re-run at `1c02f89`/`0cb2909`:**

| suite | result |
|---|---|
| `audit/test` (rounds 1, 2 and 4) | 22 of 22 pass |
| `audit/zk` | 3 of 3 pass; the source checks now read the program's own `zk.rs` (`program/programs/pof/src/zk.rs`), not the development copy |
| `audit/zk-native` | 1 of 1 passes; the zero proof is refused against the program's `vk.rs` |
| `audit2/test` | 6 of 6 pass |

The programs' own suites were not re-run by this reviewer; the program report states 35/35 and the zk on-chain suite 12/12.

**The launch build.** `certify_zk`, `set_zk`, `register_zk_owner` and `release_note_lock` compile only with `--features zk`. `program/idl/pof.json` (launch) has none of them; `pof-zk.json` has them. In the launch build, `revoke_with_pair` checks only the salted sha256, and `renew` has no zk branch. So none of the zk findings reach the launch program. A later upgrade to the zk build would also bring in the development verifying key (single machine), so that upgrade must wait for the public ceremony.

**New program code, reviewed:**
- **Staged membership revoke** (`open_path`, `stage_path`, `revoke_spent_staged`, `close_path`). The buffer is the PDA `["path", revoker, certificate]` and only its revoker writes it. Its levels are written without gaps; the missing upper levels are empty subtrees. The path must reach one of the 100 nullifier roots, which is correct for a *membership* (spent) proof: an older root still proves the spend. The buffer closes on success. The treasury's `paths` counter holds `close_config` back (FZ-08), and the wind-down closes buffers left behind (anyone may during closing). No issue.
- **Revoked verifier keys.** `check_signed` refuses a revoked key. `gate` refuses certificates signed by it. `void_by_key` (anyone) marks them, and up to 8 entries are kept. **RK-01 (Info):** an entry older than `VALIDITY_MAX` is reused without checking that its key is no longer `verifier` or `next_verifier`. If the admin revoked the active key and never rotated, the reuse would make that key sign again. Refuse the reuse in that case.
- This also adds an admin power to the trust points: `revoke_verifier_key` turns every certificate of a key off **at once**, with no delay. That is right for a leak, and it is a power to document (docs-src/trust).
- **`revoke_signed` v2.** 156 bytes, including `valid_until`, at most 9,000 slots ahead, so FZ-05 and RV-01 are closed. The client and the relayer now agree (A2-01).

**The zk fixes** (zk build only):
- ZK-01: only the newest nullifier root.
- ZK-02: a settle window of 150 slots, enforced in `gate`.
- ZK-03: a real key, and `set_zk` refuses a zero `VK_HASH`.
- ZK-04: an owner registry, appended only by the owner's signature, with `ownerId` computed on chain from the signer. The secret comes from the vault seed, which a phase 1 Verifier never sees.
- ZK-05, ZK-07 and ZK-09: fixed as written.
- ZK-10: the circuit now accepts `nextValue = 0` as the last element. That is sound if the Rings tree keeps only its true last element with `next = 0`; the parity tests cover the layout.

**ZK-11 · Medium (zk build only) · Registry root griefing.** `register_zk_owner` is open to any signer for the price of a transaction fee. It creates no per-owner account, and `certify_zk` accepts only the last 12 registry roots. A proof takes tens of seconds to make in a browser. An attacker who registers fresh keys a dozen times a minute (about 60,000 lamports a minute) therefore makes every honest proof fail with `ZkRegistryRootUnknown`. About 5 SOL also fills the 2^20 leaves for good.
**Fix:**
- One registration per owner, as a rent-bearing PDA `["zkowner", owner]`, so spam costs rent per key.
- A much longer root history, or accept any root registered within the last N slots.
- A tree height sized to the expected users, with a migration path.

**Edge rate limits (POF-14, A2-04).** The active Vercel Firewall config of project `pof` was read with the Vercel CLI, read-only, at 2026-11-25. It holds two active rules. The first is "POF heavy endpoints per IP": path `^/(api/(attest|relay|link|keeper|spr|spr-prover|card|share)|mcp)(/|$)`, deny over 30 per 60 s per IP. The second is "POF read API per IP": `^/(v1|api/(rpc|status|v1|witness)|c)(/|$)`, deny over 120 per 60 s. No burst test was run; the rules were read from the config instead. Three single GET requests showed paths outside both rules that answer: `/api/mcp` (405, the hosted MCP function, the same handler as `/mcp`), `/api/bots/link` and `/link` (200; `/link` takes a public POST that checks a signature, reads the chain and writes Blob). Extend the heavy rule to `^/(api/(attest|relay|link|keeper|spr|spr-prover|card|share|mcp)|mcp|link)(/|$)`, and give `/api/bots/` its own rule. **Applied by the lead and re-read from the active config (version 2): all three paths are covered now, so POF-14 is closed.**

**Admin power documented.** `docs-src/trust.md` (§ admin powers) now says that `revoke_verifier_key` ends every certificate a key signed at once, that `void_by_key` lets anyone mark them, and that the admin can do this in one transaction. That closes the docs item. One wording fix is left: the page says "up to 4 keys", while the program keeps `MAX_REVOKED_KEYS = 8` (`cd51f22`).

**Verifier and client.**
- The internal header (`x-pof-internal`) is compared in constant time (sha256 then `timingSafeEqual`), needs at least 16 characters, skips only the log's public rate limit, and is sent only to `POF_LOG_URL` and the status origin from env. Fine.
- Parallel attest: the reads run in parallel, while the lock and the verdicts stay in a fixed order. The race tests still pass.
- The credit pins live in the client build. Residual: pins served by the same deployment protect against the relayer tagging buyers at run time, not against a malicious deploy. The published bundle hash is how outsiders catch that.

## 5. What held up
These were checked specifically and found sound at the reviewed commits:
- `ext::signed_before` reads the instruction at `current - 1`, requires exactly one signature, and requires all three instruction indexes to be `u16::MAX` (data inside the Ed25519 instruction itself). The pubkey and message are read from the offsets the precompile verified.
- The 240 attestation bytes, the 80 STH bytes and the link-token bytes are distinct by domain and length, so they cannot be confused.
- PDA seeds: `cert` is keyed by subject hash and asset. Prefixes keep kinds from colliding. `init_config` is gated on the upgrade authority.
- The holder exemption: only the payer's canonical ATA counts; the mint, owner and token program are checked, and the ATA address cannot be squatted.
- `revoke_spent`: path (a) checks the PDA derivation, the owner, the length and the tag. Path (b) is a 40-level Poseidon path to one of the on-chain roots. Neither path can make an unspent note read as spent without a Poseidon collision or a Rings soundness failure, and a missing PDA never reads as unspent.
- `pof_gate`: `join` requires the controller returned by POF to sign. `evict` checks the PDA, so a wrong account cannot evict.
- Verifier: commitments and nullifiers are recomputed from `nk`. Paths are re-hashed to an on-chain root. `nk` is zeroed in `finally`, and no error message or log line carries it.
- Telegram secret token and Discord ed25519 verification are in place. The wallet picker escapes wallet names. The linker fetches only a fixed fxtwitter host (no SSRF).

## 6. Residual risks and trust assumptions (after all fixes)

**Still open at round 5** (launch build):
- POF-11: the vault message can still be phished.
- POF-12, partly: vault funding, and timing (CR-05, A2-07).
- POF-16 residual.
- POF-19: non-inclusion at an older root; Verifier side.
- POF-20 residual.
- POF-23: revocation latency is the keeper's cron period.
- POF-25: the CONTRACT's root wording.
- RK-01.
- The audit2 and fuzz rows each report marks open.

Off the launch build: ZK-08 (accepted), ZK-11, and the development ceremony.

- **The Verifier is trusted** to check funds honestly. It can sign anything; the transparency log makes this detectable, not impossible. Monitors must compare every on-chain `Certified` event with a log entry (POF-18).
- **The Verifier learns `nk` and the identity triple** (subject, vault, depositing wallet) for every certificate. Vault mode limits what `nk` exposes; it does not hide identity from the operator (POF-12).
- **Revocation depends on a keeper** unless option (c) of POF-01 is taken.
- **The admin is the upgrade authority** of both programs and can change any rule.
- **Helius**: the Rings program, its circuits, the forester, the indexer (Merkle and non-inclusion paths are re-checked on chain or against on-chain roots, but note creation slots come from the indexer alone) and the prover TEE.
- **X and fxtwitter** are trusted for handle ownership.
- **Borrowed funds:** even with POF-02 fixed, someone who hands over the vault's spending key can lend a certificate. A certificate proves control at a slot, not ownership.

## 7. Changes
- 2026-11-25 · audit · round 1: 25 findings, 9 failing proof tests (`cf763b5`). High findings posted on `_x/pof/BOARD.md` and sent to the lead.
- 2026-11-25 · audit · POF-14 closed: firewall config version 2 re-read (heavy rule widened to `/api/mcp` and `/link`; `/api/bots` at 120 a minute). The docs fix from 4 to 8 revoked keys is pending with the docs agent.
- 2026-11-25 · audit · round 5 addendum: edge firewall rules verified from the active config (POF-14 mostly fixed; `/api/mcp`, `/api/bots/*`, `/link` uncovered); trust.md admin-power wording checked (says 4 keys, the program keeps 8).
- 2026-11-25 · audit · round 5: final statuses for the launch build `1c02f89` (no zk); every suite green; ZK-01 to ZK-07, ZK-09, ZK-10 and CR-01 to CR-04 fixed and re-tested; new ZK-11 (zk build only) and RK-01.
- 2026-11-25 · audit · round 4: blind relay credits and the relayed revoke reviewed (CR-01 to CR-05, RV-01), W-04, LW-01; POF-27, POF-30 and W-01 to W-03 fixed; zk fixes not yet re-reviewed.
- 2026-11-25 · audit · round 3: zk path (1 Critical, 3 High, 3 Medium, 2 Low, 1 Info), witness (1 Medium, 2 Low), POF-30. The round 2 POF-26 test was corrected (controllerSigner: null; the verifier's claim was right). Round 1 and 2 statuses updated.
- 2026-11-25 · audit · round 2: all 4 High fixed and re-tested (9/9 plus round 2 controls). Statuses updated; 4 new findings (POF-26 to POF-29); POF-07 and POF-17 fixes reviewed in the working tree, not yet committed.
