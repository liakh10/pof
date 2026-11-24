# Developers

Proof of Funds certificates say that a subject (a Solana wallet, an X handle, or a fresh badge key) holds **at least** a
tier of SOL or USDC in a Helius Privacy Ring. They never carry an amount, and they revoke on chain the moment a disclosed
note is spent. This page is for people who build on them: read a certificate, gate an instruction, gate a community,
or let an agent ask.

Everything here reads public state. The chain is the source of truth; the API, the MCP server and the bots are
conveniences on top of it, and every one of them can be replaced by a direct read with the SDK.

`{{ORIGIN}}` below is this site's address.

| | |
|---|---|
| `pof` program | `pofP4QRRDXnmDN9CNYiAGHfwMEgM7sLWhVcUMpsbynT` |
| `pof_gate` program | `gatSToJMD8ZPLa85fKj6seYHUtYx4ah3ptZvLkisLPU` |
| IDLs | `program/idl/pof.json`, `program/idl/pof_gate.json` in the repository |
| HTTP API | `{{ORIGIN}}/v1`, OpenAPI 3.1 at `{{ORIGIN}}/v1/openapi.json` |
| MCP | `{{ORIGIN}}/mcp` (Streamable HTTP), or `node mcp/stdio.js` |
| SDK | `@pof/sdk`, from `https://github.com/liakh10/pof/raw/main/sdk/release/pof-sdk-0.1.0.tgz` |
| Source | `https://github.com/liakh10/pof` |

## What a certificate is

One account per subject and asset, at the PDA `["cert", subject_hash, [asset]]` of the `pof` program.

| field | meaning |
|---|---|
| `subject_kind`, `subject_hash` | who: 0 wallet, 1 X handle, 2 badge, and `sha256("pof:<kind>:" ‖ value)` (the value is never stored) |
| `asset`, `tier` | 0 SOL or 1 USDC, tier 1 to 5 (table below) |
| `status` | 0 live, 1 revoked because a disclosed note was spent, 2 revoked by its holder |
| `certified_slot`, `issued_slot`, `expiry_slot`, `revoked_slot` | when. Live means `status == 0` and `slot <= expiry_slot` |
| `controller` | the key that can revoke it and join rooms with it: the wallet itself, the badge key itself, or a key the holder's client keeps for an X handle |
| `null_hashes`, `nullset_hash` | salted hashes of the disclosed notes' nullifiers. Anyone holding a salt can call `revoke_spent` once that note is spent |
| `verifier`, `log_index` | the Verifier key that signed, and the attestation's entry in the transparency log |

| asset | id | tier 1 | tier 2 | tier 3 | tier 4 | tier 5 |
|---|---|---|---|---|---|---|
| SOL | 0 | ≥ 1 | ≥ 10 | ≥ 100 | ≥ 1,000 | ≥ 10,000 |
| USDC | 1 | ≥ 100 | ≥ 1,000 | ≥ 10,000 | ≥ 100,000 | ≥ 1,000,000 |

The tables live in the program's `Config` (base units) and can only be extended, never re-meant: a tier issued today
keeps its meaning. `GET /v1/config` shows them.

**Read it as a minimum.** "Tier 4 SOL" means "at least 1,000 SOL in the disclosed notes at the issue slot, and none of them
spent since". It does not say how much more, and it does not say anything about other wallets of the same person.

## HTTP API

Read-only JSON, CORS open (`*`), cached at the edge for 5 to 30 seconds. No key. Errors are
`{ "error": { "code", "message" } }` with 400 (your input), 404 (nothing there), 502 (the RPC or the log did not answer;
retry), 503 (not configured).

| endpoint | what |
|---|---|
| `GET /v1/certificates/{subject}` | every certificate of one subject; `?asset=SOL&minTier=4` adds a yes/no `check` |
| `GET /v1/certificates?asset=&tier=&minTier=&status=&kind=&limit=&cursor=` | list, newest first, paged |
| `GET /v1/rooms` · `GET /v1/rooms/{room}` | pof_gate rooms; one room with its members and whether each still passes |
| `GET /v1/stats` | live, revoked, expired, renewed; certified sums (tier minimums, never amounts); log size |
| `GET /v1/config` | active verifier key, fee, validity, tier tables |
| `GET /v1/log/head` | the signed tree head of the transparency log, its signature check, and the head anchored on chain |
| `GET /v1/log/proof/{id}` | one log entry with its inclusion proof against the current head, verified |

`{subject}` is what a person types: `@handle`, `x:handle`, `wallet:<base58>`, `badge:<base58>`, a bare base58 key (tried
as a wallet and as a badge), or a 64-hex subject hash. No certificate is a `200` with an empty list, so a gate can read
one shape.

```sh
curl -s "{{ORIGIN}}/v1/certificates/@anon?asset=SOL&minTier=4"
```

```json
{
  "query": "@anon",
  "slot": 389120455,
  "subjects": [{ "kind": "x", "value": "anon", "subjectHash": "cedd88c7…739520" }],
  "live": true,
  "certificates": [{
    "address": "95Yo…R1ve", "subject": "anon", "kind": "x", "subjectHash": "cedd88c7…739520",
    "asset": "SOL", "assetId": 0, "tier": 5, "tierLabel": "≥ 10,000 SOL",
    "status": "live", "statusOnChain": "live", "live": true,
    "certifiedSlot": 389101207, "issuedSlot": 389101207, "expirySlot": 395581207, "revokedSlot": null,
    "logIndex": 41, "noteCount": 2, "payer": "Rly…", "controller": "Ctl…", "verifierKey": "Vfr…",
    "renewals": 0, "revealed": null
  }],
  "check": { "asset": "SOL", "minTier": 4, "minTierLabel": "≥ 1,000 SOL", "ok": true, "reason": "ok" }
}
```

`check.reason` is one of `ok`, `no_certificate`, `below_tier`, `revoked_spent`, `revoked_by_holder`, `expired`.
`status` is the status at `slot`: a certificate whose expiry slot has passed reads `expired` even before anyone calls
`expire` (which closes the account and returns its rent). `subject` is `null` in lists, because the chain only holds the
hash.

The full schema, with every field, is the OpenAPI file. Import it into any client generator.

## SDK

```sh
npm install https://github.com/liakh10/pof/raw/main/sdk/release/pof-sdk-0.1.0.tgz
```

TypeScript, ESM with types, **no runtime dependencies** (WebCrypto for SHA-256 and Ed25519, its own base58, PDAs and
Borsh). Node 20+ or a modern browser. It reads the chain through any RPC you give it, so your gate does not depend on us.

```ts
import { PofClient } from "@pof/sdk";

const pof = new PofClient({ rpc: process.env.SOLANA_RPC! });

const r = await pof.checkProofOfFunds({ subject: "@anon", asset: "SOL", minTier: 4 });
if (!r.ok) throw new Error(`no: ${r.reason}`);       // as of r.slot
```

```ts
await pof.lookup("wallet:7Xf…");                       // all certificates of a subject
await pof.listCertificates({ asset: "USDC", minTier: 3, status: "live" });
await pof.getRoomWithMembers(roomAddress);             // members and whether each still passes
await pof.getConfig();                                 // active verifier, fee, tiers
await pof.getTreasury();                               // public counters and the log head anchored on chain
```

Account layouts come from the program's IDL, in one module, so a field the program adds is a regenerated file, not a
code change. `@pof/sdk/testing` exports `MemoryRpc`, an in-memory chain to unit-test your own gate with live, revoked and
expired certificates.

## Gate an instruction: `require_certificate`

Any program can ask `pof` before it does something:

```
pof::require_certificate(subject_hash: [u8; 32], asset: u8, min_tier: u8)
accounts: [certificate]   (the PDA ["cert", subject_hash, [asset]])
returns:  CertView { subject_kind: u8, tier: u8, expiry_slot: u64, controller: Pubkey }
fails:    NotLive · CertificateExpired · TierTooLow · AssetMismatch · BadCertificate
```

It checks the account's owner and PDA, the status, the expiry against the current slot, the asset and the tier. It does
**not** know who is calling: compare `controller` with your signer, or anyone could use anyone's certificate.

```toml
pof = { git = "https://github.com/liakh10/pof", features = ["cpi"] }   # Anchor 1.2
```

```rust
#[derive(Accounts)]
pub struct Enter<'info> {
    pub user: Signer<'info>,
    /// CHECK: pof checks it in the CPI
    pub certificate: UncheckedAccount<'info>,
    pub pof_program: Program<'info, pof::program::Pof>,
}

pub fn enter(ctx: Context<Enter>, subject_hash: [u8; 32]) -> Result<()> {
    let a = &ctx.accounts;
    let view = pof::cpi::require_certificate(
        CpiContext::new(a.pof_program.key(), pof::cpi::accounts::RequireCertificate { certificate: a.certificate.to_account_info() }),
        subject_hash, 0 /* SOL */, 3 /* ≥ 100 SOL */,
    )?.get();
    require_keys_eq!(view.controller, a.user.key());
    Ok(())
}
```

To skip the CPI, `pof::read_certificate(&info, &subject_hash, asset)` and `pof::gate(&cert, asset, min_tier, slot)` apply
the same rule inside your program.

The SDK builds the client side:

```ts
import { requireCertificateAccounts, walletSubject } from "@pof/sdk";
const { subjectHash, certificate } = await requireCertificateAccounts({ subject: walletSubject(user), asset: "SOL", minTier: 3 });
```

**Hold the gate, not the moment.** A certificate checked at join time can be revoked an hour later. If your program keeps
a membership, let anyone re-check it, the way `pof_gate` does with `evict`.

## Rooms: `pof_gate`

`pof_gate` is a small, real program built on `require_certificate`, and the reference for using it.

- `create_room(id, asset, min_tier, name)` makes a Room at `["room", creator, id u64 LE]`.
- `join(subject_hash)`: the certificate's controller signs, the CPI decides, and a Member is written at
  `["member", room, subject_hash]`.
- `evict`: **anyone** can remove a member whose certificate is revoked, expired, below the room's tier, or now has another
  controller. The member's rent goes back to whoever paid it.
- `leave`, `set_room` (tier, open, name), `close_room`.

```ts
import { joinRoomInstruction, toWeb3Instruction, walletSubject } from "@pof/sdk";
const room = await pof.getRoom(roomAddress);
const ix = await joinRoomInstruction({ room: roomAddress, asset: room.asset, subject: walletSubject(me), payer: me, controller: me });
tx.add(toWeb3Instruction(ix, web3));
```

The Telegram and Discord bots read Rooms, so one Room can gate an on-chain action, a chat and a role at once.

## For agents: the MCP server

Ask in plain language: "does @anon hold 1,000 SOL?". Eight read-only tools:

| tool | what |
|---|---|
| `check_proof_of_funds` | yes or no, with the reason; takes `min_tier` or `min_amount` (mapped to the smallest tier that proves it) |
| `get_certificates` | every certificate of a subject |
| `list_certificates` | certificates across subjects, filtered |
| `get_room` · `list_rooms` | pof_gate rooms and their members |
| `get_stats` | the counters |
| `get_log_proof` · `get_log_head` | a log entry with its verified proof; the signed head |

Hosted, nothing to install:

```sh
claude mcp add --transport http proof-of-funds {{ORIGIN}}/mcp
```

Or local over stdio, reading the chain through your own RPC (no server of ours involved):

```json
{
  "mcpServers": {
    "proof-of-funds": {
      "command": "node",
      "args": ["/path/to/pof/mcp/stdio.js"],
      "env": { "SOLANA_RPC": "https://your-rpc" }
    }
  }
}
```

`POF_API={{ORIGIN}}/v1` instead of `SOLANA_RPC` makes the local server read the API. The hosted endpoint is stateless
Streamable HTTP (POST, JSON answers), supports protocol versions 2024-11-05 to 2025-11-25, and has no sessions or keys.
Every answer says the slot it was read at.

## For communities: the bots

**Telegram gate bot.** Add the bot to a group as an admin with "Invite users", then send `/pof_bind <room address>`.
Make an invite link with "Request admin approval". When someone asks to join, the bot approves them if the wallet, handle
or badge they linked holds a live certificate meeting the Room; otherwise it says why. First-time requesters get a
private link to prove control of their subject (a wallet signature, the badge kit, or the site's X-handle check), and
their pending request is approved the moment the link completes. `/pof_evict on` also removes members whose certificate
is revoked or expires (they can ask again after renewing).

**Discord role bot.** Invite it with Manage Roles, put its role above the one it grants, and run
`/pof-setup room:<address> role:@role`. Members run `/pof-verify`. The role is granted while the certificate passes and
removed when it stops (on `/pof-verify` and by a periodic re-check).

One subject links to one account per platform: linking it from a second account moves it, so a certificate cannot be
passed around a group. Links are signed by the holder; the bots never see keys or amounts.

## Verify the transparency log yourself

Every attestation the Verifier signs is appended to a public Merkle log (RFC 9162 hashing). A leaf is 377 bytes:
`0x01 ‖ the 240 attestation bytes ‖ signature ‖ verifier key ‖ bundle hash ‖ logged slot`. It holds no amounts, no
openings, no nullifiers and no salts. The Verifier signs each tree head (`"POF-STH1" ‖ program id ‖ size ‖ root`), and
heads are anchored on chain in the Treasury by `anchor_log`.

```ts
import { verifyLogEntry, verifyConsistency } from "@pof/sdk";

const base = "{{ORIGIN}}/api/attest/log";
const head  = await (await fetch(`${base}?head`)).json();
const entry = await (await fetch(`${base}?entry=${cert.logIndex}`)).json();
const proof = await (await fetch(`${base}?proof=${cert.logIndex}&size=${head.treeSize}`)).json();
const v = await verifyLogEntry({ leaf: entry.leaf, index: cert.logIndex, proof, head, programId: "pofP4QRRDXnmDN9CNYiAGHfwMEgM7sLWhVcUMpsbynT" });
// v.ok, v.checks = { leafParses, attestationSigned, included, headSigned, programMatches }
```

Then tie the head to the chain: `(await pof.getTreasury()).log` is the last anchored `{ treeSize, rootHash, slot }`, and
`GET {{ORIGIN}}/api/attest/log?consistency=<anchored size>&size=<head size>` with `verifyConsistency` proves the current
head extends it. `GET /v1/log/head` does these checks for you and reports them; you should still be able to run them
without us, and you can.

## Limits and honesty

- Live means live **as of a slot**. Every answer carries it. For anything that matters, read at `confirmed` or later.
- A certificate is about the notes disclosed to the Verifier, at the issue slot. The Verifier saw those notes' amounts
  and kept none of them; see the security notes in /docs for what it learns and what it cannot do.
- Expired certificates are closed by anyone calling `expire`. Until then they read `expired`, never `live`.
- `listCertificates` and `GET /v1/certificates` use `getProgramAccounts`. Public RPCs may refuse it; the per-subject
  lookup does not need it.
