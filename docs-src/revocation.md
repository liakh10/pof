---
title: Revocation
order: 7
summary: The three ways a certificate ends, what each one reveals, and who can do it.
---

# Revocation

A certificate ends in one of three ways. Each one is an instruction anyone can check on chain, and each one emits an event.

| how | who | when | what becomes public |
|---|---|---|---|
| `revoke_spent` | anyone holding a disclosed note's salt and nullifier | a disclosed note is spent on the Rings program | that note's salt and nullifier (status 1) |
| `revoke_by_holder` | the certificate's controller | any time | nothing beyond the revocation (status 2) |
| `expire` | anyone | after `expiry_slot` (or during the wind-down) | nothing; the account closes and its rent goes back to its payer |

A certificate whose status byte is still "live" but whose `expiry_slot` has passed reads as **expired** everywhere (the
program's gate, the SDK, the API) before anyone calls `expire`.

## revoke_spent: proving a spend from chain state

The certificate stores, for each disclosed note, `h = sha256("pof:null:" ‖ salt ‖ nullifier)`. Whoever calls
`revoke_spent(index, salt, nullifier, membership?)` shows one pair. The program recomputes `h`, requires it to equal the
stored hash at `index`, and then requires a proof that `nullifier` is spent on the Rings pool program
(`ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW`), by one of two paths (CONTRACT §5):

**(a) The nullifier PDA.** Every Rings spend creates the account `PDA(["nullifier", tree, nullifier])` under the pool
program: 11 bytes, first byte 8. The program checks the account at that address exists, is owned by the pool program, is
11 bytes and starts with 8. No PDA has ever been closed on mainnet (RINGS.md §3), so this is the normal path.

**(b) The nullifier tree.** The pool may later close nullifier PDAs once their batch is folded into the indexed nullifier
tree (height 40). Then the caller passes `membership = { leaf_index, next_value, path }`: the leaf
`Poseidon(nullifier, next_value)` and its siblings must hash to one of the 100 nullifier roots stored at offset 17,232 of
the tree account. About 35,000 compute units with the Poseidon syscall.

An absent or closed PDA is never read as "unspent"; there is no path that trusts a statement from the Verifier or from us.

After the revocation, `revealed_index`, `revealed_salt` and `revealed_nullifier` are set on the certificate and in the
`Revoked` event (with `path` 0 for the PDA, 1 for the tree). Anyone can then check that the revealed nullifier is the one
the Rings program recorded.

## Who holds the pairs

- **The holder.** The Verifier's answer carries every salt and nullifier. The client saves them in the local revoke kit,
  which can be exported to a file. With the kit, the holder can revoke without us, from any wallet (the caller pays only
  the transaction fee).
- **The keeper.** The Verifier hands the keeper the same pairs, sealed with AES-256-GCM (the Blob key name is the
  associated data). Each scan opens every kit, reads its certificate, drops kits whose certificate is gone, revoked,
  replaced or long expired, and for each live one checks whether any disclosed nullifier is spent: first the PDA, then the
  indexer's answer re-checked against the on-chain nullifier roots. The first spent note is shown to `revoke_spent`. At most
  10 revocations per scan, so a burst is spread over a few scans.

Nobody else can revoke a live certificate by spend, because nobody else knows a salt. That is deliberate: if salts were
public, anyone could link a certificate to the later spend of its notes even after the holder revoked it first (see below).
The cost is that revocation on spend depends on the keeper in practice ([Trust points](trust), item 4).

**Before launch the keeper cron is off.** Its health (last run, in slots) is on the [status page](status).

## What a revocation by spend reveals

A revealed nullifier is the nullifier of a real spend, and every Rings spend is a transaction signed by the ring owner's
Ed25519 key. So a revocation by spend links the certificate to the ring that spent, which for a vault is the vault owner
key, and from the vault's registration and funding deposits, to the wallet that funded it.

For a wallet certificate that link is already public (the subject message names the ring, and the subject is the wallet).
For an X-handle or badge certificate it is the one link the certificate otherwise never makes.

**Revoke first, then move.** `revoke_by_holder` reveals no salt and no nullifier. A holder who wants to spend the notes
behind a handle or badge certificate and keep the handle unlinked should revoke it with the controller key first, wait for
that transaction to confirm, and only then spend.

## revoke_by_holder

The controller signs `revoke_by_holder`. For a wallet certificate the controller is the wallet; for a badge it is the badge
key (kept in the sealed kit); for an X handle it is the key the client rebuilds from the vault seed. Status becomes 2, the
revoked slot is set, the Treasury's live count and live tier sum go down.

## expire

After `expiry_slot`, anyone may call `expire`. The account closes and its rent goes back to the certificate's payer:
the wallet for a wallet certificate, the relayer for a relayed one. During a wind-down (`close_begin`), anyone may expire
any certificate at once.

A subject can be certified again over a certificate that is revoked or past its expiry. The new `certify` must carry a
newer attestation; the old account's rent goes back to its previous payer first.

## Rooms follow the certificate

A `pof_gate` member stays only while its certificate is live, unexpired, of the room's asset and at least the room's tier,
and has the same controller. When any of that stops being true, anyone may `evict` the member; the program reads the
certificate account directly (no CPI), so a closed certificate evicts too. The bots remove the member from the chat on
their sweep after launch.

## What a reader should conclude

| the reader sees | it means |
|---|---|
| live, slot ≤ expiry | the Verifier checked the notes at `issued_slot`, and no spend of them has been shown since |
| revoked_spent at slot s | a disclosed note was spent at or before s, proven from the Rings accounts |
| revoked_by_holder at slot s | the controller withdrew it at s |
| expired | the attestation is older than its validity; the notes were not re-checked |
