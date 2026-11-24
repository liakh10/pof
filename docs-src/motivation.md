---
title: Motivation
order: 3
summary: Post proof, not wallet. Why a proof of funds is a standard document in finance, and what changes when the funds sit in a shielded pool.
---

# Motivation

## Post proof, not wallet

On public chains the usual way to show you can pay is to show the wallet. That proves the balance and gives away
everything else: the full history, every counterparty, the next move. Traders, funds and people who negotiate deals
keep being asked to make that trade.

A shielded pool changes the default. Since Helius Privacy Rings went live, amounts and assets inside a ring are
encrypted; addresses on the default ring stay visible. Inside a ring, a balance is no longer public, and so it can no
longer be shown by pointing at it. The question becomes how to prove a fact about it, "at least this much", without
reopening the rest.

## A document finance already uses

A **proof of funds** letter is a routine instrument: a bank states that a client holds at least a sum, for a counterparty
who needs to know the client can complete a deal (property, acquisitions, OTC trades, sponsorships, accredited-investor
checks). The letter names a figure or a floor, a date and the issuer. It does not hand over the statement.

POF keeps the useful properties of that letter and removes the weak ones:

| | a bank letter | a POF certificate |
|---|---|---|
| What it states | holds at least X on a date | holds at least a tier, live at the current slot |
| Who vouches | the bank | the Verifier's signature, checked by the program, recorded in a public log |
| What the reader sees | the letter | a chain account anyone can read |
| When it goes stale | silently, the day after | on chain, at the slot a disclosed note is spent (once the spend is shown) |
| How a reader checks it | calls the bank | reads the account, or the API, or the SDK |
| Forgery | a convincing letter | a picture of a card; the account is the only source of truth |

## Why a live floor and not an amount

A floor is what a counterparty needs and the least a holder must give away. Tiers are coarse by design (powers of ten:
1 to 10,000 SOL, 100 to 1,000,000 USDC) so that a tier says little beyond what it is asked to say. The certificate never
stores an amount; the Verifier compares the sum with the tier and returns only yes or no.

A floor that cannot die is not worth much on a chain where money moves in one slot. So a POF certificate binds the exact
notes it was built from, by salted hashes of their nullifiers, and the program accepts a proof that one of them was
spent from the Rings program's own accounts. Moving the money is what ends the certificate.

## Who uses it on day one

- **People who post under a handle** prove size without tying the handle to a wallet.
- **Group admins** gate a Telegram or Discord community to holders of a live tier, through on-chain Rooms and the bots.
- **Counterparties in OTC trades and sponsorships** check a proof of funds before a deal.
- **Programs** gate an instruction with one CPI, `require_certificate(subject_hash, asset, min_tier)`.
- **Agents** ask the MCP server whether a subject holds a live certificate.

## What POF is not

- Not a statement of total wealth: only the disclosed notes are seen.
- Not a statement of ownership: control of a ring is what is shown ([Trust points](trust), item 6).
- Not anonymity: the subject is public, and so is the way you funded the ring ([Privacy guidance](privacy)).
- Not a custodian: POF never holds your funds or your spend key. Every spend is signed by the ring owner's own key.
