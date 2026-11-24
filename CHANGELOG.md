# Changelog

Every notable change to Proof of Funds, by component. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and each component is versioned on its own with [Semantic Versioning](https://semver.org/). Commit hashes point into
[liakh10/pof](https://github.com/liakh10/pof). Nothing is deployed on mainnet yet, so every component is **Unreleased**;
the first release of each will move its section under a version heading with its release slot.

| component | version | where |
|---|---|---|
| program (`pof`, `pof_gate`) | 0.1.0 | `program/` |
| verifier (Verifier, log, relayer, keeper, X linker) | 0.1.0 | `verifier/`, `api/attest`, `api/relay`, `api/link`, `api/keeper` |
| client | 0.1.0 | `client/`, `lab/` |
| sdk (`@pof/sdk`) | 0.1.0 | `sdk/` |
| api (`/v1`, `/api/status`, `/api/spr`) | 0.1.0 | `api/` |
| mcp | 0.1.0 | `mcp/` |
| bots | 0.1.0 | `bots/` |
| witness and cli | 0.1.0 | `witness/`, `cli/` |
| contract | §1 to §8 | `CONTRACT.md`, `RINGS.md` |
| embed (`<pof-badge>`) | 0.1.0 | `embed/` |
| zk (phase 2) | in development | `zk/` |

## program

### [Unreleased] 0.1.0
#### Added
- `pof`: `init_config` (upgrade authority only), `set_roles`, `set_params`, `set_fee` (capped at 0.25 SOL), `set_asset`
  (a tier table, once set, only toggles), `set_verifier` with a rotation delay in slots and `apply_verifier`,
  `set_paused`, `certify` (the 240-byte attestation rebuilt on chain and checked against the Ed25519-program instruction
  before it), `renew`, `revoke_spent` (nullifier PDA, or a nullifier-tree membership path to one of the 100 on-chain
  roots), `revoke_by_holder`, `expire`, `anchor_log` (the signed log head, only growing), `require_certificate` (CPI gate),
  `withdraw_fees`, `close_begin`, `close_config`. Fee exemption for payers holding 1,000,000 $POF and for the relayer. (`54aa589`)
- `pof_gate`: Rooms (`create_room`, `set_room`, `join` through `require_certificate`, permissionless `evict`, `leave`,
  `close_room`, `release_room`). No fees, no admin. (`54aa589`)
- IDLs in `program/idl/`, consumed by the SDK, the Verifier and the API. (`54aa589`)
- `launch.mjs`, `wind-down.mjs`, `ops.mjs`; the suite, wind-down, rehearsal and own-CA tests. (`73d71dd`)
#### Changed
- Config gains `held_delay` and `held_until`; IDLs refreshed. (`73d71dd`)
#### Security
- POF-07: remaking a certificate pays the prior payer the rent only; a donated surplus goes to the Treasury. POF-17: a
  lowered rotation delay waits out the old one. POF-22: `renew` refuses an expired certificate. (`73d71dd`)

## verifier

### [Unreleased] 0.1.0
#### Added
- The Verifier: CONTRACT §4 package in, §3 attestation out; commitments recomputed with the Rings SDK hasher, Merkle and
  non-inclusion paths re-hashed to on-chain roots, nullifiers derived from `nk`, minimum note age 150 slots, the sum
  compared and never returned. (`47bc6ce`, `9034e44`)
- The transparency log: RFC 9162 hashing, 377-byte leaves, 80-byte signed tree heads, inclusion and consistency proofs,
  create-if-absent appends. (`47bc6ce`, `9034e44`)
- The relayer (quote, exact-lamport payment, rolling 24-hour cap, balance floor), the keeper (sealed kits, spend scan,
  `revoke_spent`, `anchor_log`), the X linker (fxtwitter), rate limits, error codes. (`47bc6ce`, `9034e44`)
- Deterministic bundle with a published hash (`verifier/dist/BUILD.json`); the Vercel functions over it; a key script that
  writes keys to `~/.config/pof` (mode 600) and prints public keys only. (`47bc6ce`, `b0edfcc`)
- Keeper escrow: every kit sealed to each keeper registered in `verifier/keepers.json` and published at
  `GET /api/keeper/escrow`; `scripts/witness-keeper.mjs`, an independent keeper in one file. (`035f6a6`)
- `renew` with the holder's salts. (`035f6a6`)
- The keeper writes `keeper/last-scan.json` for the status page. (`d84df76`)
#### Changed
- Default certificate validity is 216,000 slots (the program still accepts up to `validity_slots`). (`035f6a6`)
- The Vercel build verifies that the bundle equals the published hash and fails the deploy otherwise. (`0387b66`)
- Rate-limit counters are named by a keyed hash of the client address per window, swept by the keeper. (`d84df76`)
#### Security
- POF-02: the ring owner signs the disclosure message v2 (`ring.proof`), always. (`d84df76`)
- POF-03, POF-09: an X code is redeemable only with the starter's secret; link ids are bound to the controller
  (`POF-LINK2`); a second start never cancels a first. (`d84df76`)
- POF-04: note locks are atomic create-if-absent generations. (`d84df76`)
- POF-05, POF-06: kits are kept per attestation until they can no longer land or their certificate dies. (`d84df76`)
- POF-08: the relayer refuses before it uses a payment, and releases it on a failed `certify`. (`d84df76`)
- POF-01: keeper escrow (above). (`035f6a6`)

## client

### [Unreleased] 0.1.0
#### Added
- `pof-client`: the Rings SDK and Poseidon WASM in the browser (139 KB gzip certify path, hasher loaded with progress),
  vault, register, shield, sync, note choice, disclosure package, revoke kits with export and import; LocalRings for a
  local validator with Rings cloned. (`6189906`)
- The lab page and the local validator recipe; withdrawals through the Helius prover. (`ec99afb`)
- `api/spr`: the indexer and prover proxies (method allowlists, key rotation, per-address window, size caps, key never
  echoed). (`084ea11`)
#### Security
- POF-02: the vault key signs the disclosure message v2. POF-03: X link with the secret kept in the tab. POF-10: the kit key
  comes from the vault seed, not `nk`; old kits are re-sealed. POF-11: vault message v2 with domain, purpose and warning,
  determinism check, random vault key with a passphrase backup otherwise. POF-12: X and badge certificates go through the
  relayer, paid from the vault; a wallet payer needs explicit consent. (`d9bec9f`)

## sdk

### [Unreleased] 0.1.0
#### Added
- `@pof/sdk`: subjects, PDAs, IDL-driven account decoding, a chain reader, RFC 9162 log proofs, CPI accounts; no runtime
  dependencies. (`1955110`, `82a06d2`)
- Local-validator integration suite. (`7402298`)
- README with examples and a release tarball installable from the repository. (`4b00ca8`)
- Witness cosignatures (`cosignMessage`, `verifyCosignature`). (`39e02d9`)
#### Changed
- Expiry read as the program does: live through `expiry_slot`. (`4b00ca8`)
#### Security
- POF-13: log heads and entries verify only against Verifier keys from Config and the `VerifierSet` history. POF-18:
  certificates matched to log leaves by the signed bytes. (`39e02d9`)

## api

### [Unreleased] 0.1.0
#### Added
- `/v1`: certificates, rooms, stats, config, verified log head and proofs; OpenAPI 3.1. (`c3e6f87`, `82a06d2`)
- `/v1/log/consistency`, `/v1/witness`, `/v1/badge/{subject}.svg`. (`39e02d9`)
- `/api/status`: RPC, program, Rings tree root age, indexer against on-chain roots, Verifier key and bundle, relayer band,
  keeper, log head signature and consistency; uptime history in Blob; the sample cron parked. (`c51636c`)
#### Security
- POF-14 (status): one cacheable URL (a query string redirects), at most one run per instance every 15 s, a shared run in
  Blob reused for 30 s, at most 6 runs a minute. POF-20 (status): the Verifier origin from `POF_STATUS_ORIGIN` or Vercel's
  own URLs, never the Host header. (`55b8394`, `fb1e902`)
- POF-20: service URLs no longer derived from the Host header when the environment is unset. (`39e02d9`)

## mcp

### [Unreleased] 0.1.0
#### Added
- MCP server with read-only tools (`check_proof_of_funds`, `get_certificates`, `list_certificates`, `get_room`,
  `list_rooms`, `get_stats`, `get_log_proof`, `get_log_head`), stdio and Streamable HTTP at `/mcp`. (`4d3a3e3`)
#### Security
- POF-14: batch at most 10, body at most 64 KB, per-address limit. POF-24: room names treated as untrusted. (`39e02d9`)

## bots

### [Unreleased] 0.1.0
#### Added
- Telegram gate bot and Discord role bot over Rooms, the `/link` page, the sweep (cron parked). (`413fbda`)
#### Security
- POF-03 (bot side): X subjects link only with a signature by the certificate's on-chain controller. POF-15: the sweep
  runs in turns with a cursor. POF-21: Discord role hierarchy respected. (`39e02d9`)

## embed

### [Unreleased] 0.1.0
#### Added
- `<pof-badge>`: a web component that shows a subject's certificate live (REVOKED with its slot), with an iframe
  fallback. (`c25f503`)

## witness and cli

### [Unreleased] 0.1.0
#### Added
- `witness/`: an independent log monitor that cosigns heads or records alarms (CONTRACT §8); certificate monitor; the
  project's witness cron parked. (`6780b93`, `39e02d9`)
- `cli/`: `pof check`, `watch`, `rooms`, `config`, `stats`, `log head|proof|verify` (keys and anchor read from chain).
  (`c4f9a99`)

## contract

### [Unreleased]
#### Added
- `CONTRACT.md` §1 to §7 (`1e4c9d1`, `7eb3bcd`, `5e2a7ca`, `54aa589`, `457d9a3`); §8 log witnesses (`5906c78`).
- `RINGS.md`: the Privacy Rings facts POF relies on, each checked against mainnet reads (`1413cf0`, `f396ca5`, `084ea11`).
#### Changed
- §3: `controller` added, 240 bytes (`54aa589`). §4: `ring.proof` over the disclosure message v2, the X link with a secret
  and a bound controller; §7: the anchor is `anchor_log` (`0387b66`).

## docs and reports

### [Unreleased]
#### Added
- `/developers` content and the devx test report (`ec99afb`); the Rings client test report (`d449f65`).
- The internal security review, round 1: 25 findings, failing proofs in `audit/test/` (`9407010`, `cf763b5`); round 2
  re-review: the High findings fixed and re-tested, POF-26 to POF-29 new (`78234b3`).
- The protocol paper in `docs-src/` and the litepaper (`c0fd4df`, `0218cba`); `README.md`, `SECURITY.md`, `LICENSE`
  (Apache-2.0), this changelog.

## zk

In development (`zk/`, `62937c7`): the phase 2 Groth16 circuit (circom 2, 4 notes, the Rings Poseidon), witness and
escrow code, parity tests against the Rings SDK and mainnet leaves, a development setup, the browser prover and the
`certify_zk` patch for `pof`, documented in `docs-src/zk.md`. Not deployed: `certify_zk` stays off until a public
ceremony has run. It will get its own version when it ships.
