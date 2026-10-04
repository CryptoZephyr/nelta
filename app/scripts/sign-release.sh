#!/usr/bin/env bash
# Re-signs a release APK with Nelta's release key plus a key-rotation proof from the old key.
# v1.1.0 was signed with the Expo template's public debug key; the proof lets Android 9+ install
# this APK as an update over it. Usage: scripts/sign-release.sh <app-release.apk> <nelta.apk>
set -euo pipefail

IN=${1:?input apk}
OUT=${2:?output apk}
: "${NELTA_RELEASE_STORE_FILE:?path to the release keystore}"
: "${NELTA_RELEASE_STORE_PASSWORD:?}"
: "${NELTA_RELEASE_KEY_ALIAS:?}"
: "${NELTA_RELEASE_KEY_PASSWORD:?}"
: "${NELTA_RELEASE_CERT_SHA256:?expected release certificate SHA-256 (hex, no colons)}"

APP_DIR=$(cd "$(dirname "$0")/.." && pwd)
OLD_KEYSTORE="$APP_DIR/android/app/debug.keystore"
OLD_CERT_SHA256=fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c
APKSIGNER="$(ls -d "${ANDROID_HOME:?}"/build-tools/* | sort -V | tail -1)/apksigner"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

expected=$(tr -d ': \n' <<<"$NELTA_RELEASE_CERT_SHA256" | tr 'A-F' 'a-f')
if [ "$expected" = "$OLD_CERT_SHA256" ]; then
  echo "NELTA_RELEASE_CERT_SHA256 is the public debug certificate; use the real release key" >&2
  exit 1
fi
old=$(keytool -exportcert -keystore "$OLD_KEYSTORE" -storepass android -alias androiddebugkey 2>/dev/null | sha256sum | cut -d' ' -f1)
if [ "$old" != "$OLD_CERT_SHA256" ]; then
  echo "$OLD_KEYSTORE is not the key that signed v1.1.0 (got $old)" >&2
  exit 1
fi

# Old key may hand the app over to the new key, but may not sign updates once a device has moved on.
"$APKSIGNER" rotate --out "$WORK/lineage" \
  --old-signer --ks "$OLD_KEYSTORE" --ks-pass pass:android --ks-key-alias androiddebugkey --key-pass pass:android \
  --set-rollback false \
  --new-signer --ks "$NELTA_RELEASE_STORE_FILE" --ks-pass env:NELTA_RELEASE_STORE_PASSWORD \
  --ks-key-alias "$NELTA_RELEASE_KEY_ALIAS" --key-pass env:NELTA_RELEASE_KEY_PASSWORD

# Android 9+ (v3 block) sees the release key plus the proof; Android 7-8 (v2 block) still see the old key.
"$APKSIGNER" sign --out "$OUT" --lineage "$WORK/lineage" --rotation-min-sdk-version 28 --v1-signing-enabled false \
  --ks "$OLD_KEYSTORE" --ks-pass pass:android --ks-key-alias androiddebugkey --key-pass pass:android \
  --next-signer --ks "$NELTA_RELEASE_STORE_FILE" --ks-pass env:NELTA_RELEASE_STORE_PASSWORD \
  --ks-key-alias "$NELTA_RELEASE_KEY_ALIAS" --key-pass env:NELTA_RELEASE_KEY_PASSWORD \
  "$IN"
rm -f "$OUT.idsig"

certs=$("$APKSIGNER" verify --min-sdk-version 28 --print-certs "$OUT")
signer=$(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' <<<"$certs")
if [ "$signer" != "$expected" ]; then
  echo "$OUT is signed by $signer, expected $expected" >&2
  exit 1
fi
"$APKSIGNER" lineage --in "$OUT" --print-certs | grep -qi "$OLD_CERT_SHA256" || {
  echo "$OUT is missing the rotation proof from the v1.1.0 key" >&2
  exit 1
}
echo "Signed $OUT with release certificate $signer"
