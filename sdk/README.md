# @pof/sdk

TypeScript SDK for **Proof of Funds** on Solana. It reads certificates straight from chain, hashes subjects, verifies the
Verifier's transparency log, and builds the accounts for gating your own program with a certificate.

- **No runtime dependencies.** SHA-256 and Ed25519 come from WebCrypto; base58, PDAs and Borsh are built in. It works in
  Node 20+ and in modern browsers.
- **No API needed.** Point it at any Solana RPC. The hosted `/v1` API is a convenience; it is not a trust point.
- **Layouts come from the program's IDL.** Account decoding lives in one module (`accounts.ts`). The IDLs in
  `src/idl/` are generated from `program/idl/*.json` by `npm run sync-idl`.
- ESM with types. Programs: `pof` = `pofP4QRRDXnmDN9CNYiAGHfwMEgM7sLWhVcUMpsbynT`,
  `pof_gate` = `gatSToJMD8ZPLa85fKj6seYHUtYx4ah3ptZvLkisLPU`.

> **Pin POF's program id.** A certificate is only a certificate if the account is owned by the pof program
> `pofP4QRRDXnmDN9CNYiAGHfwMEgM7sLWhVcUMpsbynT`, at its PDA, and the Config you check it against is pof's own
> `["config"]` PDA. Anyone can deploy a program that writes accounts with the same layout. A reader or a gate that does
> not pin the program id accepts a fake POF.
> - **On chain:** take the pof program as `Program<'info, pof::program::Pof>` (Anchor checks its id), never an
>   `UncheckedAccount` you CPI into; `require_certificate` checks the certificate's PDA and owner and the Config's seeds.
>   Without the CPI, `pof::read_certificate` checks the owner and the PDA, and you must check the Config's PDA yourself.
> - **Off chain:** `@pof/sdk` pins the id by default: `PofClient`, `requireCertificateAccounts`, `joinRoomInstruction` and
>   `evictMemberInstruction` refuse another program id unless you pass `allowOtherDeployment: true` (for your own test
>   deployment only), and an account owned by any other program never reads as a certificate. If you read accounts with
>   other code, check `owner == pofP4QR…` and the PDA every time.

## Install

The package is not on npm. Install the release tarball from the repository:

```sh
npm install https://github.com/liakh10/pof/raw/main/sdk/release/pof-sdk-0.3.2.tgz
```

## Check a subject in three lines

```ts
import { PofClient } from "@pof/sdk";

const pof = new PofClient({ rpc: "https://api.mainnet-beta.solana.com" }); // any RPC; use your own for production

const r = await pof.checkProofOfFunds({ subject: "@anon", asset: "SOL", minTier: 4 });
// { ok: true, reason: "ok", slot, certificate: { tierLabel: "≥ 1,000 SOL", expirySlot, controller, ... } }
```

`subject` is what a person types: `@handle`, `x:handle`, `wallet:<base58>`, `badge:<base58>`, a bare key (tried as a
wallet and as a badge), or a 64-hex subject hash. `reason` is one of `ok`, `no_certificate`, `below_tier`, `voided`, `settling`,
`revoked_spent`, `revoked_by_holder`, `expired`.

A certificate proves a **minimum**, never an amount. Tier 4 SOL means "holds at least 1,000 SOL" and nothing more.

| asset | id | tier 1 | tier 2 | tier 3 | tier 4 | tier 5 |
|---|---|---|---|---|---|---|
| SOL | 0 | ≥ 1 | ≥ 10 | ≥ 100 | ≥ 1,000 | ≥ 10,000 |
| USDC | 1 | ≥ 100 | ≥ 1,000 | ≥ 10,000 | ≥ 100,000 | ≥ 1,000,000 |

## Read more

```ts
// every certificate of a subject (one per asset), with the status as of the slot read
const { slot, certificates } = await pof.lookup("wallet:7Xf…");
for (const c of certificates) console.log(c.assetSymbol, c.tierLabel, c.effectiveStatus, c.expirySlot);

// all live certificates of a tier (getProgramAccounts with memcmp filters: use an RPC that allows it)
const { certificates: whales } = await pof.listCertificates({ asset: "SOL", minTier: 4, status: "live" });

// a pof_gate Room with its members and whether each one still passes
const room = await pof.getRoomWithMembers("<room address>");

// the program's Config (active verifier key, fee, tier tables) and the Treasury counters
const config = await pof.getConfig();
const stats = await pof.stats(); // live, revokedSpent, revokedByHolder, expired, per-asset tier minimums
```

`effectiveStatus` follows the program's own rule: live means the status byte is live and `slot <= expiry_slot`. A live
byte past its expiry reads `expired` before anyone calls `expire`.

## The zk path (optional)

The launch build has no zk instructions; the SDK decodes with the launch IDL. The zk build's IDL ships as `POF_ZK_IDL`.
`await pof.getZkConfig()` decodes the zk config account (null when it does not exist), and `await pof.zkEnabled()` is true
only when it is enabled at the current slot, past its activation delay. zk certificates read `settling` until their settle
slot.

## Subject hashes (CONTRACT §1)

```ts
import { subjectHashHex, walletSubject, xSubject, badgeSubject } from "@pof/sdk";

await subjectHashHex(walletSubject("7Xf…"));  // sha256("pof:wallet:" + base58)
await subjectHashHex(xSubject("@Anon"));      // sha256("pof:x:anon")  (lowercase, no @)
await subjectHashHex(badgeSubject("Bdg…"));   // sha256("pof:badge:" + base58)
```

The chain never stores a handle or a wallet in clear for a certificate, only this hash.

## Gate your program with a certificate (CPI)

On chain, call `pof::require_certificate(subject_hash, asset, min_tier)`. It fails unless the certificate is live,
unexpired, of that asset and at least that tier, and it returns `CertView { subject_kind, tier, expiry_slot, controller }`.
Compare `controller` with your signer, so only the holder can use their certificate.

```toml
# Cargo.toml (Anchor 1.2)
pof = { git = "https://github.com/liakh10/pof", features = ["cpi"] }
```

```rust
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct Enter<'info> {
    pub user: Signer<'info>,
    /// CHECK: pof checks it in the CPI (owner, PDA, status, expiry, asset, tier)
    pub certificate: UncheckedAccount<'info>,
    /// CHECK: the pof Config (its PDA is checked in the CPI); it holds the revoked verifier keys
    pub pof_config: UncheckedAccount<'info>,
    pub pof_program: Program<'info, pof::program::Pof>,
}

pub fn enter(ctx: Context<Enter>, subject_hash: [u8; 32]) -> Result<()> {
    let a = &ctx.accounts;
    let view = pof::cpi::require_certificate(
        CpiContext::new(a.pof_program.key(), pof::cpi::accounts::RequireCertificate { certificate: a.certificate.to_account_info(), config: a.pof_config.to_account_info() }),
        subject_hash,
        0, // SOL
        3, // at least 100 SOL
    )?
    .get();
    require_keys_eq!(view.controller, a.user.key());
    Ok(())
}
```

Without a CPI, `pof::read_certificate(&info, &subject_hash, asset)` plus `pof::gate(&cert, &config, asset, min_tier, slot)`
do the same check in your own program (read the Config from its PDA `["config"]` under the pof program).

A certificate is dead for the gate when it is revoked (status 1 or 2), voided (status 4, or signed by a verifier key the
Config lists in `revoked_keys`, before anyone calls `void_by_key`), expired, or a zk certificate before its settle slot.
The SDK reads all of these the same way: `effectiveStatus` is `live`, `revoked_spent`, `revoked_by_holder`, `expired`,
`voided` or `settling`.

On the client, the SDK gives you the accounts and the subject hash:

```ts
import { requireCertificateAccounts, walletSubject } from "@pof/sdk";

const r = await requireCertificateAccounts({ subject: walletSubject(user), asset: "SOL", minTier: 3 });
// r.subjectHash: the [u8; 32] arg for your instruction
// r.certificate: the account for `certificate`; r.accounts ends with the pof program
```

## Join a pof_gate Room

`pof_gate` is the reference consumer: Rooms that admit a subject only through `require_certificate`. Anyone can `evict`
a member whose certificate stopped passing.

```ts
import { PofClient, joinRoomInstruction, toWeb3Instruction, walletSubject } from "@pof/sdk";
import * as web3 from "@solana/web3.js";

const room = await pof.getRoom(roomAddress);
const ix = await joinRoomInstruction({
  room: roomAddress,
  asset: room.asset,
  subject: walletSubject(wallet.publicKey),
  payer: wallet.publicKey,          // pays the Member rent
  controller: wallet.publicKey,     // the certificate's controller signs (for an @handle: the key the holder's client keeps)
});
const tx = new web3.Transaction().add(toWeb3Instruction(ix, web3));
```

`toWeb3Instruction` takes the web3.js classes you already have, so the SDK does not pull web3.js in. With
`@solana/kit`, use `ix.programId`, `ix.keys` and `ix.data` directly.

## Verify the transparency log (CONTRACT §7)

Every attestation the Verifier signs is a leaf of an append-only RFC 9162 Merkle log. Check an entry yourself. The
verifier keys you trust must come **from the chain** (the Config and its `VerifierSet` history), never from the log:
`verifyLogEntry` and `auditLog` fail without them.

```ts
import { PofClient, LogReader, verifyLogEntry, matchCertificateLeaf } from "@pof/sdk";

const pof = new PofClient({ rpc });
const trustedKeys = (await pof.verifierKeys({ history: true })).all;   // Config + every key a VerifierSet event named

const log = new LogReader("https://<site>/api/attest/log");
const head = await log.head();
const entry = await log.entry(i);
const proof = await log.proof(i, head.treeSize);

const v = await verifyLogEntry({ leaf: entry.leaf, index: i, proof, head, programId: pof.programId, trustedKeys });
// v.ok, and v.checks: { leafParses, attestationSigned, keyTrusted, included, headSigned, programMatches }
// v.leaf.attestation: the parsed 240 bytes (subject hash, asset, tier, slots, payer, controller); never an amount

// a certificate's log_index is the submitter's word: tie the certificate to the leaf by its signed bytes
const cert = await pof.getCertificate(subject, "SOL");
matchCertificateLeaf(cert, v.leaf); // { matches, mismatched: [] }
```

Audit the whole log in one call: download every entry, recompute the root, check every signature and the head
anchored on chain in the Treasury:

```ts
import { auditLog } from "@pof/sdk";
const t = await pof.getTreasury();
const r = await auditLog({ reader: log, programId: pof.programId, trustedKeys, anchor: t?.log });
// r.ok, r.checks: { headSigned, rootRecomputed, entriesSigned, entriesBad, anchorMatches, programMatches }
```

Also exported: `leafHash`, `merkleRoot`, `inclusionPath`, `verifyInclusion`, `consistencyProof`, `verifyConsistency`,
`treeHeadMessage`, `verifyTreeHead`, `parseLeaf`, `parseAttestation`, and the witness cosignature pair
`cosignMessage` / `verifyCosignature` (CONTRACT §8).

## Test your own gate

```ts
import { PofClient, walletSubject } from "@pof/sdk";
import { MemoryRpc } from "@pof/sdk/testing";

const rpc = new MemoryRpc();
rpc.slot = 5000;
await rpc.putCertificate({ subject: walletSubject(alice), asset: 0, tier: 4, expirySlot: 9000 });
await rpc.putCertificate({ subject: walletSubject(bob), asset: 0, tier: 4, status: 1, revokedSlot: 4800 }); // revoked: funds moved
const pof = new PofClient({ rpc });
```

## Develop

```sh
npm ci
npm test              # unit tests (subjects, PDAs against web3.js, Borsh, RFC 9162 vectors, client on MemoryRpc)
npm run test:local    # starts a local validator with this build of pof and pof_gate and runs the integration suite
npm run sync-idl      # after the program's IDL changes
npm run pack          # writes release/pof-sdk-<version>.tgz
```

Apache-2.0.
