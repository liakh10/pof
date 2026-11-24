# Performance and load

What the public surfaces cost under load: the read API (`/v1`), the MCP endpoint, the Verifier's `/api/attest`, and
`/api/status`. All of it ran locally against mock upstreams with injected latency. Nothing here was measured on Vercel or
against real Helius or Blob, so treat the absolute numbers as a lower bound on latency. What carries over to production
is the shape: how many upstream calls each request makes, what the caches absorb, and where the limits bite.

## Method

- **Harness** (`bench/harness.mjs`): one Node process serves the real handlers, the way a Vercel function instance
  runs them: `api/v1/index.js`, `api/mcp.js`, `api/status/index.js`, and the Verifier bundle's attest and log routes.
- **Upstreams, all injected and counted.**
  - Solana RPC (`bench/rpc.mjs`, a separate process): 30 ms per call. It holds 5,000 certificates (a third each wallet,
    X and badge subjects; a tenth revoked; a quarter USDC), 50 rooms of 20 members, and Config and Treasury.
  - Rings indexer: 60 ms per call. The fake Rings source is built with the Helius SDK itself (the Verifier's test
    doubles), and its Merkle paths are precomputed so the fake does not dominate.
  - Vercel Blob: 40 ms per operation, on a filesystem store.
  - The transparency log: 2,000 entries, each signed with the key the mock Config lists.
- **Load** (`bench/load.mjs`): a k6-style closed-loop generator with no dependencies. 20 virtual users each send their
  next request as soon as the last one answers, for 10 s. Every latency is recorded, so percentiles are exact. One warm
  request (or warm-until-200) runs before each scenario.
- **Upstream accounting**: the counters are reset before each scenario. Afterwards "rpc/req" is the RPC calls divided by
  requests, "other/req" is Blob and indexer operations, and "cpu/req" is the harness process's CPU time divided by
  requests.
- **Memo on / off**: `/v1` keeps a short per-instance memo of heavy reads. "Memo off" disables it and shows the cost of a
  cold instance, or of a cache miss.
- **Bursts** (`bench/burst.mjs`): many requests at once, the production MCP limits, and cold caches.
- **Cold start** (`bench/coldstart.mjs`): a fresh Node process per run, median of 5. It times the import of each function
  module, then its first request.
- **Machine**: Apple M2 Pro (10 cores), 16 GB, Node 20.20.2. The machine was shared with other build agents: the
  1/5/15-minute load average was 49/32/30 during the final run. Numbers under this load are pessimistic.

Reproduce: `node bench/run.mjs` (add `--quick` for 4 s scenarios), `node bench/burst.mjs`, `node bench/coldstart.mjs`.
Raw results are in `bench/results/`: `23-14-58` is the baseline, before most fixes; `23-46-32`, `burst-…` and
`coldstart-…` are final.

## Results (final run, 20 virtual users, 10 s each)

| scenario | req/s | p50 ms | p95 ms | p99 ms | cpu/req ms | rpc/req | other/req |
|---|---:|---:|---:|---:|---:|---:|---:|
| `/v1/certificates/@handle` | 579 | 33.3 | 40.2 | 63.4 | 0.78 | 1.00 | 0 |
| `/v1/certificates/<bare key>` (wallet and badge, 4 PDAs) | 575 | 34.0 | 39.4 | 48.7 | 0.89 | 1.00 | 0 |
| `/v1/certificates/<subject>?asset=SOL&minTier=3` | 602 | 32.9 | 36.5 | 41.7 | 0.46 | 1.00 | 0 |
| `/v1/certificates?asset=SOL&status=live` (memo on) | 6,337 | 1.6 | 6.9 | 20.4 | 0.11 | 0 | 0 |
| same, memo off (4 VUs; one full scan per request) | 8 | 413 | 855 | 1,525 | 100 | 1.00 | 0 |
| `/v1/rooms/<room>` (memo on) | 9,844 | 1.2 | 4.4 | 9.7 | 0.08 | 0 | 0 |
| same, memo off | 206 | 94.1 | 132 | 228 | 2.23 | 3.00 | 0 |
| `/v1/stats` (memo on) | 1,054 | 16.5 | 28.5 | 53.5 | 1.05 | 0 | 0 |
| same, memo off (4 VUs) | 5 | 862 | 1,115 | 1,295 | 257 | 7.00 | 8.00 |
| `/v1/log/proof/<id>` (verified, warm mirror) | 604 | 26.6 | 77.4 | 117 | 1.92 | 0 | 0.01 |
| `/v1/badge/<subject>.svg` | 507 | 37.0 | 51.9 | 81.2 | 0.74 | 1.00 | 0 |
| `/mcp` `check_proof_of_funds` | 525 | 36.7 | 46.4 | 58.1 | 0.47 | 1.00 | 0 |
| `/mcp` `get_room` | 5,127 | 2.6 | 8.6 | 18.0 | 0.12 | 0.01 | 0 |
| `/api/attest` (Verifier, 8 VUs, a fresh package each) | 21 | 385 | 421 | 442 | 13.0 | 0 | 13.0 |
| `/api/status` (cached) | 12,939 | 1.1 | 3.5 | 6.1 | 0.05 | 0 | 0 |

How to read it:
- **A subject lookup costs one RPC call** (`getMultipleAccounts`, with the slot taken from its context). Its latency is
  the RPC's latency plus about 1 ms. The 2 to 4 PDAs it derives are cached.
- **Lists, rooms and stats are memoized for 5 to 10 s per instance, and the memo is single-flight.** On a hit they cost
  well under 1 ms of CPU. On a miss, the certificate scan is the one expensive read: about 100 ms of CPU to decode 5,000
  accounts, and a `getProgramAccounts` returning about 3.5 MB of base64. Stats on a miss makes 7 RPC calls: the scan,
  Config, Treasury, the verifier key history, and the log head.
- **Log proofs cost the log nothing per request.** Each instance mirrors the log, checks that the mirror's root equals the
  signed head, and computes the audit path itself.
- **Attest** makes 6 indexer calls and 7 Blob operations, and uses 13 ms of CPU per signature. Its latency is the
  upstream chain. The baseline run had 15 operations and a 1 s p50; the Verifier has since made some of them parallel.

Upstream calls per request on a miss:

| request | RPC calls |
|---|---|
| lookup / check / badge | 1 × `getMultipleAccounts` |
| room | `getAccountInfo` (room) and `getProgramAccounts` (members) in parallel, then 1 × `getMultipleAccounts` (their certificates) |
| list | 1 × `getProgramAccounts` (all certificates matching the memcmp filters) |
| stats | the shared scan, Treasury, Config, the admin's signature history |
| log proof (cold instance) | 1 log head, plus one log page per 256 entries (4 in parallel), once per instance |

## Bursts

| burst | answers | upstream |
|---|---|---|
| MCP: 300 calls from one IP, 50 at once | 40 × 200, 260 × 429 | 40 RPC calls |
| MCP: 300 calls from 300 IPs | 300 × 200 | 300 RPC calls |
| attest: 30 from one IP, 10 at once | 6 × 200, 24 × 429 | the Verifier's per-IP bucket (6) |
| `/v1` list: 200 at once, cold | 200 × 200 | **1** `getProgramAccounts` (single-flight) |
| `/v1/stats`: 200 at once, cold | 200 × 200 | 6 RPC calls in all |
| `/v1/log/proof`: 500 random entries, 50 at once, cold mirror | 500 × 200 | 4 RPC calls; the log paged once |
| the same 500 again, warm | 500 × 200 | 0 |
| `/api/status`: 200 at once, cold | 200 × 200 | 4 RPC calls in all |

The MCP limit (burst 40, then 120 per minute per IP) is per instance. A fleet of instances needs the Vercel Firewall rule
in OWNER-STEPS (devx 4).

## Cold start (fresh process, median of 5)

| module | import | first request | RSS |
|---|---:|---:|---:|
| `@pof/sdk` alone | 11 ms | | 40 MB |
| `/v1` | 15 ms | 45 ms (one RPC at 0 ms latency) | 68 MB |
| `/mcp` | 32 ms | 37 ms | 61 MB |
| `/api/bots` (link page) | 23 ms | 29 ms | 52 MB |
| `/api/status` | 22 ms | 65 ms | 66 MB |
| `/api/witness` | 22 ms | | 42 MB |
| Verifier bundle | 86 ms | | 84 MB |
| Helius SDK + Poseidon WASM | 278 ms import | 20 ms `initializePoseidon` | |

The SDK adds about 11 ms to a cold start, because it has no runtime dependencies. The expensive cold start is the
Verifier's: about 0.4 s for its bundle plus the Helius SDK and the Poseidon WASM, paid once per `/api/attest` instance.

## Hot spots found and fixed (devx code)

| where | before | after |
|---|---|---|
| every read: a separate `getSlot` beside each account read | 2 RPC calls per lookup, 4 per room | 1 and 3 (the slot comes from the response context) |
| the memo cached the value only after it resolved | a burst on a cold cache made one `getProgramAccounts` per request | single-flight: 1 per burst |
| `/v1/log/proof` read the Verifier's log per request, under its per-IP limit (one client for all of `/v1`) | 98% answered 503 at 176 req/s | 0 log calls per proof, 604 req/s, 100% verified |
| the log mirror was built behind an `await`, so a burst built 50 mirrors | 174 log calls and 503s for 50 cold requests | one mirror, 5 calls |
| a failing log sync was retried by every waiting request | the busy log was hammered | the outcome is shared, then 2 s back-off; while syncing, 503 `log_syncing` with `retry-after` |
| verifier keys read by walking the Config account's history | Config is in every `certify`: thousands of `getTransaction` calls | the admin's history plus certificates' keys: about 1 + 1 + admin transactions, once per 10 min |
| the list endpoint re-serialized 100 certificates per request | 249 req/s, p95 193 ms | page memo: 6,337 req/s, p95 6.9 ms |
| stats and trusted keys each ran their own scan | 2 scans | 1 shared scan |
| account decoding: `atob` loop, a copy per field, hex by `padStart` | | `Buffer` base64, zero-copy views, a hex table |
| PDAs derived on every lookup (about 0.4 ms each) | | cached (20,000 entries) |
| the treasury read inside every `/v1/stats` (anchor check) | 1 RPC call per stats request | memo 5 s |
| room: room and members read one after the other | 3 sequential RPC round trips | 2 |

All of these are covered by tests (`api/v1/_test`: cache, mirror, burst and back-off cases). The SDK changes are additive
(the next tarball, 0.3.0, carries them with the program's new IDL).

## Found in other parts (reported to the lead)

1. **Verifier log rate limit vs server-side readers.** `log:<ip>` (burst 120, then 60 per minute) sees every server-side
   reader on the deployment as one client. **Agreed fix:** an `x-pof-internal` header from env, which `/v1` and the
   witness now send; the status page sends it too.
2. **Verifier `range(from, to)`** read one Blob object per entry, one after another: a 256-entry page took 256 × 40 ms. A
   cold mirror of the 1,000-entry log took about 10 s in an earlier run. In the final run the cold burst was served
   (1,040 Blob reads for 1,000 entries), so the reads now overlap. A cold mirror still costs one Blob read per log entry,
   on every new instance. Storing the log in 256-entry chunks would make that L/256.
3. **Attest's upstream chain** is sequential in places. It went from 15 to 13 operations and from a 1 s to a 385 ms p50
   during this round.
4. **`/api/status` `cachedRun`** was not single-flight: 200 cold requests made 660 RPC calls. That was fixed upstream
   during the round (now 4).

## What the quotas mean

Per action, from the counts above:

| action | Solana RPC | Rings indexer | Blob ops | function CPU |
|---|---|---|---|---|
| a certificate issued (`/api/attest`) | 0 here; `certify` and its confirmation through the relayer come on top (not measured) | 6 | 7 (3 reads, 3 writes, 1 create) | about 13 ms, plus about 0.4 s once per cold instance |
| a lookup, check, badge or MCP check on a cache miss | 1 | 0 | 0 | under 1 ms |
| a room view on a miss | 3 | 0 | 0 | about 2 ms |
| a list or stats on a miss (per instance, at most once per 10 s per filter) | 1 large `getProgramAccounts`, or 7 for stats | 0 | 0 | about 100 ms at 5,000 certificates, linear in the count |
| a log proof | 0 | 0 | 0 per request; one per entry per cold instance (in the Verifier's `range`) | about 2 ms |
| the project's witness, every 5 min (after launch) | about 5, plus one scan with `--monitor` | 0 | 2 to 4 | under 100 ms |
| the status sample, every 5 min (after launch) | about 4 | 1 | 2 | small |

**N certificates a day.** Issuing costs 6N indexer calls and 7N Blob operations: N = 1,000 is 6,000 indexer calls and
7,000 Blob ops a day. Add the relayer's transactions for handle and badge subjects. Reading them is bounded by the edge
cache rather than by N:
- every lookup URL is cached for 5 s at each edge region (`s-maxage=5`), so one subject costs at most one RPC call per
  5 s per region however popular it is;
- 100,000 lookups a day spread over many subjects cost at most 100,000 `getMultipleAccounts` calls (1.2 a second).

**Where the limits are.**
- **Lists and stats grow with the total number of certificates.** At 50,000 certificates a scan is about 35 MB of base64
  and about 1 s of CPU. Before that size:
  - serve the wall from an index the keeper or witness keeps (Blob), not from `getProgramAccounts`;
  - keep the default filters, so the edge and the memo stay effective.
- **A cold instance's log mirror** reads the whole log once. That is one Blob read per entry on the Verifier's side, and
  about 64 bytes of hashes plus up to 15 MB of cached leaves per 100,000 entries in memory.
- **Helius**: lookups are standard calls; `getProgramAccounts` is the heavy one, and the indexer calls are per
  certificate. Map these counts onto the plan's credit table in the Helius dashboard. Under the current plan, set the
  daily spend alert from audit POF-14.
- **Vercel**: function CPU is about 1 ms per warm read and about 13 ms per attest. A million reads a month is under half
  a CPU-hour. Invocation count and egress of the larger list answers matter more than CPU. The Firewall rate rules
  (OWNER-STEPS devx 4) cap what one caller can spend.

## Not measured

- Real network to Helius and Blob, the edge cache, TLS and cold Vercel regions.
- The relayer's on-chain transactions.
- The browser client's proving time.
- Concurrent writers to the real Blob store (the Verifier's create-if-absent log appends were tested on the filesystem
  store only).
