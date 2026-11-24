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
| The lab in headless Chrome | `node lab/test/lab-e2e.mjs` | 12 | pass |
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
