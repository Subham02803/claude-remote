#!/usr/bin/env bash
#
# Run the dev servers.
#
#   scripts/dev.sh            host: tsx watch, Vite inside it   (default)
#   scripts/dev.sh --docker   docker compose up --build
#   scripts/dev.sh --clean    stop whichever of the two is running
#   scripts/dev.sh --logs     follow container logs
#
# Host is the default because this app drives `claude` inside `tmux` on *your*
# machine, with your credentials and your project folders. The image has none
# of those, so in a container every session start dies with `spawn tmux ENOENT`.
# Docker stays useful for building and checking the production image; it is not
# a way to actually use the app. See docker-compose.yml for what it would take.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SERVICE=claude-remote
PORT="$(sed -n 's/^PORT=[[:space:]]*\([0-9]*\).*/\1/p' .env 2>/dev/null | tail -1)"
PORT="${PORT:-4180}"
# Only ever a leftover now: the web app is served by the server itself, with
# Vite running inside that process. Nothing here starts a second port.
WEB_PORT=5173

TARGET=host
MODE=up

for arg in "$@"; do
  case "$arg" in
    --docker) TARGET=docker ;;
    -d|--detach) MODE=detach ;;
    --logs) TARGET=docker; MODE=logs ;;
    --clean|--down) MODE=clean ;;
    -h|--help) sed -n '3,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "dev.sh: unknown option $arg" >&2; exit 2 ;;
  esac
done

# ------------------------------------------------------------------ docker

compose() {
  docker compose version >/dev/null 2>&1 || {
    echo "dev.sh: 'docker compose' unavailable. Is Docker Desktop running?" >&2; exit 1; }
  case "$MODE" in
    clean) docker compose down; exit 0 ;;
    logs)  exec docker compose logs -f "$SERVICE" ;;
    up)    exec docker compose up --build ;;
  esac

  docker compose up --build -d
  local published port
  published="$(docker compose port "$SERVICE" 4180 2>/dev/null || true)"
  port="${published##*:}"; port="${port:-7420}"
  for _ in $(seq 1 60); do
    if curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:$port/api/health" 2>/dev/null; then
      echo; echo "dev.sh: up on http://127.0.0.1:$port"
      echo "dev.sh: note — no tmux or claude in the image, so sessions cannot start here."
      exit 0
    fi
    sleep 1
  done
  echo; echo "dev.sh: no answer on port $port after 60s. Last logs:" >&2
  docker compose logs --tail 40 "$SERVICE" >&2
  exit 1
}

[ "$TARGET" = docker ] && compose

# -------------------------------------------------------------- host: stop
#
# tsx watch and Vite both outlive a crashed child, so a boot error leaves a
# watcher idling on nothing. Repeat that and you get a pile of processes and a
# port that may or may not be free. Clear that before starting.

self_and_ancestors() {
  local p=$$
  while [ -n "$p" ] && [ "$p" != 0 ] && [ "$p" != 1 ]; do
    echo "$p"; p="$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')"
  done
}

# Ours only if it is working inside this repo. The cwd test is what keeps a
# `pnpm dev` in another project safe.
#
# The exclusions are load-bearing: this app spawns Claude Code sessions under
# tmux with their cwd set to a project dir, so cwd alone would sweep up the
# user's running sessions.
is_ours() {
  local pid="$1" cmd cwd
  cmd="$(ps -o command= -p "$pid" 2>/dev/null)" || return 1
  case "$cmd" in *tmux*|*claude\ --settings*) return 1 ;; esac
  cwd="$(lsof -a -d cwd -Fn -p "$pid" 2>/dev/null | sed -n 's/^n//p' | head -1)"
  case "$cwd" in "$ROOT"|"$ROOT"/*) return 0 ;; *) return 1 ;; esac
}

candidates() {
  {
    pgrep -f "$ROOT/apps/server/node_modules.*tsx" || true
    pgrep -f "$ROOT/apps/web/node_modules.*vite" || true
    pgrep -f "@claude-remote/(server|web) dev" || true
    pgrep -f "pnpm (dev|dev:server|dev:web)$" || true
    lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null || true
    lsof -ti "tcp:$WEB_PORT" -sTCP:LISTEN 2>/dev/null || true
  } | sort -u
}

stale=""; skip="$(self_and_ancestors)"
for pid in $(candidates); do
  case " $skip " in *" $pid "*) continue ;; esac
  is_ours "$pid" && stale="$stale $pid"
done

if [ -n "$stale" ]; then
  echo "dev.sh: stopping$stale"
  kill $stale 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    alive=""
    for pid in $stale; do kill -0 "$pid" 2>/dev/null && alive="$alive $pid"; done
    [ -z "$alive" ] && break
    sleep 0.3
  done
  [ -n "${alive:-}" ] && kill -9 $alive 2>/dev/null || true
fi

if [ "$MODE" = clean ]; then
  docker compose ps -q "$SERVICE" 2>/dev/null | grep -q . && docker compose down
  echo "dev.sh: clean only, nothing started."
  exit 0
fi

# ------------------------------------------------------------- host: start

command -v tmux >/dev/null 2>&1 || echo "dev.sh: warning — tmux is not installed; sessions will not start. \`brew install tmux\`" >&2

pnpm --filter @claude-remote/server dev &
server_pid=$!
stop() { trap - INT TERM EXIT; kill "$server_pid" 2>/dev/null || true; wait 2>/dev/null || true; }
trap stop INT TERM EXIT

# "The process is running" proves nothing: tsx keeps the watcher alive when the
# server exits on a bad config. Poll until it actually answers.
ready=0
for _ in $(seq 1 60); do
  kill -0 "$server_pid" 2>/dev/null || break
  if curl -fsS -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/api/health" 2>/dev/null; then
    ready=1; break
  fi
  sleep 0.5
done
echo
[ "$ready" = 1 ] \
  && echo "dev.sh: ready on http://127.0.0.1:$PORT — app and API, one port" \
  || echo "dev.sh: nothing came up on port $PORT — see the log above." >&2
echo

wait
