//! Proof of Funds: a live, public certificate that a subject holds at least a tier of SOL or USDC in a Helius Privacy Ring,
//! without showing the amount, revoked on chain the moment one of the disclosed notes is spent.
//!
//! The Verifier (off chain, open source, its every attestation in a public transparency log) takes the openings of the notes a
//! holder chooses to disclose, recomputes their commitments, checks they sit in the Rings tree at a recent root and that their
//! nullifiers are unspent, checks the sum reaches the tier, and signs the 240 bytes of CONTRACT §3 with ed25519. `certify` rebuilds
//! those bytes on chain from its arguments and accounts and checks them against the Ed25519 program instruction right before it
//! (instructions sysvar): the program id (one deployment), the subject, asset and tier, the root and its slot, the sorted salted
//! nullifier hashes (CONTRACT §5), the issue and expiry slots, the payer, the controller and a nonce. The certificate PDA
//! ["cert", subject_hash, [asset]] keeps the salted hashes h = sha256("pof:null:" ‖ salt ‖ nullifier), never the nullifiers.
//!
//! Revocation:
//! - `revoke_spent`: anyone who knows a disclosed note's salt and nullifier (the holder's revoke kit, the keeper) shows them; the
//!   program recomputes h and checks the nullifier is spent on the Rings program: (a) its nullifier PDA exists now, or (b) a
//!   membership path puts it in the tree's folded nullifier tree under a root the tree account holds (Poseidon syscall). Both
//!   are proofs from chain state alone; a missing PDA never reads as unspent.
//! - `revoke_by_holder`: the certificate's controller, at any moment.
//! - `expire`: anyone, after the expiry slot (or during the wind-down): the account closes, its rent back to the payer.
//!
//! Money: a fee per certify and renew (capped by FEE_CAP) goes to the treasury PDA; none when the payer's canonical $ROOT account
//! holds holder_min (1,000,000 $ROOT), none when the payer is the relayer (the holder paid it privately). `withdraw_fees` sends
//! the treasury's surplus to the dev wallet. The certificate's rent is the payer's and comes back at `expire`.
//!
//! Keys: the Verifier key rotates with a delay counted in slots (`set_verifier` proposes, the new key takes over by itself once
//! the delay passes, `apply_verifier` records it); pausing is immediate. The admin cannot sign attestations.
//!
//! Other programs gate on certificates with the CPI `require_certificate(subject_hash, asset, min_tier)` (it fails unless the
//! certificate is live, unexpired, of that asset and at least that tier, and returns its tier, expiry and controller), or read
//! the account directly with `read_certificate`. `pof_gate` (Rooms) is the reference consumer.

#![allow(clippy::too_many_arguments)]
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_lang::system_program;

pub mod errors;
pub mod ext;

use errors::PofError;

declare_id!("pofP4QRRDXnmDN9CNYiAGHfwMEgM7sLWhVcUMpsbynT");

/// This program's data account under the upgradeable loader: its upgrade authority alone may run `init_config`.
pub const PROGRAM_DATA: Pubkey = pubkey!("ETKHHhmbAD2AJbeDd961pDaet2Gnnv1DFg8x49ibbiHH");

pub const CONFIG_SEED: &[u8] = b"config";
pub const TREASURY_SEED: &[u8] = b"treasury";
pub const CERT_SEED: &[u8] = b"cert";
pub const PATH_SEED: &[u8] = b"path";

pub const MAX_ASSETS: usize = 4;
pub const MAX_TIERS: usize = 5;
pub const MAX_NOTES: usize = 8;
/// The fee per certify or renew can never be set above this (0.25 SOL).
pub const FEE_CAP: u64 = 250_000_000;

pub const STATUS_LIVE: u8 = 0;
pub const STATUS_REVOKED_SPENT: u8 = 1;
pub const STATUS_REVOKED_HOLDER: u8 = 2;
pub const STATUS_EXPIRED: u8 = 3;
/// Voided: signed by a Verifier key the admin has since revoked (`revoke_verifier_key`, then anyone's `void_by_key`).
pub const STATUS_VOIDED: u8 = 4;
pub const MAX_REVOKED_KEYS: usize = 4;
/// anchor_log may grow the anchored log by at most this many entries at once.
pub const MAX_LOG_STEP: u64 = 10_000_000;

pub const ATTESTATION_LEN: usize = 240;
pub const DOMAIN_CERT: &[u8; 4] = b"POF1";
/// A controller's signed revoke (CONTRACT §5): "POF-REVOKE1" ‖ program id ‖ certificate ‖ subject_hash ‖ asset ‖ nullset_hash ‖
/// issued_slot ‖ valid_until (156 bytes).
pub const DOMAIN_REVOKE: &[u8; 11] = b"POF-REVOKE1";
/// CONTRACT §7: the transparency log's signed tree head.
pub const DOMAIN_LOG: &[u8; 8] = b"POF-STH1";

// the floors of the validity and the rotation delay; the test build ("quick") lowers them so the suite expires and rotates in seconds
#[cfg(not(feature = "quick"))]
pub const VALIDITY_MIN: u64 = 9_000;
#[cfg(feature = "quick")]
pub const VALIDITY_MIN: u64 = 10;
#[cfg(not(feature = "quick"))]
pub const ROTATION_MIN: u64 = 9_000;
#[cfg(feature = "quick")]
pub const ROTATION_MIN: u64 = 5;
pub const VALIDITY_MAX: u64 = 1_512_000;
/// The launch rotation delay (about a day); the test build starts at 40 slots, so lowering it later is still tested against a held delay.
#[cfg(not(feature = "quick"))]
pub const LAUNCH_ROTATION: u64 = 216_000;
#[cfg(feature = "quick")]
pub const LAUNCH_ROTATION: u64 = 40;
pub const ROTATION_MAX: u64 = 1_296_000;

// ------------------------------------------------------------------------------------------------------------
// state

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct Params {
    /// Lamports per certify and per renew, to the treasury (at most FEE_CAP).
    pub fee_lamports: u64,
    /// Base units of $ROOT a payer's canonical account must hold to pay no fee (1,000,000 $ROOT at 6 decimals).
    pub holder_min: u64,
    /// An attestation's expiry may be at most this many slots after its issue slot.
    pub validity_slots: u64,
    /// An attestation must reach the chain within this many slots of its issue slot.
    pub max_attest_age: u64,
    /// The tree root must have been read at most this many slots before the issue slot.
    pub max_root_lag: u64,
    /// Slots between `set_verifier` and the new key taking over.
    pub rotation_delay: u64,
}

impl Params {
    pub fn launch() -> Self {
        Params {
            fee_lamports: 10_000_000,
            holder_min: 1_000_000 * 1_000_000,
            validity_slots: 216_000,
            max_attest_age: 300,
            max_root_lag: 9_000,
            rotation_delay: LAUNCH_ROTATION,
        }
    }
    pub fn check(&self) -> Result<()> {
        require!(self.fee_lamports <= FEE_CAP, PofError::FeeAboveCap);
        let ok = (1..=1_000_000_000_000_000_000).contains(&self.holder_min)
            && (VALIDITY_MIN..=VALIDITY_MAX).contains(&self.validity_slots)
            && (5..=9_000).contains(&self.max_attest_age)
            && (1..=216_000).contains(&self.max_root_lag)
            && (ROTATION_MIN..=ROTATION_MAX).contains(&self.rotation_delay);
        require!(ok, PofError::BadParams);
        Ok(())
    }
}

/// One asset's tier table (CONTRACT §2): tier i (1-based) needs at least mins[i-1] base units; zeros end the table.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, Default, InitSpace)]
pub struct AssetTiers {
    pub enabled: bool,
    /// The SPL mint (USDC), or the default key for native SOL.
    pub mint: Pubkey,
    pub decimals: u8,
    pub mins: [u64; MAX_TIERS],
}

impl AssetTiers {
    pub fn tiers(&self) -> u8 {
        self.mins.iter().take_while(|m| **m > 0).count() as u8
    }
    fn check(&self) -> Result<()> {
        let n = self.tiers() as usize;
        require!(n >= 1, PofError::BadParams);
        require!(self.mins[n..].iter().all(|m| *m == 0), PofError::BadParams);
        require!(self.mins[..n].windows(2).all(|w| w[0] < w[1]), PofError::BadParams);
        Ok(())
    }
}

pub fn sol_tiers() -> AssetTiers {
    let s = 1_000_000_000u64;
    AssetTiers { enabled: true, mint: Pubkey::default(), decimals: 9, mins: [s, 10 * s, 100 * s, 1_000 * s, 10_000 * s] }
}
pub fn usdc_tiers() -> AssetTiers {
    let u = 1_000_000u64;
    AssetTiers {
        enabled: true,
        mint: pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
        decimals: 6,
        mins: [100 * u, 1_000 * u, 10_000 * u, 100_000 * u, 1_000_000 * u],
    }
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    /// Where `withdraw_fees` sends the treasury's surplus.
    pub dev: Pubkey,
    /// The relayer's key: certificates it pays for owe no on-chain fee (the holder paid it privately).
    pub relayer: Pubkey,
    /// The Verifier's ed25519 key that signs attestations now (default: none, nothing certifies).
    pub verifier: Pubkey,
    /// A proposed key and the slot it takes over at (default key: nothing proposed).
    pub next_verifier: Pubkey,
    pub next_verifier_slot: u64,
    /// $ROOT; default until set_roles (nobody counts as a holder until then).
    pub root_mint: Pubkey,
    pub root_token_program: Pubkey,
    pub params: Params,
    /// The tier tables by asset id (CONTRACT §2): 0 SOL, 1 USDC, 2 and 3 free for new assets.
    pub assets: [AssetTiers; MAX_ASSETS],
    pub paused: bool,
    pub closing: bool,
    pub launch_slot: u64,
    /// A lowered rotation delay takes effect only after the old one has run: until held_until, set_verifier waits at least held_delay.
    pub held_delay: u64,
    pub held_until: u64,
    /// Verifier keys revoked by the admin (leaked or retired): they sign nothing more, and every certificate they signed is dead
    /// for require_certificate and Rooms at once, and can be voided by anyone.
    pub revoked_keys: [Pubkey; MAX_REVOKED_KEYS],
    pub bump: u8,
    pub treasury_bump: u8,
}

impl Config {
    pub fn is_revoked_key(&self, key: &Pubkey) -> bool {
        *key != Pubkey::default() && self.revoked_keys.iter().any(|k| k == key)
    }
    /// The key that signs now: the proposed one once its slot has come, else the current one.
    pub fn active_verifier(&self, slot: u64) -> Pubkey {
        if self.next_verifier != Pubkey::default() && slot >= self.next_verifier_slot {
            self.next_verifier
        } else {
            self.verifier
        }
    }
}

/// The treasury holds the fees (its lamports above its rent) and the public counters.
#[account]
#[derive(InitSpace)]
pub struct Treasury {
    pub fees_in: u64,
    pub fees_out: u64,
    /// certify calls that made or remade a certificate; renews.
    pub certified: u64,
    pub renewed: u64,
    pub revoked_spent: u64,
    pub revoked_holder: u64,
    pub expired: u64,
    /// Live certificates (status live, closed or not past their expiry yet) and the sum of their tier minimums by asset.
    pub live: u64,
    pub live_min: [u64; MAX_ASSETS],
    /// Certificate accounts that exist now (rent held for payers).
    pub open: u64,
    /// certify/renew paid by the relayer; by a $ROOT holder (no fee in both).
    pub relayed: u64,
    pub exempt: u64,
    /// Certificates voided because their Verifier key was revoked.
    pub voided: u64,
    /// The transparency log's latest signed head anchored on chain: its size, its root hash, the slot.
    pub log_size: u64,
    pub log_head: [u8; 32],
    pub log_slot: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Certificate {
    pub subject_kind: u8,
    pub subject_hash: [u8; 32],
    pub asset: u8,
    pub tier: u8,
    /// STATUS_LIVE, STATUS_REVOKED_SPENT, STATUS_REVOKED_HOLDER (STATUS_EXPIRED is what readers show past expiry_slot; the account
    /// itself closes at `expire`).
    pub status: u8,
    /// The slot this certificate was made (or remade after a revocation), and of its latest attestation.
    pub certified_slot: u64,
    pub issued_slot: u64,
    pub expiry_slot: u64,
    pub revoked_slot: u64,
    pub tree_root: [u8; 32],
    pub root_slot: u64,
    pub note_count: u8,
    /// The sorted salted nullifier hashes h (CONTRACT §5), the first note_count used.
    pub null_hashes: [[u8; 32]; MAX_NOTES],
    pub nullset_hash: [u8; 32],
    /// Paid the rent (gets it back at `expire`).
    pub payer: Pubkey,
    /// May revoke it and join rooms with it.
    pub controller: Pubkey,
    /// The Verifier key that signed the latest attestation.
    pub verifier: Pubkey,
    pub nonce: [u8; 16],
    /// The attestation's index in the transparency log (as the submitter states it; the log proof is the check).
    pub log_index: u64,
    pub renewals: u32,
    /// After revoke_spent: which note (255: none), its salt and nullifier, now public.
    pub revealed_index: u8,
    pub revealed_salt: [u8; 32],
    pub revealed_nullifier: [u8; 32],
    pub bump: u8,
}

impl Certificate {
    pub fn is_live(&self, slot: u64) -> bool {
        self.status == STATUS_LIVE && slot <= self.expiry_slot
    }
    /// The status a reader shows: expired once past expiry_slot while still marked live.
    pub fn shown_status(&self, slot: u64) -> u8 {
        if self.status == STATUS_LIVE && slot > self.expiry_slot {
            STATUS_EXPIRED
        } else {
            self.status
        }
    }
}

/// A membership path staged in parts (`stage_path`) for `revoke_spent_staged`, so the full 40-level path never has to fit one
/// transaction. PDA ["path", revoker, certificate]: only that revoker writes it, only for that certificate and that nullifier;
/// `revoke_spent_staged` hashes it to a nullifier root the tree holds at that moment and closes it (rent back to the revoker).
#[account(zero_copy)]
pub struct PathBuffer {
    pub revoker: Pubkey,
    pub certificate: Pubkey,
    pub nullifier: [u8; 32],
    pub next_value: [u8; 32],
    pub leaf_index: u64,
    pub path: [[u8; 32]; ext::NULL_TREE_HEIGHT],
    /// Siblings written so far from the leaf up (levels above are empty subtrees when consumed).
    pub levels: u8,
    pub bump: u8,
    pub _pad: [u8; 6],
}

/// What `require_certificate` returns (also its return data).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub struct CertView {
    pub subject_kind: u8,
    pub tier: u8,
    pub expiry_slot: u64,
    pub controller: Pubkey,
}

/// The attestation as `certify` and `renew` take it; with the payer (signer) and the program id it rebuilds CONTRACT §3.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub struct Attestation {
    pub subject_kind: u8,
    pub subject_hash: [u8; 32],
    pub asset: u8,
    pub tier: u8,
    pub tree_root: [u8; 32],
    pub root_slot: u64,
    /// The salted nullifier hashes, sorted ascending, 1 to 8 (their count is the note_count byte).
    pub null_hashes: Vec<[u8; 32]>,
    pub issued_slot: u64,
    pub expiry_slot: u64,
    pub controller: Pubkey,
    pub nonce: [u8; 16],
}

// ------------------------------------------------------------------------------------------------------------
// the bytes the Verifier signs

/// sha256(h_1 ‖ … ‖ h_n) of the sorted salted hashes (CONTRACT §5).
pub fn nullset_hash(hashes: &[[u8; 32]]) -> [u8; 32] {
    let parts: Vec<&[u8]> = hashes.iter().map(|h| h.as_ref()).collect();
    ext::sha256(&parts)
}

/// CONTRACT §3: the 240 bytes of an attestation.
pub fn attestation_bytes(program_id: &Pubkey, a: &Attestation, payer: &Pubkey) -> [u8; ATTESTATION_LEN] {
    let mut b = [0u8; ATTESTATION_LEN];
    b[0..4].copy_from_slice(DOMAIN_CERT);
    b[4..36].copy_from_slice(program_id.as_ref());
    b[36] = a.subject_kind;
    b[37..69].copy_from_slice(&a.subject_hash);
    b[69] = a.asset;
    b[70] = a.tier;
    b[71..103].copy_from_slice(&a.tree_root);
    b[103..111].copy_from_slice(&a.root_slot.to_le_bytes());
    b[111] = a.null_hashes.len() as u8;
    b[112..144].copy_from_slice(&nullset_hash(&a.null_hashes));
    b[144..152].copy_from_slice(&a.issued_slot.to_le_bytes());
    b[152..160].copy_from_slice(&a.expiry_slot.to_le_bytes());
    b[160..192].copy_from_slice(payer.as_ref());
    b[192..224].copy_from_slice(a.controller.as_ref());
    b[224..240].copy_from_slice(&a.nonce);
    b
}

/// CONTRACT §7, the transparency log's signed tree head: "POF-STH1" ‖ program id ‖ tree size u64 LE ‖ root hash (80 bytes).
pub fn log_bytes(program_id: &Pubkey, size: u64, head: &[u8; 32]) -> [u8; 80] {
    let mut b = [0u8; 80];
    b[0..8].copy_from_slice(DOMAIN_LOG);
    b[8..40].copy_from_slice(program_id.as_ref());
    b[40..48].copy_from_slice(&size.to_le_bytes());
    b[48..80].copy_from_slice(head);
    b
}

/// The 156 bytes a certificate's controller signs to revoke it without sending a transaction itself (anyone, e.g. the relayer,
/// submits them): "POF-REVOKE1" (11) ‖ program id (32) ‖ certificate address (32) ‖ subject_hash (32) ‖ asset (1) ‖ nullset_hash
/// (32) ‖ issued_slot u64 LE (8) ‖ valid_until u64 LE (8). Bound to the certificate's current attestation (a renew or remake
/// needs a new signature) and refused after valid_until, so a signed revoke cannot be held back for later.
pub fn revoke_bytes(program_id: &Pubkey, certificate: &Pubkey, cert: &Certificate, valid_until: u64) -> [u8; 156] {
    let mut b = [0u8; 156];
    b[0..11].copy_from_slice(DOMAIN_REVOKE);
    b[11..43].copy_from_slice(program_id.as_ref());
    b[43..75].copy_from_slice(certificate.as_ref());
    b[75..107].copy_from_slice(&cert.subject_hash);
    b[107] = cert.asset;
    b[108..140].copy_from_slice(&cert.nullset_hash);
    b[140..148].copy_from_slice(&cert.issued_slot.to_le_bytes());
    b[148..156].copy_from_slice(&valid_until.to_le_bytes());
    b
}

/// A membership path of a nullifier in the tree's folded nullifier tree (pof/RINGS.md §3): its leaf index, the next value of
/// its indexed leaf, the siblings from the leaf up (at most 40; upper levels left out are empty subtrees).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub struct Membership {
    pub leaf_index: u64,
    pub next_value: [u8; 32],
    pub path: Vec<[u8; 32]>,
}

// ------------------------------------------------------------------------------------------------------------
// helpers

fn add(a: u64, b: u64) -> Result<u64> {
    a.checked_add(b).ok_or(error!(PofError::Overflow))
}

/// The message before this instruction must be `want`, signed by the key active now.
fn check_signed(ix: &AccountInfo, c: &Config, slot: u64, want: &[u8]) -> Result<Pubkey> {
    let key = c.active_verifier(slot);
    require!(key != Pubkey::default(), PofError::NoVerifier);
    require!(!c.is_revoked_key(&key), PofError::KeyRevoked);
    let (signer, msg) = ext::signed_before(ix)?;
    require_keys_eq!(signer, key, PofError::WrongVerifier);
    require!(msg.as_slice() == want, PofError::AttestationMismatch);
    Ok(key)
}

/// Everything about an attestation the chain can check by itself.
fn check_attestation(c: &Config, a: &Attestation, slot: u64) -> Result<()> {
    match a.subject_kind {
        ext::KIND_WALLET | ext::KIND_BADGE => {
            // the controller of a wallet or badge certificate is that key itself
            require!(ext::key_subject_hash(a.subject_kind, &a.controller) == Some(a.subject_hash), PofError::SubjectMismatch);
        }
        ext::KIND_X => require_keys_neq!(a.controller, Pubkey::default(), PofError::NotController),
        _ => return err!(PofError::BadSubjectKind),
    }
    let t = c.assets.get(a.asset as usize).ok_or(error!(PofError::BadAsset))?;
    require!(t.enabled, PofError::BadAsset);
    require!(a.tier >= 1 && a.tier <= t.tiers(), PofError::BadTier);
    let n = a.null_hashes.len();
    require!((1..=MAX_NOTES).contains(&n), PofError::BadNoteCount);
    require!(a.null_hashes.windows(2).all(|w| w[0] < w[1]), PofError::NullHashesUnsorted);
    require!(a.issued_slot <= slot, PofError::IssuedInFuture);
    require!(slot - a.issued_slot <= c.params.max_attest_age, PofError::AttestationStale);
    require!(a.root_slot <= a.issued_slot && a.issued_slot - a.root_slot <= c.params.max_root_lag, PofError::RootStale);
    require!(a.expiry_slot > a.issued_slot && a.expiry_slot - a.issued_slot <= c.params.validity_slots, PofError::BadExpiry);
    require!(a.expiry_slot > slot, PofError::Expired);
    Ok(())
}

/// Is this payer a root holder (canonical account of the root mint holding at least holder_min)?
fn is_holder(c: &Config, payer: &Pubkey, holder_token: &AccountInfo) -> Result<bool> {
    if c.root_mint == Pubkey::default() {
        return Ok(false);
    }
    require_keys_eq!(holder_token.key(), ext::ata(payer, &c.root_mint, &c.root_token_program), PofError::BadHolderAccount);
    Ok(matches!(ext::token_view(holder_token), Some((m, o, amt)) if m == c.root_mint && o == *payer && amt >= c.params.holder_min))
}

/// The fee for one certify or renew, paid (or not) to the treasury. Returns what was paid.
fn take_fee<'info>(
    c: &Config,
    t: &mut Treasury,
    payer: &Signer<'info>,
    treasury: &AccountInfo<'info>,
    holder_token: &AccountInfo<'info>,
    system: &Program<'info, System>,
) -> Result<u64> {
    if payer.key() == c.relayer {
        t.relayed += 1;
        return Ok(0);
    }
    if is_holder(c, &payer.key(), holder_token)? {
        t.exempt += 1;
        return Ok(0);
    }
    let fee = c.params.fee_lamports;
    if fee > 0 {
        system_program::transfer(
            CpiContext::new(system.key(), system_program::Transfer { from: payer.to_account_info(), to: treasury.clone() }),
            fee,
        )?;
        t.fees_in = add(t.fees_in, fee)?;
    }
    Ok(fee)
}

fn tier_min(c: &Config, asset: u8, tier: u8) -> u64 {
    c.assets[asset as usize].mins[(tier - 1) as usize]
}

/// A live certificate stops counting as live (revoked or expired).
fn unlive(c: &Config, t: &mut Treasury, cert: &Certificate) {
    t.live = t.live.saturating_sub(1);
    let i = cert.asset as usize;
    t.live_min[i] = t.live_min[i].saturating_sub(tier_min(c, cert.asset, cert.tier));
}

/// Reads a certificate account directly (no CPI): it must be this program's, at the PDA of (subject_hash, asset).
pub fn read_certificate(info: &AccountInfo, subject_hash: &[u8; 32], asset: u8) -> Result<Certificate> {
    let (want, _) = Pubkey::find_program_address(&[CERT_SEED, subject_hash, &[asset]], &crate::ID);
    require_keys_eq!(info.key(), want, PofError::BadCertificate);
    require_keys_eq!(*info.owner, crate::ID, PofError::BadCertificate);
    let data = info.try_borrow_data()?;
    let mut d: &[u8] = &data;
    Certificate::try_deserialize(&mut d).map_err(|_| error!(PofError::BadCertificate))
}

/// The gate every consumer applies: live, unexpired, signed by a key that is not revoked, this asset, at least `min_tier`.
pub fn gate(cert: &Certificate, config: &Config, asset: u8, min_tier: u8, slot: u64) -> Result<CertView> {
    require!(cert.asset == asset, PofError::AssetMismatch);
    require!(cert.status == STATUS_LIVE, PofError::NotLive);
    require!(!config.is_revoked_key(&cert.verifier), PofError::KeyRevoked);
    require!(slot <= cert.expiry_slot, PofError::CertificateExpired);
    require!(cert.tier >= min_tier, PofError::TierTooLow);
    Ok(CertView { subject_kind: cert.subject_kind, tier: cert.tier, expiry_slot: cert.expiry_slot, controller: cert.controller })
}

fn revoke(c: &Config, t: &mut Treasury, cert: &mut Certificate, status: u8, slot: u64) {
    unlive(c, t, cert);
    cert.status = status;
    cert.revoked_slot = slot;
    if status == STATUS_REVOKED_SPENT {
        t.revoked_spent += 1;
    } else {
        t.revoked_holder += 1;
    }
}

/// revoke_spent's common part: the note's salted hash must match, then the certificate is revoked and the pair made public.
fn revoke_with_pair(c: &Config, t: &mut Treasury, cert: &mut Certificate, index: u8, salt: [u8; 32], nullifier: [u8; 32], slot: u64, by: Pubkey, path: u8) -> Result<()> {
    require!(cert.status == STATUS_LIVE, PofError::NotLive);
    require!(index < cert.note_count, PofError::BadIndex);
    require!(ext::salted_nullifier(&salt, &nullifier) == cert.null_hashes[index as usize], PofError::NullifierMismatch);
    revoke(c, t, cert, STATUS_REVOKED_SPENT, slot);
    cert.revealed_index = index;
    cert.revealed_salt = salt;
    cert.revealed_nullifier = nullifier;
    emit!(Revoked { subject_hash: cert.subject_hash, asset: cert.asset, tier: cert.tier, status: STATUS_REVOKED_SPENT, slot, by, index, salt, nullifier, path });
    Ok(())
}

// ------------------------------------------------------------------------------------------------------------
// instructions

#[program]
pub mod pof {
    use super::*;

    /// Only the program's upgrade authority, who becomes the admin and pays the config and treasury rent. The Verifier and the
    /// relayer keys are set at once; SOL and USDC tiers as CONTRACT §2; the launch parameters.
    pub fn init_config(ctx: Context<InitConfig>, verifier: Pubkey, relayer: Pubkey, dev: Pubkey) -> Result<()> {
        let auth = ext::upgrade_authority(&ctx.accounts.program_data)?;
        require!(auth == Some(ctx.accounts.admin.key()), PofError::NotUpgradeAuthority);
        let c = &mut ctx.accounts.config;
        c.admin = ctx.accounts.admin.key();
        c.dev = dev;
        c.relayer = relayer;
        c.verifier = verifier;
        c.params = Params::launch();
        c.assets[0] = sol_tiers();
        c.assets[1] = usdc_tiers();
        c.launch_slot = Clock::get()?.slot;
        c.bump = ctx.bumps.config;
        c.treasury_bump = ctx.bumps.treasury;
        ctx.accounts.treasury.bump = ctx.bumps.treasury;
        emit!(ConfigSet { admin: c.admin, dev, relayer, root_mint: Pubkey::default(), params: c.params });
        emit!(VerifierSet { verifier, next_verifier: Pubkey::default(), next_verifier_slot: 0 });
        Ok(())
    }

    /// The dev and relayer keys (None leaves them), and the root mint once (pass its mint account).
    pub fn set_roles(ctx: Context<SetRoles>, dev: Option<Pubkey>, relayer: Option<Pubkey>) -> Result<()> {
        let c = &mut ctx.accounts.config;
        if let Some(k) = dev {
            c.dev = k;
        }
        if let Some(k) = relayer {
            c.relayer = k;
        }
        if let Some(m) = &ctx.accounts.root_mint {
            require!(c.root_mint == Pubkey::default(), PofError::RootSet);
            require!(ext::is_mint(m), PofError::BadMint);
            c.root_mint = m.key();
            c.root_token_program = *m.owner;
        }
        emit!(ConfigSet { admin: c.admin, dev: c.dev, relayer: c.relayer, root_mint: c.root_mint, params: c.params });
        Ok(())
    }

    /// Every parameter at once, within the bounds (the fee at most FEE_CAP).
    pub fn set_params(ctx: Context<AdminOnly>, params: Params) -> Result<()> {
        params.check()?;
        let slot = Clock::get()?.slot;
        let c = &mut ctx.accounts.config;
        // lowering the rotation delay is itself delayed: for the old delay's length, proposals still wait at least the old delay
        if params.rotation_delay < c.params.rotation_delay {
            let held = if slot < c.held_until { c.held_delay.max(c.params.rotation_delay) } else { c.params.rotation_delay };
            c.held_delay = held;
            c.held_until = add(slot, held)?;
        }
        c.params = params;
        emit!(ConfigSet { admin: c.admin, dev: c.dev, relayer: c.relayer, root_mint: c.root_mint, params });
        Ok(())
    }

    /// The fee per certify and per renew alone (at most FEE_CAP).
    pub fn set_fee(ctx: Context<AdminOnly>, fee_lamports: u64) -> Result<()> {
        require!(fee_lamports <= FEE_CAP, PofError::FeeAboveCap);
        let c = &mut ctx.accounts.config;
        c.params.fee_lamports = fee_lamports;
        emit!(ConfigSet { admin: c.admin, dev: c.dev, relayer: c.relayer, root_mint: c.root_mint, params: c.params });
        Ok(())
    }

    /// A new asset's tier table in a free slot; on an asset already set only `enabled` may change (the tiers of certificates
    /// already issued never change meaning).
    pub fn set_asset(ctx: Context<AdminOnly>, asset: u8, tiers: AssetTiers) -> Result<()> {
        let c = &mut ctx.accounts.config;
        let slot = c.assets.get_mut(asset as usize).ok_or(error!(PofError::BadAsset))?;
        if slot.tiers() == 0 {
            tiers.check()?;
            *slot = tiers;
        } else {
            require!(slot.mint == tiers.mint && slot.decimals == tiers.decimals && slot.mins == tiers.mins, PofError::BadParams);
            slot.enabled = tiers.enabled;
        }
        emit!(AssetSet { asset, tiers: *slot });
        Ok(())
    }

    /// Propose the next Verifier key: it takes over rotation_delay slots from now (by itself; `apply_verifier` records it). The
    /// default key cancels a pending proposal at once.
    pub fn set_verifier(ctx: Context<AdminOnly>, next: Pubkey) -> Result<()> {
        let slot = Clock::get()?.slot;
        let c = &mut ctx.accounts.config;
        // a proposal whose slot has come is the key now: record it before a new proposal replaces it
        if c.next_verifier != Pubkey::default() && slot >= c.next_verifier_slot {
            c.verifier = c.next_verifier;
        }
        c.next_verifier = next;
        let delay = if slot < c.held_until { c.params.rotation_delay.max(c.held_delay) } else { c.params.rotation_delay };
        c.next_verifier_slot = if next == Pubkey::default() { 0 } else { add(slot, delay)? };
        emit!(VerifierSet { verifier: c.verifier, next_verifier: c.next_verifier, next_verifier_slot: c.next_verifier_slot });
        Ok(())
    }

    /// Anyone, once the proposed key's slot has come: it becomes the recorded key.
    pub fn apply_verifier(ctx: Context<ApplyVerifier>) -> Result<()> {
        let slot = Clock::get()?.slot;
        let c = &mut ctx.accounts.config;
        require!(c.next_verifier != Pubkey::default() && slot >= c.next_verifier_slot, PofError::NoRotationDue);
        c.verifier = c.next_verifier;
        c.next_verifier = Pubkey::default();
        c.next_verifier_slot = 0;
        emit!(VerifierSet { verifier: c.verifier, next_verifier: Pubkey::default(), next_verifier_slot: 0 });
        Ok(())
    }

    /// No certify or renew while paused (revocations and expiry never pause). Immediate, for a leaked Verifier key.
    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        emit!(PausedSet { paused });
        Ok(())
    }

    /// Certify a subject: the Verifier's attestation (the Ed25519 instruction right before this one) is checked against the bytes
    /// rebuilt here. A new certificate, or one remade over a revoked or expired one (whose rent goes back to its old payer).
    pub fn certify<'info>(ctx: Context<'info, Certify<'info>>, att: Attestation, log_index: u64) -> Result<()> {
        let slot = Clock::get()?.slot;
        let a = ctx.accounts;
        let c = &a.config;
        require!(!c.closing, PofError::Closing);
        require!(!c.paused, PofError::Paused);
        check_attestation(c, &att, slot)?;
        let payer = a.payer.key();
        let verifier = check_signed(&a.instructions, c, slot, &attestation_bytes(&crate::ID, &att, &payer))?;
        let tinfo = a.treasury.to_account_info();
        let t = &mut a.treasury;
        let cert = &mut a.certificate;
        let mut surplus = 0u64;
        if cert.payer == Pubkey::default() {
            t.open = add(t.open, 1)?;
        } else {
            // an existing account: only over a revoked or expired certificate, and only with a newer attestation
            require!(!cert.is_live(slot), PofError::AlreadyLive);
            require!(att.issued_slot > cert.issued_slot, PofError::Replayed);
            if cert.status == STATUS_LIVE {
                unlive(c, t, cert);
                t.expired += 1;
            }
            // the account's rent is its old payer's: the new payer buys it out at exactly the rent-exempt minimum. Anything above
            // it (lamports anyone may send to a PDA) goes to the treasury, so a donation can never make a remake cost more.
            // (the surplus moves after every CPI below: a direct lamport change must not precede a CPI it is not part of)
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
        if surplus > 0 {
            ext::shift(&cert.to_account_info(), &tinfo, surplus)?;
            t.fees_in = add(t.fees_in, surplus)?;
        }
        let n = att.null_hashes.len();
        cert.subject_kind = att.subject_kind;
        cert.subject_hash = att.subject_hash;
        cert.asset = att.asset;
        cert.tier = att.tier;
        cert.status = STATUS_LIVE;
        cert.certified_slot = slot;
        cert.issued_slot = att.issued_slot;
        cert.expiry_slot = att.expiry_slot;
        cert.revoked_slot = 0;
        cert.tree_root = att.tree_root;
        cert.root_slot = att.root_slot;
        cert.note_count = n as u8;
        cert.null_hashes = [[0u8; 32]; MAX_NOTES];
        cert.null_hashes[..n].copy_from_slice(&att.null_hashes);
        cert.nullset_hash = nullset_hash(&att.null_hashes);
        cert.payer = payer;
        cert.controller = att.controller;
        cert.verifier = verifier;
        cert.nonce = att.nonce;
        cert.log_index = log_index;
        cert.renewals = 0;
        cert.revealed_index = u8::MAX;
        cert.revealed_salt = [0u8; 32];
        cert.revealed_nullifier = [0u8; 32];
        cert.bump = ctx.bumps.certificate;
        t.certified += 1;
        t.live += 1;
        let i = att.asset as usize;
        t.live_min[i] = add(t.live_min[i], tier_min(c, att.asset, att.tier))?;
        emit!(Certified {
            subject_kind: att.subject_kind,
            subject_hash: att.subject_hash,
            asset: att.asset,
            tier: att.tier,
            certified_slot: slot,
            expiry_slot: att.expiry_slot,
            note_count: n as u8,
            payer,
            controller: att.controller,
            verifier,
            log_index,
            fee,
        });
        Ok(())
    }

    /// A fresh attestation on the same notes (same salted hashes), subject, asset and controller: new root, slots and tier.
    pub fn renew(ctx: Context<Renew>, att: Attestation) -> Result<()> {
        let slot = Clock::get()?.slot;
        let a = ctx.accounts;
        let c = &a.config;
        require!(!c.closing, PofError::Closing);
        require!(!c.paused, PofError::Paused);
        check_attestation(c, &att, slot)?;
        let payer = a.payer.key();
        let verifier = check_signed(&a.instructions, c, slot, &attestation_bytes(&crate::ID, &att, &payer))?;
        let tinfo = a.treasury.to_account_info();
        let t = &mut a.treasury;
        let cert = &mut a.certificate;
        require!(cert.status == STATUS_LIVE, PofError::NotLive);
        require!(slot <= cert.expiry_slot, PofError::CertificateExpired);
        let n = att.null_hashes.len();
        require!(
            cert.subject_kind == att.subject_kind && cert.controller == att.controller && n == cert.note_count as usize && cert.null_hashes[..n] == att.null_hashes[..],
            PofError::RenewMismatch
        );
        require!(att.issued_slot > cert.issued_slot, PofError::Replayed);
        let fee = take_fee(c, t, &a.payer, &tinfo, &a.holder_token, &a.system_program)?;
        let i = cert.asset as usize;
        t.live_min[i] = add(t.live_min[i].saturating_sub(tier_min(c, cert.asset, cert.tier)), tier_min(c, att.asset, att.tier))?;
        cert.tier = att.tier;
        cert.issued_slot = att.issued_slot;
        cert.expiry_slot = att.expiry_slot;
        cert.tree_root = att.tree_root;
        cert.root_slot = att.root_slot;
        cert.verifier = verifier;
        cert.nonce = att.nonce;
        cert.renewals += 1;
        t.renewed += 1;
        emit!(Renewed { subject_hash: cert.subject_hash, asset: cert.asset, tier: cert.tier, issued_slot: att.issued_slot, expiry_slot: att.expiry_slot, payer, verifier, fee, renewals: cert.renewals });
        Ok(())
    }

    /// Anyone: a disclosed note's salt and nullifier, and a proof that the nullifier is spent on the Rings program: without
    /// `membership`, its nullifier PDA ["nullifier", tree, nullifier] exists now (pass it as nullifier_account); with it, the
    /// nullifier is a leaf of the tree's folded nullifier tree under one of the 100 roots the tree holds (for a PDA the pool has
    /// closed). The salt and nullifier become public.
    pub fn revoke_spent(ctx: Context<RevokeSpent>, index: u8, salt: [u8; 32], nullifier: [u8; 32], membership: Option<Membership>) -> Result<()> {
        let slot = Clock::get()?.slot;
        let a = ctx.accounts;
        let (spent, path) = match &membership {
            None => {
                let nf = a.nullifier_account.as_ref().ok_or(error!(PofError::BadRingsAccounts))?;
                (ext::spent_on_rings(&a.tree, nf, &nullifier)?, 0)
            }
            Some(m) => (ext::spent_in_nullifier_tree(&a.tree, &nullifier, &m.next_value, m.leaf_index, &m.path)?, 1),
        };
        require!(spent, PofError::NotSpent);
        revoke_with_pair(&a.config, &mut a.treasury, &mut a.certificate, index, salt, nullifier, slot, a.caller.key(), path)
    }

    /// Open the revoker's buffer for this certificate (the revoker pays its rent) with the nullifier, its next value, its leaf
    /// index and the first siblings (from the leaf up); `stage_path` adds the rest. Two transactions carry the full 40 levels.
    pub fn open_path(ctx: Context<OpenPath>, nullifier: [u8; 32], next_value: [u8; 32], leaf_index: u64, siblings: Vec<[u8; 32]>) -> Result<()> {
        let a = ctx.accounts;
        require!(a.certificate.status == STATUS_LIVE, PofError::NotLive);
        require!(siblings.len() <= ext::NULL_TREE_HEIGHT, PofError::BadIndex);
        let mut b = a.buffer.load_init()?;
        b.revoker = a.revoker.key();
        b.certificate = a.certificate.key();
        b.nullifier = nullifier;
        b.next_value = next_value;
        b.leaf_index = leaf_index;
        b.path[..siblings.len()].copy_from_slice(&siblings);
        b.levels = siblings.len() as u8;
        b.bump = ctx.bumps.buffer;
        Ok(())
    }

    /// Write `siblings` at levels offset.. of the revoker's open buffer (no gap above what is written; a level may be rewritten).
    pub fn stage_path(ctx: Context<StagePath>, offset: u8, siblings: Vec<[u8; 32]>) -> Result<()> {
        let mut b = ctx.accounts.buffer.load_mut()?;
        let end = offset as usize + siblings.len();
        require!(end <= ext::NULL_TREE_HEIGHT && !siblings.is_empty() && offset <= b.levels, PofError::BadIndex);
        b.path[offset as usize..end].copy_from_slice(&siblings);
        b.levels = b.levels.max(end as u8);
        Ok(())
    }

    /// The staged proof: the revoker's buffer for this certificate holds a membership path of its nullifier; the program hashes
    /// all 40 levels to the root and checks it is one of the 100 nullifier roots the tree account holds NOW, checks the salted
    /// hash of the disclosed note, revokes, and closes the buffer (rent back to the revoker).
    pub fn revoke_spent_staged(ctx: Context<RevokeSpentStaged>, index: u8, salt: [u8; 32]) -> Result<()> {
        let slot = Clock::get()?.slot;
        let a = ctx.accounts;
        let nullifier = {
            let b = a.buffer.load()?;
            require_keys_eq!(b.certificate, a.certificate.key(), PofError::BadCertificate);
            let spent = ext::spent_in_nullifier_tree(&a.tree, &b.nullifier, &b.next_value, b.leaf_index, &b.path[..b.levels as usize])?;
            require!(spent, PofError::NotSpent);
            b.nullifier
        };
        revoke_with_pair(&a.config, &mut a.treasury, &mut a.certificate, index, salt, nullifier, slot, a.revoker.key(), 1)
    }

    /// The revoker drops its staged buffer (rent back); during the wind-down anyone may.
    pub fn close_path(ctx: Context<ClosePath>) -> Result<()> {
        let revoker = ctx.accounts.buffer.load()?.revoker;
        require_keys_eq!(revoker, ctx.accounts.revoker.key(), PofError::NotPayer);
        require!(ctx.accounts.caller.key() == revoker || ctx.accounts.config.closing, PofError::NotPayer);
        Ok(())
    }

    /// The certificate's controller withdraws it, at any moment.
    pub fn revoke_by_holder(ctx: Context<RevokeByHolder>) -> Result<()> {
        let slot = Clock::get()?.slot;
        let a = ctx.accounts;
        let cert = &mut a.certificate;
        require_keys_eq!(a.controller.key(), cert.controller, PofError::NotController);
        require!(cert.status == STATUS_LIVE, PofError::NotLive);
        revoke(&a.config, &mut a.treasury, cert, STATUS_REVOKED_HOLDER, slot);
        emit!(Revoked { subject_hash: cert.subject_hash, asset: cert.asset, tier: cert.tier, status: STATUS_REVOKED_HOLDER, slot, by: a.controller.key(), index: u8::MAX, salt: [0; 32], nullifier: [0; 32], path: 3 });
        Ok(())
    }

    /// Anyone submits the controller's signed revoke (Ed25519 instruction right before, signed by the certificate's controller
    /// key over the 156 POF-REVOKE1 bytes, usable until `valid_until`). The holder's wallet never signs or pays: for an X-handle
    /// or badge certificate the relayer submits it.
    pub fn revoke_signed(ctx: Context<RevokeSigned>, valid_until: u64) -> Result<()> {
        let slot = Clock::get()?.slot;
        let a = ctx.accounts;
        let key = a.certificate.key();
        let cert = &mut a.certificate;
        require!(cert.status == STATUS_LIVE, PofError::NotLive);
        require!(slot <= valid_until, PofError::Expired);
        let (signer, msg) = ext::signed_before(&a.instructions)?;
        require_keys_eq!(signer, cert.controller, PofError::NotController);
        require!(msg.as_slice() == revoke_bytes(&crate::ID, &key, cert, valid_until), PofError::AttestationMismatch);
        revoke(&a.config, &mut a.treasury, cert, STATUS_REVOKED_HOLDER, slot);
        emit!(Revoked { subject_hash: cert.subject_hash, asset: cert.asset, tier: cert.tier, status: STATUS_REVOKED_HOLDER, slot, by: a.caller.key(), index: u8::MAX, salt: [0; 32], nullifier: [0; 32], path: 4 });
        Ok(())
    }

    /// Anyone, past the expiry slot (or at any moment during the wind-down): the account closes, its rent back to its payer.
    pub fn expire(ctx: Context<Expire>) -> Result<()> {
        let slot = Clock::get()?.slot;
        let a = ctx.accounts;
        let cert = &a.certificate;
        require!(slot > cert.expiry_slot || a.config.closing, PofError::NotExpired);
        let t = &mut a.treasury;
        if cert.status == STATUS_LIVE {
            unlive(&a.config, t, cert);
            t.expired += 1;
        }
        t.open = t.open.saturating_sub(1);
        emit!(Expired { subject_hash: cert.subject_hash, asset: cert.asset, tier: cert.tier, status: cert.status, slot, payer: cert.payer });
        Ok(())
    }

    /// Anyone submits the transparency log's signed tree head (CONTRACT §7; Ed25519 instruction right before, by the active
    /// Verifier key): "POF-STH1" ‖ program id ‖ size ‖ root. The anchored log only grows.
    pub fn anchor_log(ctx: Context<AnchorLog>, size: u64, head: [u8; 32]) -> Result<()> {
        let slot = Clock::get()?.slot;
        let a = ctx.accounts;
        check_signed(&a.instructions, &a.config, slot, &log_bytes(&crate::ID, size, &head))?;
        let t = &mut a.treasury;
        require!(size > t.log_size && size - t.log_size <= MAX_LOG_STEP, PofError::LogNotGrowing);
        t.log_size = size;
        t.log_head = head;
        t.log_slot = slot;
        emit!(LogAnchored { size, head, slot });
        Ok(())
    }

    /// The CPI gate for other programs: fails unless the certificate at ["cert", subject_hash, [asset]] is live, unexpired and at
    /// least `min_tier`; returns its kind, tier, expiry and controller.
    pub fn require_certificate(ctx: Context<RequireCertificate>, subject_hash: [u8; 32], asset: u8, min_tier: u8) -> Result<CertView> {
        let cert = read_certificate(&ctx.accounts.certificate, &subject_hash, asset)?;
        gate(&cert, &ctx.accounts.config, asset, min_tier, Clock::get()?.slot)
    }

    /// The admin revokes a Verifier key at once (a leak, or a key retired after rotation): it signs nothing more, and every
    /// certificate it signed fails require_certificate and Rooms from now on; `void_by_key` marks each of them. At most 4 keys.
    pub fn revoke_verifier_key(ctx: Context<AdminOnly>, key: Pubkey) -> Result<()> {
        require_keys_neq!(key, Pubkey::default(), PofError::BadParams);
        let c = &mut ctx.accounts.config;
        if !c.is_revoked_key(&key) {
            let free = c.revoked_keys.iter().position(|k| *k == Pubkey::default()).ok_or(error!(PofError::BadParams))?;
            c.revoked_keys[free] = key;
        }
        emit!(VerifierKeyRevoked { key, slot: Clock::get()?.slot });
        Ok(())
    }

    /// Anyone: a live certificate signed by a revoked Verifier key becomes voided (status 4).
    pub fn void_by_key(ctx: Context<VoidByKey>) -> Result<()> {
        let slot = Clock::get()?.slot;
        let a = ctx.accounts;
        let cert = &mut a.certificate;
        require!(cert.status == STATUS_LIVE, PofError::NotLive);
        require!(a.config.is_revoked_key(&cert.verifier), PofError::KeyNotRevoked);
        unlive(&a.config, &mut a.treasury, cert);
        cert.status = STATUS_VOIDED;
        cert.revoked_slot = slot;
        a.treasury.voided += 1;
        emit!(Revoked { subject_hash: cert.subject_hash, asset: cert.asset, tier: cert.tier, status: STATUS_VOIDED, slot, by: a.caller.key(), index: u8::MAX, salt: [0; 32], nullifier: [0; 32], path: 5 });
        Ok(())
    }

    /// The treasury's fees to the dev wallet (0: all of them); its rent stays.
    pub fn withdraw_fees(ctx: Context<WithdrawFees>, lamports: u64) -> Result<()> {
        let a = ctx.accounts;
        let info = a.treasury.to_account_info();
        let free = info.lamports().saturating_sub(Rent::get()?.minimum_balance(info.data_len()));
        let amount = if lamports == 0 { free } else { lamports };
        require!(amount <= free, PofError::TreasuryShort);
        ext::shift(&info, &a.dev.to_account_info(), amount)?;
        let t = &mut a.treasury;
        t.fees_out = add(t.fees_out, amount)?;
        emit!(FeesWithdrawn { lamports: amount, to: a.dev.key() });
        Ok(())
    }

    /// One way: no certify or renew; anyone may `expire` any certificate (rent back to its payer). See wind-down.mjs.
    pub fn close_begin(ctx: Context<AdminOnly>) -> Result<()> {
        ctx.accounts.config.closing = true;
        emit!(ClosingBegun { slot: Clock::get()?.slot });
        Ok(())
    }

    /// The last step of the wind-down: no certificate account left. The treasury (fees and rent) and the config close to the admin.
    pub fn close_config(ctx: Context<CloseConfig>) -> Result<()> {
        require!(ctx.accounts.config.closing, PofError::NotClosing);
        require!(ctx.accounts.treasury.open == 0, PofError::NotExpired);
        Ok(())
    }
}

// ------------------------------------------------------------------------------------------------------------
// account lists

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(init, payer = admin, space = 8 + Treasury::INIT_SPACE, seeds = [TREASURY_SEED], bump)]
    pub treasury: Box<Account<'info, Treasury>>,
    /// CHECK: this program's data account (its upgrade authority is read in `init_config`)
    #[account(address = PROGRAM_DATA)]
    pub program_data: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetRoles<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ PofError::NotAdmin)]
    pub config: Box<Account<'info, Config>>,
    /// CHECK: the root coin's mint (checked in `set_roles`); optional
    pub root_mint: Option<UncheckedAccount<'info>>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ PofError::NotAdmin)]
    pub config: Box<Account<'info, Config>>,
}

#[derive(Accounts)]
pub struct ApplyVerifier<'info> {
    pub caller: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
}

#[derive(Accounts)]
#[instruction(att: Attestation)]
pub struct Certify<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [TREASURY_SEED], bump = treasury.bump)]
    pub treasury: Box<Account<'info, Treasury>>,
    #[account(init_if_needed, payer = payer, space = 8 + Certificate::INIT_SPACE, seeds = [CERT_SEED, att.subject_hash.as_ref(), &[att.asset]], bump)]
    pub certificate: Box<Account<'info, Certificate>>,
    /// CHECK: the payer of the certificate this one replaces (gets its rent back); only when remaking over another payer's
    #[account(mut)]
    pub prior_payer: Option<UncheckedAccount<'info>>,
    /// CHECK: the payer's canonical $ROOT account (derived and checked in `take_fee`); anything while no root is set
    pub holder_token: UncheckedAccount<'info>,
    /// CHECK: the instructions sysvar (address checked in ext::signed_before)
    #[account(address = ext::INSTRUCTIONS_ID)]
    pub instructions: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(att: Attestation)]
pub struct Renew<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [TREASURY_SEED], bump = treasury.bump)]
    pub treasury: Box<Account<'info, Treasury>>,
    #[account(mut, seeds = [CERT_SEED, att.subject_hash.as_ref(), &[att.asset]], bump = certificate.bump)]
    pub certificate: Box<Account<'info, Certificate>>,
    /// CHECK: the payer's canonical $ROOT account (checked in `take_fee`)
    pub holder_token: UncheckedAccount<'info>,
    /// CHECK: the instructions sysvar
    #[account(address = ext::INSTRUCTIONS_ID)]
    pub instructions: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevokeSpent<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [TREASURY_SEED], bump = treasury.bump)]
    pub treasury: Box<Account<'info, Treasury>>,
    #[account(mut, seeds = [CERT_SEED, certificate.subject_hash.as_ref(), &[certificate.asset]], bump = certificate.bump)]
    pub certificate: Box<Account<'info, Certificate>>,
    /// CHECK: the Rings state tree the note was spent from (owner checked)
    pub tree: UncheckedAccount<'info>,
    /// CHECK: the nullifier PDA ["nullifier", tree, nullifier] of the Privacy Program (derived and checked); for the PDA proof
    pub nullifier_account: Option<UncheckedAccount<'info>>,
}

#[derive(Accounts)]
pub struct OpenPath<'info> {
    #[account(mut)]
    pub revoker: Signer<'info>,
    #[account(seeds = [CERT_SEED, certificate.subject_hash.as_ref(), &[certificate.asset]], bump = certificate.bump)]
    pub certificate: Box<Account<'info, Certificate>>,
    #[account(init, payer = revoker, space = 8 + std::mem::size_of::<PathBuffer>(), seeds = [PATH_SEED, revoker.key().as_ref(), certificate.key().as_ref()], bump)]
    pub buffer: AccountLoader<'info, PathBuffer>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct StagePath<'info> {
    pub revoker: Signer<'info>,
    #[account(mut, has_one = revoker @ PofError::NotPayer)]
    pub buffer: AccountLoader<'info, PathBuffer>,
}

#[derive(Accounts)]
pub struct RevokeSpentStaged<'info> {
    #[account(mut)]
    pub revoker: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [TREASURY_SEED], bump = treasury.bump)]
    pub treasury: Box<Account<'info, Treasury>>,
    #[account(mut, seeds = [CERT_SEED, certificate.subject_hash.as_ref(), &[certificate.asset]], bump = certificate.bump)]
    pub certificate: Box<Account<'info, Certificate>>,
    /// CHECK: the Rings state tree whose nullifier roots the path must reach (owner checked)
    pub tree: UncheckedAccount<'info>,
    #[account(mut, close = revoker, seeds = [PATH_SEED, revoker.key().as_ref(), certificate.key().as_ref()], bump)]
    pub buffer: AccountLoader<'info, PathBuffer>,
}

#[derive(Accounts)]
pub struct ClosePath<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, close = revoker)]
    pub buffer: AccountLoader<'info, PathBuffer>,
    /// CHECK: the buffer's revoker (checked against the buffer in close_path), who gets the rent back
    #[account(mut)]
    pub revoker: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct RevokeByHolder<'info> {
    pub controller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [TREASURY_SEED], bump = treasury.bump)]
    pub treasury: Box<Account<'info, Treasury>>,
    #[account(mut, seeds = [CERT_SEED, certificate.subject_hash.as_ref(), &[certificate.asset]], bump = certificate.bump)]
    pub certificate: Box<Account<'info, Certificate>>,
}

#[derive(Accounts)]
pub struct RevokeSigned<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [TREASURY_SEED], bump = treasury.bump)]
    pub treasury: Box<Account<'info, Treasury>>,
    #[account(mut, seeds = [CERT_SEED, certificate.subject_hash.as_ref(), &[certificate.asset]], bump = certificate.bump)]
    pub certificate: Box<Account<'info, Certificate>>,
    /// CHECK: the instructions sysvar
    #[account(address = ext::INSTRUCTIONS_ID)]
    pub instructions: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Expire<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [TREASURY_SEED], bump = treasury.bump)]
    pub treasury: Box<Account<'info, Treasury>>,
    #[account(mut, close = payer, seeds = [CERT_SEED, certificate.subject_hash.as_ref(), &[certificate.asset]], bump = certificate.bump)]
    pub certificate: Box<Account<'info, Certificate>>,
    /// CHECK: the certificate's payer, who gets the rent back
    #[account(mut, address = certificate.payer @ PofError::NotPayer)]
    pub payer: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct AnchorLog<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [TREASURY_SEED], bump = treasury.bump)]
    pub treasury: Box<Account<'info, Treasury>>,
    /// CHECK: the instructions sysvar
    #[account(address = ext::INSTRUCTIONS_ID)]
    pub instructions: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct RequireCertificate<'info> {
    /// CHECK: the certificate PDA of (subject_hash, asset) (derived, owner and layout checked in read_certificate)
    pub certificate: UncheckedAccount<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
}

#[derive(Accounts)]
pub struct VoidByKey<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [TREASURY_SEED], bump = treasury.bump)]
    pub treasury: Box<Account<'info, Treasury>>,
    #[account(mut, seeds = [CERT_SEED, certificate.subject_hash.as_ref(), &[certificate.asset]], bump = certificate.bump)]
    pub certificate: Box<Account<'info, Certificate>>,
}

#[derive(Accounts)]
pub struct WithdrawFees<'info> {
    pub admin: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ PofError::NotAdmin, has_one = dev @ PofError::NotAdmin)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [TREASURY_SEED], bump = treasury.bump)]
    pub treasury: Box<Account<'info, Treasury>>,
    /// CHECK: config.dev
    #[account(mut)]
    pub dev: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CloseConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, close = admin, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ PofError::NotAdmin)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, close = admin, seeds = [TREASURY_SEED], bump = treasury.bump)]
    pub treasury: Box<Account<'info, Treasury>>,
}

// ------------------------------------------------------------------------------------------------------------
// events

#[event]
pub struct ConfigSet {
    pub admin: Pubkey,
    pub dev: Pubkey,
    pub relayer: Pubkey,
    pub root_mint: Pubkey,
    pub params: Params,
}
#[event]
pub struct VerifierSet {
    pub verifier: Pubkey,
    pub next_verifier: Pubkey,
    pub next_verifier_slot: u64,
}
#[event]
pub struct AssetSet {
    pub asset: u8,
    pub tiers: AssetTiers,
}
#[event]
pub struct PausedSet {
    pub paused: bool,
}
#[event]
pub struct Certified {
    pub subject_kind: u8,
    pub subject_hash: [u8; 32],
    pub asset: u8,
    pub tier: u8,
    pub certified_slot: u64,
    pub expiry_slot: u64,
    pub note_count: u8,
    pub payer: Pubkey,
    pub controller: Pubkey,
    pub verifier: Pubkey,
    pub log_index: u64,
    pub fee: u64,
}
#[event]
pub struct Renewed {
    pub subject_hash: [u8; 32],
    pub asset: u8,
    pub tier: u8,
    pub issued_slot: u64,
    pub expiry_slot: u64,
    pub payer: Pubkey,
    pub verifier: Pubkey,
    pub fee: u64,
    pub renewals: u32,
}
/// path: 0 nullifier PDA, 1 nullifier tree membership, 3 by the holder (controller signs the transaction), 4 by the controller's
/// signed revoke, 5 voided (its Verifier key revoked).
#[event]
pub struct Revoked {
    pub subject_hash: [u8; 32],
    pub asset: u8,
    pub tier: u8,
    pub status: u8,
    pub slot: u64,
    pub by: Pubkey,
    pub index: u8,
    pub salt: [u8; 32],
    pub nullifier: [u8; 32],
    pub path: u8,
}
#[event]
pub struct Expired {
    pub subject_hash: [u8; 32],
    pub asset: u8,
    pub tier: u8,
    pub status: u8,
    pub slot: u64,
    pub payer: Pubkey,
}
#[event]
pub struct VerifierKeyRevoked {
    pub key: Pubkey,
    pub slot: u64,
}
#[event]
pub struct LogAnchored {
    pub size: u64,
    pub head: [u8; 32],
    pub slot: u64,
}
#[event]
pub struct FeesWithdrawn {
    pub lamports: u64,
    pub to: Pubkey,
}
#[event]
pub struct ClosingBegun {
    pub slot: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attestation_layout_is_contract_3() {
        let a = Attestation {
            subject_kind: 1,
            subject_hash: [7; 32],
            asset: 0,
            tier: 3,
            tree_root: [9; 32],
            root_slot: 0x0102030405060708,
            null_hashes: vec![[1; 32], [2; 32]],
            issued_slot: 1000,
            expiry_slot: 2000,
            controller: Pubkey::new_from_array([5; 32]),
            nonce: [0xAB; 16],
        };
        let payer = Pubkey::new_from_array([4; 32]);
        let b = attestation_bytes(&crate::ID, &a, &payer);
        assert_eq!(&b[0..4], b"POF1");
        assert_eq!(&b[4..36], crate::ID.as_ref());
        assert_eq!(b[36], 1);
        assert_eq!(b[69], 0);
        assert_eq!(b[70], 3);
        assert_eq!(&b[103..111], &[8, 7, 6, 5, 4, 3, 2, 1]);
        assert_eq!(b[111], 2);
        assert_eq!(&b[112..144], &ext::sha256(&[&[1u8; 32], &[2u8; 32]]));
        assert_eq!(&b[144..152], &1000u64.to_le_bytes());
        assert_eq!(&b[160..192], &[4; 32]);
        assert_eq!(&b[192..224], &[5; 32]);
        assert_eq!(&b[224..240], &[0xAB; 16]);
    }

    #[test]
    fn tier_tables() {
        assert_eq!(sol_tiers().tiers(), 5);
        assert!(sol_tiers().check().is_ok() && usdc_tiers().check().is_ok());
        let mut t = sol_tiers();
        t.mins[2] = 0;
        assert!(t.check().is_err());
        t.mins = [5, 4, 0, 0, 0];
        assert!(t.check().is_err());
        assert!(Params::launch().check().is_ok());
    }

    #[test]
    fn rotation_is_lazy_and_delayed() {
        let mut c = Config {
            admin: Pubkey::default(),
            dev: Pubkey::default(),
            relayer: Pubkey::default(),
            verifier: Pubkey::new_from_array([1; 32]),
            next_verifier: Pubkey::new_from_array([2; 32]),
            next_verifier_slot: 100,
            root_mint: Pubkey::default(),
            root_token_program: Pubkey::default(),
            params: Params::launch(),
            assets: [AssetTiers::default(); MAX_ASSETS],
            paused: false,
            closing: false,
            launch_slot: 0,
            held_delay: 0,
            held_until: 0,
            revoked_keys: [Pubkey::default(); MAX_REVOKED_KEYS],
            bump: 0,
            treasury_bump: 0,
        };
        assert_eq!(c.active_verifier(99), Pubkey::new_from_array([1; 32]));
        assert_eq!(c.active_verifier(100), Pubkey::new_from_array([2; 32]));
        c.next_verifier = Pubkey::default();
        assert_eq!(c.active_verifier(1000), Pubkey::new_from_array([1; 32]));
    }
}
