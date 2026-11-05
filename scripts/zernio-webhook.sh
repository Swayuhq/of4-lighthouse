#!/bin/sh
# Loads the keys named in .env.op the same way start-op.sh does, never printing them, then points the Zernio webhook or sends it a sample event.
# tsx is the copy swayu-app already pins, so Lighthouse adds no tool for this.
set -eu
cd "$(dirname "$0")/.."
while IFS='=' read -r name ref; do
  case "$name" in '' | \#*) continue ;; esac
  value=$(op read "$ref" </dev/null | tr -d '\r')
  [ -n "$value" ] || { echo "1Password returned nothing for $name" >&2; exit 1; }
  export "$name=$value"
done < .env.op
exec "$HOME/Projects/swayu-app/node_modules/.bin/tsx" scripts/zernio-webhook.ts "$@"
