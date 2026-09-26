# Norns Lab

Norns Lab runs the upstream norns application and an unmodified, pinned copy of Awake in an ARM64 Linux container. A local browser displays norns' native 128 × 64 framebuffer and sends K1–K3 and E1–E3 input through norns' own key and encoder callbacks. An unattended scenario checks Awake's state transitions and saves the frames and runtime log.

This is the first working slice toward a broader norns emulator. The browser and scenario use a small protocol that can later connect to a Raspberry Pi OS backend. The current backend runs norns natively on ARM64 Linux; it does not boot a Raspberry Pi OS image.

## Requirements

- Apple Silicon Mac with Colima and Docker CLI (`brew install colima docker`)
- Node.js 22 or newer
- Enough free space for an Ubuntu image, norns build, and SuperCollider

Start Colima with `colima start`, then check it with `./scripts/check-host.sh`.

## Build and verify

From this directory:

```sh
npm ci
./scripts/smoke-runtime.sh
npm test
npm run verify:awake
```

The smoke command builds the `norns-lab-runtime` image and checks the real norns services. `npm run verify:awake` launches a fresh container, loads Awake, sends controls over the same gateway used by the browser, checks Awake's actual Lua state, and writes a timestamped run to `artifacts/`. Its exit code is nonzero on failure. Inspect `report.json`, `runtime.log`, and the PNG frames in that run directory for the first failure and visual evidence.

## Browser

After the image is built, run `npm start` and open the printed `http://127.0.0.1:5151` address. Click **Load Awake**. Hold a virtual K button with the pointer. Scroll an E control to turn it; click for `+1` or right click for `-1`. The page is local to this computer.

## Source and scope

Pinned revisions are in [runtime/versions.json](runtime/versions.json). The image fetches upstream [norns](https://github.com/monome/norns) and [Awake](https://github.com/tehn/awake) at build time. Awake stays unmodified. The ARM64 build compatibility patch is in `runtime/patches/`.

The current acceptance check covers the framebuffer, key and encoder routing, script lifecycle, PolyPerc startup, and softcut availability. It does not assess audible quality or stream audio to the browser. Grid, arc, MIDI, and GPIO are later work. The connected physical shield is not part of this test and is never written to by these commands.

See [the design](docs/superpowers/specs/2026-09-26-norns-emulator-design.md) for the backend boundary and future Raspberry Pi OS path.
