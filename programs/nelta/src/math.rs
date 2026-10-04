use crate::NeltaError;
use anchor_lang::prelude::*;

pub const BPS: u16 = 10_000;
pub const MAX_ORACLE_AGE_SECS: i64 = 30;
/// Tolerated validator-vs-publisher clock skew for a publish time slightly ahead of `now`.
pub const MAX_ORACLE_SKEW_SECS: i64 = 5;

/// Two-sided freshness: not too far in the future and not older than MAX_ORACLE_AGE_SECS.
pub fn oracle_fresh(now: i64, publish_ts: i64) -> bool {
    match now.checked_sub(publish_ts) {
        Some(age) => (-MAX_ORACLE_SKEW_SECS..=MAX_ORACLE_AGE_SECS).contains(&age),
        None => false,
    }
}

/// target_short = floor((held * ratio) / (10_000 * step)) * step, all in base units (1e9 = 1 SOL).
pub fn target_short(held: u64, ratio_bps: u16, step: u64) -> Result<u64> {
    require!(step > 0, NeltaError::InvalidAccountData);
    require!(ratio_bps <= BPS, NeltaError::InvalidRatio);
    let raw = (held as u128) * (ratio_bps as u128) / (BPS as u128);
    let stepped = raw / (step as u128) * (step as u128);
    u64::try_from(stepped).map_err(|_| error!(NeltaError::Overflow))
}

/// Converts a Velocity/Pyth Lazer price with `exponent` into PRICE_PRECISION (1e6).
pub fn to_price_precision(price: i64, exponent: i32) -> Result<u64> {
    require!(price > 0, NeltaError::InvalidAccountData);
    let p = price as u128;
    let shift = 6 + exponent;
    let out = if shift >= 0 {
        p.checked_mul(10u128.pow(shift as u32)).ok_or(NeltaError::Overflow)?
    } else {
        p / 10u128.pow((-shift) as u32)
    };
    u64::try_from(out).map_err(|_| error!(NeltaError::Overflow))
}

#[cfg(test)]
mod tests {
    use super::*;
    const SOL: u64 = 1_000_000_000;
    const STEP: u64 = 100_000;

    #[test]
    fn demo_amounts() {
        assert_eq!(target_short(SOL / 10, 5_000, STEP).unwrap(), SOL / 20);
        assert_eq!(target_short(SOL * 6 / 100, 5_000, STEP).unwrap(), SOL * 3 / 100);
    }

    #[test]
    fn rounds_down_to_step() {
        assert_eq!(target_short(59_999_998, 5_000, STEP).unwrap(), 29_900_000);
        assert_eq!(target_short(199_999, 10_000, STEP).unwrap(), 100_000);
        assert_eq!(target_short(99_999, 10_000, STEP).unwrap(), 0);
    }

    #[test]
    fn bounds() {
        assert_eq!(target_short(SOL, 0, STEP).unwrap(), 0);
        assert_eq!(target_short(u64::MAX, 10_000, 1).unwrap(), u64::MAX);
        assert!(target_short(SOL, 10_001, STEP).is_err());
        assert!(target_short(SOL, 5_000, 0).is_err());
    }

    #[test]
    fn oracle_freshness_is_two_sided() {
        let now = 1_800_000_000;
        assert!(oracle_fresh(now, now));
        assert!(oracle_fresh(now, now - MAX_ORACLE_AGE_SECS));
        assert!(!oracle_fresh(now, now - MAX_ORACLE_AGE_SECS - 1));
        assert!(oracle_fresh(now, now + MAX_ORACLE_SKEW_SECS));
        assert!(!oracle_fresh(now, now + MAX_ORACLE_SKEW_SECS + 1));
        assert!(!oracle_fresh(now, now + 3_600));
        assert!(!oracle_fresh(now, 0));
        assert!(!oracle_fresh(i64::MIN, i64::MAX));
    }

    #[test]
    fn price_conversion() {
        assert_eq!(to_price_precision(11_776_857_947, -8).unwrap(), 117_768_579);
        assert_eq!(to_price_precision(150, 0).unwrap(), 150_000_000);
        assert!(to_price_precision(-1, -8).is_err());
    }
}
