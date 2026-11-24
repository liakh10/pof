---
title: Trust points
order: 2
summary: Everything POF asks you to trust, first and plainly, with what each party could do if it misbehaved.
---

# Trust points

This page comes before the protocol on purpose. Each item says what you trust, why the design needs it, what that party
could do if it misbehaved, and what limits the damage. The full adversary analysis is in the [Threat model](threat-model).

## 1. The Verifier sees the notes you disclose

To check that your notes exist, are yours and are unspent, the Verifier receives, over TLS, for one request:

- the **opening** of each disclosed note: its asset, its **amount**, its blinding factor, its leaf index and the
  transaction that created it;
- the **owner key** of the ring the notes sit in, and that ring's **nullifier key** `nk`;
- the subject, the subject's signature (or the X link id), the payer.

It recomputes everything from these and signs, or refuses. The code keeps no amount, no opening and no `nk`: they live in
memory for the request and the nullifier key is zeroed when it ends (`verifier/src/verify.ts`). The answer, the log entry
and the keeper's sealed record carry no amount.

**What `nk` exposes.** `nk` cannot spend anything and cannot decrypt transfer notes. It can do two things (RINGS.md §5):
compute the nullifier of every *deposit* note of that ring and so see **when** each deposit is later spent, and read the
amounts of the ring's *merge* outputs. `nk` never rotates. This is why the client certifies from a separate **vault ring**
by default and never discloses the key of your main ring.

**The Verifier also learns who goes with what.** One request names the subject and the vault; the vault's funding
deposit is public on chain and names the wallet that made it. So the Verifier operator can link subject, vault and
funding wallet for every certificate it signs, and the relayer can link each relay credit to the vault that bought it.
The vault isolates the nullifier key, not identity: it is linked to the funding wallet in public anyway
([Privacy guidance](privacy), "What still links").

**If the Verifier misbehaved**, it could (a) record what it was shown, or (b) sign an attestation for funds that do not
exist. You cannot detect (a) from outside: you trust the published code and the operator. (b) is visible after the
fact: every attestation the Verifier signs is in the public [transparency log](transparency-log), and the bundle hash of the
code that signed it is in each entry. The log does not prevent a false attestation; it makes one permanent and
attributable. Phase 2 removes the Verifier's view entirely ([Phase 2](phase-2)).

## 2. The Verifier's signing key and the program admin

The program accepts attestations signed by one ed25519 key at a time, stored in its `Config`. The admin can:

- **pause** certify and renew at once (`set_paused`), for a leaked key; revocation and expiry never pause;
- **propose a new key** (`set_verifier`), which takes over only after a delay counted in slots (216,000 slots at launch,
  never fewer than 9,000), so a key cannot be swapped in quietly; anyone can read the pending key and its slot in `Config`;
- set the fee, up to a hard cap of 0.25 SOL per certify or renew, and enable or disable an asset. A tier table, once set,
  cannot be changed, so an issued tier never changes meaning.

The admin cannot sign attestations. The `pof` program is deployed with the upgradeable loader, and its upgrade
authority is the admin key: whoever holds it can change the program. Check the current authority on chain
(`solana program show pofP4QRRDXnmDN9CNYiAGHfwMEgM7sLWhVcUMpsbynT`); any change to it is recorded in the
[changelog](https://github.com/liakh10/pof/blob/main/CHANGELOG.md).

## 3. Helius: the Rings programs, the tree and the indexer

POF certifies notes held in Helius Privacy Rings, so it inherits their trust:

- **The Rings programs** (`ring1GaLC…`, `regy3WAe…`) are upgradeable by their authority. POF reads their accounts; if
  their layout changes, the Verifier and `revoke_spent` refuse until updated, they do not silently accept.
- **The indexer** gives the Verifier Merkle paths, nullifier non-inclusion paths and each note's creating slot. The Verifier
  does not trust the paths: it re-hashes each one with the Rings Poseidon and requires the root to be in the tree
  account's on-chain history. It does trust the indexer for the **creating slot** of a note, which only feeds the
  minimum-age rule. A dishonest or stale indexer can make the Verifier refuse; it cannot make a missing note pass.
- **Rings is new.** It went live on mainnet on 2026-11-10 and its SDK is `0.9.0-alpha`. POF pins the account layouts it
  reads and fails closed when they differ.

## 4. Revocation on spend depends on whoever holds the revoke kits

`revoke_spent` is open to anyone on chain, but it needs a disclosed note's secret salt and its nullifier. They are held
by the **holder** (in the local kit) and by the **keepers** registered in `verifier/keepers.json`: the Verifier seals
every kit to each registered keeper's X25519 key and publishes the envelopes at `GET /api/keeper/escrow`; each keeper opens
only its own. A holder has no reason to revoke their own certificate, so "the certificate dies when the money moves"
depends on at least one registered keeper running (internal review finding POF-01). Today one keeper is registered, the
project's own; `verifier/scripts/witness-keeper.mjs` is a complete independent keeper in one file, and adding an operator
is a reviewed commit to `keepers.json`, which the published bundle hash pins.

A certificate does not watch the chain by itself. When a disclosed note is spent, the certificate stays live until
somebody shows the spend with `revoke_spent`. Between the spend and the revocation there is a window: the keeper's scan
interval plus one transaction. If the keeper stopped, a spent certificate would stay live until it expires.
**Before launch the keeper is off.**

What limits this:
- certificates are short-lived: the Verifier issues them for 216,000 slots by default (the program allows up to
  `validity_slots`, 6,480,000 in the launch Config), and `renew` on the same notes re-checks them and extends them;
- the kits are escrowed to every registered keeper, so one stopped operator does not keep spent certificates alive once
  a second keeper is registered;
- the [status page](status) publishes our keeper's last run in slots, so a stopped keeper is visible.

A consumer that needs more than "live, and no spend shown yet" should ask for a recently issued or renewed certificate.

## 5. The X handle check relies on X

A handle is linked by posting a one-time code from it. The Verifier reads the post through the public fxtwitter API and
checks the author and the code. If X or fxtwitter returns a wrong author, or an account is taken over, the link is wrong.
The link itself is never stored on chain: the certificate holds only `sha256("pof:x:" ‖ handle)`.

## 6. A certificate proves control, not ownership

The Verifier sees openings and a nullifier key: that proves **control of a ring**, not who owns the money. Borrowed funds
count ("rent a whale"): lend your vault's keys, certify, hand them back. Revocation catches it the moment the notes move,
but not if the lender simply leaves them in place. The ring owner key signs every disclosure (the fix for internal review finding POF-02), so lending a certificate
means handing over the key that spends the funds, not only the nullifier key.

One note backs one live certificate at a time (a keyed index of
nullifiers at the Verifier), so a single deposit cannot certify a hundred handles at once.

## 7. Timing

A deposit into a ring from a public wallet is public: the wallet, the amount and the recipient are in the transaction.
If you shield and certify a moment later, an observer can pair them. The Verifier refuses notes younger than 150 slots;
waiting much longer is your choice and it helps ([Privacy guidance](privacy)).

## 8. Screenshots

A card image proves nothing. A certificate is a chain account; its status at the current slot is what counts. Check any
subject at `/verify`, through the API, or straight from chain with `@pof/sdk`. The site's card always reads the live
status; a screenshot keeps whatever it showed.

## 9. Our hosting

The Verifier, the relayer, the keeper, the X linker, the API and the status page run as Vercel functions; the log, the
keeper's sealed kits and the rate counters live in Vercel Blob. Vercel, like any host, sees request metadata (IP
addresses, timing). The keeper's kits are sealed with AES-256-GCM under a key held in the deployment's environment; whoever
holds that key and the Blob store can read the (salt, nullifier) pairs, which let them revoke, nothing more.

## 10. Open findings

An **internal** security review of this code base (by a separate reviewer inside the POF build, not a third-party audit
firm) is recorded in [`reports/audit.md`](https://github.com/liakh10/pof/blob/main/reports/audit.md)
with failing tests for each finding. A finding stays listed there, with its status, until its test passes.
