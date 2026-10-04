# Releasing the Android app

The app checks GitHub for a newer release and offers an **Update** button that downloads
`nelta.apk`. Android only installs that update if it is signed with the **same key** as the app
already on the phone, so every release must be signed with Nelta's release key.

`.github/workflows/android-release.yml` does the build and signing. Don't publish an APK built by hand.

## Every release

1. In `app/app.json`, bump `expo.version` (e.g. `1.2.0`) and `expo.android.versionCode` (+1). Merge to `main`.
2. Tag that commit and push the tag: `git tag v1.2.0 && git push origin v1.2.0`.
3. The **android-release** workflow builds the APK, signs it, checks the signature, and attaches it as
   `nelta.apk` to the `v1.2.0` release (it creates the release if needed). It fails if the tag and
   `app.json` version differ.
4. To rebuild an existing tag, run the workflow from the Actions tab with that tag.

## One-time setup (release key)

Create the key once and keep a backup somewhere safe (password manager). **If it is lost, no future
release can update installed apps**; users would have to uninstall and reinstall.

```bash
keytool -genkeypair -v -keystore nelta-release.jks -alias nelta -keyalg RSA -keysize 4096 -validity 10000
keytool -exportcert -keystore nelta-release.jks -alias nelta | sha256sum   # certificate fingerprint
```

Then in the repo settings → Secrets and variables → Actions:

| Name | Kind | Value |
| --- | --- | --- |
| `NELTA_RELEASE_KEYSTORE_BASE64` | secret | `base64 -w0 nelta-release.jks` |
| `NELTA_RELEASE_STORE_PASSWORD` | secret | keystore password |
| `NELTA_RELEASE_KEY_ALIAS` | secret | `nelta` |
| `NELTA_RELEASE_KEY_PASSWORD` | secret | key password |
| `NELTA_RELEASE_CERT_SHA256` | variable | the fingerprint above (hex) |

Never commit the keystore (`*.jks` is gitignored).

## Why there is a key-rotation step

v1.1.0 was signed with the Expo template's debug key, which is public. `scripts/sign-release.sh`
signs with the release key and adds a proof (APK Signature Scheme v3 lineage) that the old key
handed the app over to it, so phones on v1.1.0 can still update in place. Once an Android 9+ phone
has updated, it rejects anything signed only with the old key. Android 7–8 can't read that proof,
so for them the APK still carries the old key; keep this step for every release.

## Local builds

`gradlew assembleRelease` refuses to build without the release key. For a throwaway test build
(never publish it) set `NELTA_ALLOW_DEBUG_SIGNED_RELEASE=1`. To sign locally with the real key,
set `NELTA_RELEASE_STORE_FILE`, `NELTA_RELEASE_STORE_PASSWORD`, `NELTA_RELEASE_KEY_ALIAS`,
`NELTA_RELEASE_KEY_PASSWORD` before `npx expo prebuild` + `assembleRelease`, then run
`scripts/sign-release.sh` with `NELTA_RELEASE_CERT_SHA256` set.
