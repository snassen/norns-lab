#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
pid="$(lsof -nP -iTCP:5151 -sTCP:LISTEN -t 2>/dev/null | head -n 1 || true)"
if [[ -z "$pid" ]]; then
  printf 'Norns Lab is already stopped.\n'
  exit 0
fi

cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
command="$(ps -p "$pid" -o command=)"
if [[ "$cwd" != "$root" || "$command" != *'node src/server.js'* ]]; then
  printf 'Port 5151 belongs to another process; leaving it alone.\n' >&2
  exit 1
fi

kill -TERM "$pid"
printf 'Stopping Norns Lab (PID %s).\n' "$pid"
