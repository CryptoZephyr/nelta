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
// SpotPosition: scaled_balance u64 at 0, market_index u16, balance_type u8 (0 = deposit).
const SPOT_MARKET_INDEX: usize = 32;
const SPOT_BALANCE_TYPE: usize = 34;
const USER_PERP_POSITIONS: usize = USER_SPOT_POSITIONS + 8 * SPOT_POSITION_SIZE;
const PERP_POSITION_SIZE: usize = 80;
const PERP_BASE_ASSET_AMOUNT: usize = 8;
const PERP_MARKET_INDEX: usize = 76;
const SPOT_CUMULATIVE_DEPOSIT_INTEREST: usize = 328;
const SPOT_CUMULATIVE_INTEREST_PRECISION: u128 = 10_000_000_000;
const PERP_ORDER_STEP_SIZE: usize = 544;
// PythLazerOracle (after the discriminator): price i64, publish_time u64 (us), posted_slot u64, exponent i32.
const ORACLE_PRICE: usize = 8;
const ORACLE_PUBLISH_TIME: usize = 16;
const ORACLE_EXPONENT: usize = 32;

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

fn u16_at(d: &[u8], o: usize) -> Result<u16> {
    let b = d.get(o..o + 2).ok_or(NeltaError::InvalidAccountData)?;
    Ok(u16::from_le_bytes(b.try_into().unwrap()))
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
        let idx = u16_at(&ud, o + SPOT_MARKET_INDEX)?;
        let balance = u64_at(&ud, o)?;
        if idx == SOL_MARKET && balance > 0 {
            let balance_type = *ud.get(o + SPOT_BALANCE_TYPE).ok_or(NeltaError::InvalidAccountData)?;
            require!(balance_type == 0, NeltaError::UnexpectedBorrow);
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
        let base = i64_at(&ud, o + PERP_BASE_ASSET_AMOUNT)?;
        let idx = u16_at(&ud, o + PERP_MARKET_INDEX)?;
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
    let price = i64_at(&d, ORACLE_PRICE)?;
    let publish_us = u64_at(&d, ORACLE_PUBLISH_TIME)?;
    let exponent = i32::from_le_bytes(d.get(ORACLE_EXPONENT..ORACLE_EXPONENT + 4).ok_or(NeltaError::InvalidAccountData)?.try_into().unwrap());
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

    fn fixture(name: &str) -> Vec<u8> {
        let path = format!("{}/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
        std::fs::read(&path).unwrap_or_else(|e| panic!("{path}: {e}"))
    }

    fn json(name: &str) -> serde_json::Value {
        serde_json::from_slice(&fixture(name)).unwrap()
    }

    fn num<T: std::str::FromStr>(v: &serde_json::Value) -> T
    where
        T::Err: std::fmt::Debug,
    {
        match v {
            serde_json::Value::String(s) => s.parse().unwrap(),
            other => other.to_string().parse().unwrap(),
        }
    }

    fn account(owner: Pubkey, data: Vec<u8>) -> AccountInfo<'static> {
        let key: &'static Pubkey = Box::leak(Box::new(Pubkey::default()));
        let owner: &'static Pubkey = Box::leak(Box::new(owner));
        AccountInfo::new(key, false, false, Box::leak(Box::new(0u64)), Box::leak(data.into_boxed_slice()), owner, false)
    }

    fn venue(name: &str) -> AccountInfo<'static> {
        account(ID, fixture(name))
    }

    fn code(e: Error) -> u32 {
        match e {
            Error::AnchorError(a) => a.error_code_number,
            Error::ProgramError(p) => panic!("unexpected program error {p:?}"),
        }
    }

    fn nelta_code(e: NeltaError) -> u32 {
        anchor_lang::error::ERROR_CODE_OFFSET + e as u32
    }

    /// Expected values come from the Velocity SDK's IDL decoder over the same Devnet accounts
    /// (scripts/src/fixtures.ts), so an offset drift in this file fails here.
    #[test]
    fn decoders_match_sdk_on_devnet_fixtures() {
        let e = json("expected.json");
        let user = venue("user.bin");
        let spot = venue("sol_spot_market.bin");
        assert_eq!(read_sol_lamports(&user, &spot).unwrap(), num::<u64>(&e["user"]["sol"]["amount"]));
        let perp_base: i64 = num(&e["user"]["perp_base_asset_amount"]);
        assert!(perp_base < 0);
        assert_eq!(read_short(&user).unwrap(), perp_base.unsigned_abs());
        assert_eq!(read_order_step(&venue("sol_perp_market.bin")).unwrap(), num::<u64>(&e["sol_perp_market"]["order_step_size"]));
        let (price, publish_ts) = read_oracle_price(&venue("sol_oracle.bin")).unwrap();
        assert_eq!(price, num::<u64>(&e["sol_oracle"]["price_precision"]));
        assert_eq!(publish_ts, num::<i64>(&e["sol_oracle"]["publish_ts"]));
    }

    #[test]
    fn layout_matches_shared_fixture() {
        let l = &json("layout.json")["velocity"];
        let pairs = [
            ("user_spot_positions", USER_SPOT_POSITIONS),
            ("spot_position_size", SPOT_POSITION_SIZE),
            ("spot_market_index", SPOT_MARKET_INDEX),
            ("spot_balance_type", SPOT_BALANCE_TYPE),
            ("user_perp_positions", USER_PERP_POSITIONS),
            ("perp_position_size", PERP_POSITION_SIZE),
            ("perp_base_asset_amount", PERP_BASE_ASSET_AMOUNT),
            ("perp_market_index", PERP_MARKET_INDEX),
            ("spot_cumulative_deposit_interest", SPOT_CUMULATIVE_DEPOSIT_INTEREST),
            ("perp_order_step_size", PERP_ORDER_STEP_SIZE),
            ("oracle_price", ORACLE_PRICE),
            ("oracle_publish_time", ORACLE_PUBLISH_TIME),
            ("oracle_exponent", ORACLE_EXPONENT),
        ];
        assert_eq!(l.as_object().unwrap().len(), pairs.len());
        for (k, v) in pairs {
            assert_eq!(num::<usize>(&l[k]), v, "{k}");
        }
    }

    fn sol_slot(user: &[u8]) -> usize {
        (0..8)
            .map(|i| USER_SPOT_POSITIONS + i * SPOT_POSITION_SIZE)
            .find(|&o| u16::from_le_bytes([user[o + SPOT_MARKET_INDEX], user[o + SPOT_MARKET_INDEX + 1]]) == SOL_MARKET)
            .unwrap()
    }

    #[test]
    fn sol_borrow_is_rejected() {
        let mut user = fixture("user.bin");
        let o = sol_slot(&user);
        user[o + SPOT_BALANCE_TYPE] = 1;
        let err = read_sol_lamports(&venue_data(user), &venue("sol_spot_market.bin")).unwrap_err();
        assert_eq!(code(err), nelta_code(NeltaError::UnexpectedBorrow));
    }

    #[test]
    fn long_perp_is_rejected() {
        let mut user = fixture("user.bin");
        let o = USER_PERP_POSITIONS + PERP_BASE_ASSET_AMOUNT;
        let base = i64::from_le_bytes(user[o..o + 8].try_into().unwrap());
        user[o..o + 8].copy_from_slice(&(-base).to_le_bytes());
        assert_eq!(code(read_short(&venue_data(user)).unwrap_err()), nelta_code(NeltaError::UnexpectedLong));
    }

    #[test]
    fn other_markets_are_ignored() {
        let mut user = fixture("user.bin");
        let o = sol_slot(&user);
        user[o + SPOT_MARKET_INDEX..o + SPOT_MARKET_INDEX + 2].copy_from_slice(&7u16.to_le_bytes());
        let p = USER_PERP_POSITIONS + PERP_MARKET_INDEX;
        user[p..p + 2].copy_from_slice(&7u16.to_le_bytes());
        let user = venue_data(user);
        assert_eq!(read_sol_lamports(&user, &venue("sol_spot_market.bin")).unwrap(), 0);
        assert_eq!(read_short(&user).unwrap(), 0);
    }

    #[test]
    fn non_velocity_accounts_are_rejected() {
        let fake = Pubkey::new_from_array([7; 32]);
        let bad = nelta_code(NeltaError::InvalidVenueAccount);
        let spot = venue("sol_spot_market.bin");
        assert_eq!(code(read_sol_lamports(&account(fake, fixture("user.bin")), &spot).unwrap_err()), bad);
        assert_eq!(code(read_sol_lamports(&venue("user.bin"), &account(fake, fixture("sol_spot_market.bin"))).unwrap_err()), bad);
        assert_eq!(code(read_short(&account(fake, fixture("user.bin"))).unwrap_err()), bad);
        assert_eq!(code(read_order_step(&account(fake, fixture("sol_perp_market.bin"))).unwrap_err()), bad);
        assert_eq!(code(read_oracle_price(&account(fake, fixture("sol_oracle.bin"))).unwrap_err()), bad);
    }

    #[test]
    fn truncated_accounts_are_rejected() {
        let bad = nelta_code(NeltaError::InvalidAccountData);
        let short = |name: &str, len: usize| venue_data(fixture(name)[..len].to_vec());
        assert_eq!(code(read_short(&short("user.bin", USER_PERP_POSITIONS + 40)).unwrap_err()), bad);
        assert_eq!(code(read_sol_lamports(&short("user.bin", USER_SPOT_POSITIONS + 20), &venue("sol_spot_market.bin")).unwrap_err()), bad);
        assert_eq!(code(read_sol_lamports(&venue("user.bin"), &short("sol_spot_market.bin", SPOT_CUMULATIVE_DEPOSIT_INTEREST + 8)).unwrap_err()), bad);
        assert_eq!(code(read_order_step(&short("sol_perp_market.bin", PERP_ORDER_STEP_SIZE + 4)).unwrap_err()), bad);
        assert_eq!(code(read_oracle_price(&short("sol_oracle.bin", ORACLE_EXPONENT + 2)).unwrap_err()), bad);
    }

    fn venue_data(data: Vec<u8>) -> AccountInfo<'static> {
        account(ID, data)
    }

    #[test]
    fn known_pdas() {
        let auth = pubkey!("JndTyQdwU2hAwZdbNipCMxbed7kBGGZUP3UZ5YzEdSQ");
        assert_eq!(user_pda(&auth), pubkey!("33r8qSTvZ5AhosL372M7LCBGHuDwZEb7B3qfdMbRLBpV"));
        assert_eq!(user_stats_pda(&auth), pubkey!("6V61C28A1zHWvN2sw8m4gf8khz1EwZMzcmhwyv3tk9rf"));
    }
}
