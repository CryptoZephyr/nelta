# Devnet evidence: Nelta program v0.1 (2026-10-01)

Program `9Rk99npYk6kwtEx7MVuq2SWyr1WQQ7f9S9i8mXY4iJ4R`. Owner/deployer `6zucjHBkFGvYrMckh3eamw9Bq5KmAWRLVJvqXSYG4nMp`.
Position PDA `2KPept6Gb1BPPoMesWtvLyGxNbdB1wxgN1SYeG68MEP9` is the authority of Velocity user
`J4PhcxARTPbaGFcQaEtCtopgCbKoV3dPpbZA6X3g7tAs`. Keeper (separate fee payer, no owner key)
`D7rUNKhPUqdEfZPjij7SSpyARDngRkaQZXFfw1vboNkj`.

All signatures are confirmed and state was re-read after each step.

| Step | Signature | State after |
| --- | --- | --- |
| Deploy | `4rsse9mzLnyhTqokhb4rnmSXsi96jyH7TfA8rV7BPYJAFmfF1Ezt2FfZATNyvwHmJGcTTWNsAHrgGTEXHi5Euv51` | |
| Initialize (ratio 50%) | `3frM1MqaXCVH6NYMRR8NrUs8vi38gPYWLyKd32isqp6xRU1fNjEdgEWKWFV3joYrySRnQDGMze6GMB8jcPHcgcHn` | Velocity user owned by the PDA |
| Deposit 60 dUSDT | `275xzdBsjP5sLZhePjZfNF7p6e8Pcy6QuKXcgdY2NjahdXiEiPHPQ6CCPn4oi9H3zNGMmiqycr1BFp2qRJvx1eP5` | |
| Deposit 0.1001 SOL | `2vDxhm8XWY2WzdJAaRUXRVdDF2QpQ5moxGGkjwQDJcJXFz3CxtUJBrmMPvQPzp8BzZhHgXP133ufZ2dNnby6ZhYH` | SOL 0.100099999 |
| Rebalance, FullFill (attempt 35 of oracle-triggered sends) | `26PqZKeEEedW53LQzBrkSPGMN4tdSCgV3RU7ci4ofEXTNdndkteeEoRQLYsQKtA7GvpMFv5rkL9cPAQLQBHM43ca` | short 0.05, 158,830 CU |
| Owner arms one-use rule (SOL >= 95% of spot, release 0.04) | see `nelta-rule.log` | nonce 2 |
| **Keeper executes rule: reduce + release in one instruction** (attempt 8) | `36xbUofrP16p9KSJumH1heTvaPHd9G8PetGP1yBpYFS9yFHjLHMshny98Gr4JRR1RCWJFyrPxZhEgxBtTUW8ZwAP` | SOL 0.060099998, short 0.03, owner +0.04 wSOL, 232,804 CU |
| Recovery: ratio 0 + resting reduce-only order (keeper filled ~40 s) | `24WSGkbAUuU6vvoL33aaZcPzBcEtAVJuZHaEPax3SPcaTz5LAR1i9P68uJmCmREAxgoDrRv6fwbQsBTUn3Q2h6p6` | short 0 |
| Recovery: release all SOL | `49TLztnx9sFR5Ck3UQ1ngYEUS8kPb8Gp5zCs6Ss6nZNEimCk831ySbqXoWedU31Gq2rW9R678VJCGHTMLqkqmDYK` | owner wSOL 0.100099998 |
| Recovery: withdraw collateral | `3kidn17pXkttK1CQYoZnY18h964HtMC9EkdojK3UbB6y9DmkqNnidZtoPbf3b1fJ5gGtCQ1EZjxKeMgPLnKtfoZn` | owner 59.785 dUSDT; 0.129 dUSDT not withdrawable (trading fees/PnL) |

Failed FullFill attempts reverted with Velocity `PlaceAndTakeOrderSuccessConditionFailed` (6289), leaving state unchanged.

## Rejections (simulated against live state, all PASS)

release to a non-owner token account (InvalidRecipient), release signed by a non-owner (InvalidRecipient),
ratio above 100% (InvalidRatio), release more than held (InsufficientSol), execute with no rule (RuleInactive),
execute before trigger (NotTriggered), stale nonce (StaleNonce), keeper redirects funds to itself (InvalidRecipient),
execute after revoke (RuleInactive), replay of an executed rule (RuleInactive).

## Findings that changed the program

- Closing the whole short with FullFill failed 80 times in a row, so recovery cannot depend on instant fills.
  Added `reduce_hedge`: owner-only, reduce-only, resting order that Velocity keepers fill.
- Velocity can withdraw slightly less than requested. Transfers now pay the actual amount received
  (release still requires it to be within 1 lamport of the request).
- The target uses floor rounding on interest-scaled balances: 0.1 SOL reads as 0.099999999 and targets 0.0499.
  The demo deposits 0.1001 SOL.
