#!/usr/bin/env bash
# Verifies a built runtime without relying on browser or gateway code.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="${NORN_LAB_IMAGE:-norns-lab-runtime}"
cleanup_frames=1
if [[ -n "${NORN_LAB_FRAMES:-}" ]]; then
  frames="$NORN_LAB_FRAMES"
  cleanup_frames=0
else
  frames="$(mktemp -d "$root/.norns-lab-smoke.XXXXXX")"
fi
cleanup() {
  if [[ "$cleanup_frames" -eq 1 ]]; then rm -rf "$frames"; fi
}
trap cleanup EXIT

require_marker() {
  local marker="$1" log="$2"
  if ! grep -Fq "$marker" "$log"; then
    printf 'missing runtime marker: %s\n' "$marker" >&2
    return 1
  fi
}

run_bounded() {
  local seconds="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "${seconds}s" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "${seconds}s" "$@"
  else
    # macOS does not ship GNU timeout. `exec` preserves the caller's stdin,
    # so the Lua heredoc below reaches the Docker process unchanged.
    perl -e 'alarm shift; exec @ARGV' "$seconds" "$@"
  fi
}

if ! command -v docker >/dev/null 2>&1; then
  printf 'Docker CLI is required. Install Docker CLI and start Colima, then rerun.\n' >&2
  exit 2
fi
if ! docker info >/dev/null 2>&1; then
  printf 'Docker daemon is unavailable. Start Colima, then rerun.\n' >&2
  exit 2
fi

docker build --platform linux/arm64 -t "$image" -f "$root/runtime/Dockerfile" "$root"
test "$(docker run --rm --user we --entrypoint git "$image" -C /home/we/norns rev-parse HEAD)" = \
  '42df84420774ef4d0961cf37946ed30e4078920f'
test "$(docker run --rm --user we --entrypoint git "$image" -C /home/we/dust/code/awake rev-parse HEAD)" = \
  '73d4accfc090aaab58f1586eaf4d9cf54d3cff01'
docker run --rm --user we --entrypoint /home/we/norns/build/norns/norns "$image" --check | grep -Fq 'norns: --check ok'

log="$frames/runtime.log"
run_bounded 45 docker run --platform linux/arm64 --rm -i \
  -e NORN_LAB_EOF_GRACE_SECONDS=25 \
  -v "$frames:/frames" "$image" >"$log" 2>&1 <<'LUA'
print("SMOKE_REPL_READY")
norns.script.load('/home/we/dust/code/awake/awake.lua')
print("SMOKE_AWAKE_LOAD_REQUESTED")
print("SMOKE_AWAKE_LOADED")
print("SMOKE_POLYPERC_REGISTERED:" .. tostring(engine.name))
_norns.screen_export_png('/frames/smoke.png')
print("SMOKE_FRAME_EXPORTED")
LUA

require_marker 'SMOKE_JACK_READY' "$log"
require_marker 'SMOKE_SCLANG_READY' "$log"
require_marker 'SMOKE_NORNS_READY' "$log"
require_marker 'SMOKE_REPL_READY' "$log"
require_marker 'SMOKE_AWAKE_LOAD_REQUESTED' "$log"
require_marker 'SMOKE_AWAKE_LOADED' "$log"
require_marker 'SMOKE_POLYPERC_REGISTERED:PolyPerc' "$log"
require_marker 'SMOKE_FRAME_EXPORTED' "$log"
require_marker '# script init' "$log"
test -s "$frames/smoke.png"
if awk '/SMOKE_AWAKE_LOAD_REQUESTED/{after_awake=1} after_awake' "$log" | grep -Eq '### SCRIPT ERROR|ERROR:'; then
  printf 'Awake reported a Lua or SuperCollider error; see %s\n' "$log" >&2
  exit 1
fi
printf 'runtime smoke passed; log: %s\n' "$log"
