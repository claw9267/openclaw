#!/bin/bash
# Install the fork's dist over the Homebrew OpenClaw installation.
# Creates a backup so you can restore the original.
set -euo pipefail

HOMEBREW_DIST="/opt/homebrew/Cellar/openclaw-cli/$(openclaw --version 2>/dev/null)/libexec/lib/node_modules/openclaw/dist"
FORK_DIST="$(cd "$(dirname "$0")/.." && pwd)/dist"
BACKUP_DIR="${HOMEBREW_DIST}.bak"

if [ ! -d "$FORK_DIST" ]; then
  echo "❌ Fork dist not found. Run 'pnpm build' first."
  exit 1
fi

if [ ! -d "$HOMEBREW_DIST" ]; then
  echo "❌ Homebrew dist not found at $HOMEBREW_DIST"
  exit 1
fi

case "${1:-install}" in
  install)
    if [ ! -d "$BACKUP_DIR" ]; then
      echo "📦 Backing up original dist → ${BACKUP_DIR}"
      cp -a "$HOMEBREW_DIST" "$BACKUP_DIR"
    else
      echo "📦 Backup already exists"
    fi
    echo "🔧 Copying fork dist → $HOMEBREW_DIST"
    rm -rf "$HOMEBREW_DIST"
    cp -a "$FORK_DIST" "$HOMEBREW_DIST"
    echo "✅ Fork installed. Restart gateway to apply."
    ;;
  restore)
    if [ ! -d "$BACKUP_DIR" ]; then
      echo "❌ No backup found at $BACKUP_DIR"
      exit 1
    fi
    echo "🔄 Restoring original dist"
    rm -rf "$HOMEBREW_DIST"
    mv "$BACKUP_DIR" "$HOMEBREW_DIST"
    echo "✅ Original restored. Restart gateway to apply."
    ;;
  *)
    echo "Usage: $0 [install|restore]"
    exit 1
    ;;
esac
