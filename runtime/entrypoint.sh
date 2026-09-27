#!/usr/bin/env bash
set -Eeuo pipefail

# Docker Desktop presents host bind mounts as root-owned inside Linux. Fix the
# shared frame directory once, then run all norns and SuperCollider processes
# as the unprivileged image user.
if [[ "$(id -u)" -eq 0 && "${NORN_LAB_DROPPED_PRIVILEGES:-0}" != 1 ]]; then
  mkdir -p /frames
  chown we:we /frames
  exec env NORN_LAB_DROPPED_PRIVILEGES=1 HOME=/home/we runuser -u we -- "$0" "$@"
fi

runtime_log=/tmp/norns-lab-runtime.log
sc_log=/tmp/norns-lab-sclang.log
input_fifo=/tmp/norns-lab.stdin
mkdir -p /frames
rm -f "$input_fifo"
mkfifo "$input_fifo"

cleanup() {
  trap - EXIT INT TERM
  [[ -n "${forward_pid:-}" ]] && kill "$forward_pid" 2>/dev/null || true
  [[ -n "${audio_connect_pid:-}" ]] && kill "$audio_connect_pid" 2>/dev/null || true
  [[ -n "${audio_pid:-}" ]] && kill "$audio_pid" 2>/dev/null || true
  [[ -n "${norns_pid:-}" ]] && kill "$norns_pid" 2>/dev/null || true
  [[ -n "${sclang_pid:-}" ]] && kill "$sclang_pid" 2>/dev/null || true
  [[ -n "${jack_pid:-}" ]] && kill "$jack_pid" 2>/dev/null || true
  rm -f "$input_fifo"
}
trap cleanup EXIT INT TERM

jackd -d dummy -r 48000 -p 1024 >/tmp/norns-lab-jack.log 2>&1 &
jack_pid=$!
for _ in $(seq 1 100); do
  jack_lsp >/dev/null 2>&1 && break
  sleep 0.1
done
jack_lsp >/dev/null 2>&1 || { cat /tmp/norns-lab-jack.log >&2; exit 1; }
printf 'SMOKE_JACK_READY\n'

# Keep sclang's REPL stdin open while it boots scsynth and Crone's OSC service.
# Ubuntu's sclang is a Qt program even when it is only serving OSC, so select
# Qt's headless platform explicitly inside the container.
tail -f /dev/null | QT_QPA_PLATFORM=offscreen sclang -l /home/we/.config/SuperCollider/sclang_conf.yaml >"$sc_log" 2>&1 &
sclang_pid=$!
# Matron sends Crone commands to sclang's language port (57120). The 9999
# value printed by Crone is its legacy internal address, not a listening port.
for _ in $(seq 1 300); do
  ss -lun | grep -q ':57120 ' && break
  sleep 0.1
done
ss -lun | grep -q ':57120 ' || { cat "$sc_log" >&2; exit 1; }
printf 'SMOKE_SCLANG_READY\n'

# Tee runtime output to both the container's stdout and a log we can use for a
# readiness probe. The FIFO keeps the real matron REPL attached to container stdin.
/home/we/norns/build/norns/norns <"$input_fifo" 2>&1 | tee "$runtime_log" &
norns_pid=$!
exec 3>"$input_fifo"

for _ in $(seq 1 300); do
  grep -Fq 'init input...' "$runtime_log" && break
  if ! kill -0 "$norns_pid" 2>/dev/null; then cat "$runtime_log" >&2; exit 1; fi
  sleep 0.1
done
grep -Fq 'init input...' "$runtime_log" || { cat "$runtime_log" >&2; exit 1; }
# The REPL input thread appears before norns has finished its own startup. A
# script sent during that window is subsequently cleared by startup.lua, so
# readiness must wait for the completion marker rather than input alone.
for _ in $(seq 1 300); do
  grep -Fq 'norns.startup_status.ok' "$runtime_log" && break
  if ! kill -0 "$norns_pid" 2>/dev/null; then cat "$runtime_log" >&2; exit 1; fi
  sleep 0.1
done
grep -Fq 'norns.startup_status.ok' "$runtime_log" || { cat "$runtime_log" >&2; exit 1; }
printf 'SMOKE_NORNS_READY\n'
printf 'print("NORN_LAB_READY")\n' >&3
for _ in $(seq 1 100); do
  grep -Fq 'NORN_LAB_READY' "$runtime_log" && break
  sleep 0.1
done
grep -Fq 'NORN_LAB_READY' "$runtime_log" || { cat "$runtime_log" >&2; exit 1; }

# Export the actual final Crone JACK outputs only when a gateway supplies an
# isolated TCP port. Smoke containers leave this unset, so they cannot steal
# a browser session's audio connection. Each browser gateway or unattended
# runner owns its own receiver; the retry loop lets norns keep running if that
# receiver is refreshed or temporarily unavailable.
audio_port="${NORN_LAB_AUDIO_PORT:-0}"
if [[ "$audio_port" =~ ^[1-9][0-9]{0,4}$ ]] && (( audio_port <= 65535 )); then
  audio_log=/tmp/norns-lab-audio.log
  (
    while true; do
      ffmpeg -hide_banner -loglevel warning \
        -f jack -ac 2 -i norns-lab-capture \
        -ac 2 -ar 48000 -f f32le "tcp://host.docker.internal:${audio_port}" >>"$audio_log" 2>&1 || true
      sleep 1
    done
  ) &
  audio_pid=$!
  (
    while kill -0 "$audio_pid" 2>/dev/null; do
      if jack_lsp | grep -Fxq 'crone:output_1' \
        && jack_lsp | grep -Fxq 'crone:output_2' \
        && jack_lsp | grep -Fxq 'norns-lab-capture:input_1' \
        && jack_lsp | grep -Fxq 'norns-lab-capture:input_2'; then
        if ! jack_lsp -c crone:output_1 | grep -Fq 'norns-lab-capture:input_1' \
          || ! jack_lsp -c crone:output_2 | grep -Fq 'norns-lab-capture:input_2'; then
          jack_connect crone:output_1 norns-lab-capture:input_1 2>/dev/null || true
          jack_connect crone:output_2 norns-lab-capture:input_2 2>/dev/null || true
          printf 'SMOKE_AUDIO_CAPTURE_CONNECTED\n'
        fi
        # The connection survives while this ffmpeg process remains alive. Poll
        # for a newly-created client after a receiver restart.
        sleep 0.5
      else
        sleep 0.1
      fi
    done
  ) &
  audio_connect_pid=$!
fi

# `NORN_LAB_READY` comes from matron itself, after its stdin input thread is live.
# The gateway can now write Lua lines and request native PNG exports through stdin.
# Do not consume container stdin until then: Docker can deliver a heredoc before
# matron creates its input loop, which would lose a first script-load command.
cat <&0 >&3 &
forward_pid=$!
wait "$forward_pid" || true
sleep "${NORN_LAB_EOF_GRACE_SECONDS:-8}"
