#!/usr/bin/env bash
# Opens the ngrok tunnel on the domain recorded in PUBLIC_URL.
#
# Google OAuth needs one exact redirect URI that never changes, so this
# deliberately refuses to start on a random ngrok URL.
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "No .env found. Copy .env.example to .env first." >&2
  exit 1
fi

# shellcheck disable=SC1091
set -a; source .env; set +a

PORT="${PORT:-4180}"

if [[ -z "${PUBLIC_URL:-}" ]]; then
  cat >&2 <<'MSG'
PUBLIC_URL is not set in .env.

Reserve a free static domain at https://dashboard.ngrok.com/domains, then put
it in .env, for example:

  PUBLIC_URL=https://your-name.ngrok-free.app

A reserved domain matters: without one, ngrok hands you a new URL on every
restart and you would have to re-register the Google redirect URI every time.
MSG
  exit 1
fi

DOMAIN="${PUBLIC_URL#https://}"
DOMAIN="${DOMAIN#http://}"
DOMAIN="${DOMAIN%%/*}"

if ! command -v ngrok >/dev/null 2>&1; then
  echo "ngrok is not installed. See https://ngrok.com/download" >&2
  exit 1
fi

echo "Tunnelling ${DOMAIN} -> http://127.0.0.1:${PORT}"
echo "Google redirect URI to register: ${PUBLIC_URL%/}/auth/google/callback"
echo
exec ngrok http "${PORT}" --domain="${DOMAIN}"
