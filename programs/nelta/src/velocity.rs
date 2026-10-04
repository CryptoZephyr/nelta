//! Minimal Velocity v1 (Devnet) interface: fixed accounts, raw instruction encoding and
//! zero-copy readers for the fields Nelta checks. Layouts are pinned to velocity 2.169.0.
use crate::{math::to_price_precision, NeltaError};
use anchor_lang::prelude::*;

pub const ID: Pubkey = pubkey!("vELoC1audYbSYVRXn1vPaV8Axoa9oU6BYmNGZZBDZ1P");
pub const STATE: Pubkey = pubkey!("2etx5NvPNxeMZ7EfHE6GjJfW2imRYEUANehNS1WB4CVW");
pub const VELOCITY_SIGNER: Pubkey = pubkey!("FchXiT9JgMDis6CFLjz9uG5mQYkmDtHqiWtBPEYUabaK");
pub const SOL_SPOT_MARKET: Pubkey = pubkey!("5MzQRp6hhesVuM3CSAzBfPSNP1WaJyF1ifwkmzcrWLtU");
pub const SOL_SPOT_VAULT: Pubkey = pubkey!("BJyCJijt3zmJikjSvhorZtxaoQDWrWmTHfUvhxa5aA4i");
pub const SOL_PERP_MARKET: Pubkey = pubkey!("FDejXbUrSy6zayBCL5xuk2SXLHZgr8ppfFTLcHbyJorY");
pub const SOL_ORACLE: Pubkey = pubkey!("2k3UHX6ehRFzx5fTVvbL6FwXhMjkucjJDL9MuVKLo8TV");
pub const WSOL_MINT: Pubkey = pubkey!("So11111111111111111111111111111111111111112");
pub const TOKEN_PROGRAM: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

pub const QUOTE_MARKET: u16 = 0;
pub const SOL_MARKET: u16 = 1;
pub const SOL_PERP_INDEX: u16 = 0;
pub const LONG: u8 = 0;
pub const SHORT: u8 = 1;

const INIT_USER: [u8; 8] = [111, 17, 185, 250, 60, 122, 38, 254];
pub const INIT_USER_STATS: [u8; 8] = [254, 243, 72, 98, 251, 130, 168, 213];
const DEPOSIT: [u8; 8] = [242, 35, 198, 137, 82, 225, 242, 182];
const WITHDRAW: [u8; 8] = [183, 18, 70, 156, 148, 109, 161, 34];
const PLACE_AND_TAKE_PERP: [u8; 8] = [213, 51, 1, 187, 108, 220, 230, 224];
/// PlaceAndTakeOrderSuccessCondition::FullFill (2) | auction duration percentage 100 << 8.
const FULL_FILL: u32 = 2 | (100 << 8);

// User account (after 8-byte discriminator): authority, delegate, name, spot_positions[8], perp_positions[8].
const USER_SPOT_POSITIONS: usize = 8 + 32 + 32 + 32;
const SPOT_POSITION_SIZE: usize = 40;
const USER_PERP_POSITIONS: usize = USER_SPOT_POSITIONS + 8 * SPOT_POSITION_SIZE;
const PERP_POSITION_SIZE: usize = 80;
const SPOT_CUMULATIVE_DEPOSIT_INTEREST: usize = 328;
const SPOT_CUMULATIVE_INTEREST_PRECISION: u128 = 10_000_000_000;
const PERP_ORDER_STEP_SIZE: usize = 544;

pub fn user_pda(authority: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"user", authority.as_ref(), &0u16.to_le_bytes()], &ID).0
}

pub fn user_stats_pda(authority: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"user_stats", authority.as_ref()], &ID).0
}

pub fn initialize_user_data() -> Vec<u8> {
    let mut d = INIT_USER.to_vec();
    d.extend_from_slice(&0u16.to_le_bytes());
    let mut name = [b' '; 32];
    name[..5].copy_from_slice(b"Nelta");
    d.extend_from_slice(&name);
    d
}

pub fn deposit_data(market_index: u16, amount: u64) -> Vec<u8> {
    let mut d = DEPOSIT.to_vec();
    d.extend_from_slice(&market_index.to_le_bytes());
    d.extend_from_slice(&amount.to_le_bytes());
    d.push(0);
    d
}

/// reduce_only = true: a withdrawal can never open a borrow.
pub fn withdraw_data(market_index: u16, amount: u64) -> Vec<u8> {
    let mut d = WITHDRAW.to_vec();
    d.extend_from_slice(&market_index.to_le_bytes());
    d.extend_from_slice(&amount.to_le_bytes());
    d.push(1);
    d
}

/// Market order on SOL-PERP. With `full_fill` it must fill completely inside this transaction or
/// revert; without it the unfilled part rests for Velocity keepers to fill.
pub fn place_and_take_data(direction: u8, base: u64, reduce_only: bool, full_fill: bool) -> Vec<u8> {
    let mut d = PLACE_AND_TAKE_PERP.to_vec();
    d.extend_from_slice(&[0, 1, direction, 0]); // Market, Perp, direction, user_order_id
    d.extend_from_slice(&base.to_le_bytes());
    d.extend_from_slice(&0u64.to_le_bytes()); // price
    d.extend_from_slice(&SOL_PERP_INDEX.to_le_bytes());
    d.push(reduce_only as u8);
    // post_only, bit_flags, max_ts, trigger_price, trigger_condition, oracle_price_offset,
    // auction_duration, auction_start_price, auction_end_price, builder_idx, builder_fee
    d.extend_from_slice(&[0u8; 11]);
    if full_fill {
        d.push(1);
        d.extend_from_slice(&FULL_FILL.to_le_bytes());
    } else {
        d.push(0);
    }
    d
}

fn velocity_data<'a>(ai: &'a AccountInfo) -> Result<std::cell::Ref<'a, &'a mut [u8]>> {
    require_keys_eq!(*ai.owner, ID, NeltaError::InvalidVenueAccount);
    Ok(ai.try_borrow_data()?)
}

fn u64_at(d: &[u8], o: usize) -> Result<u64> {
    let b = d.get(o..o + 8).ok_or(NeltaError::InvalidAccountData)?;
    Ok(u64::from_le_bytes(b.try_into().unwrap()))
}

fn i64_at(d: &[u8], o: usize) -> Result<i64> {
    Ok(u64_at(d, o)? as i64)
}

/// SOL (lamports) the position holds in Velocity spot market 1.
pub fn read_sol_lamports(user: &AccountInfo, sol_spot_market: &AccountInfo) -> Result<u64> {
    let ud = velocity_data(user)?;
    let mut scaled = 0u64;
    for i in 0..8 {
        let o = USER_SPOT_POSITIONS + i * SPOT_POSITION_SIZE;
        let idx = u16::from_le_bytes(ud.get(o + 32..o + 34).ok_or(NeltaError::InvalidAccountData)?.try_into().unwrap());
        let balance = u64_at(&ud, o)?;
        if idx == SOL_MARKET && balance > 0 {
            require!(ud[o + 34] == 0, NeltaError::UnexpectedBorrow);
            scaled = balance;
        }
    }
    let sd = velocity_data(sol_spot_market)?;
    let lo = u64_at(&sd, SPOT_CUMULATIVE_DEPOSIT_INTEREST)? as u128;
    let hi = u64_at(&sd, SPOT_CUMULATIVE_DEPOSIT_INTEREST + 8)? as u128;
    let cdi = (hi << 64) | lo;
    let lamports = (scaled as u128).checked_mul(cdi).ok_or(NeltaError::Overflow)? / SPOT_CUMULATIVE_INTEREST_PRECISION;
    u64::try_from(lamports).map_err(|_| error!(NeltaError::Overflow))
}

/// Size of the SOL-PERP short in base units (1e9). Errors if the position is long.
pub fn read_short(user: &AccountInfo) -> Result<u64> {
    let ud = velocity_data(user)?;
    for i in 0..8 {
        let o = USER_PERP_POSITIONS + i * PERP_POSITION_SIZE;
        let base = i64_at(&ud, o + 8)?;
        let idx = u16::from_le_bytes(ud.get(o + 76..o + 78).ok_or(NeltaError::InvalidAccountData)?.try_into().unwrap());
        if idx == SOL_PERP_INDEX && base != 0 {
            require!(base < 0, NeltaError::UnexpectedLong);
            return Ok(base.unsigned_abs());
        }
    }
    Ok(0)
}

pub fn read_order_step(perp_market: &AccountInfo) -> Result<u64> {
    let d = velocity_data(perp_market)?;
    u64_at(&d, PERP_ORDER_STEP_SIZE)
}

/// (price in PRICE_PRECISION, publish time in unix seconds) from the Velocity Pyth Lazer oracle.
pub fn read_oracle_price(oracle: &AccountInfo) -> Result<(u64, i64)> {
    let d = velocity_data(oracle)?;
    let price = i64_at(&d, 8)?;
    let publish_us = u64_at(&d, 16)?;
    let exponent = i32::from_le_bytes(d.get(32..36).ok_or(NeltaError::InvalidAccountData)?.try_into().unwrap());
    let publish_ts = i64::try_from(publish_us / 1_000_000).map_err(|_| error!(NeltaError::Overflow))?;
    Ok((to_price_precision(price, exponent)?, publish_ts))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Bytes produced by @velocity-exchange/sdk 0.26.0 getPlaceAndTakePerpOrderIx for a
    /// 0.02 SOL reduce-only long with FullFill (captured from the SDK on Devnet).
    #[test]
    fn place_and_take_matches_sdk() {
        let sdk = "d53301bb6cdce6e000010000002d310100000000000000000000000000000100000000000000000000000102640000";
        let ours: String = place_and_take_data(LONG, 20_000_000, true, true).iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(ours, sdk);
    }

    #[test]
    fn resting_order_has_no_success_condition() {
        let full = place_and_take_data(LONG, 20_000_000, true, true);
        let resting = place_and_take_data(LONG, 20_000_000, true, false);
        assert_eq!(resting.len(), full.len() - 4);
        assert_eq!(resting[..resting.len() - 1], full[..resting.len() - 1]);
        assert_eq!(*resting.last().unwrap(), 0);
    }

    #[test]
    fn withdraw_matches_sdk() {
        let sdk = "b712469c946da1220100005a62020000000001";
        let ours: String = withdraw_data(SOL_MARKET, 40_000_000).iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(ours, sdk);
    }

    #[test]
    fn deposit_matches_sdk() {
        let sdk = "f223c68952e1f2b60100e80300000000000000";
        let ours: String = deposit_data(SOL_MARKET, 1_000).iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(ours, sdk);
    }

    #[test]
    fn known_pdas() {
        let auth = pubkey!("JndTyQdwU2hAwZdbNipCMxbed7kBGGZUP3UZ5YzEdSQ");
        assert_eq!(user_pda(&auth), pubkey!("33r8qSTvZ5AhosL372M7LCBGHuDwZEb7B3qfdMbRLBpV"));
        assert_eq!(user_stats_pda(&auth), pubkey!("6V61C28A1zHWvN2sw8m4gf8khz1EwZMzcmhwyv3tk9rf"));
    }
}
