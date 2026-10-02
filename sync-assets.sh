#!/usr/bin/env bash
# Copies the web assets into the Android Studio project assets folder
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="$SCRIPT_DIR/android/app/src/main/assets"

echo "Syncing web assets to Android app..."
mkdir -p "$TARGET_DIR/icons"

cp "$SCRIPT_DIR/index.html" "$TARGET_DIR/"
cp "$SCRIPT_DIR/styles.css" "$TARGET_DIR/"
cp "$SCRIPT_DIR/app.js" "$TARGET_DIR/"
cp "$SCRIPT_DIR/manifest.json" "$TARGET_DIR/"
cp "$SCRIPT_DIR/sw.js" "$TARGET_DIR/"
cp "$SCRIPT_DIR/icons/"*.svg "$TARGET_DIR/icons/"

echo "✅ Web assets synced to $TARGET_DIR"
