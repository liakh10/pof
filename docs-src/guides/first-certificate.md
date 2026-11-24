---
title: Get your first certificate with Phantom
order: 1
section: guides
summary: From a wallet to a live certificate, step by step: the vault, shielding, the wait, the subject, paying, and the backup.
---

# Get your first certificate with Phantom

This guide takes you from a Phantom wallet to a live certificate that says your subject holds at least a tier of SOL or
USDC. It works the same with Solflare or Backpack. Nothing here needs a command line: the `/get` page does every step and
tells you what it is about to do before your wallet asks.

Allow a few minutes of your own time, plus a wait of at least 150 slots after you shield (see step 4). Read
[Privacy guidance](../privacy) once before you start: some of what you do here is public.

## What you need

- A Solana wallet in the browser, with SOL for:
  - the amount you want to certify (for USDC: the USDC, plus a little SOL for fees);
  - network fees for a few transactions;
  - the vault's registry record, once: **0.00116 SOL** of rent;
  - for a wallet certificate: the protocol fee (**0.01 SOL** at launch, none if the wallet holds 1,000,000 $POF) and the
    certificate's rent (about 0.005 SOL, returned when the certificate expires);
  - for an X handle or a badge: the relayer's fee instead, paid from the vault (step 6), and a little SOL for the vault
    key's own transaction fees (the page proposes 0.005 SOL; each spend from the vault also leaves 0.00070612 SOL of rent
    in the Rings program).
- A place to keep a backup file (step 7).

## Step 1. Connect

Open `/get` and connect your wallet. The page lists the wallets it finds in this browser. If it says
**"No Solana wallet in this browser."**, install one and reload.

## Step 2. Make your POF vault

Your certificate is backed by a **vault**: a separate Privacy Ring used only for certificates. The Verifier has to see
one secret of the ring you certify from (its nullifier key); keeping it separate means that secret is never the one of
your main ring. See [Trust points](../trust), item 1.

The page asks Phantom to sign a message. It is a message, not a transaction: nothing is sent and nothing is paid. Read
it before you approve. It starts with `Proof of Funds: create my POF vault key` and says:

> whoever has this signature can move the money in the vault

That is true: **the signature is the vault's key**. Sign it only on the Proof of Funds site, never anywhere else.

The first time, the page asks you to sign the same message **twice**. If both signatures are identical (Phantom's are),
the vault can be rebuilt later on any device by signing again. If your wallet signs differently each time (some
multi-party and smart wallets do), the page makes a random vault key on this device instead and will ask you to back it
up before you can shield: **"Back up your vault key first."** Go to step 7, then come back.

If you later see **"This wallet opened a different vault than before."**, you are using another wallet or device than
the one you made the vault with: switch back, or import your backup.

## Step 3. Register the vault

One transaction, once: it writes the vault's public record in the Privacy Rings registry. Your wallet pays the
**0.00116 SOL** rent and the fee; the vault key co-signs in the page.

This transaction is public, and it shows that your wallet registered this vault. That is expected; see
[Privacy guidance](../privacy).

## Step 4. Shield into the vault, then wait

Choose the asset and the amount and confirm the deposit in Phantom. The amount should reach the tier you want:

| tier | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| SOL | 1 | 10 | 100 | 1,000 | 10,000 |
| USDC | 100 | 1,000 | 10,000 | 100,000 | 1,000,000 |

A deposit from your wallet is public: the wallet, the amount and the vault are in the transaction. Only what happens
inside the vault afterwards is private.

**Now wait.** The Verifier refuses notes younger than **150 slots** (about a minute), so a certificate cannot be paired
with the shield that just happened. If you try earlier, the page says **"Your newest note is too fresh to certify."** and
how many slots are left. Waiting longer than the minimum is better for your privacy: the more deposits land in between,
the harder it is to pair yours with your certificate.

## Step 5. Choose the tier and the subject

- **Asset and tier.** The page picks the fewest notes in your vault that reach the tier. If the vault holds too little:
  **"The vault does not hold enough for that tier."** Shield more, or pick a lower tier.
- **Subject**, the thing the certificate is about:
  - **This wallet**: the certificate names your wallet. Simplest; the wallet is public anyway.
  - **An X handle**: the certificate names a handle you control. Follow [Prove an X handle](prove-x-handle) first.
  - **A badge**: a fresh key made for this one certificate, linked to nothing else. Good for one deal with one
    counterparty.

## Step 6. Sign and submit

The page builds the disclosure: the chosen notes, the vault's nullifier key and one statement naming the program, the
subject, the vault, the asset and tier, the payer and a recent slot. The vault key signs the statement in the page; for a
wallet subject Phantom signs it too (one prompt).

The Verifier checks everything against the chain and signs, or explains what is wrong. Then the certificate goes on
chain, which must happen within **300 slots** of the Verifier's signature (the page does it at once):

- **Wallet subject.** Phantom asks you to approve one transaction that submits the certificate and pays the fee and rent.
- **X handle or badge.** The **relayer** submits it, so your wallet appears nowhere in the certificate. The relayer is paid
  from the vault, not from your wallet. If you bought relay credits earlier (a private transfer from the vault), one is
  used and nothing is paid at this moment; otherwise the page pays the quoted fee from the vault now, which sits next to
  the certificate in time. A payment from the vault is a transaction the vault key signs and pays for, so the page first
  sends the vault key a little SOL from your wallet (a public transfer, between two addresses that are already linked).
  Messages you may see:
  - **"No relay credit left."**: buy credits ahead of time, or pay now and accept the timing link.
  - **"The relayer is off right now."**: wait, or confirm that you accept paying from your wallet, which links the
    wallet to this subject in public.
  - **"The relayer reached its spending cap for now."** or **"The relayer is low on SOL."**: try later.

When it lands, the page shows the certificate and its live status.

## Step 7. Back up the kit

The page keeps a **revoke kit** for each certificate: the secrets that let you (or anyone you give them to) prove a
spend and revoke it, and the sealed details of the notes. It lives in this browser. Download the backup file now:

- If your vault was made from a signature, the file holds the kits; the vault itself can always be rebuilt by signing
  the vault message again with the same wallet.
- If your vault key is random (step 2), the file also holds the vault key, locked with a passphrase you choose (at least
  10 characters). **Without this file and passphrase the vault cannot be recovered**, and neither can the funds in it.

Keep the file as carefully as a seed phrase. It does not contain your wallet key.

## After that

- Check your certificate like anyone else would: [Verify someone's proof](verify-a-proof).
- It lasts **216,000 slots** by default (roughly a day). Renew it before then to keep it: [Revoke, renew, move funds](revoke-renew-move).
- Moving the notes behind it ends it. If the subject is a handle or badge, revoke it yourself **first**, then move.
