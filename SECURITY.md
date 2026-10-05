# Security policy

Nelta runs on **Solana Devnet with test funds only**. It has not been audited. Don't use it with real funds.

## Reporting a problem

Please report security problems privately, not in a public issue:

1. Open [Report a vulnerability](https://github.com/CryptoZephyr/nelta/security/advisories/new) on this repo.
2. Say what you found, how to reproduce it, and what it could affect.

We aim to reply within 3 days and to fix confirmed problems before talking about them in public. There is no bug bounty.

## What's in scope

- The Nelta program (`programs/nelta`, program ID `9Rk99npY6kwtEX7MVuq2SWyr1WQQ7f9S9i8mXY4iJ4R` on Devnet).
- The keeper (`scripts/src/worker.ts`, run on GitHub Actions).
- The Android app (`app/`) and the signed `nelta.apk` releases.

The most important rules are that only the owner can ever receive their SOL or collateral, a rule runs at most once, and the owner can always recover without the app or keeper. Anything that breaks one of these rules is a serious problem.

Out of scope: bugs in Velocity, Solana, or wallet apps themselves (report those to them), and Devnet outages or slow fills.

## Supported versions

Only the [latest release](https://github.com/CryptoZephyr/nelta/releases/latest) gets fixes.

## Release signing

Only install Nelta from this repo's [Releases](https://github.com/CryptoZephyr/nelta/releases). Official APKs are signed with one release key, so Android will refuse an update signed by anyone else.
