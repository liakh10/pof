---
title: Fees and the $POF holder rule
order: 10
summary: What a certificate costs, where the fee goes, who pays nothing, and what comes back.
---

# Fees and the $POF holder rule

## What a certificate costs

| item | amount | goes to | comes back |
|---|---|---|---|
| Protocol fee, per `certify` and per `renew` | `fee_lamports` in Config: 10,000,000 lamports (0.01 SOL) at launch | the Treasury PDA `["treasury"]` | no |
| Certificate account rent | the rent-exempt minimum for the account (about 0.005 SOL) | held in the certificate account | yes, to the payer, at `expire` |
| Network fee | the transaction's signature and priority fee | validators | no |
| Shielding into the vault, registering the vault | Rings fees and rent (RINGS.md §6: the registry record is 0.00115824 SOL of rent) | Rings | the registry rent stays with the record |

The admin can change the fee with `set_fee` or `set_params`, but never above **250,000,000 lamports (0.25 SOL)**: the cap is
a constant in the program (`FEE_CAP`). Every change emits a `ConfigSet` event.

Revocation and expiry cost only the network fee of whoever sends them. Joining a Room costs the member account's rent,
returned when the member leaves or is evicted.

## Who pays no protocol fee

**Holders of $POF.** If the payer's canonical associated token account for the root mint (the $POF mint, called
`root_mint` in Config) holds at least `holder_min` (1,000,000 $POF at launch) at the moment of `certify` or `renew`, the
program takes no fee and counts the call as `exempt` in the Treasury. The check reads that one account, owned by the
payer, of that mint; tokens held elsewhere do not count. Until the root mint is set in Config, nobody is exempt.

**Relayed certificates.** When the relayer is the payer, the program charges no on-chain fee and counts the call as
`relayed`: the holder already paid the relayer. The relayer's quote is the Config fee, the certificate rent, a
10,000-lamport network allowance and a unique tag of 1 to 99,999 lamports that identifies the payment, all in one transfer.
The rent of a relayed certificate returns to the relayer at `expire`.

The holder rule applies to the payer, so it applies when you submit `certify` yourself. A handle or badge certificate
submitted from your own wallet as payer gets the exemption, and names that wallet on chain as the payer: you choose
between the fee and that link ([Privacy guidance](privacy)).

## Where the fees go

The Treasury holds the fees above its own rent and publishes its counters: `fees_in`, `fees_out`, certificates certified,
renewed, revoked by spend, revoked by holder, expired, live, the sum of live tier minimums by asset, relayed and exempt
calls, and the anchored log head. `withdraw_fees` sends the surplus to the `dev` key named in Config (and only the
surplus: the Treasury's rent stays). Each withdrawal emits `FeesWithdrawn` with the amount.

## The $POF token

$POF is the protocol's token. It is created as a plain pump.fun token; its creator fees go to the dev wallet. Its only
role in the protocol is the holder rule above. Its address is published on the site and in this repository's config once
it exists, and not before.
