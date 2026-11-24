---
title: Verify someone's proof
order: 3
section: guides
summary: Check any wallet, handle or badge live, on the site, through the API, from a terminal, or with an embedded badge.
---

# Verify someone's proof

A certificate is an account on Solana. Checking it means reading that account at the current slot. A screenshot, a
card image or a forwarded message proves nothing: always check live.

## What you are looking at

| field | meaning |
|---|---|
| subject | the wallet, `@handle` or badge key the certificate is about |
| asset and tier | for example "≥ 1,000 SOL". A floor, never an amount |
| status | `live`, `revoked_spent`, `revoked_by_holder` or `expired`, at the slot shown |
| certified slot, expiry slot | when it was made, and the slot after which it reads `expired` |
| revoked slot | when it died, if it did |

**Live** means: the Verifier checked the notes when it signed, and no spend of them has been shown since. A spend is
shown by whoever holds the certificate's revoke kit, normally a keeper, so there can be a short gap between a spend and
the revocation ([Trust points](../trust), item 4). For a large deal, ask for a certificate issued or renewed recently.

**Who are you talking to?** A certificate is public: anyone can point at someone else's. If it matters, ask the person
to prove they control it ([Require a certificate before a deal](otc-deals)).

## On the site

Open `/verify` and type the subject: `@handle`, a wallet address, `badge:<key>`. The page reads the chain and shows
every certificate the subject has (one per asset), with the status at the current slot. Add an asset and a minimum tier
to get a plain yes or no.

## Through the API

No key, no account, open to any origin:

```sh
curl -s "https://<site>/v1/certificates/@anon?asset=SOL&minTier=4"
```

The answer lists the certificates and, when you give `asset` and `minTier`, a `check`:

```json
"check": { "asset": "SOL", "minTier": 4, "minTierLabel": "≥ 1,000 SOL", "ok": true, "reason": "ok" }
```

`reason` is one of `ok`, `no_certificate`, `below_tier`, `revoked_spent`, `revoked_by_holder`, `expired`. A subject with
no certificate is still a normal answer with an empty list. Every answer carries the `slot` it was read at. The full
schema is at `/v1/openapi.json`; [Developers](../developers) has every endpoint.

## From a terminal, without trusting us

The `pof` command reads the chain through **your own** RPC:

```sh
node cli/pof.js check @anon --asset SOL --min-tier 4 --rpc https://your-rpc
```

It exits with 0 when the subject passes, 1 when it does not, 2 when a service cannot be reached, so a script can use it
directly. Add `--verify-log` to also check the certificate's entry in the transparency log against the Verifier keys
the program lists. `pof watch @anon` prints every status change as it happens.

## On your own page: the badge

Embed a live badge that reads the chain on its own and refreshes:

```html
<script type="module" src="https://<site>/embed/pof-badge.js"></script>
<pof-badge subject="@anon" asset="SOL" min-tier="4"></pof-badge>
```

It shows the subject, the tier and the status, turns to **REVOKED** with the slot when the certificate dies, and links to
`/verify`. There is also a plain image at `/v1/badge/<subject>.svg` for places that cannot run scripts. Both show the
status at the moment they were loaded; the script version refreshes every 30 seconds by default.

## Checking the Verifier too

The certificate tells you the Verifier signed. To check that signature is in the public log and that the log was not
rewritten, see [The transparency log](../transparency-log), "How anyone audits it", or run `node cli/pof.js log verify`.
