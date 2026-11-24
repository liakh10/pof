---
title: FAQ
order: 40
summary: Short answers, each pointing to the page that has the long one.
---

# FAQ

## If you are new

**What is this, in one sentence?**
A public, live note on Solana that says "this wallet, handle or badge holds at least this much SOL or USDC", without
saying how much, which stops being valid when the money moves.

**Do I have to show my wallet or my balance?**
No. You choose what the certificate is about: your wallet, an X handle, or a one-off badge. Nobody but the Verifier sees
an amount, and it keeps none ([Trust points](trust)).

**Can Proof of Funds take my money?**
No. Your funds sit in your own Privacy Ring, the vault, and only the vault key can move them. The vault key comes from a
signature your wallet makes on our site, and never leaves your browser. That is also why you must never sign the vault
message on any other site.

**Is my money locked while I hold a certificate?**
No. You can move it at any time. Moving the notes behind a certificate ends that certificate; revoke it first if the
subject is a handle or a badge ([Revoke, renew, move funds](guides/revoke-renew-move)).

**Why does my wallet ask me to sign twice the first time?**
To check that your wallet makes the same signature each time, so your vault can be rebuilt later from the wallet alone.
If it does not, the site makes a random vault key and asks you to back it up with a passphrase.

**Why do I have to wait before certifying?**
So the certificate cannot be matched with the deposit you just made. The minimum is 150 slots (about a minute); longer
is better.

**What is a slot?**
Solana's clock: one slot is about 0.4 seconds. Every wait and every expiry here is counted in slots, because that is what
the chain itself checks.

**What if the site goes down?**
Your certificate and your funds are on chain and do not depend on the site. Anyone can still read the certificate with
their own tools; the open-source client in the repository (`client/`) opens the same vault from the same wallet
signature and can move your funds; and you can still revoke with your kit.
What stops while the site is down is getting new certificates.

**What should I keep safe?**
The backup file the site offers after your first certificate (and its passphrase, if it asked for one). Keep it as
carefully as a seed phrase.

## Details

**Does a certificate show how much I hold?**
No. It shows a tier, a floor: "at least 100 SOL". The Verifier compares the sum of your disclosed notes with the tier and
answers yes or no. The amounts are seen by the Verifier for one request and kept nowhere ([Trust points](trust)).

**Who sees my amounts, then?**
The Verifier, for the notes you disclose, during the request. Nobody else. Phase 2 removes that too ([Phase 2](phase-2)).

**Is it anonymous?**
No. The subject is public, the vault is linked on chain to the wallet that funded it, and timing can pair a deposit with a
certificate. What is private is the amount, which notes back the certificate, and the rest of your ring
([Privacy guidance](privacy)).

**What happens when I move the money?**
The certificate is revoked by spend as soon as someone holding its revoke kit shows the spend: the keeper after launch, or
you. The program checks the spend against the Rings accounts itself ([Revocation](revocation)). To keep a handle or badge
certificate unlinked, revoke it yourself first, then move.

**Can it be revoked when I did not spend?**
No. `revoke_spent` needs a salted nullifier that matches one stored on the certificate and a proof from the Rings
accounts that it is spent. Only the controller can revoke it otherwise.

**How long does a certificate last?**
Until it is revoked, or until its expiry slot: 216,000 slots after the Verifier signed by default (the program allows up to
6,480,000). `renew` re-checks the same notes and extends it; short validity is what keeps a certificate from outliving
its money if no keeper is watching.

**Why a separate vault and not my main ring?**
To prove your notes are unspent, the Verifier must see the nullifier key of the ring they are in. With it, it could see
when that ring's deposits are spent and read its merge outputs. The vault limits that to the funds you put there for
certificates.

**I lost my browser data. Is the certificate lost?**
No. The certificate lives on chain. Signing the vault message again rebuilds the vault and the X controller key (if your
wallet does not sign deterministically, the vault key is in the passphrase-protected backup file instead). The revoke
kit (salts and nullifiers) is only in the browser and in the file you exported; without it you can still revoke by
controller, but not by spend.

**Can I certify borrowed money?**
Yes, if you control the ring the notes are in. A certificate proves control at a slot, not ownership, and dies when the
notes move ([Trust points](trust), item 6).

**Can one deposit back many handles?**
Not at the same time. One note backs one live certificate; the Verifier keeps a keyed index of nullifiers to enforce it.

**Why does certify fail with ROOT_TOO_OLD?**
The Rings tree only updates when someone transacts on Rings, and the program refuses a root more than 9,000 slots older than
the attestation. Wait for the next Rings transaction; the [status page](status) shows the root's age.

**Why does it say NOTE_TOO_NEW?**
Notes younger than 150 slots are refused, so a certificate cannot point at the shield that just happened. The error says how
many slots to wait.

**What does it cost?**
A protocol fee per certify and renew (0.01 SOL at launch, never above 0.25 SOL), the certificate's rent (returned at
expiry) and network fees. Holders of 1,000,000 $POF pay no protocol fee ([Fees](fees)).

**How do I check someone's certificate?**
At `/verify`, through `GET /v1/certificates/<subject>`, through the MCP server, or straight from chain with `@pof/sdk`
([Developers](developers)). Never from a screenshot.

**How do I gate my program or my group?**
With the CPI `require_certificate(subject_hash, asset, min_tier)`, with a `pof_gate` Room, or with the Telegram and
Discord bots ([Developers](developers)).

**Has the code been audited?**
It has had an internal security review by a separate reviewer inside the POF build, not a third-party audit. Findings, their
status and their failing tests are in [`reports/audit.md`](https://github.com/liakh10/pof/blob/main/reports/audit.md).
To report a problem, see [`SECURITY.md`](https://github.com/liakh10/pof/blob/main/SECURITY.md).
