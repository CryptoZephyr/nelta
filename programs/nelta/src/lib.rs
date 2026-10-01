use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::Instruction,
    program::{invoke, invoke_signed},
};

pub mod math;
pub mod velocity;

use math::*;
use velocity as v;

declare_id!("9Rk99npYk6kwtEx7MVuq2SWyr1WQQ7f9S9i8mXY4iJ4R");

pub const POSITION_SEED: &[u8] = b"position";
pub const MAX_ORACLE_AGE_SECS: i64 = 30;

#[program]
pub mod nelta {
    use super::*;

    /// Creates the position PDA and a Velocity account whose authority is that PDA.
    pub fn initialize(ctx: Context<Initialize>, ratio_bps: u16) -> Result<()> {
        require!(ratio_bps <= BPS, NeltaError::InvalidRatio);
        let bump = ctx.bumps.position;
        {
            let p = &mut ctx.accounts.position;
            p.owner = ctx.accounts.owner.key();
            p.bump = bump;
            p.ratio_bps = ratio_bps;
        }
        let a = &ctx.accounts;
        let p = &a.position;
        let seeds: &[&[u8]] = &[POSITION_SEED, a.owner.key.as_ref(), &[bump]];
        let metas = vec![
            AccountMeta::new(a.velocity_user_stats.key(), false),
            AccountMeta::new(a.velocity_state.key(), false),
            AccountMeta::new_readonly(p.key(), false),
            AccountMeta::new(a.owner.key(), true),
            AccountMeta::new_readonly(a.rent.key(), false),
            AccountMeta::new_readonly(a.system_program.key(), false),
        ];
        let infos = [
            a.velocity_user_stats.to_account_info(),
            a.velocity_state.to_account_info(),
            p.to_account_info(),
            a.owner.to_account_info(),
            a.rent.to_account_info(),
            a.system_program.to_account_info(),
        ];
        invoke_signed(
            &Instruction { program_id: v::ID, accounts: metas, data: v::INIT_USER_STATS.to_vec() },
            &infos,
            &[seeds],
        )?;

        let metas = vec![
            AccountMeta::new(a.velocity_user.key(), false),
            AccountMeta::new(a.velocity_user_stats.key(), false),
            AccountMeta::new(a.velocity_state.key(), false),
            AccountMeta::new_readonly(p.key(), false),
            AccountMeta::new(a.owner.key(), true),
            AccountMeta::new_readonly(a.rent.key(), false),
            AccountMeta::new_readonly(a.system_program.key(), false),
        ];
        let infos = [
            a.velocity_user.to_account_info(),
            a.velocity_user_stats.to_account_info(),
            a.velocity_state.to_account_info(),
            p.to_account_info(),
            a.owner.to_account_info(),
            a.rent.to_account_info(),
            a.system_program.to_account_info(),
        ];
        invoke_signed(
            &Instruction { program_id: v::ID, accounts: metas, data: v::initialize_user_data() },
            &infos,
            &[seeds],
        )?;
        emit!(PositionOpened { owner: p.owner, ratio_bps });
        Ok(())
    }

    /// Owner moves tokens (wSOL for market 1, dUSDT for market 0) into the position.
    pub fn deposit<'info>(
        ctx: Context<'info, Deposit<'info>>,
        market_index: u16,
        amount: u64,
    ) -> Result<()> {
        require!(market_index == v::QUOTE_MARKET || market_index == v::SOL_MARKET, NeltaError::InvalidMarket);
        require!(amount > 0, NeltaError::ZeroAmount);
        let a = &ctx.accounts;
        invoke(
            &token_transfer_ix(a.owner_token.key, a.vault_token.key, a.owner.key, amount),
            &[a.owner_token.to_account_info(), a.vault_token.to_account_info(), a.owner.to_account_info()],
        )?;
        let mut metas = venue_metas(&a.venue, &a.position.key());
        metas.push(AccountMeta::new(a.spot_market_vault.key(), false));
        metas.push(AccountMeta::new(a.vault_token.key(), false));
        metas.push(AccountMeta::new_readonly(a.token_program.key(), false));
        let mut infos = venue_infos(&a.venue, &a.position.to_account_info());
        infos.push(a.spot_market_vault.to_account_info());
        infos.push(a.vault_token.to_account_info());
        infos.push(a.token_program.to_account_info());
        push_remaining(&mut metas, &mut infos, ctx.remaining_accounts);
        invoke_signed(
            &Instruction { program_id: v::ID, accounts: metas, data: v::deposit_data(market_index, amount) },
            &infos,
            &[&a.position.seeds()],
        )?;
        Ok(())
    }

    pub fn set_ratio(ctx: Context<OwnerOnly>, ratio_bps: u16) -> Result<()> {
        require!(ratio_bps <= BPS, NeltaError::InvalidRatio);
        ctx.accounts.position.ratio_bps = ratio_bps;
        Ok(())
    }

    /// Owner-signed: move the short to exactly the target for the SOL held. May increase the short.
    pub fn rebalance<'info>(ctx: Context<'info, Hedge<'info>>) -> Result<()> {
        let a = &ctx.accounts;
        let step = v::read_order_step(&a.perp_market)?;
        let held = v::read_sol_lamports(&a.venue.velocity_user, &a.sol_spot_market)?;
        let target = target_short(held, a.position.ratio_bps, step)?;
        let current = v::read_short(&a.venue.velocity_user)?;
        if target != current {
            let (direction, size, reduce_only) = if target > current {
                (v::SHORT, target - current, false)
            } else {
                (v::LONG, current - target, true)
            };
            place_and_take(&a.venue, &a.position, ctx.remaining_accounts, direction, size, reduce_only, true)?;
        }
        let after = v::read_short(&a.venue.velocity_user)?;
        require_eq!(after, target, NeltaError::PostcheckShort);
        emit!(Rebalanced { owner: a.position.owner, sol_lamports: held, short_base: after });
        Ok(())
    }

    /// Owner-signed recovery path that does not need instant liquidity: a reduce-only order that
    /// rests for Velocity keepers if it cannot fill now. It can only shrink the short.
    pub fn reduce_hedge<'info>(ctx: Context<'info, Hedge<'info>>, base: u64) -> Result<()> {
        require!(base > 0, NeltaError::ZeroAmount);
        let a = &ctx.accounts;
        let current = v::read_short(&a.venue.velocity_user)?;
        require!(base <= current, NeltaError::PostcheckShort);
        place_and_take(&a.venue, &a.position, ctx.remaining_accounts, v::LONG, base, true, false)?;
        require!(v::read_short(&a.venue.velocity_user)? <= current, NeltaError::PostcheckShort);
        Ok(())
    }

    /// Owner-signed: release SOL to the owner and shrink the short in the same instruction.
    pub fn release<'info>(ctx: Context<'info, Release<'info>>, lamports: u64) -> Result<()> {
        require_keys_eq!(ctx.accounts.core.position.owner, ctx.accounts.owner.key(), NeltaError::InvalidRecipient);
        release_paired(&ctx.accounts.core, ctx.remaining_accounts, lamports)
    }

    /// Owner-signed: arm a one-use price rule that a keeper may execute while the phone is off.
    pub fn set_rule(
        ctx: Context<OwnerOnly>,
        trigger_price: u64,
        above: bool,
        release_lamports: u64,
        expiry_ts: i64,
    ) -> Result<()> {
        require!(release_lamports > 0, NeltaError::ZeroAmount);
        require!(trigger_price > 0, NeltaError::InvalidRule);
        require!(expiry_ts > Clock::get()?.unix_timestamp, NeltaError::RuleExpired);
        let p = &mut ctx.accounts.position;
        p.rule_nonce = p.rule_nonce.checked_add(1).ok_or(NeltaError::Overflow)?;
        p.rule = Rule { active: true, above, trigger_price, release_lamports, expiry_ts };
        emit!(RuleSet { owner: p.owner, nonce: p.rule_nonce, trigger_price, above, release_lamports, expiry_ts });
        Ok(())
    }

    pub fn revoke_rule(ctx: Context<OwnerOnly>) -> Result<()> {
        let p = &mut ctx.accounts.position;
        p.rule.active = false;
        emit!(RuleRevoked { owner: p.owner, nonce: p.rule_nonce });
        Ok(())
    }

    /// Permissionless: executes the armed rule once. Can only reduce the short and pay the owner.
    pub fn execute_rule<'info>(ctx: Context<'info, ExecuteRule<'info>>, nonce: u64) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let rule = ctx.accounts.core.position.rule;
        require!(rule.active, NeltaError::RuleInactive);
        require_eq!(nonce, ctx.accounts.core.position.rule_nonce, NeltaError::StaleNonce);
        require!(now <= rule.expiry_ts, NeltaError::RuleExpired);
        let (price, publish_ts) = v::read_oracle_price(&ctx.accounts.oracle)?;
        require!(now - publish_ts <= MAX_ORACLE_AGE_SECS, NeltaError::StaleOracle);
        require!(rule_triggered(&rule, price), NeltaError::NotTriggered);
        ctx.accounts.core.position.rule.active = false;

        let a = &ctx.accounts.core;
        let held = v::read_sol_lamports(&a.venue.velocity_user, &a.sol_spot_market)?;
        let lamports = rule.release_lamports.min(held);
        release_paired(a, ctx.remaining_accounts, lamports)?;
        emit!(RuleExecuted { owner: a.position.owner, nonce, price, lamports });
        Ok(())
    }

    /// Owner-signed: withdraw quote collateral (market 0) back to the owner. Velocity enforces margin.
    pub fn withdraw_collateral<'info>(
        ctx: Context<'info, WithdrawCollateral<'info>>,
        amount: u64,
    ) -> Result<()> {
        require!(amount > 0, NeltaError::ZeroAmount);
        let a = &ctx.accounts;
        let before = token_amount(&a.vault_token)?;
        venue_withdraw(
            &a.venue, &a.position, &a.spot_market_vault, &a.velocity_signer, &a.vault_token, &a.token_program,
            ctx.remaining_accounts, v::QUOTE_MARKET, amount,
        )?;
        let received = token_amount(&a.vault_token)?.checked_sub(before).ok_or(NeltaError::Overflow)?;
        invoke_signed(
            &token_transfer_ix(a.vault_token.key, a.owner_token.key, &a.position.key(), received),
            &[a.vault_token.to_account_info(), a.owner_token.to_account_info(), a.position.to_account_info()],
            &[&a.position.seeds()],
        )?;
        Ok(())
    }
}

fn release_paired<'info>(a: &ReleaseCore<'info>, remaining: &'info [AccountInfo<'info>], lamports: u64) -> Result<()> {
    require!(lamports > 0, NeltaError::ZeroAmount);
    let step = v::read_order_step(&a.perp_market)?;
    let held = v::read_sol_lamports(&a.venue.velocity_user, &a.sol_spot_market)?;
    require!(lamports <= held, NeltaError::InsufficientSol);
    let remaining_sol = held - lamports;
    let target = target_short(remaining_sol, a.position.ratio_bps, step)?;
    let current = v::read_short(&a.venue.velocity_user)?;
    if current > target {
        place_and_take(&a.venue, &a.position, remaining, v::LONG, current - target, true, true)?;
        require_eq!(v::read_short(&a.venue.velocity_user)?, target, NeltaError::PostcheckShort);
    }
    let before = token_amount(&a.vault_token)?;
    venue_withdraw(
        &a.venue, &a.position, &a.spot_market_vault, &a.velocity_signer, &a.vault_token, &a.token_program,
        remaining, v::SOL_MARKET, lamports,
    )?;
    let received = token_amount(&a.vault_token)?.checked_sub(before).ok_or(NeltaError::Overflow)?;
    require!(received.saturating_add(1) >= lamports, NeltaError::PostcheckSol);
    invoke_signed(
        &token_transfer_ix(a.vault_token.key, a.owner_token.key, &a.position.key(), received),
        &[a.vault_token.to_account_info(), a.owner_token.to_account_info(), a.position.to_account_info()],
        &[&a.position.seeds()],
    )?;
    let held_after = v::read_sol_lamports(&a.venue.velocity_user, &a.sol_spot_market)?;
    require!(held_after.saturating_add(lamports) <= held.saturating_add(1), NeltaError::PostcheckSol);
    let short_after = v::read_short(&a.venue.velocity_user)?;
    require_eq!(short_after, current.min(target), NeltaError::PostcheckShort);
    emit!(Released { owner: a.position.owner, lamports, sol_after: held_after, short_after });
    Ok(())
}

fn place_and_take<'info>(
    venue: &Venue<'info>,
    position: &Account<'info, Position>,
    remaining: &'info [AccountInfo<'info>],
    direction: u8,
    base: u64,
    reduce_only: bool,
    full_fill: bool,
) -> Result<()> {
    let mut metas = venue_metas(venue, &position.key());
    let mut infos = venue_infos(venue, &position.to_account_info());
    push_remaining(&mut metas, &mut infos, remaining);
    invoke_signed(
        &Instruction { program_id: v::ID, accounts: metas, data: v::place_and_take_data(direction, base, reduce_only, full_fill) },
        &infos,
        &[&position.seeds()],
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn venue_withdraw<'info>(
    venue: &Venue<'info>,
    position: &Account<'info, Position>,
    spot_market_vault: &UncheckedAccount<'info>,
    velocity_signer: &UncheckedAccount<'info>,
    vault_token: &UncheckedAccount<'info>,
    token_program: &UncheckedAccount<'info>,
    remaining: &'info [AccountInfo<'info>],
    market_index: u16,
    amount: u64,
) -> Result<()> {
    let mut metas = venue_metas(venue, &position.key());
    metas.push(AccountMeta::new(spot_market_vault.key(), false));
    metas.push(AccountMeta::new_readonly(velocity_signer.key(), false));
    metas.push(AccountMeta::new(vault_token.key(), false));
    metas.push(AccountMeta::new_readonly(token_program.key(), false));
    let mut infos = venue_infos(venue, &position.to_account_info());
    infos.push(spot_market_vault.to_account_info());
    infos.push(velocity_signer.to_account_info());
    infos.push(vault_token.to_account_info());
    infos.push(token_program.to_account_info());
    push_remaining(&mut metas, &mut infos, remaining);
    invoke_signed(
        &Instruction { program_id: v::ID, accounts: metas, data: v::withdraw_data(market_index, amount) },
        &infos,
        &[&position.seeds()],
    )?;
    Ok(())
}

fn venue_metas(venue: &Venue, position: &Pubkey) -> Vec<AccountMeta> {
    vec![
        AccountMeta::new_readonly(venue.velocity_state.key(), false),
        AccountMeta::new(venue.velocity_user.key(), false),
        AccountMeta::new(venue.velocity_user_stats.key(), false),
        AccountMeta::new_readonly(*position, true),
    ]
}

fn venue_infos<'info>(venue: &Venue<'info>, position: &AccountInfo<'info>) -> Vec<AccountInfo<'info>> {
    vec![
        venue.velocity_state.to_account_info(),
        venue.velocity_user.to_account_info(),
        venue.velocity_user_stats.to_account_info(),
        position.clone(),
    ]
}

fn push_remaining<'info>(metas: &mut Vec<AccountMeta>, infos: &mut Vec<AccountInfo<'info>>, remaining: &[AccountInfo<'info>]) {
    for ai in remaining {
        metas.push(AccountMeta { pubkey: *ai.key, is_signer: false, is_writable: ai.is_writable });
        infos.push(ai.clone());
    }
}

fn token_transfer_ix(source: &Pubkey, dest: &Pubkey, authority: &Pubkey, amount: u64) -> Instruction {
    let mut data = Vec::with_capacity(9);
    data.push(3u8);
    data.extend_from_slice(&amount.to_le_bytes());
    Instruction {
        program_id: v::TOKEN_PROGRAM,
        accounts: vec![
            AccountMeta::new(*source, false),
            AccountMeta::new(*dest, false),
            AccountMeta::new_readonly(*authority, true),
        ],
        data,
    }
}

/// Reads (mint, owner) from an SPL token account owned by the classic token program.
fn token_account_mint_owner(ai: &AccountInfo) -> Result<(Pubkey, Pubkey)> {
    require_keys_eq!(*ai.owner, v::TOKEN_PROGRAM, NeltaError::InvalidTokenAccount);
    let d = ai.try_borrow_data()?;
    require!(d.len() >= 72, NeltaError::InvalidTokenAccount);
    let mint = Pubkey::try_from(&d[0..32]).map_err(|_| NeltaError::InvalidTokenAccount)?;
    let owner = Pubkey::try_from(&d[32..64]).map_err(|_| NeltaError::InvalidTokenAccount)?;
    Ok((mint, owner))
}

fn token_amount(ai: &AccountInfo) -> Result<u64> {
    let d = ai.try_borrow_data()?;
    let b = d.get(64..72).ok_or(NeltaError::InvalidTokenAccount)?;
    Ok(u64::from_le_bytes(b.try_into().unwrap()))
}

fn rule_triggered(rule: &Rule, price: u64) -> bool {
    if rule.above { price >= rule.trigger_price } else { price <= rule.trigger_price }
}

#[account]
#[derive(InitSpace)]
pub struct Position {
    pub owner: Pubkey,
    pub bump: u8,
    pub ratio_bps: u16,
    pub rule_nonce: u64,
    pub rule: Rule,
}

impl Position {
    pub fn seeds(&self) -> [&[u8]; 3] {
        [POSITION_SEED, self.owner.as_ref(), std::slice::from_ref(&self.bump)]
    }
}

/// trigger_price uses PRICE_PRECISION (1e6 USD).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct Rule {
    pub active: bool,
    pub above: bool,
    pub trigger_price: u64,
    pub release_lamports: u64,
    pub expiry_ts: i64,
}

#[derive(Accounts)]
pub struct Venue<'info> {
    /// CHECK: address-constrained Velocity state
    #[account(address = v::STATE)]
    pub velocity_state: UncheckedAccount<'info>,
    /// CHECK: must be the Velocity user derived from the position PDA, checked in validate()
    #[account(mut)]
    pub velocity_user: UncheckedAccount<'info>,
    /// CHECK: must be the Velocity user stats derived from the position PDA, checked in validate()
    #[account(mut)]
    pub velocity_user_stats: UncheckedAccount<'info>,
    /// CHECK: Velocity program
    #[account(address = v::ID)]
    pub velocity_program: UncheckedAccount<'info>,
}

impl<'info> Venue<'info> {
    fn validate(&self, position: &Pubkey) -> Result<()> {
        require_keys_eq!(self.velocity_user.key(), v::user_pda(position), NeltaError::InvalidVenueAccount);
        require_keys_eq!(self.velocity_user_stats.key(), v::user_stats_pda(position), NeltaError::InvalidVenueAccount);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(init, payer = owner, space = 8 + Position::INIT_SPACE, seeds = [POSITION_SEED, owner.key().as_ref()], bump)]
    pub position: Account<'info, Position>,
    /// CHECK: address-constrained Velocity state
    #[account(mut, address = v::STATE)]
    pub velocity_state: UncheckedAccount<'info>,
    /// CHECK: derived from the position PDA
    #[account(mut, address = v::user_pda(&position.key()))]
    pub velocity_user: UncheckedAccount<'info>,
    /// CHECK: derived from the position PDA
    #[account(mut, address = v::user_stats_pda(&position.key()))]
    pub velocity_user_stats: UncheckedAccount<'info>,
    /// CHECK: Velocity program
    #[account(address = v::ID)]
    pub velocity_program: UncheckedAccount<'info>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OwnerOnly<'info> {
    pub owner: Signer<'info>,
    #[account(mut, has_one = owner, seeds = [POSITION_SEED, owner.key().as_ref()], bump = position.bump)]
    pub position: Account<'info, Position>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub owner: Signer<'info>,
    #[account(has_one = owner, seeds = [POSITION_SEED, owner.key().as_ref()], bump = position.bump)]
    pub position: Account<'info, Position>,
    #[account(constraint = venue.validate(&position.key()).is_ok() @ NeltaError::InvalidVenueAccount)]
    pub venue: Venue<'info>,
    /// CHECK: Velocity validates the spot market vault seeds
    #[account(mut)]
    pub spot_market_vault: UncheckedAccount<'info>,
    /// CHECK: owner's source token account; the token program enforces the owner signature
    #[account(mut)]
    pub owner_token: UncheckedAccount<'info>,
    /// CHECK: position-owned token account, verified below
    #[account(mut, constraint = token_account_mint_owner(&vault_token)?.1 == position.key() @ NeltaError::InvalidTokenAccount)]
    pub vault_token: UncheckedAccount<'info>,
    /// CHECK: classic SPL token program
    #[account(address = v::TOKEN_PROGRAM)]
    pub token_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Hedge<'info> {
    pub owner: Signer<'info>,
    #[account(has_one = owner, seeds = [POSITION_SEED, owner.key().as_ref()], bump = position.bump)]
    pub position: Account<'info, Position>,
    #[account(constraint = venue.validate(&position.key()).is_ok() @ NeltaError::InvalidVenueAccount)]
    pub venue: Venue<'info>,
    /// CHECK: address-constrained SOL spot market (also passed in remaining accounts for Velocity)
    #[account(address = v::SOL_SPOT_MARKET)]
    pub sol_spot_market: UncheckedAccount<'info>,
    /// CHECK: address-constrained SOL-PERP market (also passed in remaining accounts for Velocity)
    #[account(address = v::SOL_PERP_MARKET)]
    pub perp_market: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Release<'info> {
    pub owner: Signer<'info>,
    pub core: ReleaseCore<'info>,
}

#[derive(Accounts)]
pub struct ExecuteRule<'info> {
    pub keeper: Signer<'info>,
    pub core: ReleaseCore<'info>,
    /// CHECK: address-constrained Velocity SOL oracle, read in read_oracle_price()
    #[account(address = v::SOL_ORACLE)]
    pub oracle: UncheckedAccount<'info>,
}

/// Accounts for a paired release. SOL can only reach the position owner's wSOL account.
#[derive(Accounts)]
pub struct ReleaseCore<'info> {
    #[account(mut, seeds = [POSITION_SEED, position.owner.as_ref()], bump = position.bump)]
    pub position: Account<'info, Position>,
    #[account(constraint = venue.validate(&position.key()).is_ok() @ NeltaError::InvalidVenueAccount)]
    pub venue: Venue<'info>,
    /// CHECK: address-constrained SOL spot market (also passed in remaining accounts for Velocity)
    #[account(address = v::SOL_SPOT_MARKET)]
    pub sol_spot_market: UncheckedAccount<'info>,
    /// CHECK: address-constrained SOL-PERP market (also passed in remaining accounts for Velocity)
    #[account(address = v::SOL_PERP_MARKET)]
    pub perp_market: UncheckedAccount<'info>,
    /// CHECK: address-constrained Velocity SOL spot vault
    #[account(mut, address = v::SOL_SPOT_VAULT)]
    pub spot_market_vault: UncheckedAccount<'info>,
    /// CHECK: address-constrained Velocity signer
    #[account(address = v::VELOCITY_SIGNER)]
    pub velocity_signer: UncheckedAccount<'info>,
    /// CHECK: position-owned wSOL account, verified below
    #[account(mut, constraint = token_account_mint_owner(&vault_token)? == (v::WSOL_MINT, position.key()) @ NeltaError::InvalidTokenAccount)]
    pub vault_token: UncheckedAccount<'info>,
    /// CHECK: owner's wSOL account, verified below
    #[account(mut, constraint = token_account_mint_owner(&owner_token)? == (v::WSOL_MINT, position.owner) @ NeltaError::InvalidRecipient)]
    pub owner_token: UncheckedAccount<'info>,
    /// CHECK: classic SPL token program
    #[account(address = v::TOKEN_PROGRAM)]
    pub token_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct WithdrawCollateral<'info> {
    pub owner: Signer<'info>,
    #[account(has_one = owner, seeds = [POSITION_SEED, owner.key().as_ref()], bump = position.bump)]
    pub position: Account<'info, Position>,
    #[account(constraint = venue.validate(&position.key()).is_ok() @ NeltaError::InvalidVenueAccount)]
    pub venue: Venue<'info>,
    /// CHECK: Velocity validates the spot market vault seeds
    #[account(mut)]
    pub spot_market_vault: UncheckedAccount<'info>,
    /// CHECK: address-constrained Velocity signer
    #[account(address = v::VELOCITY_SIGNER)]
    pub velocity_signer: UncheckedAccount<'info>,
    /// CHECK: position-owned token account, verified below
    #[account(mut, constraint = token_account_mint_owner(&vault_token)?.1 == position.key() @ NeltaError::InvalidTokenAccount)]
    pub vault_token: UncheckedAccount<'info>,
    /// CHECK: owner's token account of the same mint, verified below
    #[account(mut, constraint = token_account_mint_owner(&owner_token)? == (token_account_mint_owner(&vault_token)?.0, owner.key()) @ NeltaError::InvalidRecipient)]
    pub owner_token: UncheckedAccount<'info>,
    /// CHECK: classic SPL token program
    #[account(address = v::TOKEN_PROGRAM)]
    pub token_program: UncheckedAccount<'info>,
}

#[event]
pub struct PositionOpened { pub owner: Pubkey, pub ratio_bps: u16 }
#[event]
pub struct Rebalanced { pub owner: Pubkey, pub sol_lamports: u64, pub short_base: u64 }
#[event]
pub struct Released { pub owner: Pubkey, pub lamports: u64, pub sol_after: u64, pub short_after: u64 }
#[event]
pub struct RuleSet { pub owner: Pubkey, pub nonce: u64, pub trigger_price: u64, pub above: bool, pub release_lamports: u64, pub expiry_ts: i64 }
#[event]
pub struct RuleRevoked { pub owner: Pubkey, pub nonce: u64 }
#[event]
pub struct RuleExecuted { pub owner: Pubkey, pub nonce: u64, pub price: u64, pub lamports: u64 }

#[error_code]
pub enum NeltaError {
    #[msg("Hedge ratio must be between 0 and 10000 bps")]
    InvalidRatio,
    #[msg("Only market 0 (quote) and market 1 (SOL) are allowed")]
    InvalidMarket,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Velocity account does not belong to this position")]
    InvalidVenueAccount,
    #[msg("Token account has the wrong mint or owner")]
    InvalidTokenAccount,
    #[msg("Released funds can only go to the position owner")]
    InvalidRecipient,
    #[msg("Not enough SOL in the position")]
    InsufficientSol,
    #[msg("Short does not match the target after execution")]
    PostcheckShort,
    #[msg("SOL balance did not decrease by the released amount")]
    PostcheckSol,
    #[msg("Invalid rule parameters")]
    InvalidRule,
    #[msg("Rule is not active")]
    RuleInactive,
    #[msg("Rule nonce does not match")]
    StaleNonce,
    #[msg("Rule has expired")]
    RuleExpired,
    #[msg("Oracle price is too old")]
    StaleOracle,
    #[msg("Trigger price not reached")]
    NotTriggered,
    #[msg("Position holds a long perp, which Nelta never opens")]
    UnexpectedLong,
    #[msg("Spot SOL balance is a borrow, which Nelta never opens")]
    UnexpectedBorrow,
    #[msg("Account data could not be read")]
    InvalidAccountData,
    #[msg("Arithmetic overflow")]
    Overflow,
}
