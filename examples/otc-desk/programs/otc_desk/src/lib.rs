//! Example consumer of Proof of Funds: an OTC desk that only accepts orders from a trader who holds a live certificate
//! of at least tier 3 SOL (>= 100 SOL). The whole gate is one CPI, `pof::require_certificate`, plus one check that the
//! certificate's controller is the signer, so nobody can trade on someone else's certificate.
//!
//! The order remembers the certificate it was placed under. Anyone can `expire_order` once that certificate is revoked
//! or expired, so a stale order never outlives the funds behind it (the same pattern as pof_gate's `evict`).
use anchor_lang::prelude::*;

declare_id!("3pFbQAcZFMGXmAN7uCHJKikTzrHNyVvfF4E4kYWZbG7Y");

/// POF asset id of SOL (CONTRACT §2) and the tier this desk requires: 3 = at least 100 SOL.
pub const ASSET_SOL: u8 = 0;
pub const MIN_TIER: u8 = 3;

#[program]
pub mod otc_desk {
    use super::*;

    /// Place an order. `subject_hash` is the trader's POF subject (sha256("pof:wallet:" + base58), or an @handle's).
    pub fn place_order(mut ctx: Context<PlaceOrder>, subject_hash: [u8; 32], order_id: u64, side: Side, amount: u64, price: u64) -> Result<()> {
        require!(amount > 0 && price > 0, DeskError::BadOrder);
        let a = &mut ctx.accounts;
        // The gate: fails unless the certificate is live, unexpired, SOL, and at least MIN_TIER.
        let view = pof::cpi::require_certificate(
            CpiContext::new(
                a.pof_program.key(),
                pof::cpi::accounts::RequireCertificate { certificate: a.certificate.to_account_info(), config: a.pof_config.to_account_info() },
            ),
            subject_hash,
            ASSET_SOL,
            MIN_TIER,
        )?
        .get();
        // The certificate must be the signer's own.
        require_keys_eq!(view.controller, a.trader.key(), DeskError::NotYourCertificate);

        let (trader, certificate) = (a.trader.key(), a.certificate.key());
        let o = &mut a.order;
        o.trader = trader;
        o.subject_hash = subject_hash;
        o.certificate = certificate;
        o.order_id = order_id;
        o.side = side;
        o.amount = amount;
        o.price = price;
        o.tier = view.tier;
        o.certificate_expiry_slot = view.expiry_slot;
        o.placed_slot = Clock::get()?.slot;
        o.bump = ctx.bumps.order;
        emit!(OrderPlaced { trader: o.trader, order_id, side, amount, price, tier: view.tier });
        Ok(())
    }

    /// Anyone may close an order whose certificate no longer passes the gate; the rent goes back to the trader.
    pub fn expire_order(ctx: Context<ExpireOrder>) -> Result<()> {
        let slot = Clock::get()?.slot;
        let o = &ctx.accounts.order;
        // the certificate account is pinned by `has_one = certificate`, so a read error means it is gone
        let still = match (read_pof_config(&ctx.accounts.pof_config)?, pof::read_certificate(&ctx.accounts.certificate.to_account_info(), &o.subject_hash, ASSET_SOL)) {
            (Some(c), Ok(cert)) => pof::gate(&cert, &c, ASSET_SOL, MIN_TIER, slot).is_ok() && cert.controller == o.trader,
            _ => false, // closed, voided by a revoked verifier key, or POF wound down
        };
        require!(!still, DeskError::CertificateStillLive);
        emit!(OrderExpired { trader: o.trader, order_id: o.order_id, slot });
        Ok(())
    }
}

/// POF's Config at its PDA (None once POF has wound down and closed it).
fn read_pof_config(info: &AccountInfo) -> Result<Option<pof::Config>> {
    let (want, _) = Pubkey::find_program_address(&[pof::CONFIG_SEED], &pof::ID);
    require_keys_eq!(info.key(), want, DeskError::BadPofConfig);
    if info.data_is_empty() {
        return Ok(None);
    }
    require_keys_eq!(*info.owner, pof::ID, DeskError::BadPofConfig);
    let data = info.try_borrow_data()?;
    let mut d: &[u8] = &data;
    Ok(Some(pof::Config::try_deserialize(&mut d).map_err(|_| error!(DeskError::BadPofConfig))?))
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum Side {
    Buy,
    Sell,
}

#[account]
#[derive(InitSpace)]
pub struct Order {
    pub trader: Pubkey,
    pub subject_hash: [u8; 32],
    pub certificate: Pubkey,
    pub order_id: u64,
    pub side: Side,
    pub amount: u64,
    pub price: u64,
    pub tier: u8,
    pub certificate_expiry_slot: u64,
    pub placed_slot: u64,
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(subject_hash: [u8; 32], order_id: u64)]
pub struct PlaceOrder<'info> {
    #[account(mut)]
    pub trader: Signer<'info>,
    /// CHECK: the POF certificate ["cert", subject_hash, [0]]; pof checks owner, PDA, status, expiry, asset and tier in the CPI
    pub certificate: UncheckedAccount<'info>,
    /// CHECK: the pof Config; pof checks its seeds in the CPI (it holds the revoked verifier keys)
    pub pof_config: UncheckedAccount<'info>,
    #[account(init, payer = trader, space = 8 + Order::INIT_SPACE, seeds = [b"order", trader.key().as_ref(), &order_id.to_le_bytes()], bump)]
    pub order: Account<'info, Order>,
    pub pof_program: Program<'info, pof::program::Pof>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExpireOrder<'info> {
    pub caller: Signer<'info>,
    #[account(mut, close = trader, has_one = trader, has_one = certificate, seeds = [b"order", order.trader.as_ref(), &order.order_id.to_le_bytes()], bump = order.bump)]
    pub order: Account<'info, Order>,
    /// CHECK: receives the rent
    #[account(mut)]
    pub trader: UncheckedAccount<'info>,
    /// CHECK: read directly with pof::read_certificate (a closed account fails the gate)
    pub certificate: UncheckedAccount<'info>,
    /// CHECK: the pof Config, checked by its PDA in read_pof_config
    pub pof_config: UncheckedAccount<'info>,
}

#[event]
pub struct OrderPlaced {
    pub trader: Pubkey,
    pub order_id: u64,
    pub side: Side,
    pub amount: u64,
    pub price: u64,
    pub tier: u8,
}

#[event]
pub struct OrderExpired {
    pub trader: Pubkey,
    pub order_id: u64,
    pub slot: u64,
}

#[error_code]
pub enum DeskError {
    #[msg("amount and price must be positive")]
    BadOrder,
    #[msg("the certificate's controller is not the signer")]
    NotYourCertificate,
    #[msg("the certificate still passes the desk's gate")]
    CertificateStillLive,
    #[msg("that is not the pof Config account")]
    BadPofConfig,
}
