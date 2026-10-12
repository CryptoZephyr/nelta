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

## Dependency warnings still open

The checked-in Android dependency tree still reports these advisories:

- [`decode-uri-component`](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr): Expo Router uses it through CommonJS `query-string`. The patched decoder is ESM-only, and npm proposes an Expo Router 58 upgrade. That needs a separate SDK migration and Android verification.
- [`braces`](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm): used by the Metro/build file-matching tools. The latest available version, 3.0.3, remains affected.
- [`node-forge`](https://github.com/advisories/GHSA-86w9-cpqp-85rv): used by Expo's development and code-signing tools. The latest available version, 1.4.0, remains affected.

Npm counts affected parent packages as well as the packages named above. Those counts do not establish that each warning is reachable from the APK. We have not demonstrated an exploit through Nelta. Do not apply npm's proposed Expo 44 downgrade to clear the build-tool warnings.

Rust's `bincode` 1.x also has an unmaintained-package warning. It is an Anchor dependency; replacing its serialization format requires upstream compatibility work.

Run `npm audit` in both `app/` and `scripts/` to check the installed lockfiles again. Dependency findings can change as upstream publishes fixes or advisories.

## Wallet preflight

The sign-only fill path simulates the signed transaction before broadcast. Wallets that only support signing and sending are asked to run preflight (`skipPreflight: false`). The wallet controls that submission, and market conditions can still change between simulation and execution. Preflight does not guarantee a fill or prevent every failed-transaction fee.

## Release signing

Only install Nelta from this repo's [Releases](https://github.com/CryptoZephyr/nelta/releases). Official APKs are signed with one release key, so Android will refuse an update signed by anyone else.
