//! Phase 2: `certify_zk`. A certificate made from a Groth16 proof instead of the Verifier's signature, so nobody off chain sees
//! an amount, the nullifier key or the notes (pof/zk/circuits/pof.circom, pof/docs-src/zk.md).
//!
//! The proof shows: the prover knows 1..4 notes of one ring that are leaves of the Rings state tree under `state_root`, whose
//! nullifiers are absent from the Rings nullifier tree under `null_root`, whose amounts in this asset sum to at least the tier's
//! minimum, and the secret behind the ring owner's entry in the POF owner registry (the owner registered it with its own
//! signature, so nk and the openings alone do not suffice: audit ZK-04). It publishes per note
//! `tag = Poseidon("pof:zk:tag:v1", nullifier)` and the nullifier encrypted to the revocation key (Baby Jubjub). The program
//! rebuilds or checks every public input itself:
//!   state_root    in the 500-root state history of the Rings tree account
//!   null_root     the NEWEST nullifier root of that account (ZK-01: the nullifier tree only grows, so an older root would
//!                 show a long-spent note as absent)
//!   asset_hash    Poseidon(mint[0..31], mint[31]) of the asset's mint in Config (Rings hashBytes)
//!   min_amount    the tier's minimum from Config
//!   ctx           sha256("pof:zk:ctx:v1" ‖ program ‖ kind ‖ subject_hash ‖ asset ‖ tier ‖ controller ‖ payer ‖ nonce), top 3
//!                 bits cleared: the proof is bound to this one certificate (no replay to another subject, payer, tier)
//!   escrow        the revocation key active now (ZkConfig)
//!   registry_root in the owner registry's root history
//!
//! A nullifier spent but still queued in Rings (its PDA exists, not folded into the nullifier tree yet) passes the proof. So a
//! zk certificate SETTLES first (ZK-02): its issued_slot is ZK_SETTLE_SLOTS ahead, `gate` (require_certificate, pof_gate)
//! refuses it until then, and anyone who sees the nullifier PDA of a tag (tags are public, nullifiers become public when spent)
//! or opens the escrow revokes it with revoke_spent in that window.
//!
//! One note backs one live zk certificate: a NoteLock PDA ["znote", tag] per note, released (anyone) once its certificate is
//! not live. revoke_spent on a zk certificate (verifier = the ZkConfig address) checks Poseidon(TAG_DOMAIN, nullifier) == tag.
use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::errors::PofError;
use crate::ext;
use crate::*;

#[path = "groth16.rs"]
pub mod groth16;
#[path = "vk.rs"]
pub mod vk;

pub const ZK_SEED: &[u8] = b"zk";
pub const REGISTRY_SEED: &[u8] = b"zkreg";
pub const LOCK_SEED: &[u8] = b"znote";
/// The ZkConfig PDA ["zk"] of this program: also the `verifier` recorded on every zk certificate.
pub const ZK_CONFIG: Pubkey = pubkey!("6q7PxLzgUtLHMfCDDHzkU4Ho54rC6b21VZmSFsD6Tsv1");
/// Rings tree 0 (RINGS §1): the only state tree.
pub const RINGS_TREE: Pubkey = pubkey!("777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor");
pub const ZK_NOTES: usize = 4;
pub const REG_H: usize = 20;
pub const REG_ROOTS: usize = 12;
/// Slots between certify_zk and the certificate passing `gate` (ZK-02): the keeper and anyone watching nullifier PDAs revoke
/// a queued spend inside it. About a minute at mainnet speed.
#[cfg(not(feature = "quick"))]
pub const ZK_SETTLE_SLOTS: u64 = 150;
#[cfg(feature = "quick")]
pub const ZK_SETTLE_SLOTS: u64 = 20;
/// "pof:zk:tag:v1" as a 32-byte big-endian field element.
pub const TAG_DOMAIN: [u8; 32] = be_domain(b"pof:zk:tag:v1");
pub const CTX_DOMAIN: &[u8] = b"pof:zk:ctx:v1";
/// The root of the empty owner registry: the zero chain (empty leaf 0, Poseidon(z, z)) at height 20 (= ext::NULL_ZEROS
/// continued; checked in the tests).
pub const REG_EMPTY_ROOT: [u8; 32] = [
    0x21, 0x34, 0xe7, 0x6a, 0xc5, 0xd2, 0x1a, 0xab, 0x18, 0x6c, 0x2b, 0xe1, 0xdd, 0x8f, 0x84, 0xee, 0x88, 0x0a, 0x1e, 0x46, 0xea, 0xf7, 0x12, 0xf9,
    0xd3, 0x71, 0xb6, 0xdf, 0x22, 0x19, 0x1f, 0x3e,
];

const fn be_domain(s: &[u8]) -> [u8; 32] {
    let mut o = [0u8; 32];
    let mut i = 0;
    while i < s.len() {
        o[32 - s.len() + i] = s[i];
        i += 1;
    }
    o
}

// tree account layout (RINGS §1)
const TREE_LEN: usize = 40_080;
const STATE_HISTORY_AT: usize = 1_152;
const STATE_HISTORY_LEN_AT: usize = 114;
const ROOT_SLOT_AT: usize = 120;
const NULL_CURSOR_AT: usize = 17_224;
const NULL_ROOTS_AT: usize = 17_232;
const NULL_ROOTS: u64 = 100;

#[account]
#[derive(InitSpace)]
pub struct ZkConfig {
    /// certify_zk refuses while false. Turning it on, or changing the key, waits Config.params.rotation_delay (ZK-09);
    /// turning it off is immediate.
    pub enabled: bool,
    /// The revocation key K = k·B8 on Baby Jubjub (x, y, 32-byte big-endian): the keeper holds k. On the curve (checked).
    pub escrow: [[u8; 32]; 2],
    /// Counts key changes; each note lock records the epoch it was encrypted under, so the keeper knows which k opens it.
    pub escrow_epoch: u32,
    /// A change waiting for next_slot (0: none). Takes over by itself at that slot (as the verifier key does).
    pub next_enabled: bool,
    pub next_escrow: [[u8; 32]; 2],
    pub next_slot: u64,
    /// sha256 of the verifying key compiled into this build (vk::VK_HASH), to match against the ceremony transcript.
    pub vk_hash: [u8; 32],
    pub certified: u64,
    pub bump: u8,
}

impl ZkConfig {
    /// (enabled, escrow key, epoch) in force at `slot`.
    pub fn active(&self, slot: u64) -> (bool, [[u8; 32]; 2], u32) {
        if self.next_slot != 0 && slot >= self.next_slot {
            let epoch = if self.next_escrow != self.escrow { self.escrow_epoch + 1 } else { self.escrow_epoch };
            (self.next_enabled, self.next_escrow, epoch)
        } else {
            (self.enabled, self.escrow, self.escrow_epoch)
        }
    }
}

/// The POF owner registry (ZK-04): an append-only Poseidon Merkle tree (height 20) of Poseidon(ownerId(owner), commitment), each
/// appended by register_zk_owner under the ring owner's own signature, with its last 12 roots (Borsh decoding keeps it under the 4 KB frame).
#[account]
#[derive(InitSpace)]
pub struct ZkRegistry {
    pub next_index: u64,
    pub filled: [[u8; 32]; REG_H],
    pub roots: [[u8; 32]; REG_ROOTS],
    pub cursor: u8,
    pub bump: u8,
}

/// One note behind one live certificate, with what the keeper needs to open the escrow.
#[account]
#[derive(InitSpace)]
pub struct NoteLock {
    pub certificate: Pubkey,
    pub tag: [u8; 32],
    /// Paid the lock's rent (gets it back at release).
    pub payer: Pubkey,
    pub eph: [[u8; 32]; 2],
    pub ct: [u8; 32],
    pub escrow_epoch: u32,
    pub locked_slot: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub struct ZkArgs {
    /// 0 wallet or 2 badge: the controller is that key and signs (an X handle needs the linker's proof: not in this version).
    pub subject_kind: u8,
    pub asset: u8,
    pub tier: u8,
    pub nonce: [u8; 16],
    /// -A ‖ B ‖ C, big-endian (js/zk.js proofBytes).
    pub proof: [u8; 256],
    pub state_root: [u8; 32],
    pub null_root: [u8; 32],
    pub registry_root: [u8; 32],
    pub eph: [[u8; 32]; 2],
    /// One per used note, strictly ascending (distinct notes), 1..=4.
    pub tags: Vec<[u8; 32]>,
    pub cts: Vec<[u8; 32]>,
}

#[event]
pub struct ZkCertified {
    pub certificate: Pubkey,
    pub subject_hash: [u8; 32],
    pub asset: u8,
    pub tier: u8,
    pub settles_slot: u64,
    pub tags: Vec<[u8; 32]>,
    pub eph: [[u8; 32]; 2],
    pub cts: Vec<[u8; 32]>,
    pub escrow_epoch: u32,
    pub state_root: [u8; 32],
    pub null_root: [u8; 32],
}

#[event]
pub struct ZkOwnerRegistered {
    pub owner: Pubkey,
    pub index: u64,
    pub leaf: [u8; 32],
    pub root: [u8; 32],
}

#[event]
pub struct ZkConfigSet {
    pub enabled: bool,
    pub escrow: [[u8; 32]; 2],
    pub takes_over_slot: u64,
    pub vk_hash: [u8; 32],
}

#[event]
pub struct NoteReleased {
    pub tag: [u8; 32],
    pub certificate: Pubkey,
}

/// Poseidon(TAG_DOMAIN, nullifier): what a zk certificate stores per note, and what revoke_spent checks for one.
pub fn tag_of(nullifier: &[u8; 32]) -> Result<[u8; 32]> {
    ext::poseidon2(&TAG_DOMAIN, nullifier).map_err(|_| error!(PofError::NullifierMismatch))
}

/// The context field element that binds a proof to one certificate.
pub fn zk_context(subject_kind: u8, subject_hash: &[u8; 32], asset: u8, tier: u8, controller: &Pubkey, payer: &Pubkey, nonce: &[u8; 16]) -> [u8; 32] {
    let mut h = ext::sha256(&[CTX_DOMAIN, crate::ID.as_ref(), &[subject_kind], subject_hash, &[asset], &[tier], controller.as_ref(), payer.as_ref(), nonce]);
    h[0] &= 0x1f;
    h
}

/// Rings hashBytes for 32 or 33 bytes: Poseidon(bytes[0..31], bytes[31..]) (both right-aligned in 32 bytes).
fn hash_bytes_2(b: &[u8]) -> Result<[u8; 32]> {
    let mut hi = [0u8; 32];
    hi[1..].copy_from_slice(&b[..31]);
    let mut lo = [0u8; 32];
    let rest = &b[31..];
    lo[32 - rest.len()..].copy_from_slice(rest);
    ext::poseidon2(&hi, &lo).map_err(|_| error!(PofError::BadParams))
}
pub fn asset_hash(mint: &Pubkey) -> Result<[u8; 32]> {
    hash_bytes_2(&mint.to_bytes())
}
/// Rings solanaOwnerIdentity: hashBytes(0x53 ‖ key).
pub fn owner_id(key: &Pubkey) -> Result<[u8; 32]> {
    let mut t = [0u8; 33];
    t[0] = 0x53;
    t[1..].copy_from_slice(key.as_ref());
    hash_bytes_2(&t)
}

fn be_u64(v: u64) -> [u8; 32] {
    let mut o = [0u8; 32];
    o[24..].copy_from_slice(&v.to_be_bytes());
    o
}

/// The Rings tree account: `state_root` in its state history, `null_root` its newest nullifier root (ZK-01). Returns the slot of
/// the tree's last update (offset 120).
pub fn check_roots(tree: &AccountInfo, state_root: &[u8; 32], null_root: &[u8; 32]) -> Result<u64> {
    require_keys_eq!(tree.key(), RINGS_TREE, PofError::BadRingsAccounts);
    require_keys_eq!(*tree.owner, ext::SPP_ID, PofError::BadRingsAccounts);
    let d = tree.try_borrow_data()?;
    require!(d.len() == TREE_LEN && d[0] == 1, PofError::BadRingsAccounts);
    let len = (u16::from_le_bytes([d[STATE_HISTORY_LEN_AT], d[STATE_HISTORY_LEN_AT + 1]]) as usize).min(500);
    let in_state = (0..len).any(|i| &d[STATE_HISTORY_AT + i * 32..STATE_HISTORY_AT + i * 32 + 32] == state_root);
    require!(in_state, PofError::ZkStateRootUnknown);
    let cursor = u64::from_le_bytes(d[NULL_CURSOR_AT..NULL_CURSOR_AT + 8].try_into().unwrap());
    let newest = ((cursor % NULL_ROOTS + NULL_ROOTS - 1) % NULL_ROOTS) as usize;
    let at = NULL_ROOTS_AT + newest * 32;
    require!(null_root.iter().any(|b| *b != 0) && &d[at..at + 32] == null_root, PofError::ZkNullRootNotNewest);
    Ok(u64::from_le_bytes(d[ROOT_SLOT_AT..ROOT_SLOT_AT + 8].try_into().unwrap()))
}

/// The public inputs in the circuit's order (circuits/pof.circom).
pub fn public_inputs(c: &Config, escrow: &[[u8; 32]; 2], args: &ZkArgs, ctx: [u8; 32]) -> Result<[[u8; 32]; vk::NPUB]> {
    let t = &c.assets[args.asset as usize];
    let mut x = [[0u8; 32]; vk::NPUB];
    x[0] = args.state_root;
    x[1] = args.null_root;
    x[2] = asset_hash(&t.mint)?;
    x[3] = be_u64(tier_min(c, args.asset, args.tier));
    x[4] = ctx;
    x[5] = escrow[0];
    x[6] = escrow[1];
    x[7] = args.eph[0];
    x[8] = args.eph[1];
    for (i, tag) in args.tags.iter().enumerate() {
        x[9 + i] = *tag;
        x[9 + ZK_NOTES + i] = args.cts[i];
    }
    x[9 + 2 * ZK_NOTES] = args.registry_root;
    Ok(x)
}

// ------------------------------------------------------------------------------------------------------------
// Baby Jubjub on-curve check (ZK-09): a·x² + y² = 1 + d·x²·y² over the BN254 scalar field, 256-bit limbs (admin path only)

type U256 = [u64; 4]; // little-endian limbs
const P_R: U256 = [0x43e1f593f0000001, 0x2833e84879b97091, 0xb85045b68181585d, 0x30644e72e131a029];
fn u256(b: &[u8; 32]) -> U256 {
    let mut o = [0u64; 4];
    for i in 0..4 {
        o[3 - i] = u64::from_be_bytes(b[i * 8..i * 8 + 8].try_into().unwrap());
    }
    o
}
fn geq(a: &U256, b: &U256) -> bool {
    for i in (0..4).rev() {
        if a[i] != b[i] {
            return a[i] > b[i];
        }
    }
    true
}
fn sub(a: &U256, b: &U256) -> U256 {
    let mut o = [0u64; 4];
    let mut borrow = 0u64;
    for i in 0..4 {
        let (d1, b1) = a[i].overflowing_sub(b[i]);
        let (d2, b2) = d1.overflowing_sub(borrow);
        o[i] = d2;
        borrow = (b1 | b2) as u64;
    }
    o
}
fn addmod(a: &U256, b: &U256) -> U256 {
    let mut o = [0u64; 4];
    let mut carry = 0u64;
    for i in 0..4 {
        let (s1, c1) = a[i].overflowing_add(b[i]);
        let (s2, c2) = s1.overflowing_add(carry);
        o[i] = s2;
        carry = (c1 | c2) as u64;
    }
    if carry == 1 || geq(&o, &P_R) {
        o = sub(&o, &P_R);
    }
    o
}
fn mulmod(a: &U256, b: &U256) -> U256 {
    let mut r = [0u64; 4];
    for i in (0..256).rev() {
        r = addmod(&r, &r);
        if (b[i / 64] >> (i % 64)) & 1 == 1 {
            r = addmod(&r, a);
        }
    }
    r
}
/// On the curve and not the identity (0, 1). (Subgroup membership is checked off chain by the key's maker: too costly here.)
pub fn on_baby_jubjub(x: &[u8; 32], y: &[u8; 32]) -> bool {
    if !groth16::in_field(x) || !groth16::in_field(y) {
        return false;
    }
    let (x, y) = (u256(x), u256(y));
    let a: U256 = [168700, 0, 0, 0];
    let d: U256 = [168696, 0, 0, 0];
    let x2 = mulmod(&x, &x);
    let y2 = mulmod(&y, &y);
    let lhs = addmod(&mulmod(&a, &x2), &y2);
    let rhs = addmod(&[1, 0, 0, 0], &mulmod(&d, &mulmod(&x2, &y2)));
    lhs == rhs && !(x == [0; 4] && y == [1, 0, 0, 0])
}

// ------------------------------------------------------------------------------------------------------------
// instructions

/// Admin. Turning certify_zk off with the same key is immediate; anything else (on, a new key) waits the rotation delay.
pub fn handle_set_zk(ctx: Context<SetZk>, enabled: bool, escrow: [[u8; 32]; 2]) -> Result<()> {
    let slot = Clock::get()?.slot;
    let c = &ctx.accounts.config;
    // the verifier rotation's delay, including a lowered delay still being waited out (POF-17)
    let delay = if slot < c.held_until { c.params.rotation_delay.max(c.held_delay) } else { c.params.rotation_delay };
    let z = &mut ctx.accounts.zk;
    let r = &mut ctx.accounts.registry;
    if z.bump == 0 {
        z.bump = ctx.bumps.zk;
        z.vk_hash = vk::VK_HASH;
    }
    if r.bump == 0 {
        r.bump = ctx.bumps.registry;
        r.roots[0] = REG_EMPTY_ROOT;
    }
    require!(on_baby_jubjub(&escrow[0], &escrow[1]), PofError::ZkBadEscrowKey);
    require!(vk::VK_HASH != [0u8; 32], PofError::ZkNoVerifyingKey);
    // fold a due change first
    let (en, k, ep) = z.active(slot);
    z.enabled = en;
    z.escrow = k;
    z.escrow_epoch = ep;
    z.next_slot = 0;
    let takes = if !enabled && escrow == z.escrow {
        z.enabled = false;
        slot
    } else {
        z.next_enabled = enabled;
        z.next_escrow = escrow;
        z.next_slot = slot.checked_add(delay.max(1)).ok_or(error!(PofError::Overflow))?;
        z.next_slot
    };
    emit!(ZkConfigSet { enabled, escrow, takes_over_slot: takes, vk_hash: vk::VK_HASH });
    Ok(())
}

/// The ring owner (it signs) appends Poseidon(ownerId(owner), commitment) to the owner registry, where commitment =
/// Poseidon("pof:zk:own:v1", ownerSecret) and ownerSecret never leaves the owner's device.
pub fn handle_register_zk_owner(ctx: Context<RegisterZkOwner>, commitment: [u8; 32]) -> Result<()> {
    require!(groth16::in_field(&commitment) && commitment != [0u8; 32], PofError::BadParams);
    let owner = ctx.accounts.owner.key();
    let leaf = ext::poseidon2(&owner_id(&owner)?, &commitment).map_err(|_| error!(PofError::BadParams))?;
    let r = &mut ctx.accounts.registry;
    let index = r.next_index;
    require!(index < (1u64 << REG_H), PofError::ZkRegistryFull);
    let mut cur = leaf;
    let mut idx = index;
    for level in 0..REG_H {
        if idx & 1 == 0 {
            r.filled[level] = cur;
            cur = ext::poseidon2(&cur, &ext::NULL_ZEROS[level]).map_err(|_| error!(PofError::BadParams))?;
        } else {
            cur = ext::poseidon2(&r.filled[level], &cur).map_err(|_| error!(PofError::BadParams))?;
        }
        idx >>= 1;
    }
    let at = (r.cursor as usize + 1) % REG_ROOTS;
    r.cursor = at as u8;
    r.roots[at] = cur;
    r.next_index = index + 1;
    emit!(ZkOwnerRegistered { owner, index, leaf, root: cur });
    Ok(())
}

pub fn handle_certify_zk<'info>(ctx: Context<'info, CertifyZk<'info>>, args: ZkArgs) -> Result<()> {
    let slot = Clock::get()?.slot;
    let cert_key = ctx.accounts.certificate.key();
    let a = ctx.accounts;
    let c = &a.config;
    require!(!c.closing, PofError::Closing);
    require!(!c.paused, PofError::Paused);
    let (enabled, escrow, epoch) = a.zk.active(slot);
    require!(enabled, PofError::ZkDisabled);
    require!(args.subject_kind == ext::KIND_WALLET || args.subject_kind == ext::KIND_BADGE, PofError::ZkSubjectKind);
    let subject_hash = ext::key_subject_hash(args.subject_kind, &a.controller.key()).ok_or(error!(PofError::BadSubjectKind))?;
    let t = c.assets.get(args.asset as usize).ok_or(error!(PofError::BadAsset))?;
    require!(t.enabled, PofError::BadAsset);
    require!(args.tier >= 1 && args.tier <= t.tiers(), PofError::BadTier);
    let n = args.tags.len();
    require!((1..=ZK_NOTES).contains(&n) && args.cts.len() == n, PofError::BadNoteCount);
    require!(args.tags[0] != [0u8; 32] && args.tags.windows(2).all(|w| w[0] < w[1]), PofError::NullHashesUnsorted);
    require!(ctx.remaining_accounts.len() == n, PofError::ZkLockMissing);

    // the roots the proof must stand on, then the proof against inputs the program rebuilt
    let root_slot = check_roots(&a.tree, &args.state_root, &args.null_root)?;
    require!(args.registry_root != [0u8; 32] && a.registry.roots.contains(&args.registry_root), PofError::ZkRegistryRootUnknown);
    let payer = a.payer.key();
    let controller = a.controller.key();
    let cx = zk_context(args.subject_kind, &subject_hash, args.asset, args.tier, &controller, &payer, &args.nonce);
    let inputs = public_inputs(c, &escrow, &args, cx)?;
    groth16::verify(&args.proof, &inputs).map_err(|e| match e {
        groth16::Groth16Error::InputNotInField => error!(PofError::ZkInputNotInField),
        _ => error!(PofError::ZkProofInvalid),
    })?;

    // the certificate (the remake rules of certify, POF-07 included)
    let tinfo = a.treasury.to_account_info();
    let t = &mut a.treasury;
    let cert = &mut a.certificate;
    let mut surplus = 0u64;
    if cert.payer == Pubkey::default() {
        t.open = add(t.open, 1)?;
    } else {
        require!(!cert.is_live(slot), PofError::AlreadyLive);
        if cert.status == STATUS_LIVE {
            unlive(c, t, cert);
            t.expired += 1;
        }
        // the new payer buys the old payer out at exactly the rent-exempt minimum; lamports above it go to the treasury,
        // moved after every CPI of this instruction (the note locks below create accounts)
        let info = cert.to_account_info();
        let rent = Rent::get()?.minimum_balance(info.data_len());
        surplus = info.lamports().saturating_sub(rent);
        if cert.payer != payer {
            let prior = a.prior_payer.as_ref().ok_or(error!(PofError::PriorPayerMissing))?;
            require_keys_eq!(prior.key(), cert.payer, PofError::PriorPayerMissing);
            system_program::transfer(
                CpiContext::new(a.system_program.key(), system_program::Transfer { from: a.payer.to_account_info(), to: prior.to_account_info() }),
                rent,
            )?;
        }
    }
    let fee = take_fee(c, t, &a.payer, &tinfo, &a.holder_token, &a.system_program)?;
    let settles = add(slot, ZK_SETTLE_SLOTS)?;
    let expiry = add(slot, c.params.validity_slots)?;
    cert.subject_kind = args.subject_kind;
    cert.subject_hash = subject_hash;
    cert.asset = args.asset;
    cert.tier = args.tier;
    cert.status = STATUS_LIVE;
    cert.certified_slot = slot;
    // a zk certificate's issued_slot is the slot it settles at: `gate` refuses it before (ZK-02)
    cert.issued_slot = settles;
    cert.expiry_slot = expiry;
    cert.revoked_slot = 0;
    cert.tree_root = args.state_root;
    cert.root_slot = root_slot;
    cert.note_count = n as u8;
    cert.null_hashes = [[0u8; 32]; MAX_NOTES];
    cert.null_hashes[..n].copy_from_slice(&args.tags);
    cert.nullset_hash = nullset_hash(&args.tags);
    cert.payer = payer;
    cert.controller = controller;
    cert.verifier = ZK_CONFIG;
    cert.nonce = args.nonce;
    cert.log_index = u64::MAX;
    cert.renewals = 0;
    cert.revealed_index = u8::MAX;
    cert.revealed_salt = [0u8; 32];
    cert.revealed_nullifier = [0u8; 32];
    cert.bump = ctx.bumps.certificate;
    t.certified += 1;
    t.live += 1;
    let i = args.asset as usize;
    t.live_min[i] = add(t.live_min[i], tier_min(c, args.asset, args.tier))?;
    a.zk.certified += 1;

    // one lock per note
    let space = 8 + NoteLock::INIT_SPACE;
    let rent = Rent::get()?.minimum_balance(space);
    for (k, lock) in ctx.remaining_accounts.iter().enumerate() {
        let tag = args.tags[k];
        let (pda, bump) = Pubkey::find_program_address(&[LOCK_SEED, &tag], &crate::ID);
        require_keys_eq!(lock.key(), pda, PofError::ZkLockMissing);
        require!(lock.is_writable, PofError::ZkLockMissing);
        let value = NoteLock { certificate: cert_key, tag, payer, eph: args.eph, ct: args.cts[k], escrow_epoch: epoch, locked_slot: slot, bump };
        if *lock.owner == crate::ID {
            // an existing lock: only this certificate's own (remade over its revoked or expired self)
            let old = {
                let d = lock.try_borrow_data()?;
                NoteLock::try_deserialize(&mut &d[..]).map_err(|_| error!(PofError::ZkNoteLocked))?
            };
            require_keys_eq!(old.certificate, cert_key, PofError::ZkNoteLocked);
        } else {
            // a fresh lock; lamports someone sent to the address first do not block it (ZK-07): top up, allocate, assign
            require_keys_eq!(*lock.owner, system_program::ID, PofError::ZkNoteLocked);
            let seeds: &[&[u8]] = &[LOCK_SEED, &tag, &[bump]];
            if lock.lamports() == 0 {
                system_program::create_account(
                    CpiContext::new_with_signer(a.system_program.key(), system_program::CreateAccount { from: a.payer.to_account_info(), to: lock.clone() }, &[seeds]),
                    rent,
                    space as u64,
                    &crate::ID,
                )?;
            } else {
                let top = rent.saturating_sub(lock.lamports());
                if top > 0 {
                    system_program::transfer(CpiContext::new(a.system_program.key(), system_program::Transfer { from: a.payer.to_account_info(), to: lock.clone() }), top)?;
                }
                system_program::allocate(CpiContext::new_with_signer(a.system_program.key(), system_program::Allocate { account_to_allocate: lock.clone() }, &[seeds]), space as u64)?;
                system_program::assign(CpiContext::new_with_signer(a.system_program.key(), system_program::Assign { account_to_assign: lock.clone() }, &[seeds]), &crate::ID)?;
            }
        }
        let mut d = lock.try_borrow_mut_data()?;
        value.try_serialize(&mut &mut d[..])?;
    }

    if surplus > 0 {
        ext::shift(&a.certificate.to_account_info(), &tinfo, surplus)?;
        a.treasury.fees_in = add(a.treasury.fees_in, surplus)?;
    }

    emit!(Certified {
        subject_kind: args.subject_kind,
        subject_hash,
        asset: args.asset,
        tier: args.tier,
        certified_slot: slot,
        expiry_slot: expiry,
        note_count: n as u8,
        payer,
        controller,
        verifier: ZK_CONFIG,
        log_index: u64::MAX,
        fee,
    });
    emit!(ZkCertified {
        certificate: cert_key,
        subject_hash,
        asset: args.asset,
        tier: args.tier,
        settles_slot: settles,
        tags: args.tags.clone(),
        eph: args.eph,
        cts: args.cts.clone(),
        escrow_epoch: epoch,
        state_root: args.state_root,
        null_root: args.null_root,
    });
    Ok(())
}

/// Anyone: close a note lock whose certificate is gone, no longer live, or no longer carries the tag. Rent back to its payer.
pub fn handle_release_note_lock(ctx: Context<ReleaseNoteLock>) -> Result<()> {
    let slot = Clock::get()?.slot;
    let a = &ctx.accounts;
    let lock = &a.lock;
    let info = a.certificate.to_account_info();
    let dead = if info.lamports() == 0 || *info.owner != crate::ID {
        true
    } else {
        let d = info.try_borrow_data()?;
        match Certificate::try_deserialize(&mut &d[..]) {
            Ok(cert) => !cert.is_live(slot) || cert.verifier != ZK_CONFIG || !cert.null_hashes[..cert.note_count as usize].contains(&lock.tag),
            Err(_) => true,
        }
    };
    require!(dead, PofError::ZkNoteStillLive);
    emit!(NoteReleased { tag: lock.tag, certificate: lock.certificate });
    Ok(())
}

#[derive(Accounts)]
pub struct SetZk<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ PofError::NotAdmin)]
    pub config: Box<Account<'info, Config>>,
    #[account(init_if_needed, payer = admin, space = 8 + ZkConfig::INIT_SPACE, seeds = [ZK_SEED], bump)]
    pub zk: Box<Account<'info, ZkConfig>>,
    #[account(init_if_needed, payer = admin, space = 8 + ZkRegistry::INIT_SPACE, seeds = [REGISTRY_SEED], bump)]
    pub registry: Box<Account<'info, ZkRegistry>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterZkOwner<'info> {
    /// The ring owner (the vault key): its signature is the consent the circuit later proves.
    pub owner: Signer<'info>,
    #[account(mut, seeds = [REGISTRY_SEED], bump = registry.bump)]
    pub registry: Box<Account<'info, ZkRegistry>>,
}

#[derive(Accounts)]
#[instruction(args: ZkArgs)]
pub struct CertifyZk<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// The subject key (wallet or badge): it consents by signing; may be the payer.
    pub controller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [ZK_SEED], bump = zk.bump)]
    pub zk: Box<Account<'info, ZkConfig>>,
    #[account(seeds = [REGISTRY_SEED], bump = registry.bump)]
    pub registry: Box<Account<'info, ZkRegistry>>,
    #[account(mut, seeds = [TREASURY_SEED], bump = treasury.bump)]
    pub treasury: Box<Account<'info, Treasury>>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Certificate::INIT_SPACE,
        seeds = [CERT_SEED, ext::key_subject_hash(args.subject_kind, controller.key).unwrap_or_default().as_ref(), &[args.asset]],
        bump
    )]
    pub certificate: Box<Account<'info, Certificate>>,
    /// CHECK: the payer of the certificate this one replaces (gets its rent back); only when remaking over another payer's
    #[account(mut)]
    pub prior_payer: Option<UncheckedAccount<'info>>,
    /// CHECK: the payer's canonical $ROOT account (checked in take_fee)
    pub holder_token: UncheckedAccount<'info>,
    /// CHECK: Rings tree 0 (address, owner and layout checked in check_roots)
    pub tree: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    // remaining accounts: the note locks ["znote", tag], writable, one per tag in the tags' order
}

#[derive(Accounts)]
pub struct ReleaseNoteLock<'info> {
    #[account(mut, close = payer, seeds = [LOCK_SEED, lock.tag.as_ref()], bump = lock.bump)]
    pub lock: Box<Account<'info, NoteLock>>,
    /// CHECK: the certificate the lock names (read, any state; closed counts as gone)
    #[account(address = lock.certificate)]
    pub certificate: UncheckedAccount<'info>,
    /// CHECK: gets the lock's rent back
    #[account(mut, address = lock.payer)]
    pub payer: UncheckedAccount<'info>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_zk_config_address_is_the_pda() {
        assert_eq!(Pubkey::find_program_address(&[ZK_SEED], &crate::ID).0, ZK_CONFIG);
    }

    #[test]
    fn tag_domain_is_the_ascii_big_endian() {
        assert_eq!(&TAG_DOMAIN[19..], b"pof:zk:tag:v1");
        assert!(TAG_DOMAIN[..19].iter().all(|b| *b == 0));
    }

    #[test]
    fn baby_jubjub_points() {
        let hexb = |s: &str| -> [u8; 32] {
            let mut o = [0u8; 32];
            for i in 0..32 {
                o[i] = u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap();
            }
            o
        };
        // B8 (circomlib)
        let x = hexb("0bb77a6ad63e739b4eacb2e09d6277c12ab8d8010534e0b62893f3f6bb957051");
        let y = hexb("25797203f7a0b24925572e1cd16bf9edfce0051fb9e133774b3c257a872d7d8b");
        assert!(on_baby_jubjub(&x, &y));
        let mut y2 = y;
        y2[31] ^= 1;
        assert!(!on_baby_jubjub(&x, &y2));
        assert!(!on_baby_jubjub(&[0u8; 32], &be_u64(1)));
    }

    #[test]
    fn the_empty_registry_root_is_the_zero_chain() {
        let mut z = [0u8; 32];
        for _ in 0..REG_H {
            z = ext::poseidon2(&z, &z).unwrap();
        }
        assert_eq!(z, REG_EMPTY_ROOT);
    }
}
