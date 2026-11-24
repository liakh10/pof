# Proof of Funds: second internal security review (audit2)

A second reviewer, working apart from the first one. The findings were written before reading
[`reports/audit.md`](audit.md). Only then were they compared with it. There was no `reports/fuzz.md` at review time. Each finding below is marked **new** or as a
duplicate of an audit.md finding. This is an internal review inside the POF build, not a third-party audit.

## 1. Scope

| | |
|---|---|
| Commit reviewed | `982bdf0` at the start, re-checked at `5f95342` (the tests below run at `5f95342`) |
| On chain | `program/programs/pof` (`lib.rs`, `ext.rs`, `errors.rs`), `program/programs/pof_gate` |
| Off chain | `verifier/src` (verify, rings, locks, log, merkle, keeper, escrow, relayer, credits, linker, limits, store, app), `verifier/lib/blind.mjs`, `witness/`, `api/*` (attest, relay, link, keeper, rpc, spr, card, share, bots, witness), `client/pof-client.js`, `client/server/spr-proxy.js`, `ui/*.js`, `vercel.json` |
| Docs read first | `CONTRACT.md`, `RINGS.md`, `README.md`, `docs-src/trust.md`, `docs-src/threat-model.md`, `docs-src/privacy.md` |
| Production | `https://proofoffunds.vercel.app`, read-only: about 30 requests in total, at most 3 to any one endpoint. No certificate was requested. No transaction was sent. |
| Not covered | `zk/` (phase 2), `sdk/` internals, `mcp/` tools, the Helius Rings programs themselves |

## 2. Method

- **Code read**, line by line, for the programs, the Verifier and the client's certify and revoke paths. For each
  instruction and endpoint the question was: who can call it, what it trusts, and what it writes.
- **Cross-checks** of each byte layout between its producers and its consumers: the program, `verifier/src/contract.ts`,
  `client/pof-client.js` and `program/js/pof.mjs`. These cover the attestation, the signed tree head, the link id and the revoke bytes.
- **Failing tests** in [`audit2/test/`](../audit2/test). Run them with `node --test audit2/test/`. Each one asserts the
  intended behaviour, so it fails today and should pass once the finding is fixed. At `5f95342` all 6 fail, as intended.
- **Production probes**: response headers, error bodies, CORS, the static files served by `outputDirectory: "."`, and
  whether the expensive endpoints answer an uncached random subject. The Vercel firewall configuration could not be read
  with the access available, so rate rules at the edge are **unverified**.

## 3. Findings

| id | severity | title | where | status | vs audit.md |
|---|---|---|---|---|---|
| A2-01 | **Medium** | The relayed holder revoke cannot land: the client signs 148 bytes and sends no `validUntil`, while the program and the relayer need 156 | `client/pof-client.js:621-645` vs `lib.rs:355-366,795-808`, `verifier/src/relayer.ts:125-133` | open, test | **new** (a regression of the RV-01 fix) |
| A2-02 | **Medium** (config) | Note lock ("one note, one live certificate") is not tied to the Config's `max_attest_age`, and does not follow the certificate without a chain | `verifier/src/app.ts:73-80`, `verifier/src/locks.ts:21-28` | open, test | **new** |
| A2-03 | Low | Relayer payment matching: by amount only, from any positive balance change, in the last 60 signatures | `verifier/src/program.ts` `incoming`, `relayer.ts:28,85-95` | open | partly **dup POF-16** (60-signature window); expire-refund and quote-grinding parts new |
| A2-04 | Low | Cost amplification on unthrottled, uncacheable endpoints | `api/card.js`, `api/share.js`, `api/v1`, `verifier/src/log.ts` `range`, `escrow.ts` `list` | open | partly **dup POF-14** (rpc, spr, mcp); card, share, v1, log range and escrow new |
| A2-05 | Low | The same blind-credit RSA key and house ring are pinned for mainnet and devnet | `verifier/lib/credit-pins.json` | open, test | **new** |
| A2-06 | Low (privacy) | The public log and escrow keep every attempt and each subject's whole tier history | `verify.ts:231-234`, `escrow.ts:45-52`, `app.ts` `keeperEscrow` | open | **new** |
| A2-07 | Info (privacy) | The /get flow defaults to no random delay; at today's Rings traffic the anonymity set of a handle certificate is a few deposits | `site/pages/get.html:98`, `ui/get.js:294` | open | partly **dup POF-12 / CR-05** |
| A2-08 | Info (privacy) | Kits keep salts, nullifiers and subject ↔ vault in plain text in `localStorage` | `client/pof-client.js:425-440` | open | **new** |
| A2-09 | Info | Docs say `validity_slots` can be 6,480,000; the program caps it at 1,512,000 | `docs-src/trust.md:88`, `faq.md:75`, `protocol.md:166,205` | open, test | **new** |
| A2-10 | Info | `spr-proxy` returns the upstream response untouched (headers, unscrubbed body) whenever upstream sends `access-control-allow-origin` | `client/server/spr-proxy.js` (`sprProxy`, `proverProxy`) | open | **new** |
| A2-11 | Info | The site root is the repository root (`outputDirectory: "."`): one `.vercelignore` slip publishes local files | `vercel.json`, `.vercelignore` | open | **new** |

No Critical or High finding in this round. The program review found nothing beyond what §5 lists as sound.

### A2-01 · Medium · The relayed holder revoke cannot land
**What.** The program checks 156 bytes: `"POF-REVOKE1" ‖ program ‖ certificate ‖ subject_hash ‖ asset ‖ nullset_hash ‖
issued_slot ‖ valid_until` (`revoke_bytes`, `revoke_signed(valid_until)`). Commit `1d05f29` moved the relayer to the
same 156 bytes. A revoke without `validUntil` is now refused (`BAD_VALID_UNTIL`).

The browser client did not follow. `revokeBytesOf` still builds the old 148 bytes, with no `valid_until`, and
`revokeRelayed` posts `{ subjectHash, asset, signature }` only.

**Impact.** No X-handle or badge holder can revoke through the relayer. The other way is `revoke_by_holder`, and there
the controller key must sign a transaction. Doing that without linking a wallet takes a funded controller, which the
client does not set up. So "revoke first, then move" (the privacy guidance, and the client's own `REVOKE_FIRST`
notice) fails for exactly the subjects it exists for. A holder then either:
- moves the money, and the keeper's `revoke_spent` publishes the nullifier, which links the handle to the vault and so to
  the funding wallet; or
- waits for the certificate to expire.

**Proof.** `audit2/test/revoke-bytes.test.mjs` builds a kit and runs the client's own `revokeBytesOf`. It gets 148
bytes, where `lib.rs` wants 156. It also shows that `revokeRelayed` sends no `validUntil`.

**Fix.**
- Client: append `valid_until` (suggested: the current slot + 1,500) to the signed bytes, and send it as `validUntil`.
- Add one shared test vector to the program, the verifier and the client tests.

### A2-02 · Medium (configuration) · Note lock not tied to the program
**What.** `NoteLocks.binding` releases a note lock, when no live certificate holds it on chain, at
`issuedSlot + certifyWindow`. Two things decide whether that is safe:
1. `certifyWindow` comes from `POF_CERTIFY_WINDOW_SLOTS`, default 300, and nothing compares it with the Config. The admin
   can raise `max_attest_age` to 9,000 with `set_params` (`Params::check`).
   - Say `max_attest_age` > `certifyWindow`.
   - A holder takes an attestation for subject A and does not submit it.
   - After `certifyWindow` slots, the holder takes one for subject B on the same note.
   - Both still land: two live certificates on one note, the exact thing POF-04 closed.
2. `app.ts` builds the chain only when `POF_RELAYER_KEY` is set. With `chain = null`, a lock binds for `certifyWindow`
   slots only, even while A's certificate is live for a day.

Production has a relayer key today: `/api/relay/quote` answers `CHAIN_OFF` from the program, not `RELAY_OFF`. So point 2
is latent there.

**Proof.** `audit2/test/locks.test.mjs`: both scenarios hand the note to B.

**Fix.**
- Read `max_attest_age` from the Config, at start-up and on each attest, and use the larger of it and the env value.
- Refuse to attest, with `CHAIN_OFF`, when no chain is configured, instead of falling back to the short window.

### A2-03 · Low · Relayer payment matching
`incoming()` counts any positive change of the relayer's balance in a transaction the relayer did not pay for. It reads
only the last 60 signatures, and a payment is matched by its exact amount.

- **Window (dup POF-16).** About 60 dust transfers (about 0.0003 SOL) push an honest payment out of view. The holder then
  gets `NOT_PAID`, and the payment is stranded.
- **Refunds count as payments (new).** `expire` on a relayer-paid certificate returns its lamports to the relayer, in a
  transaction the caller pays for. If `fee_lamports` is 0:
  1. pre-fund that certificate PDA with `network + tag` lamports;
  2. call `expire`;
  3. the relayer's balance change equals a quote this attacker holds, so the relayer's own rent is accepted as the
     attacker's payment.
- **Quote grinding (new).** Quotes are not bound to anyone, and the tag has 99,999 values. An attacker who sees a pending
  payment on chain can request quotes until one matches its amount, then spend the victim's payment first. This needs on
  the order of 10^5 quote requests, behind per-instance buckets.

**Fix:** a reference key per quote, Solana Pay style, put into the payment transaction and looked up with
`getSignaturesForAddress(reference)`. Count only SystemProgram transfers whose source is not a POF PDA.

### A2-04 · Low · Cost amplification
These have no per-client limit in code, and a fresh subject or query string bypasses the CDN.

| endpoint | what one request costs |
|---|---|
| `/api/card/<any>.png` | an RPC lookup and a resvg render; measured at 1.3 s and 140 KB for a random subject (`x-vercel-cache: MISS`) |
| `/c/<any>` | an RPC lookup |
| `/v1/certificates/<any>` | an RPC lookup |
| `/api/attest/log?from=` | up to 256 Blob reads per call, behind a 120-a-minute per-instance bucket |
| `/api/keeper/escrow` | a full Blob `list`, plus up to 500 Blob reads per call |

The edge firewall could not be inspected. If it has no rule here, these are the cheapest ways to grow the Vercel and
Helius bills.

**Fix:**
- A Firewall rate rule per IP on `/api/card`, `/c`, `/v1`, `/api/attest/log` and `/api/keeper/escrow`.
- Normalise the cache key, by stripping unknown query parameters.
- Cap the escrow list at about 100 entries, and cache the listing.

### A2-05 · Low · One credit key for two networks
`credit-pins.json` pins the same RSA modulus, `kid` and house ring for `mainnet` and `devnet`. Any devnet relayer that
holds that key (a staging deployment, or a future devnet test of credits) will sign credits for transfers paid in faucet
SOL. The mainnet relayer accepts those credits, because `Credits.spend` checks only `kid` and the RSA signature.
Mainnet then pays rent and fees for them, up to the daily cap.

Today the lab uses a throwaway key, so this is latent.

**Fix:** a separate key and `kid` per network. A test exists: `audit2/test/config.test.mjs`.

### A2-06 · Low · The log is a permanent public history of attempts and tiers
Every attestation the Verifier signs goes into the public log, and into the public escrow listing. This includes
attestations that never landed on chain. Each one carries the subject hash, the asset, the tier, the issue slot, the
payer and the controller.

An X subject hash is `sha256("pof:x:" ‖ handle)`, which a dictionary of handles reverses. So the log tells anyone:
- that a given handle asked for a certificate, even if it never submitted one;
- every tier it has held, through renews and remakes, long after the certificate is revoked or closed.

The docs say the log holds "no amounts", which is true. They do not say that it holds this.

**Fix:**
- State it on the privacy page.
- Consider issuing the X subject hash with a per-handle salt known to the holder. That needs a contract change, so a
  minimum fix is the docs.

### A2-07 · Info · Default timing
The /get page defaults to "Random delay: No", and the Verifier's minimum note age is 150 slots. RINGS.md measured
about 20 tree transactions in 2,825 slots, roughly one every 140 slots. A certificate's issue slot, tier and note count
(all public) are then consistent with only a handful of recent public deposits, and each deposit names its vault and its
depositor.

**Fix:** turn the delay on by default, and widen it (for example 1,500 to 9,000 slots) for handle and badge subjects.

### A2-08 · Info · Kits in plain text
`saveKit` seals the openings and the badge secret. It stores these in clear in `localStorage` (`pof:kits:v1`):
- `revoke: [{ salt, nullifier }]`;
- the subject value, such as the handle;
- `ringOwner` (the vault).

Any script on the origin, an extension, or anyone with the device can link handle, vault and funding wallet, and can
watch for the spend. The export file carries the same.

**Fix:** seal the whole kit except `attestation` and `subjectHash`, under `kitKey`. Keep the revoke pair recoverable
through the vault seed.

### A2-09 · Info · Validity in the docs
`trust.md:88`, `faq.md:75` and `protocol.md:166,205` give 6,480,000 slots as the program's bound. In fact
`VALIDITY_MAX = 1_512_000` and the launch value is 216,000. A test exists: `audit2/test/config.test.mjs`.

### A2-10 · Info · Proxy passthrough
In `sprProxy` and `proverProxy`, the check `if (r.headers.get('access-control-allow-origin')) return r;` is meant to
pass the proxy's own error responses through. But a real upstream response that carries that header is also returned
as it is: every upstream header, and a body the `api-key` scrub never ran on.

The production indexer answer seen in this review had the proxy's own headers, so the path did not trigger.

**Fix:** mark the proxy's own responses (a symbol, or a wrapper type), not a header the upstream can also send.

### A2-11 · Info · Repository root served as the site
With `outputDirectory: "."`, every deployed file is public. Some examples:
- `/verifier/src/app.ts`;
- `/client/server/spr-proxy.js`;
- `/vercel.json`;
- `/.vercelignore`.

Every `.js` file in the repository also counts as a `'self'` script under the CSP.

A local `.env.local` (Blob read-write token) sits in the folder. It returned 404 in production, and `.gitignore` covers
it. But a CLI deploy relies on `.vercelignore` alone, which does not list it.

**Fix:** build the site into its own output folder, and add `.env*` to `.vercelignore`.

## 4. Production observations (read-only)

**Response headers.**
- HSTS is `max-age=63072000; includeSubDomains; preload`.
- The CSP is `default-src 'self'`, scripts `'self' 'wasm-unsafe-eval'`, `frame-ancestors 'none'`.
- `X-Frame-Options: DENY` and `nosniff` are set on pages and APIs.
- The API answers CORS `*`, as designed for public reads.

**Error bodies.**
- Errors are short `{ error: { code, message } }` objects: no stack, no URL, no key.
- `/api/keeper/scan` without the cron secret answers 403.

**Live services before launch.**
- `/api/attest` and `/api/link/start` are live and sign.
- `/api/relay/quote` answers `CHAIN_OFF`, because the program has no Config on mainnet yet.
- The log is empty and its head is signed by `3pmA4cQP…3ZUR`.
- The escrow lists one keeper, `pof-1`.

**Proxies.** `/api/rpc` refuses methods outside its list (for example `requestAirdrop`). `/api/spr` passes indexer
methods with the project's key. Both are open by design, POF-14.

**Static files.** `/.env.local`, `/.env`, `/.vercel/project.json`, `/program/target/...`, `/lab/`, `/bench/` and
`/fuzz/` all answer 404.

## 5. What held up

Checked specifically, and found sound:
- **Signature check.** `ext::signed_before` accepts exactly one signature, with all offsets in the Ed25519 instruction.
  The key and the message are read from the verified offsets, and the expected bytes are rebuilt on chain from the
  instruction arguments and the payer signer.
- **Signing domains.** `POF1`, `POF-STH1`, `POF-LINK2` and `POF-REVOKE1` are separated by their first bytes, and the
  lengths are fixed.
- **Lamports.** `certify` over an existing account refuses a live certificate and a not-newer `issued_slot`. It buys
  the old payer out at exactly the rent, and moves any surplus to the treasury after the CPIs. `expire` closes the
  account to the recorded payer. The treasury counters cannot underflow.
- **The `$ROOT` exemption.** Only the canonical ATA counts. The owner, the mint, the token program and the account
  state are checked, and the account cannot be squatted. Borrowing tokens within one transaction exempts that one
  payment only.
- **`revoke_spent`.**
  - Path (a) derives the PDA from the passed tree and the nullifier, and checks owner, length and tag.
  - Path (b) always hashes 40 levels, with zeros filled in from a constant table that a unit test checks, and has the
    leaf index below 2^40. So a leaf of the indexed tree cannot be swapped with an internal node, even though both
    are 2-input Poseidon.
  - An all-zero root slot in the history would need a Poseidon preimage of zero.
- **`revoke_signed`.** It is bound to the certificate address, the nullset and the issue slot. It is checked against the
  controller, refused after `valid_until`, and refused unless the certificate is live.
- **`pof_gate`.** `join` goes through the CPI with the PDA checked, and the returned controller must sign. `evict` reads
  the certificate directly and accepts only the PDA address.
- **Verifier.**
  - It refuses a ring owner proof that is missing or wrong, and a subject or controller proof that is missing or wrong.
  - `nk` is checked against the registry `npk`.
  - It recomputes the commitments with the SDK and re-hashes each 32-level path to an on-chain root.
  - The nullifiers are derived here. Non-inclusion is re-hashed to an on-chain nullifier root, with `low < nf < high`
    checked.
  - It refuses duplicate notes and mixed trees.
  - `nk` is zeroed in `finally`, and nothing secret goes into an error.
- **Transparency log.** The RFC 9162 inclusion and consistency verification matches §2.1.3.2 and §2.1.4.2. Appends are
  create-if-absent with no gaps.
- **Blind credits.**
  - RSA-FDH with e = 65537 and a 3,072-bit modulus, signed through OpenSSL with blinding (`RSA_NO_PADDING`).
  - The client verifies every unblinded signature against the pinned key.
  - A claim is bound to the transfer signer.
  - A spent token is marked by create-if-absent and bound to the attestation.
- **Linker.** It contacts only the fixed fxtwitter host (no SSRF), and the secret is needed to redeem a code.
- **Bot webhooks.** Telegram refuses when its secret is unset. Discord checks its ed25519 signature.
- **Site scripts.** Server and chain strings reach `innerHTML` only through `esc()`, including on-chain room names.

## 6. Residual risks (beyond audit.md §6)

- **Pre-launch keeper.** The keeper and every cron are off. So a note spent between attestation and `certify` keeps its
  certificate live until expiry: one day at launch.
- **The project's own witness.** It runs in the same Vercel project with the same Blob store, so it is not independent.
  An independent witness is still needed.
- **What the relayer key holds.** The relayer key is also the house ring's spending key. Whoever reads that Vercel env
  holds both the relay float and all unspent credit revenue.
- **Edge rate limits.** Whether the edge rate-limits `/api/attest`, `/api/spr*`, `/mcp`, `/v1` and `/api/card` could
  not be confirmed (A2-04, POF-14).

## 7. Changes
- 2026-11-25 · audit2 · first round: 11 findings (2 Medium, 4 Low, 5 Info), 6 failing tests in `audit2/test/`; compared with audit.md after writing.
