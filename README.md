# Nelta

Nelta keeps SOL custody and its SOL-PERP hedge in sync. SOL and dUSDT collateral sit in a Velocity
account whose authority is a Nelta position PDA, so every change goes through the rules in
`programs/nelta`:

- **Paired release** (`release`, `execute_rule`): in one instruction, reduce the short to
  `floor(remaining_sol * ratio / 10_000 / step) * step` with a `FullFill` market order, withdraw the SOL,
  and pay it only to the owner's wSOL account. If the fill is incomplete, the whole transaction reverts.
- **Rebalance** (owner only): move the short to the same target for the SOL held. The ratio is capped at 100%.
- **One-use rule**: the owner arms `(trigger price, above/below, release amount, expiry)`. Any keeper can
  execute it once, with a fresh oracle (at most 30 s old), the matching nonce, and before expiry. A rule can
  only reduce the hedge and pay the owner. The owner can revoke it at any time.
- **Owner recovery**: `set_ratio(0)`, then `reduce_hedge` (reduce-only resting order filled by Velocity keepers), `release` and `withdraw_collateral`. None of these need the app or worker.

Devnet program: `9Rk99npYk6kwtEx7MVuq2SWyr1WQQ7f9S9i8mXY4iJ4R` (Velocity `vELoC1audYbSYVRXn1vPaV8Axoa9oU6BYmNGZZBDZ1P`).

## Build and test

Requires Rust, Solana CLI 4.x (platform tools 1.57) and Anchor CLI 1.0.2.

```bash
cargo test                                   # math + Velocity encoding (byte-matched to the SDK)
cd programs/nelta && cargo-build-sbf --sbf-out-dir ../../target/deploy -- --features no-log-ix-name
anchor idl build -o target/idl/nelta.json
```

## Devnet lifecycle

```bash
cd scripts && npm ci
npx tsx src/e2e.ts init      # position PDA + Velocity user owned by it
npx tsx src/e2e.ts fund      # 60 dUSDT collateral + 0.1001 SOL
npx tsx src/e2e.ts hedge     # 50% short, sent on each oracle update until FullFill succeeds
npx tsx src/e2e.ts negative  # simulated attacks/edge cases that must fail
npx tsx src/e2e.ts rule      # keeper executes a one-use rule: reduce + release 0.04 SOL
npx tsx src/e2e.ts replay    # executed rule cannot run again
npx tsx src/e2e.ts recover   # owner closes the hedge and withdraws everything
```

`NELTA_OWNER_KEYPAIR` and `NELTA_KEEPER_KEYPAIR` point to keypair files (never committed).
