#!/bin/sh
# Starts the app with the keys named in .env.op. The Windows 1Password app cannot start a Linux program,
# so op run fails under WSL; this reads each reference instead and hands it straight to the app, never printing it.
set -eu
cd "$(dirname "$0")/.."
while IFS='=' read -r name ref; do
  case "$name" in '' | \#*) continue ;; esac
  value=$(op read "$ref" </dev/null | tr -d '\r')
  [ -n "$value" ] || { echo "1Password returned nothing for $name" >&2; exit 1; }
  export "$name=$value"
done < .env.op
exec next start --hostname 127.0.0.1 --port 4174
