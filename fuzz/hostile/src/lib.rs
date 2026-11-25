//! POF fuzz: a hostile program around `pof` and `pof_gate`. It is loaded only on the fuzzer's local validator.
//!
//! What it tries:
//! - `require_certificate` here is a FAKE POF: the same instruction name, so the same Anchor discriminator and argument layout as
//!   `pof::require_certificate`. It says yes to anything (tier 5, never expires, controller = the account passed as
//!   `certificate`). `pof_gate::join` must refuse it as `pof_program` (Program<Pof>); `naive_gate` shows what a consumer that
//!   does not pin POF's program id would accept.
//! Built against the POF API of 187914b and later (require_certificate and gate take POF's config: revoked Verifier keys).
//! - `probe`: a careful consumer. The CPI to the pinned POF, the return data's program id checked, and the answer compared with a
//!   direct read (`pof::read_certificate` + `pof::gate`) of the same account: both must agree on every certificate.
//! - `certify_cpi`: POF's `certify` through a CPI, the payer a PDA of this program signing with seeds, `times` times in one
//!   top-level instruction. POF reads the Ed25519 instruction before the TOP-LEVEL instruction, so one signature is all that any
//!   of the CPIs can see: at most one may land.
//! - `ctl_join`, `ctl_toctou`: a certificate whose controller is this program's PDA ["ctl"] joins a room through a CPI to
//!   `pof_gate::join`, and revokes itself between two `require_certificate` calls in one instruction (the second must fail).

#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::get_return_data;

declare_id!("FYEDSAf3NfrWo217Yqb9cKZh1yZubSgtJwaaqsRoY6ed");

pub const PAYER_SEED: &[u8] = b"payer";
pub const CTL_SEED: &[u8] = b"ctl";

#[error_code]
pub enum HostileError {
    #[msg("no return data after the CPI")]
    NoReturn,
    #[msg("the return data came from another program")]
    ReturnFromElsewhere,
    #[msg("the CPI answer and the direct read differ")]
    ViewsDiffer,
    #[msg("the certificate still answered yes after it was revoked in this instruction")]
    StaleYes,
}

#[program]
pub mod hostile {
    use super::*;

    /// The fake POF (same discriminator as pof::require_certificate): yes to anything.
    pub fn require_certificate(ctx: Context<Fake>, _subject_hash: [u8; 32], _asset: u8, _min_tier: u8) -> Result<pof::CertView> {
        Ok(pof::CertView { subject_kind: 1, tier: 5, expiry_slot: u64::MAX, controller: ctx.accounts.certificate.key() })
    }

    /// A consumer that forgets to pin POF: whatever program the caller passes answers.
    pub fn naive_gate(ctx: Context<Naive>, subject_hash: [u8; 32], asset: u8, min_tier: u8) -> Result<()> {
        let a = ctx.accounts;
        let view = pof::cpi::require_certificate(
            CpiContext::new(a.pof_program.key(), pof::cpi::accounts::RequireCertificate { certificate: a.certificate.to_account_info(), config: a.config.to_account_info() }),
            subject_hash,
            asset,
            min_tier,
        )?
        .get();
        emit!(Gated { by: a.pof_program.key(), tier: view.tier, expiry_slot: view.expiry_slot, controller: view.controller, direct: false });
        Ok(())
    }

    /// A careful consumer: pinned POF, return data checked, CPI answer == direct read.
    pub fn probe(ctx: Context<Probe>, subject_hash: [u8; 32], asset: u8, min_tier: u8) -> Result<()> {
        let a = ctx.accounts;
        let view = pof::cpi::require_certificate(
            CpiContext::new(pof::ID, pof::cpi::accounts::RequireCertificate { certificate: a.certificate.to_account_info(), config: a.config.to_account_info() }),
            subject_hash,
            asset,
            min_tier,
        )?
        .get();
        let (pid, _) = get_return_data().ok_or(error!(HostileError::NoReturn))?;
        require_keys_eq!(pid, pof::ID, HostileError::ReturnFromElsewhere);
        let cert = pof::read_certificate(&a.certificate, &subject_hash, asset)?;
        let cfg = { let d = a.config.try_borrow_data()?; let mut s: &[u8] = &d; pof::Config::try_deserialize(&mut s)? };
        let direct = pof::gate(&cert, &cfg, asset, min_tier, Clock::get()?.slot)?;
        require!(direct == view, HostileError::ViewsDiffer);
        emit!(Gated { by: pof::ID, tier: view.tier, expiry_slot: view.expiry_slot, controller: view.controller, direct: true });
        Ok(())
    }

    /// POF certify through a CPI, payer = this program's PDA ["payer"], `times` times with the same attestation.
    pub fn certify_cpi<'info>(ctx: Context<'info, CertifyCpi<'info>>, att: pof::Attestation, log_index: u64, times: u8) -> Result<()> {
        let a = ctx.accounts;
        let bump = [ctx.bumps.payer];
        let seeds: &[&[u8]] = &[PAYER_SEED, &bump];
        for _ in 0..times {
            pof::cpi::certify(
                CpiContext::new_with_signer(
                    pof::ID,
                    pof::cpi::accounts::Certify {
                        payer: a.payer.to_account_info(),
                        config: a.config.to_account_info(),
                        treasury: a.treasury.to_account_info(),
                        certificate: a.certificate.to_account_info(),
                        prior_payer: None,
                        holder_token: a.holder_token.to_account_info(),
                        instructions: a.instructions.to_account_info(),
                        system_program: a.system_program.to_account_info(),
                    },
                    &[seeds],
                ),
                att.clone(),
                log_index,
            )?;
        }
        Ok(())
    }

    /// Join a room as the controller PDA ["ctl"].
    pub fn ctl_join(ctx: Context<CtlJoin>, subject_hash: [u8; 32]) -> Result<()> {
        let a = ctx.accounts;
        let bump = [ctx.bumps.ctl];
        let seeds: &[&[u8]] = &[CTL_SEED, &bump];
        pof_gate::cpi::join(
            CpiContext::new_with_signer(
                pof_gate::ID,
                pof_gate::cpi::accounts::Join {
                    controller: a.ctl.to_account_info(),
                    payer: a.payer.to_account_info(),
                    room: a.room.to_account_info(),
                    member: a.member.to_account_info(),
                    certificate: a.certificate.to_account_info(),
                    pof_config: a.config.to_account_info(),
                    pof_program: a.pof_program.to_account_info(),
                    system_program: a.system_program.to_account_info(),
                },
                &[seeds],
            ),
            subject_hash,
        )
    }

    /// Ask POF (must be yes), revoke the certificate as its controller PDA, ask again in the same instruction (must be no: the
    /// instruction fails with POF's error, or, when `tolerate` is set, this program records the refusal and succeeds).
    pub fn ctl_toctou(ctx: Context<CtlToctou>, subject_hash: [u8; 32], asset: u8, tolerate: bool) -> Result<()> {
        let a = ctx.accounts;
        let ask = |a: &CtlToctou| {
            pof::cpi::require_certificate(
                CpiContext::new(pof::ID, pof::cpi::accounts::RequireCertificate { certificate: a.certificate.to_account_info(), config: a.config.to_account_info() }),
                subject_hash,
                asset,
                1,
            )
        };
        ask(a)?;
        let bump = [ctx.bumps.ctl];
        let seeds: &[&[u8]] = &[CTL_SEED, &bump];
        pof::cpi::revoke_by_holder(CpiContext::new_with_signer(
            pof::ID,
            pof::cpi::accounts::RevokeByHolder {
                controller: a.ctl.to_account_info(),
                config: a.config.to_account_info(),
                treasury: a.treasury.to_account_info(),
                certificate: a.certificate.to_account_info(),
            },
            &[seeds],
        ))?;
        // a CPI error aborts the whole transaction on Solana, so a "tolerated" second ask is a direct read instead
        if tolerate {
            let cert = pof::read_certificate(&a.certificate, &subject_hash, asset)?;
            let cfg = { let d = a.config.try_borrow_data()?; let mut s: &[u8] = &d; pof::Config::try_deserialize(&mut s)? };
            require!(pof::gate(&cert, &cfg, asset, 1, Clock::get()?.slot).is_err(), HostileError::StaleYes);
            return Ok(());
        }
        ask(a)?;
        err!(HostileError::StaleYes)
    }
}

#[derive(Accounts)]
pub struct Fake<'info> {
    /// CHECK: anything
    pub certificate: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Naive<'info> {
    /// CHECK: anything
    pub certificate: UncheckedAccount<'info>,
    /// CHECK: passed through
    pub config: UncheckedAccount<'info>,
    /// CHECK: NOT pinned, on purpose
    pub pof_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Probe<'info> {
    /// CHECK: checked by POF and by read_certificate
    pub certificate: UncheckedAccount<'info>,
    /// CHECK: POF's config (checked by POF; deserialized for the direct read)
    pub config: UncheckedAccount<'info>,
    pub pof_program: Program<'info, pof::program::Pof>,
}

#[derive(Accounts)]
pub struct CertifyCpi<'info> {
    #[account(mut, seeds = [PAYER_SEED], bump)]
    pub payer: SystemAccount<'info>,
    /// CHECK: POF checks
    pub config: UncheckedAccount<'info>,
    /// CHECK: POF checks
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
    /// CHECK: POF checks
    #[account(mut)]
    pub certificate: UncheckedAccount<'info>,
    /// CHECK: POF checks
    pub holder_token: UncheckedAccount<'info>,
    /// CHECK: POF checks
    pub instructions: UncheckedAccount<'info>,
    pub pof_program: Program<'info, pof::program::Pof>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CtlJoin<'info> {
    /// CHECK: this program's PDA ["ctl"], signs by seeds
    #[account(seeds = [CTL_SEED], bump)]
    pub ctl: UncheckedAccount<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: pof_gate checks
    #[account(mut)]
    pub room: UncheckedAccount<'info>,
    /// CHECK: pof_gate checks
    #[account(mut)]
    pub member: UncheckedAccount<'info>,
    /// CHECK: POF checks
    pub certificate: UncheckedAccount<'info>,
    /// CHECK: POF checks
    pub config: UncheckedAccount<'info>,
    /// CHECK: pof_gate checks (Program<Pof>); passed through unpinned on purpose
    pub pof_program: UncheckedAccount<'info>,
    pub pof_gate_program: Program<'info, pof_gate::program::PofGate>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CtlToctou<'info> {
    /// CHECK: this program's PDA ["ctl"], signs by seeds
    #[account(seeds = [CTL_SEED], bump)]
    pub ctl: UncheckedAccount<'info>,
    /// CHECK: POF checks
    pub config: UncheckedAccount<'info>,
    /// CHECK: POF checks
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
    /// CHECK: POF checks
    #[account(mut)]
    pub certificate: UncheckedAccount<'info>,
    pub pof_program: Program<'info, pof::program::Pof>,
}

#[event]
pub struct Gated {
    pub by: Pubkey,
    pub tier: u8,
    pub expiry_slot: u64,
    pub controller: Pubkey,
    pub direct: bool,
}
