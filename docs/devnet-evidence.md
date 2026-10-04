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

## Redesigned app + hosted keeper (2026-10-04)

Emulator + MWA fake wallet, owner `3wtCUZuLHDvZtnYvQ3yhwAYZq8HEC5xuoqPdzqs1yftw`, funded with 0.2 SOL and 60 dUSDT.
Every step except the keeper run was signed in the redesigned app. No local keeper was running: the rule was
executed by the GitHub Actions keeper (run 37160640617, keeper key `7kCrKbJ9hAjLFdY26HY5asutdJ4XYadZKajYbu1diqTx`).

| Step | Signature | State after (as shown in the app) |
| --- | --- | --- |
| Create position, nonce accounts, deposit 60 dUSDT and 0.1001 SOL | `2wruEgY8UsSTf7P6MBBKZjHHw4wRcY2uz7DRXFgokxEWu1i8MBU8NzR5FqGVpgk56Pwp1Q9Ym3fDLYkHWwueXeZL`, `3V1YuejaAwafgu6ehK6ZCmDvnwgH8Wj2bw9TPsJmsvpi55GN2vUSHm6jjvs6FijQX9MA8PPSzoB7Z1pikebu11Hb`, `5YiE8H5wGEHRdvcwoUFBk9msss3SNVWwyvaPH7LVYHFYxF5f6FaGDAN7pKEghY7YLmnLXpevCFdZNjN3g1YhosGH`, `2z3GnYbQrRmREwvPSJHDLCRVB6qm9s5PSYEt5GXtbXpWMPWrXre5WKshcB65cr61fMzZDh2bbcRSR1xx9MsBwM9V`, `iDCis3JigpxXi98Vn7cYTnKhJj6HPR4hiyjL5q5qxgyxHaLqzoNDi8e3aorzSPE5eGL5ZfaQsMMr5pa4cgTdiBY` | SOL 0.1001, short 0, off by 0.05 |
| Sync hedge (fifth tap; the first four ended "No fill this time, nothing changed") | `5gi9SLxKhwKSvRnuu4xWpLFkJ5yJpCiEFEs5fMtfeerrjETD1ogp2zwN3V42XQqT62smWx6qS67hBdyzNas7BVmq` | short 0.05, in sync |
| Arm rule (SOL rises to $110, release 0.04, 24h), app force-stopped at 00:02:47Z | `GSsFFAc3WTou68BXjJUjQRGXmvjGh895c8jxDX338T5YhcXfmu52tpwKApjGHmJE4c6zfU2onVVq9oDyckFNVnc` | rule armed |
| Hosted keeper executes at 00:03:38Z, app stopped | `668M2dDJNdjARRq8eZwAjDF9nPFN6Dns2EXLiy4cPVNDf9a6sQCvKxXsEcNWQmXYvUa3rnUjTWCKmnxudq6NR3jB` | after reopening: SOL 0.0601, short 0.03, +0.04 wSOL, rule not armed |
| Release 0.04 SOL (first tap) | `3VS9rYbEnWd79RTfc5T7MvnAcTAAiReKkZ5YAmsxUSdNFtRMU2Hkx5tKKSFTizasWjZ7Ug4uyq2QXq5gdmVfv4Bm` | SOL 0.0201, short 0.01 |
| Recovery 1: close hedge | `STpPj1neHJqzFEQ9dbNXgosqw4xBsJ256acKYi7R77TYi9UWEJ1vunPzsJrxyBkSd8aVipX6R7JBH62Hf91kZFW` | short 0 |
| Recovery 2: withdraw all SOL | `4zQvBtevzUnxom3TFWyauNdDZAZkf6D9c2m81NBMoKG73RgEA9PEKzFDBoh6ccTH4L4TzumjNdtkD81RY9vN1Yjz` | SOL 0 |
| Recovery 3: withdraw collateral | `33h6W4867mCj5kQioT4vRPEbGzCZeJF23rmRxbrn4YNPv3s32ndf19isPb92tF2ppTLzzaAG19NQqLfqMDyeRki` | 0.05 dUSDT left (fees/PnL dust) |

62 unfilled attempts landed as reverted transactions and changed nothing.

### Forbidden actions, rerun on the current program (all PASS)

`e2e.ts negative`: release to a non-owner account, release signed by a non-owner, ratio above 100%, release more
SOL than held, keeper with no armed rule, keeper before trigger, stale nonce, keeper redirecting funds to itself,
revoked rule.

`d10extra.ts`: arming an already-expired rule (`RuleExpired`), keeper after expiry (`RuleExpired`), fake oracle and
different perp market (`ConstraintAddress`), replay of the previous nonce (`StaleNonce`), non-owner rebalance (extra
short) and non-owner ratio change (`ConstraintSeeds`). Arm/revoke fixture:
`5pzgR4jsjzuCwifSPGuUxxN4Jv4urrLnWaun6LbmZ3RQRxd5B3HhYmJVL3uAonWazjyV3UvkCnFGdwY1cpoGFqU5`,
`2AuxjwTgC3gjAL9HSxhzNbsAFah44BQVhL4Nq8GmUYPq3Xwn42JRi2XaCE6wo95zZxGyQshjT8q2kpi7Nq2LPxsy`.

## Hedge ratio, failures and restarts (2026-10-04)

Same emulator owner `3wtCUZuLHDvZtnYvQ3yhwAYZq8HEC5xuoqPdzqs1yftw`. The new Hedge ratio card changes the ratio and moves
the short in one transaction (`set_ratio` + `rebalance`, FullFill), so the two can never disagree.

| Step | Signature | State after (as shown in the app) |
| --- | --- | --- |
| Add 59.75 dUSDT collateral (approve tapped twice; one request reached the wallet) | `3zqmXknHWUyWihCeWU8J3ZNVGCvfvATnyuMgRLMmV5Juf3pyCJukNxz2HSaEUHv7S5vei7BNdBuB6pFGrGjm3zLg` | collateral 59.75 |
| Add 0.1001 SOL | `21mssj9TVBSCwQvmvePxrnSPaeN7Poenf3icDwShsUVeGeUCekgbSgB2a47QSxX11fHhEd6P5YfTRqMxf9uKiF13` | SOL 0.1001, target 0 (ratio 0%) |
| Ratio 0% to 50% (second tap; first ended "No fill this time", ratio still 0%) | `2dbXvxMyfG54FJyWpiWZX84XoySFsareuNyZAdMMfMdik5bLabY2w8uYzxLmr7DbAz93atbBNawvvFjSotViAVka` | 50%, short 0.05 |
| Ratio 50% to 100% (second tap) | `5uSJp787r56xnNALyzCyDYJuMWoTYCtbu66DfEGiuoNuZyPnhnDTvowj5ULQHHaxArD9FhCRFXAbqMmeH7eZnks3` | 100%, short 0.10 |
| Ratio 100% to 50% (fourth tap, including the restart test below) | `3gHZZE5JmhwaYi5MaH9LtbAMoaJpYZFoKBUHgrCRXCJX4XrGAXysWNZbEJTTe1XmJRy6VELbHbPf7KXKNxd9PKpb` | 50%, short 0.05 |

- **No fill:** every unfilled try landed as a reverted transaction; the ratio and short stayed as before.
- **App killed mid-fill:** force-stopped at try 41 of 160 while waiting for a fill. Nothing landed afterwards; on reopen
  the app showed 100% / short 0.10 unchanged, and a fresh attempt worked.
- **Duplicate fills:** each try also advances its sibling nonces, so once one lands every other signed try is void.
  No reverted try landed after either success above.
- **RPC down:** with the emulator's network off, pull-to-refresh kept the last values under "Showing the last reading".
- **Not exercised:** the "Needs attention" stale-price notice (shown when Velocity's price is over 2 minutes old) did not
  trigger during testing; the feed stayed fresh.
