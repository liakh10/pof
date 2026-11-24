---
title: Revoke, renew, and moving your funds
order: 6
section: guides
summary: How a certificate ends, how to keep it alive, and the right order of steps when you want your money back.
---

# Revoke, renew, and moving your funds

## The four ways a certificate ends

| what happens | who does it | what anyone sees afterwards |
|---|---|---|
| You revoke it | you, with the certificate's controller key | `revoked_by_holder` at that slot, nothing more |
| A note behind it is spent | a keeper, you, or anyone holding its revoke kit, once the spend has happened | `revoked_spent` at that slot, and that one note's nullifier |
| It reaches its expiry slot | nobody needs to act: it reads `expired` from then on | `expired`; anyone may later close the account, and its rent goes back to whoever paid it |
| You certify the same subject again later | you | a new certificate in the same place, after the old one is revoked or expired |

## Revoke it yourself

Open your certificates on the site (the page lists the kits saved in this browser, or imported from your backup file)
and choose revoke. The certificate's **controller** signs:

- a wallet certificate: Phantom asks you to approve the transaction;
- a badge certificate: the badge key, kept in your kit, signs in the page;
- a handle certificate: the controller key, rebuilt from your vault, signs in the page.

Revoking reveals no secret. It is the step to take **before** you move funds behind a handle or badge certificate (see
below). Every transaction also needs an account that pays its network fee, and that account appears in the
transaction: the page tells you which one it uses before you confirm.

If you lost the kit, you can still revoke a wallet certificate (the wallet is the controller) and a handle certificate
(the controller comes back from the vault); a badge's key lives only in the kit.

## Renew it

A certificate lasts **216,000 slots** by default (roughly a day). Renewing re-checks the **same notes** and moves the
expiry forward; the tier can change if the notes still reach it. You need:

- the certificate still live (a renew is refused once it has expired: certify again instead);
- the kit, because a renewal reuses the certificate's secrets so the program can see it is the same set of notes;
- the protocol fee again (**0.01 SOL** at launch, none for a payer holding 1,000,000 $POF), or the relayer's fee for a
  handle or badge.

Renew from the same page you certified on. The checks and the messages are the ones of
[Get your first certificate](first-certificate), step 6; if a note has been spent in the meantime you will see
**"A note you picked was already spent."**, and the certificate cannot be renewed on those notes.

## Moving your funds

The notes behind a certificate are its promise. Spending one ends the certificate, and **how** it ends matters:

**If the certificate is for a handle or a badge, revoke it first, then move.**
1. Revoke it (above) and wait until the page shows the revocation confirmed.
2. Then withdraw or transfer out of the vault.

Done in this order, nothing links the handle or badge to your vault. Done the other way round, a keeper revokes the
certificate by showing the spent note's nullifier, and that nullifier matches a transaction your vault signed: the
handle or badge is then publicly linked to the vault, and through the vault's funding to your wallet. The page reminds
you: **"To move the money without linking the certificate to the spend, revoke the certificate first."**

**If the certificate is for your wallet,** the order matters less: the wallet is already named. Moving the funds ends the
certificate as soon as the spend is shown.

**Notes that do not back any certificate** can move freely; they do not affect any certificate.

To move funds out, the page withdraws from the vault through the Privacy Rings prover. The vault key signs and pays the
network fee from its own small SOL balance, and each spent note leaves 0.00070612 SOL of rent in the Rings program. You
can withdraw to any address, or transfer privately to another Privacy Ring.

## What happens if you move funds and nobody revokes

The certificate stays `live` until someone shows the spend. After launch, the registered keepers do that on their next
scan; anyone with the kit can do it at any time. If no keeper were running, the certificate would stay live until its
expiry slot, which is why certificates are short-lived by default ([Trust points](../trust), item 4).
