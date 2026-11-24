# Test report: developer surfaces (API, SDK, MCP, bots)

Scope: `sdk/` (`@pof/sdk` 0.2.0), `api/v1/` and `api/openapi.json`, `mcp/` and `api/mcp.js`, `bots/` and `api/bots.js`,
`witness/` and `api/witness.js`, `cli/`, `embed/`, `examples/`. Every suite below runs from a clean checkout with the
commands shown. Node 20, solana-cli 4.1.2 (Agave), Anchor 1.2.0 programs built from `program/` at the time of the run
(the IDL with `held_delay` / `held_until`). Headless Chromium (playwright-core 1.63) for the browser suites.

## Summary

| suite | command | tests | result |
|---|---|---|---|
| SDK unit | `cd sdk && npm test` | 21 | pass |
| SDK on a local validator | `cd sdk && npm run test:local` | 7 | pass |
| OTC desk example on a local validator | `zsh examples/otc-desk/test/run.sh` | 3 | pass |
| HTTP API | `cd api/v1 && node --test _test/` | 15 | pass |
| MCP, official client | `cd mcp && npm ci && npm test` | 4 | pass |
| Bots against mocks | `cd bots && node --test test/` | 12 | pass |
| Log witness | `cd witness && node --test test/` | 5 | pass |
| CLI | `cd cli && node --test test/` | 5 | pass |
| `<pof-badge>`, iframe, SVG in Chromium | `cd embed && node --test test/` | 3 | pass |
| Static gated page in Chromium | `cd examples/gated-page && node --test test/` | 1 | pass |
| Release tarball | fresh project, `npm install <repo tarball URL>`, `tsc --strict` (NodeNext), run | 1 | pass |

## Audit findings fixed in these parts (reports/audit.md, round 1)

| id | what changed | proven by |
|---|---|---|
| POF-13 | log heads and entries are checked only against verifier keys from the chain (the Config and every `VerifierSet` event), never the key the log names; `keyTrusted` is its own check; `verifyLogEntry` and `auditLog` require `trustedKeys` | SDK: no keys, a foreign key; API: a log signed by a key the Config does not list reads `verified: false`; witness `unknown_key`; CLI `log verify` fails |
| POF-14 | MCP batches of at most 10, bodies of at most 64 KB, a per-IP rate limit (429 with `retry-after`); room reads are memoized | MCP: 10 pass, 11 refused, empty refused, 70 KB is 413, the 4th quick call from one IP is 429 and another IP is not |
| POF-15 | the bot sweep re-checks everyone in turns with a stored cursor and a time budget | 30 revoked grants all removed over several budgeted runs |
| POF-18 | a certificate is tied to its log leaf by the signed bytes (`matchCertificateLeaf`, `?certificate=`, `pof check --verify-log`, the witness monitor) | a certificate pointing at another leaf fails on `nonce` |
| POF-20 | no service URL from the Host header in production (`POF_LOG_URL`; bots no longer call a linker) | `/v1/log/head` in production without `POF_LOG_URL` is 503 |
| POF-21 | `/pof-setup` refuses roles at or above the member's highest, `@everyone` and integration roles; the server owner may bind any | five refusals and two accepts |
| POF-24 | room names are cleaned (no links, markup, control or bidi characters) in chats, and quoted and labelled untrusted in MCP answers | link and bidi cases |
| POF-03 (bots) | an X handle links only with a signature by the controller of the handle's certificate on chain; no bearer link id is accepted | a stranger's signature, a handle without a certificate, and the right controller |

## SDK unit (21)

- **Base58 and PDAs against @solana/web3.js** (an independent implementation): 200 random keys round-trip and encode
  identically; 40 random `["cert", hash, [asset]]` PDAs give the same address and bump as `findProgramAddressSync`;
  every generated keypair is on the curve and every PDA is off it.
- **Subject hashes** (CONTRACT §1) against `node:crypto` SHA-256: wallet, badge, X handle (case and `@` folded); a web3.js
  `PublicKey` is accepted; handles longer than 15 characters or with other symbols are refused.
- **Subject parsing**: `@h`, `x:h`, `wallet:`, `badge:`, a bare key (tried as wallet and as badge), a 64-hex hash; empty
  and garbage input refused.
- **Tiers** (CONTRACT §2): labels, asset parsing, unknown tiers refused. On the local validator the SDK's tier table is
  compared with the program's `Config` for all 10 asset-tier pairs (base units).
- **Account layouts** from the program's IDL: Certificate encode then decode, memcmp offsets of `asset` and `tier`, a wrong
  discriminator and a short buffer refused, liveness at the expiry slot exactly as the program's `Certificate::is_live`
  (live at `expiry_slot`, expired at `expiry_slot + 1`).
- **Attestation bytes** (CONTRACT §3, 240 bytes): built and parsed back field for field, offsets of `tier`, `root_slot`,
  `expiry_slot`, `controller` and `nonce` checked against the table.
- **Transparency log** (CONTRACT §7), against a reference RFC 9162 implementation written separately in the test:
  roots of every tree size 1 to 33 match; inclusion proofs for **every index of every size 1 to 33** verify, and fail
  with a wrong leaf, a tampered path node or a shortened path; consistency proofs for **every pair of sizes up to 20**
  verify and fail with a wrong old root. Signed tree heads (80 bytes) verify with a real Ed25519 key and fail with a
  changed size; a 377-byte leaf parses; `verifyLogEntry` passes end to end and fails with the wrong index, a forged
  attestation byte, or a head key outside the trusted set.
- **Client on an in-memory chain**: lookups by wallet, handle, badge, bare key and hash; every `checkProofOfFunds` reason
  (`ok`, `below_tier`, `expired`, `revoked_spent`, `no_certificate`); list filters by asset, tier, minimum tier, status
  and kind; stats; an account owned by another program at a certificate address is ignored; rooms with members and
  their live status; Config (verifier rotation applies at its slot) and Treasury counters.
- **CPI accounts**: `require_certificate` accounts and data, out-of-range tier refused; `pof_gate.join` member PDA
  checked against web3.js; conversion to a web3.js `TransactionInstruction`.
- **Consistency proof generation** against the reference for every pair of sizes up to 24; **witness cosignatures**
  (88 bytes) verify and fail with a changed timestamp or root; **`auditLog`** over a 300-entry log (two pages) passes,
  and fails with a foreign key, a wrong anchor, a badly signed entry and a head that does not match its entries;
  **verifier key history** from `VerifierSet` events in transaction logs.

## SDK on a local validator (7)

A fresh `solana-test-validator` with `pof.so` and `pof_gate.so` loaded as upgradeable programs (a throwaway upgrade
authority), devx's own ports, 16 ticks per slot. `init_config` and `certify` are sent with the program's own IDL builder;
everything a developer touches goes through the SDK and devx code. The validator is stopped and its ledger deleted after
the run.

1. Program ids, Config and Treasury PDAs, active verifier, relayer, fee and all tier minimums read correctly.
2. Three real `certify` transactions (an Ed25519-signed 240-byte attestation each: a wallet subject paid by its holder, an
   X-handle subject paid by the relayer, a tier 1 wallet) read back through `lookup`, `checkProofOfFunds`,
   `listCertificates` (asset, tier and kind filters on a real `getProgramAccounts`) and `stats` (the Treasury's live count
   and live tier-minimum sum).
3. `require_certificate` with the SDK's accounts and data: accepted at the certificate's tier, with the `CertView` return
   data decoded (kind, tier, controller); refused with `TierTooLow` one tier above.
4. `pof_gate`: a room created; the wallet holder and the X-handle certificate's controller join with
   `joinRoomInstruction`; the tier 1 holder is refused with `TierTooLow`; the room reads back with its name, tier and two
   live members.
5. `revoke_by_holder`: the SDK reads `revoked_by_holder` with the revoke slot; `checkProofOfFunds` gives that reason; the
   room shows the member as not live; a third party `evict`s it; the Treasury counts the revocation.
6. `anchor_log`: the head computed by the SDK over the three log leaves is signed by the Verifier key and anchored; the
   Treasury holds the same size and root; every leaf's inclusion proof verifies against it.
7. The `/v1` router, the MCP `check_proof_of_funds` tool and the bots' gate decision all read the same chain and agree
   (`@localwhale` passes tier 5; the revoked wallet reads `revoked_by_holder`; stats and config match).

In step 6 the trusted keys come from the chain itself: `verifierKeys({ history: true })` finds the key in the
`VerifierSet` event that `init_config` emitted.

## OTC desk example on a local validator (3)

`examples/otc-desk` is a separate Anchor 1.2 program, built against the `pof` crate with `features = ["cpi"]`, loaded
next to `pof` and `pof_gate`. Its instructions are built from its own IDL with the SDK's encoder and account resolver.

1. A trader with a live tier 3 SOL certificate places an order; the order records the certificate and tier.
2. Refused: a tier 2 certificate (`TierTooLow`, from the CPI), a wallet without a certificate, and a trader using
   someone else's live certificate (`NotYourCertificate`, the controller check).
3. `expire_order` is refused while the certificate passes (`CertificateStillLive`); after `revoke_by_holder` a third
   party closes the order and the rent goes back to the trader.

Not covered here: `revoke_spent` (it needs the cloned Privacy Rings program and a real nullifier PDA; the program and
verifier suites cover it) and `renew`/`expire`.

## HTTP API (15)

Router tests and the real Vercel entry behind a Node HTTP server, with the chain served by a JSON-RPC mock built from the
in-memory accounts and the log served in the Verifier's exact shape:

- every endpoint answers with the documented shape; CORS `*` and preflight `204`; `405` for writes; cache headers per
  endpoint (`s-maxage` 5 to 300, `no-store` on upstream errors);
- the gate `check` for each reason; an unknown subject is `200` with an empty list;
- a clear `400` for a bad subject, an unknown asset, `minTier` without `asset`, a tier out of range, an unknown status or
  kind, a room that is not an address; `404` for unknown routes, rooms and log entries; `503` without an RPC; `502` when
  the RPC fails;
- paging (`limit`, `cursor`, `nextCursor`);
- `/v1/log/proof/{id}` verifies all entries, and a **tampered proof from the log is reported as `verified: false`** with
  `checks.included: false`, never passed through;
- the OpenAPI file is served and lists every route;
- `/v1/log/consistency` verifies against the signed head, and a tampered proof reads `verified: false`;
- `/v1/badge/{subject}.svg` renders live, revoked with its slot, expired, below tier, none, and the dark theme; a hostile
  subject gets a 400 that is still an SVG and holds no markup from the input;
- `/v1/witness` serves a witness document with every cosignature checked.

## MCP (4)

The official client (`@modelcontextprotocol/sdk` 1.32.2) connects over **stdio** (spawning `node mcp/stdio.js` against
the JSON-RPC mock) and over **Streamable HTTP** (the hosted handler behind a Node server). On both: initialize, server
info and instructions, `tools/list` (8 tools, read-only annotations), calls of every tool with yes and no answers
(including `min_amount` mapped to a tier and the "funds moved" reason), tool errors returned as `isError` results, an
unknown tool rejected, ping. Over raw HTTP: `GET` is 405, notifications are 202, CORS preflight, protocol version
negotiation (2024-11-05 echoed, unknown versions answered with 2025-11-25), batches, a parse error is 400. The limits of
POF-14 above. `get_room` quotes the room name and labels it untrusted.

## Bots against mocks (12)

Recorded Telegram Bot API and Discord REST calls, Discord interactions signed with a real Ed25519 key, wallet link
signatures from real Ed25519 keys, the in-memory chain.

- Link tokens: expiry, platform and user binding, tampering refused; a short secret refused.
- Telegram: the webhook secret is enforced; only admins bind a group; an unlinked requester is held and sent a personal
  link, then **approved in the same call that completes the link**; a linked small holder is declined with the reason; a
  linked whale is approved at once; unbound groups are left alone; `/start`, `/status`, `/unlink`.
- Linking: a signature by another key, an unreadable signature, and a signature made for another user are refused; a
  subject linked from a second account moves; X handles by the certificate controller's signature (see POF-03 above).
- Discord: bad signatures are 401; PING answers PONG; setup needs Manage Roles and a real Room; `/pof-verify` offers a
  personal link, the link grants the role; after a revocation the sweep removes the role, and **a second sweep does
  nothing**; `/pof-verify` then says the funds moved; `/pof-unlink`.
- Telegram sweep removes a revoked member (ban then unban, so they can ask again) only where `/pof_evict on` is set.
- Paused sweep and unconfigured bots answer clearly.

- Discord role hierarchy, the sweep in turns, and room name cleaning (POF-21, POF-15, POF-24 above).

## Log witness (5)

Against a growing log in the Verifier's HTTP shape and the in-memory chain:
- cosigns a good head; follows growth with consistency proofs; an unchanged head refreshes its row; a published document
  verifies and a forged row is caught;
- alarms, none cosigned: equivocation (same size, another root), a shrinking log, a rewritten history (the consistency
  proof cannot reach the held head), a key the program does not list, a bad signature;
- the anchor on chain: equal, prefix, ahead (the chain saw a newer head; the log must extend to it), and a mismatch;
- `keygen` writes a 64-byte key with mode 600, prints only the public key, never overwrites; `run.js` cosigns against
  a real HTTP log and JSON-RPC;
- the monitor raises `unlogged_certificate` for a certificate whose named entry holds another attestation, once.

## CLI (5)

Run as a child process against a real JSON-RPC endpoint and the log: `check` (yes, no with the reason, a threshold,
JSON, exit codes 0 / 1 / 2), `check --verify-log` (a certificate whose bytes are in its entry passes; one pointing at
another entry fails on `nonce`), `rooms`, `config`, `stats`, `log head`, `log proof --certificate`, `log verify` (the
whole log recomputed, the anchor matched, and everything failing when the Config lists another key), and `watch`
(the state, a tier change, `REVOKED` with its slot, and the account closing).

## Embed in Chromium (3) and the gated page (1)

- `<pof-badge>`: every state renders with its text; CSS custom properties apply inside the shadow root; the link goes to
  `/verify`; with `refresh="1"` a revocation on chain shows as `REVOKED · slot 5002` and fires `pof-status`; no page
  errors. A hostile subject string is rendered as text (no element, no script run). The iframe page renders in the dark
  theme; at a real 375 px phone width (device scale 3, touch) the page has no horizontal scroll; the SVG badge's title
  reads the revocation.
- The static gated page with a mock wallet signing with a real Ed25519 key: a ≥ 1,000 SOL wallet gets in; ≥ 10 SOL, a
  revoked certificate, no certificate, and a forged signature stay out, each with its sentence.

Not covered: the live Telegram and Discord platforms (their tokens are the owner's to create; the setup scripts print
each step's result) and Vercel Blob itself (the bots use the same private-store calls as the Verifier).
