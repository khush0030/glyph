#!/usr/bin/env bash
# Build the Swift audiocap sidecar (release) and install it as the Tauri
# externalBin for the host target triple. Run this after changing any Swift
# source under sidecar/audiocap/. The resulting binary is committed so a plain
# `pnpm tauri dev` works without this step.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"

triple="$(rustc -Vv | grep '^host:' | cut -d' ' -f2)"
echo "building audiocap for ${triple}..."

cd "$here/audiocap"
swift build -c release

mkdir -p "$root/src-tauri/binaries"
dest="$root/src-tauri/binaries/audiocap-$triple"
cp ".build/release/audiocap" "$dest"

# Sign ad-hoc with the hardened runtime + audio-input entitlement so the sidecar
# can open the mic / system-audio tap when the bundled app runs under hardened
# runtime (M9). No Developer ID needed for this Mac; notarization is out of
# scope until a signing identity exists.
codesign --force --options runtime \
  --entitlements "$here/audiocap.entitlements" \
  --sign - "$dest"
codesign --verify --verbose=2 "$dest"

echo "installed + signed → src-tauri/binaries/audiocap-$triple"
