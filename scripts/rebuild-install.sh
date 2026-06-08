#!/usr/bin/env bash
# Build Glyph (release), install it to /Applications, and produce a drag-install .dmg.
# Usage: ./scripts/rebuild-install.sh
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"
export PATH="$HOME/.cargo/bin:$PATH"

APP="$REPO/src-tauri/target/release/bundle/macos/Glyph.app"
DMG="$REPO/src-tauri/target/release/bundle/dmg/Glyph_0.0.0_aarch64.dmg"

echo "==> Quitting any running Glyph…"
osascript -e 'quit app "glyph"' 2>/dev/null || true
pkill -f "/Applications/Glyph.app" 2>/dev/null || true

echo "==> Building Glyph.app (release)…"
# Tauri's dmg target drives Finder via AppleScript and is flaky in automation —
# build only the .app here and make the dmg ourselves with hdiutil below.
pnpm tauri build --bundles app

[ -d "$APP" ] || { echo "!! Build did not produce $APP" >&2; exit 1; }

echo "==> Installing to /Applications…"
rm -rf "/Applications/Glyph.app"
cp -R "$APP" /Applications/
xattr -dr com.apple.quarantine "/Applications/Glyph.app" 2>/dev/null || true

echo "==> Building drag-install .dmg…"
STAGE="$(mktemp -d)"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
mkdir -p "$(dirname "$DMG")"
rm -f "$DMG"
hdiutil create -volname "Glyph" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
rm -rf "$STAGE"

echo
echo "✅ Installed: /Applications/Glyph.app"
echo "📦 DMG:       $DMG"
echo
echo "Credentials (not in repo):"
echo "  ~/Library/Application Support/ai.oltaflock.glyph/.env        (API keys)"
echo "  ~/Library/Application Support/ai.oltaflock.glyph/secrets.json (OAuth tokens)"
echo
echo "Launch:  open -a Glyph"
