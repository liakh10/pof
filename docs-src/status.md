---
title: Status
order: 30
summary: What the status page measures, how each state is decided, and how the uptime history is kept.
---

# Status

`GET /api/status` runs every check below at the moment it is asked (cached at the edge for about 20 seconds) and returns
their states, their measurements and the stored uptime history. Every check reads public state only: the Solana RPC, the
Rings tree account, the Helius Rings indexer, the Verifier's own public endpoints, and the `pof` program's Config and
Treasury. Nothing on this page signs, and nothing on it can leak a key: RPC and indexer addresses are never shown, and the
relayer appears as a balance band, not a number.

Each check is in one of five states:

| state | meaning |
|---|---|
| ok | working as designed |
| degraded | working, with a margin running out or a part slow |
| down | the function it guards would refuse right now |
| off | deliberately off (before launch) |
| unknown | not configured on this deployment, or nothing to compare with yet |

The overall state is the worst of ok, degraded and down; off and unknown do not lower it.

All windows are counted in **slots**, read from the chain.

`/api/status` takes no parameters: a request with a query string is redirected to the plain URL, so every visitor shares
the one cached answer. Behind the edge cache, each server instance runs the checks at most once every 15 seconds, a run
stored in Blob in the last 30 seconds is reused by every instance, and at most 6 runs start in any one-minute window;
past that the last stored run is served, marked `stale: true`. Nobody can make the page read the chain or the indexer on
demand. The Verifier and the log are
reached at the address set in `POF_STATUS_ORIGIN`, or else the production domain Vercel sets for the project, or else the
deployment's own URL; never at the address a request claims in its Host header.

## The checks

### Solana RPC (`rpc`)
Asks every configured RPC node for its slot at `confirmed`. **Degraded** if a node does not answer, if the fastest answer
takes more than 1,500 ms, or if one node is more than 150 slots behind another. **Down** if no node answers. Shows the
number of nodes, how many answered, the fastest time, the highest slot and the spread.

### The `pof` program (`program`)
Reads `Config`. **Unknown** if the program has no Config on this network (not deployed yet). **Down** if certify and renew
are paused (`set_paused`), or the program is winding down. Shows the active Verifier key, the fee, `max_root_lag`,
`max_attest_age`, `validity_slots`, and a pending Verifier key rotation with the slots left until it takes over.

### Rings tree root (`rings_tree`)
Reads the Rings tree account (`777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor`): the current state root, the slot it was
last updated (offset 120), the number of leaves and the root history. The program refuses an attestation whose root is
more than `max_root_lag` slots older than its issue slot (9,000 at launch). The tree only updates when someone transacts
on Rings, so a quiet pool can stop certification by itself. **Degraded** when the root is older than half of
`max_root_lag`; **down** when it is older than `max_root_lag`: certification waits for the next Rings transaction.

### Rings indexer, as the Verifier sees it (`rings_indexer`)
The Verifier accepts "this nullifier is unspent" from the indexer only when the indexer's non-inclusion path reaches a
nullifier root that the tree account itself holds. This check makes the same call for a fixed probe value and compares:
the indexer's slot with the chain's (the lag), and the indexer's nullifier root with the 100 roots in the tree account.
**Degraded** if the indexer is more than 150 slots behind, or its root is not in the on-chain history yet while it is
less than 1,500 slots behind. **Down** if it is more than 1,500 slots behind, does not answer, or its root is not in the
history and it is far behind. Unknown when no Helius key is configured.

### Verifier (`verifier`)
Calls `GET /api/attest`, the Verifier's public facts. **Down** if it does not answer, or if its key is not the key the
program accepts now (its attestations would be refused). **Degraded** if the bundle hash it reports is not the published
build in `verifier/dist/BUILD.json`. Shows the response time, the key, the version, the running bundle hash and the
published one. To check the published hash yourself, rebuild it ([The transparency log](transparency-log), step 7).

### Relayer balance (`relayer`)
Reads the relayer's SOL balance (its address is in Config) and shows only the band:

| band | balance | state |
|---|---|---|
| empty | below 0.05 SOL (the relayer's floor) | down: relayed certificates wait; holders can still certify from their own wallet |
| low | 0.05 to 0.5 SOL | degraded |
| ok | 0.5 to 2 SOL | ok |
| ample | 2 SOL or more | ok |

### Keeper (`keeper`)
**Off** before launch: nobody watches the disclosed nullifiers yet, and revocation on spend depends on holders. After
launch it reads the keeper's last run (its slot and counts: kits watched, live, revoked, errors). **Degraded** if the last
run is more than 3,000 slots old or had errors; **down** if it is more than 6,000 slots old. The keeper runs about every
1,500 slots; its last run is also the upper bound of how long a spent certificate can stay live before it is revoked
([Revocation](revocation)).

### Transparency log (`log`)
Fetches the signed tree head and verifies its signature, with the Verifier's key. Then it checks that the log extends
every head seen before:
- the head **anchored on chain** in the Treasury (by `anchor_log`): a consistency proof from the anchored size to the
  current size must verify;
- the head the **previous sample** stored: the same proof from that size.
**Down** if the signature fails, if the head is signed by another key than the Verifier's, if the log is shorter than
an anchored or earlier head, or if a consistency proof fails: each of these means the log changed its history.
**Degraded**, after launch, when entries have waited more than 9,000 slots for an anchor. Shows the size, the root, the
anchored size and slot, and how many entries are not anchored yet.

## History

After launch a cron calls `GET /api/status/sample` (with the cron secret) every few minutes. Each sample runs all checks
and stores, in Vercel Blob:
- the sample itself (the states and a few numbers: root age, indexer lag, RPC and Verifier times, log size, anchored
  size, relayer band), in one file per UTC date;
- a per-day summary: for each check, how many samples were ok, degraded and down; 90 days are kept;
- the log head, so the next sample can prove the log only grew.

`GET /api/status/history` returns the summary as uptime per day and per check, where uptime is the share of samples that
were not down (off and unknown are not counted). Before launch the cron is parked, so the history is empty and the page
shows the live checks only. Data older than 2 hours is shown "as of" its date.
