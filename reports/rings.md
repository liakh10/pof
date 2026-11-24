# Test report: the Privacy Rings client (browser client, lab, proxies)

Scope: `client/` (the browser client and its SDK bundle), `client/server/spr-proxy.js` and `api/spr/[method].js` (the Rings
indexer and prover proxies), `lab/` (the harness and the local validator with Privacy Rings cloned from mainnet), and the
facts in `RINGS.md`. Node 20, solana-cli 4.1.2 (Agave), Chrome 158 headless, `@heliuslabs/spr` 0.9.0-alpha.
No mainnet transaction was sent for any of this. Mainnet was read only: accounts, tree roots, indexer reads.

## Summary

| suite | command | checks | result |
|---|---|---|---|
| Core against mainnet data | `cd client && node --test test/core.test.mjs` | 7 | pass |
| Error sentences | `node --test test/errors.test.mjs` | 2 | pass |
| Proxies, stubbed upstream | `node --test test/proxy.test.mjs` | 6 | pass |
| Whole flow on a local Rings clone, real Verifier | `node --test test/local-e2e.mjs` | 1 run, 43 assertions | pass |
| Proxies live (devnet + mainnet, read-only) | `node test/proxy-live.mjs` | 5 | pass |
| USDC and mixed assets on the clone, relay credits | `node --test test/local-usdc.mjs` | 1 run, 46 assertions | pass |
| Vault keys: deterministic, changed, random, locked | `node --test test/vault.test.mjs` | 1 run, 17 assertions | pass |
| The lab in headless Chrome | `node lab/test/lab-e2e.mjs` | 14 | pass |
| Wallet matrix in Chrome (stand-ins) | `node lab/test/wallets.mjs` | 9 profiles | pass |
| Phone timings, 375 px, CPU 4x and 6x | `node lab/test/mobile-perf.mjs` | 2 runs | pass |
| Prover attestation inside Chrome | `node lab/test/prover-browser.mjs` | 2 networks | pass |
| Real spend on devnet | `node test/devnet-e2e.mjs` | 7 | **waiting for devnet SOL** (owner step) |
| Mainnet facts behind RINGS.md | `client/tools/facts/*.mjs` | 11 reads | done, 2026-11-25 |

## What is proven, and where

**From public mainnet data** (`test/vectors.json`, made by `tools/facts/vectors.mjs`):
- **The note commitment formula.** Four real SOL deposits, rebuilt from their public instruction data only (owner hash,
  amount, leaf index, `depositBlinding(tree, leafIndex)`), give exactly the leaf hashes the Helius indexer holds.
- **Merkle paths.** A 32-level state-tree path re-hashes to its root, and that root is in the tree account's on-chain
  500-root history.
- **Spent nullifiers.** A spent nullifier's PDA `["nullifier", tree, nf]` exists (owner `ring1…`, 11 bytes, first byte 8).
  None of the 55,348 such PDAs had been closed.
- **The membership fallback.** After a batch, the indexed-tree membership path (leaf `Poseidon(nf, next)`, 40 levels)
  reproduces a nullifier root held on chain.
- **The cloned tree.** The cloned tree's frontier (offset 128) with its next index reproduces its root.

**On a local validator with the Rings programs and tree 0 cloned** (`lab/rings-local`), against the real Verifier
(`verifier/dist`) reading the chain through `LocalRings`:
- **The flow.** Make the vault (one signature; the wallet is asked twice the first time to check it signs
  deterministically) → register it in the User Registry clone → shield 2 SOL and 3 SOL from the wallet.
- **The rebuilt tree.** `LocalRings` rebuilds both new leaves on top of the cloned frontier and checks the rebuilt root
  against the tree account before answering. Every path re-hashes to it.
- **Note choice.** Tier 1 takes the single 2 SOL note (fewest notes, then the least excess). Tier 2 (10 SOL) is
  correctly unreachable with 5 SOL.
- **The attestation.** The §4 package goes to `Verifier.attest`, which returns a 240-byte `POF1` attestation. Its
  `tree_root` equals the local tree root, its controller is the wallet, and its nullifier equals the one the client
  derived on its own.
- **Refusals:**
  - a wrong nullifier key (`NULLIFIER_KEY_MISMATCH`);
  - a tier the notes do not reach (`BELOW_TIER`);
  - a forged ring proof (`BAD_RING_PROOF`, audit POF-02);
  - an X or badge certificate paid from the wallet without consent (`PAYER_LINKS_WALLET`, POF-12).
- **An X subject (POF-03)**, with the real Linker and a stubbed fxtwitter: `linkStart` keeps the secret in the client. A
  stranger holding the public post and a guessed secret gets `NO_CODE`. `linkCheck` returns a link id bound to the
  vault's controller for the handle. The same link id with another controller is refused; with its own controller the
  Verifier attests, and the attestation's controller is that key.
- **`attest()` over HTTP.** It saves a revoke kit: the salt and nullifier in clear, the openings and the badge secret
  sealed. A key built from `nk` does **not** open the kit (POF-10); the vault-seed key does. The badge kit's controller
  signs as the badge, and a second vault derivation gives the same vault.

**In headless Chrome** (the lab page, `lab/serve.mjs`):
- **The hasher.** The Poseidon WASM is fetched next to the bundle (no CDN), with progress, compiled, and ready in about
  0.1 to 0.4 s on localhost (SIMD build).
- **The page flow.** The dev wallet, the vault, registration, two shields, sync (5.5 SOL), the pick, and certification
  of a wallet subject (240-byte attestation) all work from the page.
- **The badge subject.** It is refused by default without a relayer (POF-12). With "pay from the wallet" ticked, it is
  attested.
- **Kits and keys.** The kits are listed. The Rings derivation message (Solana off-chain message v0, `TSPP/derive/v1`)
  signs and derives. No page errors.
- **The prover through the proxy.** The SDK attests the Helius Nitro prover enclave through `/api/spr-prover`, including
  the signed TEE policy fetch the page makes itself: devnet 0.9 s, mainnet 0.5 s.

**Proxies:**
- **Allowlists.**
  - Indexer: only its seven read methods pass.
  - Prover: only `/attestation`, `/health`, `/proving-keys` and `/prove/<key>[/status|/indexed]` pass.
  - Path tricks get 404: `../etc`, `prove/../x`, extra segments.
- **The key.**
  - It is added upstream only and scrubbed from every answer; the live check confirms the page never receives it.
  - A 429 rotates to the next key.
  - With no key configured, the answer is a clear 503 (`NO_KEY`).
- **Limits.** A per-address window answers 429 with `retry-after`. Bodies are capped at 256 KB (indexer) and 4 MB (prover).
- **Prover traffic.** The `Spr-Tee*` headers pass both ways, the body passes byte for byte, cookies are dropped both ways.
- **Live, read-only.** On devnet and mainnet the SDK's own clients attest the prover and read a 40-level nullifier-tree
  path through the proxies.

## Size budget (gzip, what a first visit downloads)

| file | gzip | budget | loads |
|---|---|---|---|
| `dist/spr.js` + shared chunk | 138 KB | 200 KB | the certify path |
| `dist/hasher-simd.wasm` | 420 KB | 440 KB | once, with progress (`hasher.wasm` 560 KB without WASM SIMD) |
| `dist/web3.js` | 82 KB | 110 KB | wallet transactions |
| `dist/spr-spend.js` | 202 KB | 260 KB | only for a withdrawal (the attested prover client) |

`npm run build` fails when a file passes its budget.

## Not proven yet

- **A real spend on devnet.** Register, shield 1.2 SOL, sync through the indexer, attest, withdraw 0.3 SOL through the
  prover, then see the spent note's PDA and a refusal from the Verifier. The script is written; it waits for 2 devnet SOL
  on the lab key (`_x/pof/OWNER-STEPS.md`, rings 2). The automated airdrops refused it (rate limit).
- **Phantom.**
  - Whether Phantom signs the Rings derivation message (binary, off-chain header `0xff "solana offchain"`): owner step
    rings 1, a signature with no transaction. If it refuses, the vault path still works (plain-text signature).
  - Whether Phantom signs the vault message the same way twice: checked by the client itself on first use.
- **Withdrawal from a real browser wallet.** The vault key signs it inside the page; the code path was exercised in Node
  only.
- The audit fixes POF-02 (ring proof) and POF-03 (link secret) were re-run against the Verifier as committed (0387b66).

## Round 2 (2026-11-25)

### Wallet compatibility
In headless Chrome, with stand-ins that reproduce each wallet's provider surface and sign with real Ed25519 keys
(`lab/test/wallets.mjs`, raw results in `lab/test/wallets.json`). Each run covers:
- connect (the picker whenever more than one wallet is present);
- the vault signature, with the determinism check that signs twice the first time;
- the Rings derivation message (Solana off-chain message v0) through `deriveRing`.

| profile | wallets seen | connected | vault | Rings derivation | result |
|---|---|---|---|---|---|
| Phantom (injected) | Phantom | Phantom | signature | ok 0de938fa | pass |
| Solflare (injected) | Solflare | Solflare | signature | ok 269bd9c4 | pass |
| Backpack (injected) | Backpack | Backpack | signature | ok 06365531 | pass |
| Wallet Standard | Standard Wallet | Standard Wallet | signature | ok 2e6b0aad | pass |
| MPC-style (non-deterministic) | MPC Wallet | MPC Wallet | PASSPHRASE_NEEDED → random (backup required) | ok 125002d3 | pass |
| Phantom + Solflare + Standard (picker) | Phantom, Solflare, Standard Wallet | Solflare | signature | ok 269bd9c4 | pass |
| Phantom in-app browser (iOS, injected) | Phantom | Phantom | signature | ok 0de938fa | pass |
| Phone, no wallet (deep links) | none | — | — | — | pass |
| Desktop, no wallet (install links) | none | — | — | — | pass |

How each surface is handled:
- **Injected providers.**
  - Phantom and Solflare are asked with `signMessage(bytes, "utf8" | "hex")` and answer `{ signature }`.
  - Backpack answers a bare `Uint8Array`.
  - Every shape is normalised and checked to be 64 bytes.
- **Wallet Standard.** Wallets that announce themselves through the standard are listed by name, and `solana:signMessage`
  answers `[{ signedMessage, signature }]`.
- **Phones.**
  - Phantom's in-app browser injects the same provider as the desktop extension.
  - A phone with no wallet gets "Open in Phantom / Solflare / Backpack" deep links (`phantom.app/ul/browse/…`,
    `solflare.com/ul/v1/browse/…`, `backpack.app/ul/v1/browse/…`). A desktop with no wallet gets install links.
- **Non-deterministic signers** (MPC-style) are detected on first use. The vault key is then random, locked under a
  passphrase, and must be backed up before any shield.

Real wallets the stand-ins cannot show, so these stay owner checks:
- whether Phantom, Solflare and Backpack sign the binary off-chain derivation message at all (owner step rings 1);
- whether Ledger-backed accounts sign it.

The vault path needs only a UTF-8 message, so it works either way.

### Phones: timings at 375 × 812, Chrome CPU throttling
Network: 150 ms latency, 6.4 Mbit/s (`lab/test/mobile-perf.mjs`, raw results in `lab/test/mobile-perf.json`).

| CPU | hasher, first visit (ms) | hasher, second visit (ms) | vault signature (ms) | sync through the indexer (ms) | tier pick (ms) | local-clone sync (ms) | sideways scroll |
|---|---|---|---|---|---|---|---|
| 4x | 2314 | 462 | 269 | 517 | 1064 | 14959 | no |
| 6x | 2260 | 492 | 314 | 522 | 1048 | 16017 | no |

- **First visit.** The 420 KB gzip WASM is downloaded with progress events, checked against the sha256 published in the
  bundle at build time (a tampered or truncated file is refused), compiled, and kept in the Cache API.
- **Second visit.** The WASM comes from the cache (`fromCache: true`) and is checked against the same hash again.
- **Sync through the indexer.** This is the production path: the Helius indexer through `/api/spr` (devnet, a fresh
  vault).
- **Local-clone sync.** It replays every Rings transaction of the local chain, so it grows with test history. It is not
  the production path.

### USDC and mixed assets (on the clone, real Verifier)
- **Setup.** The real USDC mint is cloned with its mint authority rewritten to a local key, and 1,234.567891 USDC is
  minted. The holder shields 150.5 USDC, 1,000 USDC and 2 SOL into the vault.
- **Amounts.** A seventh decimal is refused. The token balance drops by exactly 1,150.5 USDC. The rebuilt tree, including
  the SPL deposits, reaches the on-chain root.
- **Tiers.**
  - USDC tier 1 (≥ 100) takes the 150.5 note (excess 50.5).
  - USDC tier 2 (≥ 1,000) takes the 1,000 note.
  - USDC tier 3 (≥ 10,000) reports exactly what is short.
  - SOL notes never back a USDC tier, and USDC notes never back a SOL tier.
- **The Verifier.** It attests USDC tier 2. It refuses a SOL note disclosed under the USDC asset (`WRONG_ASSET`) and a SOL
  note relabelled as USDC (`NOT_IN_TREE`).

### Privacy states for the site (`pof.privacy`, `pof.waitForAge`, `certify({ delaySlots })`)
- **`privacy({ subjectKind, relay, allowWalletPayer, from, pick })`** returns `{ ok, needsConsent, warnings }`. Each
  warning is `{ code, level: block | warn | info, text, … }`:

  | code | level | when |
  |---|---|---|
  | `NOTE_TOO_NEW` | block | a needed note is younger than the minimum age (gives the slot count and the slot it ends) |
  | `WALLET_PAYER` | block or warn | an X or badge subject would be paid from the wallet |
  | `NO_CREDIT` | warn | the relay would be paid at certify time |
  | `RECENT_SHIELD` | warn | the newest chosen note was shielded under 1,500 slots ago, or under 10× the minimum age |
  | `RING_KEY_SHARED` | warn | certifying from the wallet's own Ring |
  | `SUBJECT_IS_WALLET` | info | |
  | `SHIELD_IS_PUBLIC` | info | |
  | `REVOKE_FIRST` | info | |

- **`choose`** returns `readyAtSlot` and `waitSlots` (the first slot at which some set of notes qualifies). The minimum age
  is taken from the Verifier's `GET /api/attest` facts.
- **`waitForAge`** emits `status('age', { waitSlots, readyAtSlot })` until ready.
- **`certify({ delaySlots: [lo, hi] })`** waits a random number of slots first and emits `status('delay', { remainingSlots })`.

### The relay fee without a timing link: blind credits (audit POF-12, rounds 2 and 3)
- **Buying.** `pof.credits.buy({ count })` pays the relayer ahead of time, in a bundle (5 or 20 credits at 0.01 SOL
  each), by a **private transfer** from the vault to the relayer's house ring. The proof hides the amount and the
  recipient, and no tag is added.
- **Blinding.** For each credit the client draws a random 32-byte token and blinds it (blind RSA-FDH, `dist/blind.mjs`,
  byte for byte the Verifier's `verifier/lib/blind.mjs`, a test checks they are identical).
- **Claiming.** The claim (message v2) is signed by the vault key that signed the transfer. The relayer signs the blinded
  values without ever seeing the tokens. The client unblinds, checks every signature, and keeps `{ kid, token, signature }`
  sealed under the vault-seed key.
- **Spending.** Each relayed certificate spends one credit in `/api/relay/certify`. **Even the relayer cannot tie a spent
  credit to the purchase that paid for it.** The v1 hash list this replaces would have let it do so.
- **Recovery.** A bundle that was paid but not claimed (a closed tab, an indexer delay) is kept and claimed again by
  `credits.resume()`.
- **Fallbacks.** Paying at certify time needs `payNow: true` (warned as `NO_CREDIT`). Paying from the wallet needs
  `allowWalletPayer: true` (`WALLET_PAYER`).
- **Proven against the Verifier's own `Credits`** (local USDC test, and the lab in Chrome, where the house-ring receipt
  is simulated):
  - the wrong bundle size is refused (`BAD_BUNDLE`), an unpaid claim is refused (`NOT_RECEIVED`), and so is a short
    payment (`WRONG_AMOUNT`);
  - five tokens are signed, unblinded and verified, and the same transfer cannot be claimed twice (`ALREADY_CLAIMED`);
  - a badge certificate is relayed with one credit, with no quote and no payment;
  - none of the values the relayer saw at the claim equals the spent token's hash image;
  - the spent credit is refused a second time (`CREDIT_USED`);
  - without credits, certify refuses (`CREDITS_NEEDED`).
- **Not proven yet.** The private transfer itself needs the prover (devnet, waiting for devnet SOL), and a real house ring
  must be registered for the relayer key (owner step at launch).

### The relayed revoke (X and badge certificates)
- **The bytes.** `pof.revokeRelayed(kit)` has the certificate's controller sign the 148 `POF-REVOKE1` bytes: domain,
  program id, certificate address, subject hash, asset, nullset hash and the certificate's issued slot, so the signature
  dies with that certificate. The bytes are built from the kit's attestation and the certificate PDA.
- **The submit.** The client posts them to `/api/relay/revoke`. The relayer submits `[ed25519(controller, bytes),
  revoke_signed()]`, so no wallet pays and none appears. It answers `PROGRAM_NOT_READY` until the deployed program has
  `revoke_signed` (it is in the IDL now).
- **Proven so far.** The client's bytes equal the Verifier's `revokeBytes`, the badge key's signature over them verifies,
  and a wallet certificate is refused (it revokes from the wallet). The on-chain `revoke_signed` run belongs to the
  program and verifier suites.

**What still links, for /docs:**
- **The vault and the wallet** are linked in public: every shield is a public deposit from the wallet naming the vault,
  and `fundVault` is a plain transfer.
- **Activity is visible.** The vault's private transfers are visible as transactions signed by the vault (amounts and
  recipients hidden).
- **The operator links at attest time.** The Verifier learns subject, vault and wallet together (RINGS §5). The relayer can
  no longer tie a spent credit to its purchase: the credits are blind.
- **A revocation after a spend** links the certificate to the vault's spend.
- **The honest wording:** vault mode isolates the nullifier key, not identity. Shielding from a fresh wallet is the only
  path with no wallet link.

### Vault key at rest (audit POF-27) and the X controller (POF-26)
- **A random vault seed** (non-deterministic wallets only):
  - It is stored only inside a passphrase box (PBKDF2-SHA256 600,000 rounds, AES-GCM).
  - It sits in memory only while the vault is open.
  - The box is also what the backup file carries.
  - Opening fails without the passphrase (`VAULT_LOCKED`) and with a wrong one (`BAD_PASSPHRASE`).
  - A plain-text seed from before the fix is sealed on the next open, and the clear copy is deleted.
  - The test checks that no `seed` field is left in clear in storage.
- **The lab.** `.vercelignore` keeps `lab/` off the production origin.
- **For the site's CSP:**
  - `script-src 'self' 'wasm-unsafe-eval'` (the hasher compiles WASM);
  - `connect-src 'self' https://d3gbdb0egjwcw9.cloudfront.net` (the Helius signed TEE policy the SDK fetches for a
    withdrawal);
  - no inline script.
- **An X subject** now also carries `subject.controllerProof`, the X controller key's signature over the disclosure
  message (POF-26). The lab links a handle through the real Linker, with a simulated post, and the Verifier attests it.

## Trust points this part carries (for /docs)

- **The nullifier key `nk`.** The Verifier needs it to compute nullifiers (RINGS §5). It cannot spend and cannot decrypt
  transfers. It can see when that ring's deposits are spent and read the amounts of its merge outputs. The client
  therefore certifies from a separate vault ring and never sends anything else derived from the vault seed.
- **The vault key and the vault message.** The vault key comes from a wallet signature over a fixed message that says
  what it is. A page that obtains that signature can move the vault. When the wallet does not sign deterministically,
  the vault key is random and must be backed up with a passphrase before any shield.
- **Linkability.**
  - The vault isolates `nk`, not identity: a shield from the wallet is a public deposit naming the vault.
  - X and badge certificates go through the relayer so the wallet is not the payer.
  - A revocation after a spend reveals the vault's spend.
