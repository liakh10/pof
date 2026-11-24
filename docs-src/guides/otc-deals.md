---
title: Require a certificate before a deal
order: 5
section: guides
summary: For OTC desks and counterparties: what to ask for, how to check it, how to tie it to the person you deal with, and how to enforce it on chain.
---

# Require a certificate before a deal

A proof of funds letter before a trade is routine. A POF certificate does the same job on chain: the counterparty shows
that a subject holds at least a tier, live, without showing a statement, a balance or a wallet history.

## 1. Agree what you need

- **Asset and minimum tier.** Tiers are floors: SOL 1, 10, 100, 1,000, 10,000; USDC 100, 1,000, 10,000, 100,000,
  1,000,000. Ask for the tier that covers the deal, not the exact size.
- **The subject.** A wallet, an `@handle`, or a **badge** made for this deal. A badge is the cleanest for one
  counterparty: it is a fresh key linked to nothing else, and it can be revoked when the deal is done.
- **Freshness.** Certificates last 216,000 slots by default and can be renewed. For a large deal, ask for one issued or
  renewed within a window you name, in slots.

## 2. Check it live

```sh
curl -s "https://<site>/v1/certificates/badge:<key>?asset=SOL&minTier=4"
```

Look at `check.ok` and `check.reason`, then at the certificate itself:

- `status` is `live` at `slot`;
- `issuedSlot` is recent enough for you;
- `expirySlot` is after the slot you expect to settle.

From a terminal, reading the chain through your own RPC: `node cli/pof.js check badge:<key> --asset SOL --min-tier 4
--rpc <your RPC>` (exit code 0 means it passes). In code:

```ts
const r = await fetch(`https://<site>/v1/certificates/${encodeURIComponent(subject)}?asset=SOL&minTier=4`).then(r => r.json());
const c = r.certificates.find(c => c.asset === "SOL");
const ok = r.check?.ok && c && r.slot - c.issuedSlot <= MAX_AGE_SLOTS && c.expirySlot > SETTLE_SLOT;
```

## 3. Make sure you are dealing with the holder

A certificate is public. Anyone can send you the address of somebody else's. Ask the counterparty to sign, with the key
shown in the certificate as `controller`, a message you choose: your deal reference and a recent slot. For a wallet
certificate that key is the wallet; for a badge it is the badge key; for a handle it is the certificate's own controller
key (or ask them to post or message from the handle).

```ts
import { ed25519Verify, decodeBase58 } from "@pof/sdk";
const message = new TextEncoder().encode(`deal ${dealRef} at slot ${slot}`);
const valid = await ed25519Verify(decodeBase58(c.controller), message, signatureBytes);
```

## 4. Check again at settlement

A certificate can be revoked between your first check and the trade. Read it again right before you settle, or keep
`node cli/pof.js watch <subject>` running: it prints every status change. If the counterparty moves the certified funds,
the certificate is revoked as soon as the spend is shown, normally by a keeper
([Revocation](../revocation)).

## 5. Enforce it on chain

If the deal runs through your own Solana program (an escrow, an allowlist, an order book), make the program ask `pof`
itself with one CPI:

```rust
pub fn open_deal(ctx: Context<OpenDeal>, subject_hash: [u8; 32], settle_slot: u64) -> Result<()> {
    let a = &ctx.accounts;
    let view = pof::cpi::require_certificate(
        CpiContext::new(a.pof_program.key(), pof::cpi::accounts::RequireCertificate { certificate: a.certificate.to_account_info() }),
        subject_hash, 0 /* SOL */, 4 /* ≥ 1,000 SOL */,
    )?.get();
    require_keys_eq!(view.controller, a.counterparty.key());   // the signer controls the certificate
    require!(view.expiry_slot >= settle_slot, DealError::CertificateEndsBeforeSettlement);
    // ... open the deal
    Ok(())
}
```

`require_certificate` fails unless the certificate is live, unexpired, of that asset and at least that tier. It does not
know who is calling, so always compare `controller` with the signer. A check at open time can go stale: re-check at
settlement, or let anyone close a deal whose certificate died, the way `pof_gate` lets anyone `evict`. The full CPI
reference, the accounts and the SDK helper are in [Developers](../developers).

## What a certificate does not tell you

- **Ownership.** It proves control of the funds' ring, not who owns them ([Trust points](../trust), item 6).
- **The amount or the rest of the balance.** Only that the disclosed notes reach the tier.
- **That the funds will still be there.** It is live until a spend is shown. Check at settlement.
- **Anything about the Verifier's honesty beyond the log.** The Verifier sees the disclosed amounts and signs; its every
  signature is in a public log you can audit ([The transparency log](../transparency-log)).
