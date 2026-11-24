# Test report: the Verifier, the transparency log, the relayer, the keeper and the X-handle linker

Scope: `verifier/` (one bundle, `dist/pof-verifier.mjs`) and the Vercel functions that run it: `api/attest`,
`api/attest/log`, `api/relay/[fn]`, `api/link/[fn]`, `api/keeper/[fn]`. The bytes are in `CONTRACT.md` §3, §4, §5 and §7.
Environment: Node 20, solana-cli 4.1.2 (Agave), `@heliuslabs/spr` 0.9.0-alpha, esbuild 0.28.2, this build of the `pof`
program. No mainnet transaction was sent. Mainnet was read only: the tree account, registry records, nullifier PDAs and the
Helius Rings indexer.

## Summary

| suite | command | checks | result |
|---|---|---|---|
| Contract bytes, RFC 9162 log, keys | `cd verifier && node --test test/contract.test.mjs` | 9 | pass |
| The Verifier against SDK-built notes | `node --test test/verifier.test.mjs` | 13 | pass |
| Relayer, keeper, escrow, credits, linker, revoke, HTTP | `node --test test/services.test.mjs` | 14 | pass |
| The audit's proofs (rounds 1 to 4) | `node --test ../audit/test/` | 22 | pass |
| Two local validators, Rings cloned from mainnet, this `pof` build | `node test/e2e/local-e2e.mjs` | 13 | pass |
| Mainnet, read only | `node test/e2e/mainnet-read.mjs` | 7 | pass |
| Reproducible bundle, no input outside verifier/, BUILD.json fresh | `node --test test/build.test.mjs` | 2 | pass |

## The test doubles are the SDK's, not ours

`test/helpers.mjs` builds notes with the SDK's own `Utxo` class, the tree with the SDK's Poseidon, and nullifiers with the
SDK's `NullifierKey`. The Verifier recomputes the same values through a different SDK entry (`ownerUtxoHash`), so a
mismatch between our reading of the SDK and the SDK itself fails the tests. Every unit test imports the built bundle,
not the sources: what is tested is what ships.

## What is proven, and where

**Contract bytes** (`contract.test.mjs`): every §3 field at its offset (240 bytes, controller at 192, nonce at 224) and the
round trip; the §1 subject hashes against plain sha256; the §2 tier minimums; the §5 salted nullifier and nullset hash;
the 377-byte §7 leaf and the 80-byte signed head; base58 signatures up to 88 characters.

**The transparency log**: RFC 9162 inclusion and consistency proofs for every index of every size 1 to 33, generated and
checked, with tampering caught; the empty-tree root `e3b0c442…`; 40 concurrent appends from 4 instances land at 40
distinct, gap-free indexes (appends are create-if-absent); a stale hash cache catches up; the signed head verifies.

**The Verifier** (`verifier.test.mjs`), one test per refusal and the happy paths:
- two notes reach tier 2; the answer carries no amount; the signature verifies; the nullifiers equal the SDK's;
- refused, each with its own code: wrong version, tier, asset; empty, oversized, duplicate note lists; a wrong amount,
  blinding or leaf index (NOT_IN_TREE); another asset's note; another ring's `nk`; an unregistered owner; a bad or missing
  ring signature, or one over another tier (BAD_RING_PROOF); a bad subject signature; a stale subject slot; a wrong payer
  for relay; a creating transaction that did not create the note; the indexer down (nothing signed, nothing logged);
- a spent note; a note 20 slots old against a 150-slot minimum (with the slots left); a root no longer in the history;
- vault mode: both the vault and the wallet sign; the wallet's signature cannot be replayed with another ring;
- X handles: the link id certifies only with its controller (LINK_OTHER_CONTROLLER), the controller must sign
  (BAD_CONTROLLER_PROOF), expiry and forgery are caught, an unbound link proves the handle but cannot certify;
- badges signed by the badge key, not by the ring;
- one note backs one live certificate; the same subject may renew; the note is free again once the certify window passes;
- USDC tiers at 6 decimals and the USDC mint.

**Services** (`services.test.mjs`):
- relayer: quote, exact payment, certify; a payment never pays twice, also when two attestations race (POF-30); a refusal
  for the cap or the balance floor never uses the payment (POF-08); an uncertain send keeps the payment for the same
  attestation and a landed one is not refunded (POF-28); wallet subjects are not relayed;
- relay credits (POF-12): a private transfer to the house ring buys blind-signed credits once; a thief or a wrong signer
  cannot claim; the relayer never sees a token or an unblinded signature at claim time; a credit pays one certify, comes
  back if the program refuses, and cannot be reused or forged;
- keeper: a live certificate is revoked the moment a disclosed note is spent, with the right index; the report carries no
  nullifier; dead kits are dropped once they can no longer land; the scan has a time budget and resumes;
- keeper escrow (POF-01): each kit is sealed to each registered keeper; the listing carries no salt or nullifier in clear;
  a registered keeper opens its envelope (and only its own) and revokes through the same permissionless instruction;
- renew reuses the holder's salts, so the salted hashes stay the certificate's;
- linker: redeemed only with the starter's secret (POF-03), the author and code checked through the post, bound to the
  controller, the code burns; a second start never cancels the first (POF-09); five wrong tries lock a code;
- HTTP: JSON errors with codes, 429 with `retry-after`, cron routes need the secret and are off before launch;
- relayed holder revoke: a signature that is not the controller's over this certificate's bytes is refused before anything
  is sent; v2 bytes carry a valid-until slot and an expired one is refused (RV-01); a revoked certificate is not live;
- credit keys: the pinned key is RSA-3072 with e = 65537 and the client's fingerprint; a key that is not the pinned one
  turns credits off; a repeated claim gets the same signatures (CR-02); OpenSSL's signature equals the textbook one
  (CR-03); a retired key's credits are still honoured (CR-04).

## The local end to end

`test/e2e/local-e2e.mjs` runs its own validator (port 37899) with the Rings programs, tree 0, the protocol config and
the SOL interface cloned from mainnet, and this build of `pof` as an upgradeable program. The holder side is the rings
agent's client, unchanged. Output of the last run (`test/e2e/local-e2e.txt`):

1. `init_config`: the Verifier and relayer keys are in Config (validity, max attest age read back).
2. A vault ring registers and shields 2 SOL on the clone.
3. The Verifier signs a 240-byte attestation for `@e2e_anon`, payer the relayer, link bound to the vault's controller.
4. The relayer's `certify` lands: the certificate is live, tier 1, with the salted hashes.
5. The certificate carries the controller key and the log index.
6. The keeper holds the sealed kit and sees the certificate live, nothing spent.
7. The same note is refused for a second handle (NOTE_IN_USE).
8. `anchor_log`: the treasury holds the log's signed head.
9. The attestation is provably in the anchored log (RFC 9162 inclusion against the on-chain head).
10. Phase B: a fresh validator loads the Config, the Treasury and the Certificate from phase A, plus the nullifier PDA a
    real spend of that note leaves (11 bytes, `0x08` ‖ queue index ‖ `0000`, owned by the Rings program). The certificate
    is still live.
11. The keeper finds the spent nullifier and `revoke_spent` lands.
12. The certificate reads revoked (spent), with the salt and nullifier now public.
13. The keeper drops the kit.

Why two phases: a real spend on the clone needs the Helius prover against mainnet state, which a local validator cannot
give. The spend is therefore the account it leaves, loaded at genesis of phase B; the program checks the same bytes
either way. A real spend on devnet (full Helius stack) is the next step; it needs devnet SOL (owner step in
`_x/pof/OWNER-STEPS.md`).

## Mainnet, read only

`test/e2e/mainnet-read.mjs` (output `test/e2e/mainnet-read.txt`): tree 0 decodes to 500 state roots and its nullifier
roots; a real recent leaf re-hashes with the SDK's Poseidon to a root in the on-chain history; its creating transaction
gives its slot and leaf index; a published nullifier reads spent through its PDA and a random one reads unspent with a
verified non-inclusion path; the newest nullifier is still queued (PDA path only); about 6,800 registry records exist and
one owner's `npk` reads back through its record PDA.

## Reproducible build

`npm run build:check` builds the bundle twice in a temporary folder and compares both with `dist/BUILD.json`. The bundle
inlines the program IDL and `keepers.json`, so the hash pins them. The Vercel build runs `build:verify` and fails the
deploy if the bundle differs from the committed hash; at run time the bundle hashes itself and `GET /api/attest` shows it.

## What this does not cover yet

- A real spend on devnet (needs devnet SOL).
- The house ring's credit check against a real private transfer (`sdkHouseRing`): unit-tested with a fake; it needs the
  relayer key's Ring registered and a devnet or launch transfer.
- `revoke_signed` on chain: the relayer side is ready; the program instruction is the program's.
- Blob behaviour under real concurrency: the create-if-absent primitive is tested on the folder store; Blob's
  `allowOverwrite: false` gives the same guarantee and is exercised at the first deploy.
