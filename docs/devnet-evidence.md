# Devnet evidence: Nelta program v0.1 (2026-10-01)

Program `9Rk99npYk6kwtEx7MVuq2SWyr1WQQ7f9S9i8mXY4iJ4R`. Owner/deployer `6zucjHBkFGvYrMckh3eamw9Bq5KmAWRLVJvqXSYG4nMp`.
Position PDA `2KPept6Gb1BPPoMesWtvLyGxNbdB1wxgN1SYeG68MEP9` is the authority of Velocity user
`J4PhcxARTPbaGFcQaEtCtopgCbKoV3dPpbZA6X3g7tAs`. Keeper (separate fee payer, no owner key)
`D7rUNKhPUqdEfZPjij7SSpyARDngRkaQZXFfw1vboNkj`.

All signatures are confirmed and state was re-read after each step.

| Step | Signature | State after |
| --- | --- | --- |
| Deploy (later upgraded with `reduce_hedge` and received-amount transfers) | `4rsse9mzLnyhTqokhb4rnmSXsi96jyH7TfA8rV7BPYJAFmfF1Ezt2FfZATNyvwHmJGcTTWNsAHrgGTEXHi5Euv51` | |
| Initialize (ratio 50%) | `3frM1MqaXCVH6NYMRR8NrUs8vi38gPYWLyKd32isqp6xRU1fNjEdgEWKWFV3joYrySRnQDGMze6GMB8jcPHcgcHn` | Velocity user owned by the PDA |
| Deposit 60 dUSDT | `275xzdBsjP5sLZhePjZfNF7p6e8Pcy6QuKXcgdY2NjahdXiEiPHPQ6CCPn4oi9H3zNGMmiqycr1BFp2qRJvx1eP5` | |
| Deposit 0.1001 SOL | `2vDxhm8XWY2WzdJAaRUXRVdDF2QpQ5moxGGkjwQDJcJXFz3CxtUJBrmMPvQPzp8BzZhHgXP133ufZ2dNnby6ZhYH` | SOL 0.100099999 |
| Rebalance, FullFill (attempt 35 of oracle-triggered sends) | `26PqZKeEEedW53LQzBrkSPGMN4tdSCgV3RU7ci4ofEXTNdndkteeEoRQLYsQKtA7GvpMFv5rkL9cPAQLQBHM43ca` | short 0.05, 158,830 CU |
| Owner arms one-use rule (SOL >= 95% of spot, release 0.04) | `vLAo4fVb1AivHYxB3gPsB57DwYDbrwa3F4mkvVCeJAg6eMThiDYorH7kKzsQhcR2DMMbXc9A2DgY2rAdVJnR8NR` | nonce 2 |
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

## Phone-off run with the keeper worker (upgraded program)

| Step | Signature | State after |
| --- | --- | --- |
| Re-fund 60 dUSDT + 0.1001 SOL | `2pK4Ua5jgPNCYyKQVzvsVo56w1KogcWW4DCEDCTZkcKdGHzHYGWQ3u36tM9gxnbRQumxREm8H8Y4SiqzcaMqqF2W`, `wFGSB3uDp2d7P8EyKpEQq63BfqKr8DKtjuTeM62cy3AiyB3gsmww91ET42FL8S7WniuGuBYTTTNd5FxX8e38gR3` | SOL 0.100099999 |
| Rebalance to 50% (attempt 32, after a first run of 80 reverted attempts) | `5nmd7UK7egueMRKunDHTSGW86hhMBBKRVhCkgAFT4KXPJxiHuHjkPTmVrRq3wJwf72nx5kS1kptrTACoanAiyYqZ` | short 0.05 |
| Owner arms rule (SOL >= 111.72) and the owner process exits | `3xBQoKQKNXWMBNLN6qcLMNtrXXXSZxHR2ERWTJFcvBnxCzN6QhS8Uaa7feDa3myqofkJo2wHWmeKQgJca6DPSA1w` | rule active, nonce 3 |
| `worker.ts` (keeper key only) executes at 117.06 USD, attempt 9 | `1DQRdSGpYVuKMUG7sMzWcNwQFcPMbb7Ey21qxhcAVUoGjuyCXGgrtW3JHeRdudL1XqbPc5qZkE9EYBjX2s8Ncyy` | SOL 0.060099998, short 0.03, owner +0.04 wSOL, rule inactive |

All ten rejection checks above were re-run against the upgraded program and passed.

## Android app run (emulator + MWA fake wallet, app-owned position)

Owner `EmHzvQyjdmnJRcR3yPNzXAJQFydKwzu4JoH1CbvtGruc`, funded with 0.2 SOL and 25 dUSDT. Every step except the keeper run was signed in the app through Mobile Wallet Adapter.

| Step | Signature | State after (as shown in the app) |
| --- | --- | --- |
| Create position (50%) | `66DJ28ms8dhzKAaTr4Qf5KRm8HCKLrKDY2y5GDkkNrV9CcRNUDA6ZQrPsh6jP6FFQahDEvN8MQ2UyT95gYZzfrQv` | position exists |
| Deposit 25 dUSDT collateral, then 0.1001 SOL | `58sHdWhbvx7zgqdk2gqKuCX7hWyNdwqEwVaGGwyvFuWBe3EN1JnkVmUyWG9uESdbAMuGBJzMAe3gUbzLJfUpTDVW` (SOL) | SOL 0.1001, collateral 25.00 dUSDT |
| Sync hedge (durable-nonce retries) | `2Yvk3wtYo5nYtSi5CEiQdyE1Ge55rohH9UfLmQ9HH19KGZSXXVU86AZSbP1hEQXp1LkwEEiwnEkqM1pew8Rcazz3` | short 0.05, in sync |
| Arm rule (SOL >= 118.00, release 0.04, 24h), then app force-stopped | `3u3s1hauYDT2FjQGV9X5QyaM8H28n6W1mvM1DcrsRfEd88NTvkcJ96oKUZwHtzLQEvcHuBN6EFHppPB8Zt8gca2U` | rule active, nonce 1 |
| `worker.ts` executes at 118.43 USD, attempt 3, app not running | `499aiKy2zeFVpu2xHSD7odSjRVgbUyzhN5qcY7byEE2tQHcYqotfMqotsLdxkg9N1UTYzpfbZ1A7GG8u36RJBUQX` | SOL 0.0601, short 0.03, owner +0.04 wSOL, rule inactive |
| Release with hedge 0.02 SOL | `5cDPshv9PMVSs1KxYnUdMqR3M8b5wUZufzTQcisG5ZZopjbmu1QDbyRoU7MzqJRKmd2umWwVt52WcG6YDnHaA39v` | SOL 0.0401, short 0.02 |
| Recovery 1: close hedge (reduce-only, filled by Velocity keepers) | `39DYPwwMtX1pA6XtMvxmGYci1AGtQzkiNztznCuBC3K9S41NXJrmCPmyt5anL76snCufrtijLsL6a9LTaZKp8CWb` | short 0 |
| Recovery 2: withdraw all SOL | `3v9S7ZoBdQrgqaYsWn8RziicoYUCSPhvkcFS9mLmMTm4oCM6hRDp8QcYcAuGYXRkYngppzY88BDB1MiyUYd8AitV` | SOL 0 |
| Recovery 3: withdraw collateral (24.84 dUSDT) | `MhziqKu11VqrSbiGki673Kbvv8kNLa3B7owWCzyyEeRwyQgu1B2grXGKPXfDxWK38i9NfyAUBNKMh7Pus51QRch` | collateral 0, wallet 24.76 dUSDT |

Unfilled attempts landed as reverted transactions (`PlaceAndTakeOrderSuccessConditionFailed`, Velocity log
"AMM has too much inventory") and changed nothing; Sync hedge needed two taps and Release needed two.
