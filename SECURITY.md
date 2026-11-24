# Security policy

Proof of Funds asks people to trust it with the facts about their funds. If you find a way to break that trust, we want to
hear it before anyone else does.

## How to report

- **Privately, by direct message to the project's X account.** Its address is `X_URL` in [`config.js`](config.js) and on
  the site. Send a short note that you have a security report; we answer with how to share the details.
- **Or a private GitHub security advisory** on [liakh10/pof](https://github.com/liakh10/pof/security/advisories/new),
  when private vulnerability reporting is enabled on the repository.

Please do not open a public issue, post on X, or share a working exploit before a fix is out. There is no email address
for reports; anything claiming to be one is not ours.

Include what you can: the component and commit, the steps or a failing test (the style of [`audit/test/`](audit/test/)
is ideal), what an attacker gains, and whether you tried it anywhere other than your own local validator or devnet.

## Scope

In scope:

| component | where |
|---|---|
| the `pof` and `pof_gate` programs | `program/programs/` and the deployed ids `pofP4QRRDXnmDN9CNYiAGHfwMEgM7sLWhVcUMpsbynT`, `gatSToJMD8ZPLa85fKj6seYHUtYx4ah3ptZvLkisLPU` |
| the Verifier, the transparency log, the relayer, the keeper, the X linker | `verifier/`, `api/attest`, `api/relay`, `api/link`, `api/keeper` |
| the browser client | `client/` |
| the read API, the SDK, the MCP server, the bots, the status checks | `api/v1`, `sdk/`, `mcp/`, `bots/`, `api/status` |
| the phase 2 circuit and its verifier, once deployed | `zk/` |
| the shared contract | `CONTRACT.md` |

What matters most to us: a certificate issued without real, unspent funds at the stated tier; a certificate that stays live
after a disclosed note is spent and the spend is shown; a revocation of a certificate whose notes are unspent; anything
that reveals an amount, a nullifier key or a link between a handle and a wallet beyond what [the paper](docs-src/trust.md)
already states; the Verifier or relayer keys; the transparency log accepting a rewrite.

Out of scope (report these to their owners): Helius Privacy Rings itself (its programs, circuits, prover, indexer), Solana,
Vercel, X and fxtwitter, the wallets. Also out of scope: volumetric denial of service, findings that need a compromised
device of the victim, social engineering, and anything already listed with its status in
[`reports/audit.md`](reports/audit.md) (new evidence on a listed finding is welcome).

## Rules for testing

- Test on a local validator (`lab/rings-local/`) or devnet. Do not run an exploit against mainnet certificates, funds or
  services you do not own.
- Do not access, change or delete data that is not yours, and stop as soon as you reach data that is not yours.
- Keep request rates within the published limits.

We will not pursue anyone who reports in good faith under these rules.

## What happens next

We acknowledge the report, reproduce it, and agree with you on disclosure. Fixes are made in the open: the finding, its
fix and a test that proves it are added to [`reports/audit.md`](reports/audit.md) and the [changelog](CHANGELOG.md), with
credit if you want it.

For an issue in the Verifier key or the relayer key, the program admin can pause `certify` and `renew` at once
(`set_paused`; revocation and expiry keep working) and rotate the Verifier key, which takes effect after the rotation delay
counted in slots and recorded in the program's Config.
