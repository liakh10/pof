---
title: Gate a Telegram group or a Discord role
order: 4
section: guides
summary: For community admins: let in only people with a live certificate of a tier, and let them out when it dies.
---

# Gate a Telegram group or a Discord role

You run a community and want it open only to people who hold at least a tier, say "≥ 100 SOL", right now. Proof of
Funds gives you three pieces that work together:

- a **Room**: an on-chain rule, "asset SOL, at least tier 3", owned by you;
- the **Telegram bot**, which approves join requests for a group bound to that Room;
- the **Discord bot**, which gives a role to members whose certificate meets the Room, and takes it away when it stops.

Nobody sends you a wallet address or a balance. A member links a subject (a wallet, an `@handle` or a badge) that holds
a certificate, and the bot reads the chain.

## Step 1. Make a Room

On the `/rooms` page, connect your wallet and create a Room: pick the asset, the minimum tier and a short name. Your
wallet pays the Room account's rent; there is no fee and no admin other than you. You can change the tier, the name or
close it to new members later. Copy the **Room address**: the bots need it.

(Developers can create Rooms directly with the `pof_gate` instruction `create_room`; see [Developers](../developers).)

A Room is also an on-chain membership list: certificate holders can `join` it themselves, and anyone can `evict` a
member whose certificate is no longer good enough. The bots do not need that: they read the Room's asset and tier and
check each member's certificate.

## Step 2a. Telegram

1. Add the Proof of Funds bot (its handle is on the site) to your group and make it an **admin** with the permission to
   **invite users via link**. It needs nothing else.
2. In the group, send `/pof_bind <Room address>`. The bot answers `Bound to Room …` with the tier.
3. In the group settings, create an **invite link with "Request admin approval" turned on**, and share that link. People
   who open it send a join request instead of entering directly.
4. Optional: `/pof_evict on` makes the bot remove members whose certificate is revoked or expires (they can request
   again). `/pof_status` shows the binding; `/pof_unbind` stops the bot acting in the group. Only group admins can use
   these commands.

What a member sees: after the join request, the bot sends them a private message with a **Link my certificate** button.
They open it, prove they control their subject (below), and if the certificate is live and meets the Room the request is
approved at once. If not, the bot tells them why, for example `The certificate reads ≥ 10 SOL; this room needs ≥ 100 SOL.`
or `The certificate expired at slot … Renew it to enter.`

## Step 2b. Discord

1. Open the bot's invite link (on the site). It asks only for **Manage Roles**. Pick your server and authorize.
2. In **Server Settings → Roles**, create the role you want to give (for example `Verified ≥ 100 SOL`), and drag the
   bot's own role **above** it: Discord lets a bot hand out only roles below its own.
3. In any channel, run `/pof-setup room:<Room address> role:@Verified ≥ 100 SOL`. You need Manage Roles yourself, and
   the bot refuses a role above your own highest role.
4. Tell members to run `/pof-verify`. The first time, they get a personal **Link my certificate** button; after linking,
   a live certificate that meets the Room gets the role. `/pof-status` shows what they linked; `/pof-unlink` removes it.

## How members prove their subject

The link page asks for one signature, by the key that controls the subject:

| subject | what the member signs with |
|---|---|
| wallet | that wallet |
| badge | the badge key, which the site takes from the member's saved kit |
| `@handle` | the certificate's controller key, which the site rebuilds from the member's vault |

One subject links to one Telegram account and one Discord account at a time. Linking it again moves it, so one
certificate cannot let a whole group in.

## When certificates die

A member's certificate ends when its funds move, when its holder revokes it, or when it expires (216,000 slots by
default unless renewed). After launch the bots re-check gated members on a regular sweep:

- Telegram removes them when `/pof_evict on` is set;
- Discord removes the role.

Before launch that sweep is off: the bots gate new requests, and removal waits for it. Between a spend and its revocation
there can be a short gap ([Trust points](../trust), item 4).

## What you, as the admin, learn

The bots see which subject each Telegram or Discord account linked. You see, through the bot's messages and the chain,
the subject's tier and status. Nobody learns an amount. If your members would rather not tie their Telegram or Discord
account to their wallet, suggest a badge or a handle certificate.
