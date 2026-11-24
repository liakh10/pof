# Proof of Funds: internal security review

Status: **round 1, open**. This report is updated as fixes land; every row of the findings table carries its status.
Reviewer: the POF `audit` agent. It did not write any of the code reviewed here and edits none of it; fixes are made by the owners of each part.

## 1. Scope

| part | paths | commits reviewed |
|---|---|---|
| on-chain programs | `program/programs/pof`, `program/programs/pof_gate` (Anchor 1.2) | `54aa589` |
| Verifier, transparency log, keeper, relayer, X linker, limits | `verifier/src/*`, `api/attest/*`, `api/relay/*`, `api/keeper/*`, `api/link/*` | `47bc6ce`, `9034e44`, `b0edfcc`, `4b22ca5` |
| browser client, indexer proxy | `client/pof-client.js`, `client/wallet.js`, `client/server/spr-proxy.js` | `6189906`, `ec99afb` |
| public read API, SDK, MCP, bots | `api/v1/*`, `sdk/src/*`, `mcp/*`, `api/mcp.js`, `bots/*`, `api/bots.js` | `82a06d2`, `7402298`, `4b00ca8`, `ec99afb` |
| shared contract | `CONTRACT.md` §1 to §7, `RINGS.md` | `457d9a3`, `ec99afb` |

Repository head at the end of this round: `cf763b5` (the audit's own proof tests).

**Not covered in this round** (stated so that nobody reads silence as a pass):
- the `zk/` folder and `api/status/`, which were not yet committed during the review;
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

| severity | count |
|---|---|
| Critical | 0 |
| High | 4 |
| Medium | 10 |
| Low | 7 |
| Informational | 4 |

No finding lets anyone mint a certificate without real, unspent funds in a Privacy Ring, or move anyone's money. The program's signature check, PDA derivations, spent-nullifier proofs and fee rules held up under review. The serious problems are all off chain:
- whose funds may back whose certificate (POF-02, POF-03);
- whether one note can back several certificates (POF-04);
- whether a certificate really dies when its money moves (POF-05, POF-06, POF-01).

## 4. Findings

| id | severity | title | where | status |
|---|---|---|---|---|
| POF-01 | Medium | Spend-revocation is custodial in practice | design: CONTRACT §5, `verifier/src/keeper.ts` | open |
| POF-02 | **High** | The ring owner never consents; nk + openings certify any subject | `verifier/src/verify.ts:128-136` | open, test |
| POF-03 | **High** | X-handle code redeemable by whoever reads the post first | `verifier/src/linker.ts:29-50`, `verify.ts:82-89` | open, test |
| POF-04 | **High** | Note-lock race: one note behind several live certificates | `verifier/src/locks.ts:26-34` | open, test |
| POF-05 | **High** | Keeper deletes the kit of a later attestation; spent certificate stays live | `verifier/src/keeper.ts:42-47` | open, test |
| POF-06 | Medium | Dead kits kept 30 days; the keeper scan can be flooded past its 60 s limit | `verifier/src/keeper.ts:44`, `vercel.json` | open, test |
| POF-07 | Medium | Remaking a certificate pays the prior payer every lamport in the PDA | `program/programs/pof/src/lib.rs:621-629` | open |
| POF-08 | Medium | The relayer burns a payment when it refuses for cap or balance | `verifier/src/relayer.ts:64-79` | open, test |
| POF-09 | Medium | Anyone can cancel or lock out another person's pending X code | `verifier/src/linker.ts:20-26,37,42` | open, test |
| POF-10 | Medium | The client seals kits (badge secret, amounts) under a key derived from nk, which the Verifier sees | `client/pof-client.js:68,85,266` | open |
| POF-11 | Medium | The vault spending key comes from a phishable signMessage, and is lost with a non-deterministic signer | `client/pof-client.js:19,60-62` | open |
| POF-12 | Medium | Privacy: wallet, vault and handle are linkable on chain and by the operator | `client/pof-client.js:126,291-296,301`; design | open |
| POF-13 | Medium | `/v1` "verified" log answers trust the key the log itself names | `api/v1/_lib.js:180-182`, `sdk/src/log.ts:142,207` | open |
| POF-14 | Medium | Paid upstreams (Helius indexer and prover, RPC) behind open, unauthenticated endpoints | `client/server/spr-proxy.js`, `mcp/core.js:61`, `api/mcp.js` | open, a per-instance limit is in progress (uncommitted) |
| POF-15 | Low | Bot sweep re-checks only the first 500 grants and members | `bots/sweep.js:17,37` | open |
| POF-16 | Low | Relayer: an attestation can be replayed for 30 days, and payments are found in the last 60 signatures only | `verifier/src/relayer.ts:57`, `verifier/src/program.ts` `incoming` | open |
| POF-17 | Low | The verifier rotation delay can be cut to 9,000 slots without delay | `lib.rs:530-536,565-576` | open |
| POF-18 | Low | `log_index` is not signed; the certificate stores what the submitter says | `lib.rs:599,652` | open |
| POF-19 | Low | Non-inclusion accepted against any of the last 100 nullifier roots | `verifier/src/rings.ts:117,181-189` | open |
| POF-20 | Low | Service URLs derived from the Host header when env is unset | `api/bots.js:19,34`, `api/v1/index.js:10`, `api/v1/_lib.js:160-163` | open |
| POF-21 | Low | Discord `/pof-setup` lets a Manage Roles user hand out roles above their own | `bots/discord.js:88-95` | open |
| POF-22 | Info | `renew` is unreachable, and accepts an expired certificate | `lib.rs:680-713`; no Verifier path | open |
| POF-23 | Info | Revocation latency is the keeper's cron period, not "seconds" | `RINGS.md` §3, keeper cron | open |
| POF-24 | Info | Creator-chosen room names flow into MCP answers and Discord messages | `mcp/tools.js:201,208`, `bots/*` | open |
| POF-25 | Info | The signed `tree_root` is the current head, not the root the notes were found at | `verifier/src/verify.ts:199` | open |

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
- **The Verifier is trusted** to check funds honestly. It can sign anything; the transparency log makes this detectable, not impossible. Monitors must compare every on-chain `Certified` event with a log entry (POF-18).
- **The Verifier learns `nk` and the identity triple** (subject, vault, depositing wallet) for every certificate. Vault mode limits what `nk` exposes; it does not hide identity from the operator (POF-12).
- **Revocation depends on a keeper** unless option (c) of POF-01 is taken.
- **The admin is the upgrade authority** of both programs and can change any rule.
- **Helius**: the Rings program, its circuits, the forester, the indexer (Merkle and non-inclusion paths are re-checked on chain or against on-chain roots, but note creation slots come from the indexer alone) and the prover TEE.
- **X and fxtwitter** are trusted for handle ownership.
- **Borrowed funds:** even with POF-02 fixed, someone who hands over the vault's spending key can lend a certificate. A certificate proves control at a slot, not ownership.

## 7. Changes
- 2026-11-25 · audit · round 1: 25 findings, 9 failing proof tests (`cf763b5`). High findings posted on `_x/pof/BOARD.md` and sent to the lead.
