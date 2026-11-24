//! Proof of Funds Rooms: on-chain rooms gated by live POF certificates, the reference consumer of `pof::require_certificate`.
//!
//! A creator makes a Room ["room", creator, id u64 LE] with an asset and a minimum tier. A certificate's controller `join`s it:
//! the program asks POF through the `require_certificate` CPI (live, unexpired, that asset, at least that tier) and writes a
//! Member ["member", room, subject_hash] only if POF says yes and the controller it returns is the signer. Membership lasts only
//! as long as the certificate: the moment it is revoked, expires, closes, drops below the room's tier, or is remade with another
//! controller, anyone may `evict` the member (a direct read of the certificate account, no CPI, so a closed one evicts too), and
//! the member's rent goes back to whoever paid it. Bots (Telegram, Discord) read Rooms and Members.
//!
//! No fees, no admin: rooms belong to their creators. When POF winds down (its config closing or closed), anyone may close an
//! empty room (`release_room`), its rent back to the creator.

#![allow(clippy::too_many_arguments)]
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

declare_id!("gatSToJMD8ZPLa85fKj6seYHUtYx4ah3ptZvLkisLPU");

pub const ROOM_SEED: &[u8] = b"room";
pub const MEMBER_SEED: &[u8] = b"member";

#[error_code]
pub enum GateError {
    #[msg("only the room's creator may do this")]
    NotCreator,
    #[msg("the room takes no new members")]
    RoomShut,
    #[msg("no such asset or tier on POF")]
    BadTier,
    #[msg("the certificate's controller is not the signer")]
    NotController,
    #[msg("the member's certificate is still live and good enough for this room")]
    StillValid,
    #[msg("the room still has members")]
    MembersLeft,
    #[msg("not POF's config")]
    BadPofConfig,
    #[msg("POF is not winding down")]
    NotClosing,
    #[msg("not this member's certificate")]
    BadCertificate,
}

#[account]
#[derive(InitSpace)]
pub struct Room {
    pub creator: Pubkey,
    pub id: u64,
    pub asset: u8,
    pub min_tier: u8,
    /// Takes new members.
    pub open: bool,
    /// A label, UTF-8, zero padded.
    pub name: [u8; 32],
    pub members: u32,
    pub joined: u64,
    pub evicted: u64,
    pub created_slot: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Member {
    pub room: Pubkey,
    pub subject_hash: [u8; 32],
    pub subject_kind: u8,
    /// The POF certificate PDA of (subject_hash, room.asset).
    pub certificate: Pubkey,
    /// The certificate's controller when it joined.
    pub controller: Pubkey,
    /// Paid the rent; gets it back at evict or leave.
    pub payer: Pubkey,
    pub joined_slot: u64,
    pub bump: u8,
}

fn check_tier(pof_config: &AccountInfo, asset: u8, min_tier: u8) -> Result<()> {
    let c = read_pof_config(pof_config)?.ok_or(error!(GateError::BadPofConfig))?;
    let t = c.assets.get(asset as usize).ok_or(error!(GateError::BadTier))?;
    require!(t.enabled && min_tier >= 1 && min_tier <= t.tiers(), GateError::BadTier);
    Ok(())
}

/// POF's config at its PDA: Some(config), or None when the account is closed (POF wound down).
fn read_pof_config(info: &AccountInfo) -> Result<Option<pof::Config>> {
    let (want, _) = Pubkey::find_program_address(&[pof::CONFIG_SEED], &pof::ID);
    require_keys_eq!(info.key(), want, GateError::BadPofConfig);
    if info.data_is_empty() {
        return Ok(None);
    }
    require_keys_eq!(*info.owner, pof::ID, GateError::BadPofConfig);
    let data = info.try_borrow_data()?;
    let mut d: &[u8] = &data;
    Ok(Some(pof::Config::try_deserialize(&mut d).map_err(|_| error!(GateError::BadPofConfig))?))
}

#[program]
pub mod pof_gate {
    use super::*;

    /// A new room: certificates of `asset` at `min_tier` or above may join.
    pub fn create_room(ctx: Context<CreateRoom>, id: u64, asset: u8, min_tier: u8, name: [u8; 32]) -> Result<()> {
        check_tier(&ctx.accounts.pof_config, asset, min_tier)?;
        let r = &mut ctx.accounts.room;
        r.creator = ctx.accounts.creator.key();
        r.id = id;
        r.asset = asset;
        r.min_tier = min_tier;
        r.open = true;
        r.name = name;
        r.created_slot = Clock::get()?.slot;
        r.bump = ctx.bumps.room;
        emit!(RoomSet { room: r.key(), creator: r.creator, id, asset, min_tier, open: true, name });
        Ok(())
    }

    /// The creator changes the tier (members below it become evictable), opens or shuts the door, renames.
    pub fn set_room(ctx: Context<SetRoom>, min_tier: u8, open: bool, name: [u8; 32]) -> Result<()> {
        let r = &mut ctx.accounts.room;
        check_tier(&ctx.accounts.pof_config, r.asset, min_tier)?;
        r.min_tier = min_tier;
        r.open = open;
        r.name = name;
        emit!(RoomSet { room: r.key(), creator: r.creator, id: r.id, asset: r.asset, min_tier, open, name });
        Ok(())
    }

    /// The controller of a live certificate joins: POF's `require_certificate` CPI decides.
    pub fn join(ctx: Context<Join>, subject_hash: [u8; 32]) -> Result<()> {
        let a = ctx.accounts;
        require!(a.room.open, GateError::RoomShut);
        let view = pof::cpi::require_certificate(
            CpiContext::new(a.pof_program.key(), pof::cpi::accounts::RequireCertificate { certificate: a.certificate.to_account_info() }),
            subject_hash,
            a.room.asset,
            a.room.min_tier,
        )?
        .get();
        require_keys_eq!(view.controller, a.controller.key(), GateError::NotController);
        let slot = Clock::get()?.slot;
        let m = &mut a.member;
        m.room = a.room.key();
        m.subject_hash = subject_hash;
        m.subject_kind = view.subject_kind;
        m.certificate = a.certificate.key();
        m.controller = view.controller;
        m.payer = a.payer.key();
        m.joined_slot = slot;
        m.bump = ctx.bumps.member;
        let r = &mut a.room;
        r.members += 1;
        r.joined += 1;
        emit!(Joined { room: r.key(), subject_hash, tier: view.tier, expiry_slot: view.expiry_slot, controller: view.controller, slot });
        Ok(())
    }

    /// Anyone: the member's certificate is no longer good for this room (revoked, expired, closed, below the tier, or remade
    /// with another controller). The member closes, its rent back to its payer.
    pub fn evict(ctx: Context<Evict>) -> Result<()> {
        let a = ctx.accounts;
        let slot = Clock::get()?.slot;
        let m = &a.member;
        let r = &mut a.room;
        let still = match pof::read_certificate(&a.certificate, &m.subject_hash, r.asset) {
            Ok(cert) => pof::gate(&cert, r.asset, r.min_tier, slot).is_ok() && cert.controller == m.controller,
            Err(_) => {
                // only "no certificate here any more" may evict; a wrong account must not
                let (want, _) = Pubkey::find_program_address(&[pof::CERT_SEED, &m.subject_hash, &[r.asset]], &pof::ID);
                require_keys_eq!(a.certificate.key(), want, GateError::BadCertificate);
                false
            }
        };
        require!(!still, GateError::StillValid);
        r.members = r.members.saturating_sub(1);
        r.evicted += 1;
        emit!(Left { room: r.key(), subject_hash: m.subject_hash, evicted: true, by: a.caller.key(), slot });
        Ok(())
    }

    /// The member's controller leaves.
    pub fn leave(ctx: Context<Leave>) -> Result<()> {
        let a = ctx.accounts;
        let r = &mut a.room;
        r.members = r.members.saturating_sub(1);
        emit!(Left { room: r.key(), subject_hash: a.member.subject_hash, evicted: false, by: a.controller.key(), slot: Clock::get()?.slot });
        Ok(())
    }

    /// The creator closes an empty room (rent back).
    pub fn close_room(ctx: Context<CloseRoom>) -> Result<()> {
        require!(ctx.accounts.room.members == 0, GateError::MembersLeft);
        emit!(RoomClosed { room: ctx.accounts.room.key(), creator: ctx.accounts.creator.key() });
        Ok(())
    }

    /// Anyone, while POF winds down (config closing or closed): an empty room closes, its rent back to its creator.
    pub fn release_room(ctx: Context<ReleaseRoom>) -> Result<()> {
        let a = ctx.accounts;
        let closing = read_pof_config(&a.pof_config)?.map(|c| c.closing).unwrap_or(true);
        require!(closing, GateError::NotClosing);
        require!(a.room.members == 0, GateError::MembersLeft);
        emit!(RoomClosed { room: a.room.key(), creator: a.creator.key() });
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct CreateRoom<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(init, payer = creator, space = 8 + Room::INIT_SPACE, seeds = [ROOM_SEED, creator.key().as_ref(), id.to_le_bytes().as_ref()], bump)]
    pub room: Box<Account<'info, Room>>,
    /// CHECK: POF's config PDA (read for the tier table)
    pub pof_config: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetRoom<'info> {
    pub creator: Signer<'info>,
    #[account(mut, seeds = [ROOM_SEED, room.creator.as_ref(), room.id.to_le_bytes().as_ref()], bump = room.bump, has_one = creator @ GateError::NotCreator)]
    pub room: Box<Account<'info, Room>>,
    /// CHECK: POF's config PDA (read for the tier table)
    pub pof_config: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(subject_hash: [u8; 32])]
pub struct Join<'info> {
    pub controller: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [ROOM_SEED, room.creator.as_ref(), room.id.to_le_bytes().as_ref()], bump = room.bump)]
    pub room: Box<Account<'info, Room>>,
    #[account(init, payer = payer, space = 8 + Member::INIT_SPACE, seeds = [MEMBER_SEED, room.key().as_ref(), subject_hash.as_ref()], bump)]
    pub member: Box<Account<'info, Member>>,
    /// CHECK: the POF certificate of (subject_hash, room.asset); POF checks it in the CPI
    pub certificate: UncheckedAccount<'info>,
    pub pof_program: Program<'info, pof::program::Pof>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Evict<'info> {
    pub caller: Signer<'info>,
    #[account(mut, seeds = [ROOM_SEED, room.creator.as_ref(), room.id.to_le_bytes().as_ref()], bump = room.bump)]
    pub room: Box<Account<'info, Room>>,
    #[account(mut, close = payer, has_one = room, seeds = [MEMBER_SEED, room.key().as_ref(), member.subject_hash.as_ref()], bump = member.bump)]
    pub member: Box<Account<'info, Member>>,
    /// CHECK: the member's payer, who gets the rent back
    #[account(mut, address = member.payer)]
    pub payer: UncheckedAccount<'info>,
    /// CHECK: the member's certificate PDA (read directly; may be closed)
    #[account(address = member.certificate @ GateError::BadCertificate)]
    pub certificate: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Leave<'info> {
    pub controller: Signer<'info>,
    #[account(mut, seeds = [ROOM_SEED, room.creator.as_ref(), room.id.to_le_bytes().as_ref()], bump = room.bump)]
    pub room: Box<Account<'info, Room>>,
    #[account(mut, close = payer, has_one = room, has_one = controller @ GateError::NotController, seeds = [MEMBER_SEED, room.key().as_ref(), member.subject_hash.as_ref()], bump = member.bump)]
    pub member: Box<Account<'info, Member>>,
    /// CHECK: the member's payer, who gets the rent back
    #[account(mut, address = member.payer)]
    pub payer: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct CloseRoom<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(mut, close = creator, seeds = [ROOM_SEED, room.creator.as_ref(), room.id.to_le_bytes().as_ref()], bump = room.bump, has_one = creator @ GateError::NotCreator)]
    pub room: Box<Account<'info, Room>>,
}

#[derive(Accounts)]
pub struct ReleaseRoom<'info> {
    pub caller: Signer<'info>,
    #[account(mut, close = creator, seeds = [ROOM_SEED, room.creator.as_ref(), room.id.to_le_bytes().as_ref()], bump = room.bump)]
    pub room: Box<Account<'info, Room>>,
    /// CHECK: the room's creator, who gets the rent back
    #[account(mut, address = room.creator)]
    pub creator: UncheckedAccount<'info>,
    /// CHECK: POF's config PDA (closing, or closed)
    pub pof_config: UncheckedAccount<'info>,
}

#[event]
pub struct RoomSet {
    pub room: Pubkey,
    pub creator: Pubkey,
    pub id: u64,
    pub asset: u8,
    pub min_tier: u8,
    pub open: bool,
    pub name: [u8; 32],
}
#[event]
pub struct Joined {
    pub room: Pubkey,
    pub subject_hash: [u8; 32],
    pub tier: u8,
    pub expiry_slot: u64,
    pub controller: Pubkey,
    pub slot: u64,
}
#[event]
pub struct Left {
    pub room: Pubkey,
    pub subject_hash: [u8; 32],
    pub evicted: bool,
    pub by: Pubkey,
    pub slot: u64,
}
#[event]
pub struct RoomClosed {
    pub room: Pubkey,
    pub creator: Pubkey,
}
