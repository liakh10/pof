---
title: Privacy guidance
order: 9
summary: What each step puts on chain, who can link what, and the habits that keep a certificate from pointing back at your wallet.
---

# Privacy guidance

POF hides amounts and which notes back a certificate. It does not hide everything, and some of what it does not hide is
on chain at the moment you fund the vault. This page lists what each step reveals, then the habits that help.

## What each step reveals

| step | public on chain | seen by the POF operator |
|---|---|---|
| Register the vault | the vault owner key and its public keys; the wallet that paid, in the same transaction | nothing |
| Shield into the vault | the depositing wallet, **the amount**, and the vault as recipient | nothing |
| Link an X handle | the post you make (you may delete it after the check) | the handle, your IP |
| Attest | nothing | the subject, the vault, its `nk`, the openings and amounts of the disclosed notes, your IP; the registered keepers get the salts and nullifiers |
| Pay the relayer | a withdrawal from the vault (by default), the amount (fee + rent + a unique tag) and the slot | the payment |
| Certify | subject (hash for a handle), asset, tier, slots, payer, controller, note count | the same |
| Revoke by holder | the revocation and its slot | the same |
| Revoke by spend | one disclosed note's nullifier, which matches a spend signed by the vault key | the same |

Two consequences follow directly:

1. **The vault is linked to the wallet that funded it**, by its registration and by every public deposit. Vault mode
   keeps the nullifier key of your main ring away from the Verifier; it does not hide that the vault is yours.
2. **For an X-handle or badge certificate, the chain does not name the vault**, but timing and amounts can. If a vault
   receives a public deposit of 1,200 SOL and a handle gets a "≥ 1,000 SOL" certificate a little later, an observer can
   pair them, the more easily the rarer deposits of that size are.

## Habits that help

**Certify from the vault, never from your main ring.** That is the client's default. The Verifier sees the `nk` of the
ring you certify from; with it, it could follow when that ring's deposits are spent and read its merge outputs.

**Wait between funding and certifying.** The Verifier refuses notes younger than 150 slots. That is a floor against the
crudest pairing, not a privacy guarantee. Fund the vault well before you need the certificate, and let other deposits of
similar size land in between.

**Prefer a private transfer into the vault over a public deposit.** A deposit from a public balance shows the amount. A
private Rings transfer from another ring into the vault hides it (its output has a random blinding and an encrypted
amount). When you deposit publicly, avoid amounts that sit just above one tier.

**Let the relayer submit handle and badge certificates.** The client does this by default: the relayer is the payer, and
its fee is paid as a withdrawal from the vault, so no wallet appears in the certificate, its event or its log entry. Know
what remains: a withdrawal is a Rings spend signed by the vault key, and it lands shortly before the relayer's `certify`.
Someone watching both can pair the vault with the certificate by timing. Paying the relayer from an account that has no
link to the vault, well before you attest, weakens that pairing. Submitting from your wallet instead names the wallet as
payer; the client asks for explicit consent before it does that.

**Revoke first, then move.** Spending notes behind a live certificate lets anyone holding the kit revoke it by spend, and
that reveals a nullifier that matches a transaction signed by the vault. For a handle or badge certificate, revoke it
with the controller key first (it reveals nothing), wait for confirmation, then spend.

**Use a badge for a one-off deal.** A badge key is made fresh for one certificate and links to nothing else. Hand the
counterparty the badge address; they check it live; you revoke or let it expire.

**Keep the kit file private.** The exported kit contains each certificate's salts and nullifiers (which can revoke it and,
after a spend, link it) and the openings and badge secrets, sealed under a key derived from the vault seed (never from
`nk`, which the Verifier sees). If your wallet signs non-deterministically, the file also carries the random vault key
under your passphrase: it is then the only way to recover the vault on another device.

**Never sign the vault message anywhere else.** Its signature is the vault's spending key. The message says so, and names
its domain.

**Know what the operator sees.** The Verifier operator can link subject, vault and funding wallet for each certificate it
signs, and the host sees request IP addresses. The code stores no amount, opening or `nk`; it stores the log (no amounts),
the keeper's sealed pairs, and rate-limit counters named by a keyed hash of the client address per window (swept by the
keeper). Phase 2 removes the operator's view of amounts and `nk`
([Phase 2](phase-2)); it does not remove the host's view of your IP. Use the network path you trust.

## By subject kind

| | wallet | X handle | badge |
|---|---|---|---|
| Who is named publicly | the wallet | the handle (as a hash anyone can recompute) | a fresh key |
| Who submits `certify` | the wallet | the relayer | the relayer |
| Links to the funding wallet on chain | yes, the subject is the wallet | only by timing, amounts, the relayer payment, or a revocation by spend | same as a handle |
| Who can revoke by hand | the wallet | the controller key, rebuilt from the vault | the badge key, kept in the kit |
| Best for | showing size for a known wallet | posting under a handle | one counterparty, one deal |
