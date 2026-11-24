# @pof/verifier

The Proof of Funds Verifier, its transparency log, the relayer, the keeper and the X-handle linker: one bundle,
`dist/pof-verifier.mjs`, which every function under `api/attest`, `api/relay`, `api/keeper` and `api/link` runs.
The bytes it reads and signs are fixed in `../CONTRACT.md` (§3 attestation, §4 disclosure, §5 revocation, §7 log).
Threat model: `../docs-src/threat-model.md`. Test report: `../reports/verifier.md`.

## What it does, in order
1. Reads the §4 package. The ring owner's signature over the disclosure message v2 (and the subject's, or for an X handle the
   link id plus the controller's signature).
2. Reads the ring owner's User Registry record and checks `Poseidon(nk) == npk`.
3. Recomputes every disclosed note's commitment with the Helius SDK's own hasher (`ownerUtxoHash`), takes the indexer's
   Merkle path, re-hashes it with the SDK's Poseidon and requires the root to be in the tree account's on-chain history.
4. Derives every nullifier from `nk` and requires it unspent: no nullifier PDA, and the indexer's non-inclusion path
   re-hashed to an on-chain nullifier root.
5. Requires each note's creating transaction to be at least `POF_MIN_AGE_SLOTS` old and the sum to reach the tier. The sum is
   compared, never returned or stored.
6. Takes the note locks (one note backs one live certificate), signs the 240 §3 bytes, appends the 377-byte §7 leaf, seals
   the keeper kit (salt, nullifier per note) and the escrow envelopes, and answers. `nk` lives only in this request.

## Reproducible build
```sh
cd verifier && npm ci && npm run build:check   # builds twice, compares with dist/BUILD.json
```
`dist/BUILD.json` holds the published sha256 of the bundle (plus esbuild version, lockfile hash and a hash per source).
The bundle has no timestamps, no absolute paths and no source map, and it inlines `../program/idl/pof.json` and
`keepers.json`, so the hash pins them too. Vercel builds with `build:verify`, which fails the deploy if the bundle differs
from the committed hash. At run time the bundle hashes its own file: `GET /api/attest` shows it, and every log leaf
carries it.

## Keys
`node scripts/keys.mjs` makes, once, in `~/.config/pof/` (dir 700, files 600): `verifier.json` and `relayer.json`
(Solana keypair JSON), `seal.hex` (the keeper's AES key and the root of the lock, quote and rate-limit HMAC keys),
`keeper.x25519` (our keeper's escrow key). It prints public keys only. `--vercel` pushes them to the linked project's env.

## Environment
| name | what |
|---|---|
| `POF_PROGRAM` | the pof program id |
| `POF_VERIFIER_KEY`, `POF_RELAYER_KEY`, `POF_SEAL_KEY` | from `scripts/keys.mjs --vercel` |
| `SOLANA_RPC` | comma list of RPC nodes |
| `HELIUS_API_KEY` or `HELIUS_KEYS` | the Rings indexer key (a comma list rotates); `HELIUS_SPR_URL` defaults to mainnet `/v1/spr` |
| `BLOB_READ_WRITE_TOKEN` | the private Blob store (log, kits, escrow, locks, relay ledger, limits) |
| `CRON_SECRET` | the keeper routes |
| `POF_KEEPER_LIVE=1` | turns the keeper crons on (launch only) |
| `POF_MIN_AGE_SLOTS` (150), `POF_VALIDITY_SLOTS` (216,000), `POF_SUBJECT_PROOF_SLOTS` (1,500), `POF_MAX_ROOT_LAG_SLOTS` (9,000), `POF_CERTIFY_WINDOW_SLOTS` (300) | must agree with the program's Config |
| `POF_RELAY_DAILY_LAMPORTS` (2 SOL), `POF_RELAY_FLOOR_LAMPORTS` (0.05 SOL), `POF_ATTEST_PER_10MIN` (30) | relayer cap and floor, attest cap per client |

## HTTP
| route | |
|---|---|
| `GET /api/attest` | the Verifier key, the bundle hash, the parameters |
| `POST /api/attest` | §4 package → §3 attestation (CONTRACT §4) |
| `GET /api/attest/log` | `?head`, `?entry=i`, `?proof=i&size=n`, `?consistency=m&size=n`, `?from=i&to=j` (CONTRACT §7) |
| `GET /api/relay/quote`, `POST /api/relay/certify` | the relayer for X and badge subjects |
| `POST /api/link/start`, `POST /api/link/check`, `GET /api/link?id=` | the X-handle linker |
| `GET /api/keeper/escrow` | every live kit sealed to each registered keeper (public) |
| `GET /api/keeper/scan`, `GET /api/keeper/anchor` | cron only (`Bearer CRON_SECRET`), off before launch |

## Errors
Every rejection is `{ "error": { "code", "message", "details"? } }` with the HTTP status. Nothing is signed or logged on a
rejection.

| code | status | meaning |
|---|---|---|
| `BAD_JSON`, `TOO_LARGE`, `METHOD`, `BAD_QUERY` | 400/413/405 | the request itself |
| `BAD_VERSION`, `BAD_PACKAGE`, `BAD_HEX`, `BAD_BASE58`, `BAD_LENGTH` | 400 | a field of the package has the wrong form |
| `BAD_ASSET`, `BAD_TIER`, `BAD_SUBJECT_KIND`, `BAD_HANDLE` | 400 | not a §1/§2 value |
| `BAD_NOTES`, `DUPLICATE_NOTES`, `MIXED_TREES`, `WRONG_ASSET`, `BAD_SALTS` | 400 | the notes list |
| `BAD_RING_PROOF` | 400 | the ring owner did not sign this disclosure message |
| `BAD_SUBJECT_PROOF`, `SUBJECT_PROOF_STALE` | 400 | the subject's signature or link id; the signed slot is too old |
| `BAD_CONTROLLER`, `BAD_CONTROLLER_PROOF` | 400 | the controller key, or its signature (X subjects) |
| `LINK_EXPIRED`, `LINK_UNBOUND`, `LINK_OTHER_CONTROLLER` | 400 | the X link id |
| `NO_RING`, `NULLIFIER_KEY_MISMATCH` | 400 | no registry record, or `nk` is not that ring's |
| `NOT_IN_TREE` | 400 | the commitment, its leaf index or its path does not reach an on-chain root |
| `NOTE_SPENT`, `NOTE_TOO_NEW`, `BELOW_TIER`, `NOTE_IN_USE` | 400 | the notes cannot back this certificate (wait, add notes, or pick a lower tier) |
| `BAD_PAYER` | 400 | with `relay: true` the payer is the relayer |
| `STALE_ROOT`, `ROOT_TOO_OLD`, `INDEXER_UNAVAILABLE`, `NULLIFIER_UNPROVEN`, `RPC_UNAVAILABLE`, `RINGS_TREE` | 502/503 | a source could not be read or checked; nothing was signed; retry |
| `LOCK_BUSY`, `LOG_BUSY` | 409/503 | a concurrent request; retry |
| `RATE_LIMITED` | 429 | with `retry-after` |
| `BAD_QUOTE`, `QUOTE_EXPIRED`, `NOT_PAID` | 400/402 | the relayer quote and payment |
| `BAD_SIGNATURE`, `BAD_HASHES`, `BAD_LOG_INDEX`, `WRONG_PROGRAM`, `ATTESTATION_EXPIRED`, `RELAY_NOT_FOR_WALLETS` | 400 | what the relayer is asked to submit |
| `RELAY_CAP`, `RELAY_LOW`, `RELAY_OFF` | 429/503 | the relayer cannot pay now; the payment stays valid |
| `CHAIN_REJECTED`, `CHAIN_UNCERTAIN`, `CHAIN_OFF` | 502/504/503 | the program refused, the confirmation did not arrive (check before retrying), or no program here |
| `NO_SECRET`, `NO_CODE`, `BAD_POST`, `POST_NOT_FOUND`, `WRONG_AUTHOR`, `CODE_NOT_IN_POST`, `POST_TOO_OLD`, `TOO_MANY_TRIES`, `X_UNAVAILABLE` | 400/429/503 | the X-handle linker |
| `BAD_RANGE`, `NOT_FOUND`, `BAD_LEAF`, `BAD_ATTESTATION` | 404/400 | the log |
| `FORBIDDEN`, `KEEPER_OFF`, `ESCROW_OFF`, `NOT_FOLDED`, `NO_SPEND_PROOF` | 403/503/409 | the keeper |
| `NOT_CONFIGURED`, `KEY_MISSING`, `SEALED`, `BAD_ACCOUNT`, `INTERNAL` | 500/502/503 | our side; nothing was signed |

## Tests
```sh
npm test                          # unit and service tests against the bundle (SDK-built doubles)
node --test ../audit/test/        # the audit's proofs
node test/e2e/local-e2e.mjs       # two local validators with Rings cloned from mainnet and this build of pof
```
