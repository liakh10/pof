---
title: The transparency log
order: 8
summary: An append-only Merkle log of every attestation the Verifier signs, anchored on chain, and how anyone audits it.
---

# The transparency log

The Verifier is trusted to check funds honestly. The log does not make that trust unnecessary; it makes every signature
the Verifier produces **public, ordered and permanent**, so a false attestation cannot be quietly withdrawn and a
signature made outside the log stands out.

## What is in it

One entry per attestation the Verifier signs, appended before the answer leaves the Verifier, whether or not the holder
later submits it. A leaf is exactly 377 bytes (CONTRACT §7):

| offset | size | field |
|---|---|---|
| 0 | 1 | version `0x01` |
| 1 | 240 | the attestation bytes ([The protocol](protocol), Step 5) |
| 241 | 64 | the Verifier's ed25519 signature over them |
| 305 | 32 | the Verifier key that signed |
| 337 | 32 | the bundle hash: sha256 of the Verifier code that produced it |
| 369 | 8 | the slot the Verifier read when it appended the entry |

No amounts, no openings, no nullifiers, no salts. The attestation carries the salted `nullset_hash`, which cannot be tested
against a nullifier without the salts.

## How it is built

- Hashing is RFC 9162 (Certificate Transparency v2): `leaf_hash = sha256(0x00 ‖ leaf)`,
  `node = sha256(0x01 ‖ left ‖ right)`, the tree over n leaves splits at the largest power of two below n, and the empty
  tree's root is `sha256("")`.
- Entries are stored at sequential indexes, each written with create-if-absent, so two concurrent appends never take the
  same index and the log has no gaps. Nothing is rewritten or deleted.
- **Signed tree head.** The Verifier signs, with its attestation key, the 80 bytes
  `"POF-STH1" ‖ program id ‖ tree size (u64) ‖ root hash`.
- **On-chain anchor.** The keeper submits the current signed head to the program's `anchor_log` instruction (an
  Ed25519-program instruction by the active Verifier key, then `anchor_log(size, head)`). The program accepts a head only
  if it is larger than the last one, and stores size, root and slot in the Treasury. Anchoring runs with the keeper,
  which is off before launch.

## Reading it

| request | answer |
|---|---|
| `GET /api/attest/log?head` | `{ treeSize, rootHash, slot, signature, verifierKey }` |
| `GET /api/attest/log?entry=i` | `{ index, leaf, leafHash, attestation, signature, verifierKey, bundleHash, loggedSlot }` |
| `GET /api/attest/log?proof=i&size=n` | an RFC 9162 inclusion path of entry i in the tree of size n |
| `GET /api/attest/log?consistency=m&size=n` | an RFC 9162 consistency proof from size m to size n |
| `GET /api/attest/log?from=i&to=j` | up to 256 entries |

`/v1/log/head` and `/v1/log/proof/:id` return the same data with the checks already run; run them yourself anyway.

## How anyone audits it

Everything below uses public data and `@pof/sdk` ([Developers](developers), "Verify the transparency log yourself", has the
code).

1. **Take the Verifier key from the chain, not from the log.** Read `Config` for the active key (and any pending key and
   its slot), and the `VerifierSet` events for the keys it had before. An answer that names its own key proves nothing by
   itself; `@pof/sdk`'s log checks require the trusted keys as an argument for this reason.
2. **Check the head.** Verify the signed tree head with that key.
3. **Check it extends the anchor.** Read the Treasury's anchored `{ treeSize, rootHash, slot }` and verify a consistency
   proof from the anchored size to the current size. The head you were shown is then the same history the chain fixed.
4. **Check it extends what you saw before.** Keep the last head you verified and check consistency from it every time. A
   log that forks or rewrites fails this check; the [status page](status) runs it at every sample.
5. **Match certificates to entries.** For each `Certified` event (or each certificate account), fetch the entry at its
   `log_index`, check the inclusion proof against a verified head, parse the 240 bytes and compare them with the
   certificate: subject kind and hash, asset, tier, tree root and its slot, note count, `nullset_hash`, issued and expiry
   slots, payer, controller, nonce, and the Verifier key. The `log_index` on a certificate is what the submitter stated;
   it is not part of the signed bytes, so if it does not match, search the log for the attestation itself.
6. **Raise the alarm on a certificate with no entry.** A certificate whose attestation is in no log entry means the
   Verifier key signed outside the log. That is the one event a monitor must never see.
7. **Check the code that signed.** Every entry names the bundle hash of the Verifier that produced it. Rebuild the bundle
   from the repository (`cd verifier && npm ci && npm run build:check`: same Node major, pinned lockfile and esbuild,
   no timestamps or absolute paths) and compare the hash with `verifier/dist/BUILD.json` and with the entries.

## Witnesses

A witness runs steps 1 to 4 continuously and publishes what it saw (CONTRACT §8). `node witness/run.js` runs one, with
its own key (`node witness/keygen.js` writes it to `~/.config/pof/witness.json` and prints only the public key). At each
step it fetches the signed head, requires the key to be one Config lists now or listed before, requires a consistency proof
from the last head it verified, and requires agreement with the head anchored in the Treasury. Only then does it
**cosign** the head: ed25519 over `"POF-WIT1" ‖ program id ‖ tree size ‖ root hash ‖ timestamp` (88 bytes). On any
failure it records an alarm with both signed heads as evidence and cosigns nothing: `log_unreachable`, `unknown_key`,
`bad_signature`, `log_shrank`, `equivocation`, `inconsistent`, `anchor_mismatch`.

The project runs one witness (`GET /v1/witness` serves its document; before launch its cron is parked). One witness run by
the operator adds little against the operator; its value is that anyone can run another with the same code, and two
witnesses that cosigned different heads of the same size are proof of a split view.

## What the log proves and what it does not

It proves that an attestation was signed by the key the program accepted, that it is in an ordered history that never
shrinks, and which build signed it. It does not prove the Verifier checked the notes honestly: that remains trust point 1
until [Phase 2](phase-2) replaces the Verifier's view with a proof the program checks itself.
