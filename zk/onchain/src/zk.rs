//! Phase 2: `certify_zk`. A certificate made from a Groth16 proof instead of the Verifier's signature, so nobody off chain sees
//! an amount, the nullifier key or the notes (pof/zk/circuits/pof.circom, pof/zk/docs-src/zk.md).
//!
//! The proof shows: the prover knows 1..4 notes of one ring that are leaves of the Rings state tree under `state_root`, whose
//! nullifiers are absent from the Rings nullifier tree under `null_root`, whose amounts in this asset sum to at least the tier's
//! minimum; it publishes per note `tag = Poseidon("pof:zk:tag:v1", nullifier)` and the nullifier encrypted to the revocation key
//! (`ZkConfig.escrow`, Baby Jubjub). The program rebuilds every public input itself:
//!   state_root  must be in the 500-root state history of the Rings tree account (checked here, not trusted)
//!   null_root   must be in its 100-root nullifier history
//!   asset_hash  = Poseidon(mint[0..31], mint[31]) of the asset's mint in Config (Rings hashBytes)
//!   min_amount  = the tier's minimum from Config
//!   ctx         = sha256("pof:zk:ctx:v1" ‖ program ‖ kind ‖ subject_hash ‖ asset ‖ tier ‖ controller ‖ payer ‖ nonce), top 3 bits
//!                 cleared: the proof is bound to this one certificate and cannot be replayed for another subject, payer or tier
//!   escrow      = ZkConfig.escrow; eph, tags, cts come from the arguments and are stored (tags on the certificate, the rest
//!                 in the note locks) so the keeper can always open them
//!
//! One note backs one live certificate: each tag gets a NoteLock PDA ["znote", tag]; a lock is released (permissionless) once
//! its certificate is no longer live. `revoke_spent` on a zk certificate (its `verifier` is the ZkConfig address) checks
//! `Poseidon(TAG_DOMAIN, nullifier) == tag` instead of the salted sha256, then the same spent proofs (a) or (b).
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
pub const LOCK_SEED: &[u8] = b"znote";
/// The ZkConfig PDA ["zk"] of this program: also the `verifier` recorded on every zk certificate.
pub const ZK_CONFIG: Pubkey = pubkey!("6q7PxLzgUtLHMfCDDHzkU4Ho54rC6b21VZmSFsD6Tsv1");
/// Rings tree 0 (RINGS §1): the only state tree.
pub const RINGS_TREE: Pubkey = pubkey!("777pvSGe5LaBd9nCczvE2FXEauiwtfGJ5XRpjKyniGor");
pub const ZK_NOTES: usize = 4;
/// "pof:zk:tag:v1" as a 32-byte big-endian field element.
pub const TAG_DOMAIN: [u8; 32] = be_domain(b"pof:zk:tag:v1");
pub const CTX_DOMAIN: &[u8] = b"pof:zk:ctx:v1";

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
const NULL_ROOTS_AT: usize = 17_232;
const NULL_ROOTS: usize = 100;

#[account]
#[derive(InitSpace)]
pub struct ZkConfig {
    /// certify_zk refuses while false (the admin turns it on after the public ceremony's key is in the build).
    pub enabled: bool,
    /// The revocation key K = k·B8 on Baby Jubjub (x, y as 32-byte big-endian): the keeper holds k.
    pub escrow: [[u8; 32]; 2],
    /// sha256 of the verifying key compiled into this build (vk::VK_HASH), for readers to match against the ceremony.
    pub vk_hash: [u8; 32],
    pub certified: u64,
    pub bump: u8,
}

/// One note behind one live certificate. Holds what the keeper needs to open the escrow: the ephemeral point and the ciphertext.
#[account]
#[derive(InitSpace)]
pub struct NoteLock {
    pub certificate: Pubkey,
    pub tag: [u8; 32],
    /// Paid the lock's rent (gets it back at release).
    pub payer: Pubkey,
    pub eph: [[u8; 32]; 2],
    pub ct: [u8; 32],
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
    pub tags: Vec<[u8; 32]>,
    pub eph: [[u8; 32]; 2],
    pub cts: Vec<[u8; 32]>,
    pub state_root: [u8; 32],
    pub null_root: [u8; 32],
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
    let mut h = ext::sha256(&[
        CTX_DOMAIN,
        crate::ID.as_ref(),
        &[subject_kind],
        subject_hash,
        &[asset],
        &[tier],
        controller.as_ref(),
        payer.as_ref(),
        nonce,
    ]);
    h[0] &= 0x1f;
    h
}

/// Rings hashBytes of a 32-byte mint: Poseidon(mint[0..31], mint[31]) (both right-aligned in 32 bytes).
pub fn asset_hash(mint: &Pubkey) -> Result<[u8; 32]> {
    let m = mint.to_bytes();
    let mut hi = [0u8; 32];
    hi[1..].copy_from_slice(&m[..31]);
    let mut lo = [0u8; 32];
    lo[31] = m[31];
    ext::poseidon2(&hi, &lo).map_err(|_| error!(PofError::BadAsset))
}

fn be_u64(v: u64) -> [u8; 32] {
    let mut o = [0u8; 32];
    o[24..].copy_from_slice(&v.to_be_bytes());
    o
}

/// The Rings tree account: is `state_root` in its state history and `null_root` in its nullifier history? Returns the slot of
/// the tree's last update (offset 120).
pub fn check_roots(tree: &AccountInfo, state_root: &[u8; 32], null_root: &[u8; 32]) -> Result<u64> {
    require_keys_eq!(tree.key(), RINGS_TREE, PofError::BadRingsAccounts);
    require_keys_eq!(*tree.owner, ext::SPP_ID, PofError::BadRingsAccounts);
    let d = tree.try_borrow_data()?;
    require!(d.len() == TREE_LEN && d[0] == 1, PofError::BadRingsAccounts);
    let len = (u16::from_le_bytes([d[STATE_HISTORY_LEN_AT], d[STATE_HISTORY_LEN_AT + 1]]) as usize).min(500);
    let in_state = (0..len).any(|i| &d[STATE_HISTORY_AT + i * 32..STATE_HISTORY_AT + i * 32 + 32] == state_root);
    require!(in_state, PofError::ZkStateRootUnknown);
    require!(null_root.iter().any(|b| *b != 0), PofError::ZkNullRootUnknown);
    let in_null = (0..NULL_ROOTS).any(|i| &d[NULL_ROOTS_AT + i * 32..NULL_ROOTS_AT + i * 32 + 32] == null_root);
    require!(in_null, PofError::ZkNullRootUnknown);
    Ok(u64::from_le_bytes(d[ROOT_SLOT_AT..ROOT_SLOT_AT + 8].try_into().unwrap()))
}

/// The 17 public inputs in the circuit's order (circuits/pof.circom).
pub fn public_inputs(c: &Config, zk: &ZkConfig, args: &ZkArgs, ctx: [u8; 32]) -> Result<[[u8; 32]; vk::NPUB]> {
    let t = &c.assets[args.asset as usize];
    let mut x = [[0u8; 32]; vk::NPUB];
    x[0] = args.state_root;
    x[1] = args.null_root;
    x[2] = asset_hash(&t.mint)?;
    x[3] = be_u64(tier_min(c, args.asset, args.tier));
    x[4] = ctx;
    x[5] = zk.escrow[0];
    x[6] = zk.escrow[1];
    x[7] = args.eph[0];
    x[8] = args.eph[1];
    for (i, tag) in args.tags.iter().enumerate() {
        x[9 + i] = *tag;
        x[9 + ZK_NOTES + i] = args.cts[i];
    }
    Ok(x)
}

pub fn handle_set_zk(ctx: Context<SetZk>, enabled: bool, escrow: [[u8; 32]; 2]) -> Result<()> {
    let z = &mut ctx.accounts.zk;
    require!(escrow.iter().all(groth16::in_field), PofError::BadParams);
    z.enabled = enabled;
    z.escrow = escrow;
    z.vk_hash = vk::VK_HASH;
    z.bump = ctx.bumps.zk;
    Ok(())
}

pub fn handle_certify_zk<'info>(ctx: Context<'info, CertifyZk<'info>>, args: ZkArgs) -> Result<()> {
    let slot = Clock::get()?.slot;
    let cert_key = ctx.accounts.certificate.key();
    let a = ctx.accounts;
    let c = &a.config;
    require!(!c.closing, PofError::Closing);
    require!(!c.paused, PofError::Paused);
    require!(a.zk.enabled, PofError::ZkDisabled);
    require!(args.subject_kind == ext::KIND_WALLET || args.subject_kind == ext::KIND_BADGE, PofError::ZkSubjectKind);
    let subject_hash = ext::key_subject_hash(args.subject_kind, &a.controller.key()).ok_or(error!(PofError::BadSubjectKind))?;
    let t = c.assets.get(args.asset as usize).ok_or(error!(PofError::BadAsset))?;
    require!(t.enabled, PofError::BadAsset);
    require!(args.tier >= 1 && args.tier <= t.tiers(), PofError::BadTier);
    let n = args.tags.len();
    require!((1..=ZK_NOTES).contains(&n) && args.cts.len() == n, PofError::BadNoteCount);
    require!(args.tags[0] != [0u8; 32] && args.tags.windows(2).all(|w| w[0] < w[1]), PofError::NullHashesUnsorted);
    require!(ctx.remaining_accounts.len() == n, PofError::ZkLockMissing);

    // the proof, against inputs the program rebuilt
    let root_slot = check_roots(&a.tree, &args.state_root, &args.null_root)?;
    let payer = a.payer.key();
    let controller = a.controller.key();
    let cx = zk_context(args.subject_kind, &subject_hash, args.asset, args.tier, &controller, &payer, &args.nonce);
    let inputs = public_inputs(c, &a.zk, &args, cx)?;
    groth16::verify(&args.proof, &inputs).map_err(|e| match e {
        groth16::Groth16Error::InputNotInField => error!(PofError::ZkInputNotInField),
        _ => error!(PofError::ZkProofInvalid),
    })?;

    // the certificate (same rules as certify for an existing account)
    let tinfo = a.treasury.to_account_info();
    let t = &mut a.treasury;
    let cert = &mut a.certificate;
    if cert.payer == Pubkey::default() {
        t.open = add(t.open, 1)?;
    } else {
        require!(!cert.is_live(slot), PofError::AlreadyLive);
        if cert.status == STATUS_LIVE {
            unlive(c, t, cert);
            t.expired += 1;
        }
        if cert.payer != payer {
            let prior = a.prior_payer.as_ref().ok_or(error!(PofError::PriorPayerMissing))?;
            require_keys_eq!(prior.key(), cert.payer, PofError::PriorPayerMissing);
            let rent = cert.to_account_info().lamports();
            system_program::transfer(
                CpiContext::new(a.system_program.key(), system_program::Transfer { from: a.payer.to_account_info(), to: prior.to_account_info() }),
                rent,
            )?;
        }
    }
    let fee = take_fee(c, t, &a.payer, &tinfo, &a.holder_token, &a.system_program)?;
    let expiry = add(slot, c.params.validity_slots)?;
    cert.subject_kind = args.subject_kind;
    cert.subject_hash = subject_hash;
    cert.asset = args.asset;
    cert.tier = args.tier;
    cert.status = STATUS_LIVE;
    cert.certified_slot = slot;
    cert.issued_slot = slot;
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
    for (k, lock) in ctx.remaining_accounts.iter().enumerate() {
        let tag = args.tags[k];
        let (pda, bump) = Pubkey::find_program_address(&[LOCK_SEED, &tag], &crate::ID);
        require_keys_eq!(lock.key(), pda, PofError::ZkLockMissing);
        require!(lock.is_writable, PofError::ZkLockMissing);
        let value = NoteLock { certificate: cert_key, tag, payer, eph: args.eph, ct: args.cts[k], locked_slot: slot, bump };
        if lock.lamports() == 0 || *lock.owner == system_program::ID {
            let space = 8 + NoteLock::INIT_SPACE;
            let rent = Rent::get()?.minimum_balance(space);
            let seeds: &[&[u8]] = &[LOCK_SEED, &tag, &[bump]];
            system_program::create_account(
                CpiContext::new_with_signer(
                    a.system_program.key(),
                    system_program::CreateAccount { from: a.payer.to_account_info(), to: lock.clone() },
                    &[seeds],
                ),
                rent.saturating_sub(lock.lamports()),
                space as u64,
                &crate::ID,
            )?;
        } else {
            // an existing lock: only this certificate's own (remade over its revoked or expired self)
            require_keys_eq!(*lock.owner, crate::ID, PofError::ZkNoteLocked);
            let old = {
                let d = lock.try_borrow_data()?;
                NoteLock::try_deserialize(&mut &d[..]).map_err(|_| error!(PofError::ZkNoteLocked))?
            };
            require_keys_eq!(old.certificate, cert_key, PofError::ZkNoteLocked);
        }
        let mut d = lock.try_borrow_mut_data()?;
        value.try_serialize(&mut &mut d[..])?;
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
        tags: args.tags.clone(),
        eph: args.eph,
        cts: args.cts.clone(),
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
    pub system_program: Program<'info, System>,
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
}
