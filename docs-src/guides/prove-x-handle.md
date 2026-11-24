---
title: Prove an X handle
order: 2
section: guides
summary: Link a handle you control to a certificate with one public post, and what that does and does not reveal.
---

# Prove an X handle

A certificate for an X handle says "@handle holds at least this tier". To get one, you show once that you control the
handle, by posting a short code from it. This guide is step 5 of
[Get your first certificate](first-certificate) when you pick **An X handle** as the subject.

## Before you start

- The account must be **public** while you link it: the check reads the post through a public reader.
- Have your vault ready (steps 1 to 4 of the first guide). The handle's certificate gets its own key, the
  **controller**, which the page rebuilds from your vault. It is the key that can later revoke the certificate and join
  Rooms with it.
- Use the same browser tab from start to finish: the page keeps a private secret for this link in the tab.

## Step 1. Ask for a code

Type the handle without the `@` (1 to 15 letters, digits or underscores; otherwise **"That is not an X handle."**).
The page asks the server for a one-time code and gets back two things:

- the **code**, `pof-` followed by 8 letters and digits, which you will post: it is public from that moment;
- a **secret**, which stays in your tab. Only the holder of the secret can turn the code into a link, so someone who
  reads your post first cannot use it.

The code lives **30 minutes**. Asking again does not cancel the first one.

## Step 2. Post it

Post this text from the handle, exactly as the page shows it:

```
Linking @yourhandle to Proof of Funds: pof-xxxxxxxx
```

A reply works too, as long as it comes from the handle and contains the code.

## Step 3. Check

Paste the link to the post (`x.com/yourhandle/status/…`) and press check. The server reads the post and checks that the
author is the handle, that the post contains your code, and that it is not older than the code. Then it returns a
**link**: the Verifier's signature over the handle, your controller key and an expiry one hour ahead.

You can delete the post now. The link does not depend on it.

What you may see:

| message | what to do |
|---|---|
| that post could not be read: is it public, and is the account public? | make the account public for a moment, or wait for the post to appear, then check again |
| that post is not from @yourhandle | post from the handle itself, not from another account |
| the post does not contain the current code | copy the code from the page again; an older code does not count |
| that post is older than the code | make a new post after asking for the code |
| too many wrong tries for this code: start again | after 5 failed checks the code is burnt; ask for a new one |
| **"X did not answer the handle check."** | the public reader is down for a moment; try again |
| **"The X link expired."** | the link lasts one hour; post a fresh code and link again |

## Step 4. Certify

Continue with step 6 of the first guide. For a handle, the controller key also signs the disclosure statement in the
page, so a link that leaked to someone else cannot certify the handle with their funds. An X certificate is always submitted by the relayer and paid from your vault,
so no wallet appears in it.

## What this reveals

- **On chain**, the certificate stores only `sha256("pof:x:" ‖ handle)`. Anyone can hash a handle and compare, so the
  certificate is public for that handle, but the chain does not hold the name itself.
- **Your post** is public for as long as you leave it up, and archives may keep it.
- **The Verifier** learns the handle, your vault and its funding. See [Trust points](../trust), item 1.
- **The handle check trusts X**: if the account is taken over, whoever controls it can link it. See
  [Trust points](../trust), item 5.
- Nothing on chain ties the handle to your wallet, except what [Privacy guidance](../privacy) lists: timing, deposit
  amounts and payments next to the certificate, and a revocation by spend. To move the funds, revoke first.

## Using the handle with the bots

The Telegram and Discord bots accept a handle certificate too. When the link page asks you to prove the handle, it asks
for a signature by the certificate's **controller** key, which the site rebuilds from your vault. See
[Gate a community](gate-a-community).
