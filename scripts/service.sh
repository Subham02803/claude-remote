#!/usr/bin/env bash
#
# What launchd runs. Not meant to be run by hand — `claude-remote` manages it.
#
# Kept separate from the plist so the thing launchd starts can be edited
# without reinstalling the service, and so a start does the same work whether
# it came from a login, a crash restart, or `claude-remote restart`.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] service.sh: $*"; }

# launchd holds this log open in append mode, so rotating by rename would send
# every later line to the renamed file. Copy, then truncate in place: same
# inode, one generation kept.
LOG="$HOME/Library/Logs/claude-remote/server.log"
if [ -f "$LOG" ] && [ "$(stat -f%z "$LOG" 2>/dev/null || echo 0)" -gt 5242880 ]; then
  cp "$LOG" "$LOG.1" 2>/dev/null && : > "$LOG"
fi

say "starting in $ROOT"

TSX="$ROOT/apps/server/node_modules/.bin/tsx"
if [ ! -x "$TSX" ]; then
  say "dependencies are not installed. Run: pnpm install"
  exit 78 # EX_CONFIG — a code launchd will not spin on
fi

for tool in node pnpm tmux; do
  command -v "$tool" >/dev/null 2>&1 || {
    say "$tool is not on PATH. PATH is baked in at install time — re-run \`claude-remote install\`."
    exit 78
  }
done

# The service serves the built web app, so a source edit would otherwise be
# invisible until someone remembered to build. Cheap to check, seconds to fix.
stamp="apps/web/dist/index.html"
newer=""
if [ -f "$stamp" ]; then
  newer="$(find apps/web/src apps/web/public apps/web/index.html apps/web/vite.config.ts \
                apps/web/package.json packages/shared/src \
                -newer "$stamp" -print -quit 2>/dev/null || true)"
fi
if [ ! -f "$stamp" ] || [ -n "$newer" ]; then
  say "the web app is out of date${newer:+ ($newer)}; building"
  if ! pnpm --filter @claude-remote/web build; then
    say "the build failed. Serving whatever was built last, if anything."
  fi
fi

# exec, so launchd supervises the server itself rather than this script: its
# pid is the real one, and a stop signal reaches the process that has to
# answer it.
say "handing over to the server"
exec "$TSX" --env-file-if-exists=.env apps/server/src/index.ts
