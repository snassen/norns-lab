#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
application="$HOME/Applications/Norns Lab.app"
contents="$application/Contents"
mkdir -p "$contents/MacOS"

swiftc -O "$root/macos/NornsLabMenu.swift" -o "$contents/MacOS/NornsLabMenu"
python3 - "$contents/Info.plist" "$root" <<'PY'
import plistlib
import sys

with open(sys.argv[1], 'wb') as file:
    plistlib.dump({
        'CFBundleDevelopmentRegion': 'en',
        'CFBundleExecutable': 'NornsLabMenu',
        'CFBundleIdentifier': 'local.nornslab.launcher',
        'CFBundleInfoDictionaryVersion': '6.0',
        'CFBundleName': 'Norns Lab',
        'CFBundlePackageType': 'APPL',
        'CFBundleShortVersionString': '1.0',
        'CFBundleVersion': '1',
        'LSUIElement': True,
        'NornsLabProjectPath': sys.argv[2],
        'NSHighResolutionCapable': True,
    }, file)
PY
printf 'Installed %s\n' "$application"
