# RINGS.md: the hard facts about Helius Privacy Rings for POF

Owner: `rings`. Every fact below was checked against the SDK sources (`@heliuslabs/spr` 0.9.0-alpha, `dist/`) and, where it
says **[mainnet read]**, against read-only mainnet RPC or the Helius Rings indexer on 2026-11-25 (slot ~473,505,000). No
transaction was sent. Scripts that produced the reads: `client/tools/facts/*.mjs` (rerunnable, they never print a key).

Short answers first:
- A note commitment can be recomputed from its opening; the formula reproduces real mainnet deposit leaves. **[mainnet read]**
- A spent nullifier shows on chain as a **PDA `["nullifier", tree, nf]` owned by the Rings program** (11 bytes, first byte 8).
  None has ever been closed. After a batch it can *also* be proven by an indexed-tree membership path (40 Poseidon hashes).
- The nullifier **cannot** be checked from the opening alone. The verifier needs the wallet's nullifier secret `nk`.
  That is the biggest trust point of v1 (section 5).
- Devnet has the same programs and tree address. The Helius indexer and prover answer on both networks through
  `https://<net>.helius-rpc.com/v1/spr` with a key. Local tests use a cloned validator and our own tree reconstruction;
  devnet tests run the full stack, real spends included (section 8).

## 1. Program ids and accounts (mainnet = devnet, same addresses)

| what | address | notes |
|---|---|---|
| Solana Privacy Program (SPP, "the pool") | `ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW` | upgradeable |
| User Registry | `regy3WAeRXMYuMYxr5iK3Bf9Arr3PcxGxyzAddbiqDQ` | upgradeable |
| tree 0 (the only tree) | `777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor` | PDA `["tree", u16 LE 0]` under SPP, 40,080 bytes |
| protocol config | `EienwBSpsbAetT3RAAMzVA9rB5RHgCF7yTH7FFST6AK5` | `nextTreeId = 1`, tree creation and ring activation are permissioned |
| SOL interface (the SOL vault) | `CiNmas621VuyofiDSrEPfTXHKrdZuB6jMKECyNiMpLXE` | system account, held 3,202 SOL **[mainnet read]** |
| SPP CPI authority | `CaM8DbtJ2mSecgaHYo9xeT7VSKq7AnaqEUm5p7e5LW4a` | `getShieldedPoolCpiAuthorityAddress()` |
| USDC asset registry | `J85i28ZES8pHqDa21YsmLSbUh2FR56c9WW5GCfQXUeHB` | PDA `["spl_asset_registry", mint]`; mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, asset id 3 **[mainnet read]** |
| USDC vault | PDA `["spl_asset_vault", mint]` under SPP | `splInterfaceWithBump(mint)` |

- SOL is asset id 1 with the pseudo-mint `11111111111111111111111111111111` (`SOL_MINT`). 474 SPL assets are registered;
  USDT id 19, JUP id 12, JitoSOL id 28. SPL interface creation is permissionless. **[mainnet read]**
- 6,823 wallets have a User Registry record (2026-11-25). **[mainnet read]**
- Instruction tags (first data byte to SPP): deposit 15, transact 16, mergeTransact 17, ringDeposit 18, ringTransact 19,
  batchUpdateNullifierTree 12, closeNullifierPdas 13 (`interface/program.js`).

### The tree account (tree 0), byte offsets (pinned in `interface/state.js`, checked against mainnet)
| offset | size | field |
|---|---|---|
| 0 | 1 | discriminator = 1 |
| 2 | 2 | tree id (u16 LE) |
| 8 | 24 | fee schedule: fee per nullifier 5,000 · append reimbursement 5,000 · close reimbursement 88 lamports **[mainnet read]** |
| 32 | 8 | fee balance |
| 40 | 8 | nullifier input-queue count (55,352 at the read; = number of nullifier PDAs ever made) |
| 72 | 8 | **next leaf index** of the state tree (64,160 at the read) |
| 80 | 32 | **current state root** |
| 112 | 2 | state root history cursor (index of the current root) |
| 114 | 2 | history length (500 when full) |
| 116 | 2 | history capacity (500) |
| 118 | 1 | subtrees length (32) |
| 120 | 8 | **slot of the last state-tree update** (equals the indexer's `rootSeq`) |
| 128 | 1,024 | **frontier**: 32 filled subtrees (lets anyone compute proofs for leaves appended later; verified: frontier + next index reproduces the root) |
| 1,152 | 16,000 | **state root history**: 500 × 32 bytes (one root per slot that updated the tree) |
| 17,224 | 8 | nullifier root history cursor (u64 LE; current = cursor − 1 mod 100) |
| 17,232 | 3,200 | **nullifier root history**: 100 × 32 bytes |

- State tree: height 32, node = `Poseidon(left, right)`, leaf = the note commitment, empty leaf = 32 zero bytes.
- The state root history holds the last 500 tree-updating slots. At today's traffic (about one Rings transaction a minute)
  that is roughly 8 hours. **[mainnet read: 20 tree transactions over 2,825 slots]**
- Read the head with `decodeTreeHeadRoots(data)` from `@heliuslabs/spr/interface`; the slot is the u64 at 120.

## 2. How a note commitment is formed
All Poseidon here is BN254, circom-compatible, inputs as 32-byte big-endian field elements (`hasher/index.js`).
`hashBytes(b)` packs bytes into 31-byte chunks right-aligned in 32 and folds `Poseidon(acc, chunk)`.

```
ownerHash   = Poseidon( solanaOwnerIdentity(ownerPubkey), npk )
              solanaOwnerIdentity(k) = hashBytes( 0x53 ‖ k )          (k = the owner's Ed25519 public key, 32 bytes)
              npk = Poseidon( rightAlign(nk) )                       (nk = the 31-byte nullifier secret)
commitment  = Poseidon( 3,                                           (UTXO_DOMAIN, right-aligned)
                        treeId,                                      (u16 right-aligned; 0)
                        hashBytes(assetMint32),                      (SOL: the all-zero pubkey 1111…1111)
                        amount,                                      (u64 big-endian, right-aligned)
                        dataHash or 0,
                        Poseidon( ringDataHash or 0, ringProgramId ? hashBytes(ringProgramId) : 0 ),
                        Poseidon( ownerHash, blinding ) )
```
- **Deposit notes** (the proofless `deposit`, tag 15): `blinding = 0x00 ‖ sha256("Deposit" ‖ tree ‖ u64 BE leafIndex)[1..32]`
  (`depositBlinding`). The deposit's instruction data is public: view tag, `recipientOwnerHash`, amount, asset, optional memo.
  **Verified on mainnet:** three SOL deposits from public data alone reproduced their leaf hashes exactly. **[mainnet read]**
- **Transfer outputs** (change, received private transfers): blinding from a random per-transaction seed, readable only by
  decrypting the note (viewing key).
- **Merge outputs**: `blinding = Poseidon("TMOB", nk, firstNullifier)`; the ciphertext key is `Poseidon("TMOK", nk, firstNullifier)`.
- The SDK's `Utxo.hash(npk, treeId, dataHash, ringDataHash)` computes the same value (`transaction/utxo.js`).

**The opening** the verifier needs per note (the TBD(rings) of CONTRACT §4):
`{ tree, leafIndex, asset (mint base58), amount (u64 decimal string), blinding (hex 32), dataHash? (hex 32), ringDataHash? (hex 32), ringProgramId? (base58) }`,
plus once per package the ring's `owner` (base58 Ed25519 public key) and `nk` (hex 31). Default-ring notes have no data and no
ring fields; the client sends them only when present.

## 3. How a nullifier is formed, and how a spent one shows on chain
```
nullifier = Poseidon( commitment, blinding, rightAlign(nk) )            (keypair/nullifier-key.js)
```
- **A spend creates a PDA** `["nullifier", tree, nullifier]` under SPP (`interface/pda`, `nullifierPdaAccounts` in every
  transact). Its data is 11 bytes: `0x08 ‖ u64 LE queue index ‖ 0x0000`; rent 706,120 lamports, paid by the spender.
  **[mainnet read: 55,348 such PDAs, queue indexes 1…55,348 with no gap; none has been closed since launch]**
- The nullifier also enters the **nullifier tree** (an indexed Merkle tree, height 40) in batches of 4,999 by a forester
  (`batchUpdateNullifierTree`). After that, `closeNullifierPdas` (tag 13) *may* close the PDA. It has never happened on
  mainnet so far (the nullifier root has advanced 11 batches while every PDA stayed open), but the program must not
  rely on that forever.
- **Proving "spent" after the PDA is gone (verified on mainnet):** indexed-tree leaf = `Poseidon(value, nextValue)`, node =
  `Poseidon(left, right)`, 40 levels. The Helius indexer has no membership call, but a **non-inclusion proof for `nf + 1`**
  returns `lowElement = nf` with its path. That path reproduced the current nullifier root, and that root was in the
  on-chain nullifier root history at index 11. **[mainnet read]**
- **On chain within CU:** 41 two-input `sol_poseidon` calls at about 61·2² + 542 = 786 CU each, so about 32k CU plus
  overhead. Instruction data: 40 × 32 path + 32 next value + 8 index = 1,320 bytes. That does not fit a legacy transaction
  (1,232) but fits a **version 1 transaction** (4,096 bytes, which mainnet already accepts: the Rings SDK sends only v1, and
  the registration we read was v1 **[mainnet read]**). The other way is to write the path into a buffer account first.
- **Recommended `revoke_spent` check** (for CONTRACT §5, proposed text below): (a) the PDA path: the account at
  `find_program_address(["nullifier", tree, nf], SPP)` exists, is owned by SPP, is 11 bytes and starts with 8. Or (b) the tree
  path: a 40-level membership proof of `nf` whose root is one of the 100 roots at offset 17,232 of the tree account
  (owner SPP, discriminator 1). v1 of the program can ship (a) only, plus a dated note that (b) is the upgrade if Helius
  starts closing PDAs. The keeper revokes within seconds of a spend, and a PDA lives at least until its batch (4,999
  nullifiers) is inserted.
- **Checking "unspent" (verifier):** the PDA is absent (`getAccountInfo` = null), **and** the indexer's
  `getNonInclusionProofs(tree, [nf])` returns a proof whose path reproduces a root in the on-chain nullifier history. A
  spent or queued nullifier makes the indexer refuse: `Nullifier leaf … is already used or queued`. **[mainnet read]**

## 4. Reading the root and its slot
- One RPC read of the tree account (`getAccountInfo`, `confirmed`): current root at offset 80, its slot at 120, the
  500-root history at 1,152. `context.slot` is the read slot.
- A note is in the tree at root R if the indexer's `getMerkleProofs(tree, [commitment])` path (32 levels) hashes to R and
  R is in the on-chain history. Verified: the proof of leaf 57,233 hashed to the root at history index 97. **[mainnet read]**
- **For CONTRACT §3: one root.** Every note must be in tree 0 today (there is only one tree; `nextTreeId = 1`). Sign the
  **state root** and the slot read at offset 120 (`root_slot`). If a second tree ever appears, add the tree id to the bytes then.
  The program can cheaply check at `certify` that `tree_root` is still in the 500-root history (one 40 KB account read). That
  check is optional: the signature already binds it.

## 5. The nullifier secret `nk`: what the verifier must get and what it exposes (answer to the verifier)
**Confirmed:** the nullifier cannot be recomputed without `nk`, and nothing public binds a claimed nullifier to a commitment.
If the client only sent nullifiers, a cheater could send random 32 bytes; they would never show as spent, and the
certificate would never die. **So the §4 package must carry `nk`.** The verifier then checks
`Poseidon(rightAlign(nk)) == npk`, with `npk` taken from the owner's registry record when one exists, and recomputes `ownerHash`,
every commitment and every nullifier itself.

What `nk` (31 bytes, HKDF from the wallet's derivation signature, info `TSPP/nf_key/ed25519/v1`) lets its holder do:
- **Cannot spend.** Every spend is a Solana transaction signed by the owner's Ed25519 key (`ownerSigners` in
  `transactInstruction`). A Groth16 proof with `nk` alone moves nothing.
- **Cannot decrypt transfer notes.** The viewing key is a separate HKDF output (`TSPP/view_key/...`) from the same seed.
- **Can compute the nullifier of every deposit note of that ring and watch when each one is spent.** A deposit's
  blinding is public (from tree and leaf index), and its owner hash and amount are in public instruction data. So, with
  `nk`, someone can list every deposit into the wallet (they are public anyway) and learn *when* each of them is
  later spent. **This is a privacy trust point: document it.**
- **Can decrypt merge outputs and follow them.** The merge blinding and the merge ciphertext key are both
  `Poseidon(…, nk, firstNullifier)`, and `firstNullifier` is public. So the holder of `nk` reads the amount of every merge
  output of that ring and can compute its nullifier. When the wallet merges, its consolidated balances become readable.
- **Cannot follow transfer outputs** (random blinding seed), unless they also hold the opening.
- `nk` **never rotates** (the README says it outright: a wallet with another nullifier key must register under a new
  owner). Once leaked, it stays leaked for that ring.

**Rules that follow (proposed to verifier and devx):**
1. The verifier uses `nk` only in memory for one request, never logs it and never gives it to the keeper. The keeper
   needs only `(salt, nullifier)` per disclosed note.
2. **Vault mode in the client** (default for handle and badge subjects, optional for wallets): `pof-client` derives a
   separate POF vault identity from one more wallet signature (Ed25519 seed = `sha256(sig("pof/vault/v1"))`, so it is
   recoverable from the wallet alone) and shields into the vault. Only the vault's `nk` is ever disclosed; the main ring
   is never touched.
3. /docs trust point (proposed words): "To prove your notes are unspent, the Verifier must see the nullifier key of the
   ring you certify from. With it, the Verifier could see when your deposits into that ring are spent and read the amounts
   of its merge outputs. It cannot move or decrypt anything else. POF certifies from a separate vault ring for this reason,
   and the Verifier keeps no key."

## 6. Registering a Ring from the browser (Phantom)
- The shielded keys come from **one Ed25519 signature** over a fixed **Solana off-chain message v0** (85 + 14 bytes):
  `\xffsolana offchain` ‖ version 0 ‖ application domain `sha256("TSPP/derive/v1")` ‖ format 0 ‖ signer count 1 ‖ signer
  pubkey ‖ u16 LE length 14 ‖ `"TSPP/derive/v1"` (`ed25519DerivationMessage(pubkey)` in `@heliuslabs/spr/keypair`). The
  64-byte signature is the seed. HKDF-Extract it, then expand to `nk` (31 bytes) and the X25519 viewing secret. The wallet
  must sign **these exact bytes**: bare `TSPP/derive/v1`, or a wallet that wraps the message in its own envelope, gives
  another identity and is refused by `LocalKeys.fromDerivationSeed`.
- **Phantom:** `signMessage(bytes)` signs raw bytes. Whether Phantom accepts a message that starts with the off-chain
  header `0xff "solana offchain"` cannot be proven without the owner's Phantom. It is a signature, not a transaction, and costs
  nothing; the owner step is in `_x/pof/OWNER-STEPS.md` (the /lab "derive" button). Ledger-backed Phantom accounts may
  refuse off-chain messages; vault mode then still works, because its seed signature is a plain UTF-8 message.
- The signature **is secret key material** (`nk` + viewing key). Any page that gets the user to sign that exact message
  learns them. The client never sends it anywhere and wipes it after derivation.
- **Registration transaction:** User Registry ix 0 (`REGISTER`) with `npk` (32) and the X25519 viewing public key (33);
  record PDA `["zolana/registry/v0", owner]`, 100 bytes. **Rent 0.00115824 SOL** (mainnet `getMinimumBalanceForRentExemption(100)`)
  plus the transaction fee; one observed registration paid 90,959 lamports in fees (priority included), 6,110 CU, version 1
  transaction **[mainnet read]**. The owner signs; a sponsor can pay rent and fee as `payer` (two signatures).
- A deposit **does not** need a registry record: the depositor names the recipient's owner hash directly. The record matters
  for receiving private transfers, and for the verifier to look up `npk` by wallet.
- **Shield (deposit) fees:** one signature fee, plus CU around 200k by default (`DEFAULT_COMPUTE_UNIT_LIMIT`). There is no
  per-deposit pool fee in the tree schedule; the 5,000 lamports "per nullifier" applies to spends, and every spend also
  pays the 706,120-lamport nullifier PDA rent. USDC deposits need the depositor's USDC token account.
- **A deposit from a public balance is public:** its view tag is the recipient's own wallet address (we decoded live
  deposits: view tag = wallet), and its amount and owner hash are in the data. Only what follows the deposit is private.

## 7. What "holds ≥ X" means when proven from openings (plus `nk`)
Proven, at the slot of the root read:
- every disclosed note is a leaf of the Rings state tree under a root that is in the on-chain history;
- each note's owner is the ring whose `nk` was shown, and its asset and amount are exactly as opened (sum ≥ tier);
- none of their nullifiers was spent (PDA absent, and the indexer's non-inclusion path matches an on-chain nullifier root);
- afterwards: the moment one is spent, its PDA appears, and `revoke_spent` can prove it publicly.

Not proven:
- **That the money is the subject's own.** Openings plus `nk` show *control of a ring*, not ownership. Borrowed funds count
  ("rent a whale"). For a wallet subject, the verifier must also require that the ring owner is the wallet, or that the
  wallet signed a statement naming the vault.
- **That the same notes are not behind another live certificate.** Without a check, one whale certifies a hundred
  handles. Proposal for verifier: keep a keyed index `HMAC(k_verifier, nf)` of the notes behind live certificates (no
  amounts) and refuse a second live certificate on the same note and asset.
- **The total balance.** Only the disclosed notes are seen; the rest of the ring stays private.
- **Any history** (how long it was held). The note's leaf index gives a lower bound on its age; a "minimum note age"
  can be enforced by comparing the leaf index with the tree's leaf count at a past slot, or simpler, by the deposit's slot
  from the indexer (`getShieldedTransactionsBySignature`).
- **Privacy after revocation:** a spend is signed by the ring owner's key, so a revealed nullifier links the certificate to
  that owner address. For handle and badge subjects this links the handle to the vault address, which is why vault mode
  exists. The UI should offer "revoke first, then move", so a holder who revokes by hand reveals nothing.
- **Timing:** shield and certify in the same minute and an observer can pair them. The client enforces a minimum note age
  (proposed default: 150 slots, about a minute) and advises waiting longer.

## 8. Devnet, indexer, prover, and how we test
- **Devnet:** the same program ids and the same tree address are live on devnet (`ring1…` and `regy3…` executable,
  `777pv…` owned by SPP) **[devnet read]**. The Helius indexer answers on **`https://devnet.helius-rpc.com/v1/spr`** and on
  **`https://mainnet.helius-rpc.com/v1/spr`** with a Helius key (`?api-key=`). The cloudfront URLs in the README return 403
  from here.
- **The prover** (needed only for spends: transfer and withdraw; not for register, deposit, sync or certify): the Nitro TEE
  attestation **succeeds on mainnet and devnet** when the Helius key rides in the prover URL itself
  (`proverUrl: "https://<net>.helius-rpc.com/v1/spr?api-key=…"`, `proverTee: SignedTeePolicy.forNetwork(net)`). The SDK
  passes `apiKey` only to the indexer. **[mainnet + devnet read: `attestProver()` ok, platform aws-nitro]**
- So **devnet runs the whole stack** (RPC, indexer, prover) with the same programs: a real spend and a real nullifier PDA
  can be produced there with devnet SOL, no mainnet transaction.
- **The indexer cannot serve a local validator.** Local testing therefore uses:
  1. a validator with SPP, the registry, the tree, the protocol config and the SOL interface **cloned from mainnet** (the
     hush recipe), warped past the tree's last-update slot (offset 120), since the tree refuses an older slot;
  2. **our own reconstruction** of every leaf appended after the clone: the cloned frontier (offset 128) plus our own
     deposits gives exact Merkle proofs. `client/lib/localtree.js` reads the tree account and deposit events from the local
     node, so the client and the verifier get the same proofs without an indexer;
  3. a "spent" note simulated by **preloading a nullifier PDA** (owner SPP, 11 bytes, `0x08…`) at its derived address with
     `--account`. That is byte-for-byte the state a real spend leaves, so `revoke_spent` and the keeper are tested
     against it;
  4. how to start it: section 10.

## 9. Proposed CONTRACT text (for the section owners)
- **§3 `tree_root` (program + verifier):** "the Rings **state** root of tree 0 (`777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor`)
  at which every disclosed note was found; `root_slot` is the u64 at tree offset 120 read with it. One root: every note of
  one attestation must be in the same tree."
- **§4 notes[].opening (verifier):** replace the TBD with
  `{ "tree": base58, "leafIndex": u64, "asset": base58 mint (SOL = 1111…1111), "amount": "u64 decimal", "blinding": hex32, "dataHash"?: hex32, "ringDataHash"?: hex32, "ringProgramId"?: base58 }`
  and add at the package top level `"ring": { "owner": base58 Ed25519 pubkey, "nk": hex31 }` (and, in vault mode,
  `"vaultLink": base58 signature by the subject wallet over "pof:vault:" ‖ owner` for a wallet subject).
- **§5 the on-chain check (verifier with program):** "`nullifier` is spent if the account at `PDA(["nullifier", tree,
  nullifier], ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW)` exists, is owned by that program, is 11 bytes long and has
  data[0] == 8. (Upgrade path if Helius closes PDAs: a 40-level indexed-tree membership proof, leaf =
  Poseidon(nf, next), whose root is one of the 100 roots at tree offset 17,232.) The certificate stores `tree` once
  (all notes in one tree)."

## 10. The client, the lab and the local validator (how to run them)
**Local validator with Rings cloned** (RPC `http://127.0.0.1:35899`, ws 35900, faucet 36900, gossip 35000, dynamic 35100-35300):
```
node pof/lab/rings-local/prep.mjs          # once: dumps ring1…/regy3… binaries, saves tree 0, protocol config, SOL interface,
                                           # USDC registry + mint (mint authority rewritten to .run/usdc-authority.json), warp slot
zsh pof/lab/rings-local/chain.sh start     # refuses when 3 validators already run; ledger in the rings scratchpad
POF_PROGRAMS="pofP4QR…=path/pof.so" POF_ACCOUNTS="nf-pda.json" zsh pof/lab/rings-local/chain.sh start   # with the program, a spent PDA
zsh pof/lab/rings-local/chain.sh stop
```
`.run/cloned-tree.b64` is the tree as loaded at genesis; `client/localtree.js` (LocalRings) needs it to rebuild leaves on top of
the cloned frontier. LocalRings implements the Verifier's `RingsSource` (slot, treeHead, merklePaths, registryNullifierKey,
spent, creation), so the verifier and program tests can run against the clone:
`new LocalRings(jsonRpc('http://127.0.0.1:35899'), { cloned })`.

**The lab:** `node pof/lab/serve.mjs` (or the `pof-lab` entry in `.claude/launch.json`) → `http://localhost:5491/lab/`. It serves the
client, proxies `/api/rpc?net=local|devnet|mainnet` (mainnet read-only) and `/api/spr/<method>?net=` (Helius key server-side),
and answers `POST /api/attest` with the real Verifier (`verifier/dist`) over LocalRings with a throwaway key. Buttons: dev
wallet (local), connect (wallet picker), derive ring keys (the Phantom owner step), make vault, register, shield, sync,
pick, certify (wallet or badge subject), kits (list, export, import).

**Tests** (`cd pof/client`): `npm test` (core vectors from mainnet data + the local e2e against the real Verifier),
`npm run test:lab` (the lab page in headless Chrome, 11 checks), `npm run test:devnet` (real spend through the Helius
prover; waits for devnet SOL, OWNER-STEPS rings 2). `npm run build` rebuilds `dist/` and fails over the size budget.

**Browser facts:** `dist/spr.js` + shared chunk = 139 KB gzip, `dist/hasher-simd.wasm` = 420 KB gzip (fetched next to the
bundle with progress events, `hasher.wasm` 560 KB for browsers without WASM SIMD), `dist/spr-spend.js` = 202 KB gzip and
loads only for a withdrawal. The bundle needs a secure context (https or localhost: Kit's WebCrypto guard). Wallet
transactions are legacy messages (every wallet signs them); only a withdrawal is a version 1 transaction, signed by the vault
key in the page. In headless Chrome the hasher was ready about 0.4 s after the page asked for it (localhost).

**Production wiring the site needs** (not in rings' folders): `api/spr/[method].js` over `client/server/spr-proxy.js` with
`HELIUS_KEYS`, a prover proxy for withdrawals (the prover's TEE channel is end-to-end encrypted, so a byte-for-byte proxy is
safe), and `/api/rpc`.

## Changes
- 2026-11-25 · rings · first version.
- 2026-11-25 · rings · §8: the prover attests on mainnet and devnet with the key in the prover URL; devnet runs the full stack.
- 2026-11-25 · rings · §10: the client, the lab, the local validator, the size budget.
