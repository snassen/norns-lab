#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  printf 'Docker CLI is missing. Install docker and colima with: brew install docker colima\n' >&2
  exit 2
fi
if ! docker info >/dev/null 2>&1; then
  printf 'Docker daemon is unavailable. Start it with: colima start\n' >&2
  exit 2
fi
arch="$(docker info --format '{{.Architecture}}')"
if [[ "$arch" != 'aarch64' && "$arch" != 'arm64' ]]; then
  printf 'ARM64 Docker daemon required; found: %s\n' "$arch" >&2
  exit 2
fi
printf 'host check passed: Docker ARM64 daemon is ready\n'
