#!/usr/bin/env bash
# Build the Swift audiocap sidecar (release) and install it as the Tauri
# externalBin for the host target triple. Run this after changing any Swift
# source under sidecar/audiocap/. The resulting binary is committed so a plain
# `pnpm tauri dev` works without this step.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/.." && pwd)"

triple="$(rustc -Vv | grep '^host:' | cut -d' ' -f2)"
echo "building audiocap for $triple…"

cd "$here/audiocap"
swift build -c release

mkdir -p "$root/src-tauri/binaries"
cp ".build/release/audiocap" "$root/src-tauri/binaries/audiocap-$triple"
echo "installed → src-tauri/binaries/audiocap-$triple"
