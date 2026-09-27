# Norns Lab

Norns Lab runs the upstream norns application and an unmodified, pinned copy of Awake in an ARM64 Linux container. A local browser displays norns' native 128 × 64 framebuffer, plays its stereo audio, and sends K1–K3 and E1–E3 input through norns' own key and encoder callbacks. An unattended scenario checks Awake's state and audio, then saves frames, a short WAV, and the runtime log.

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

The smoke command builds the `norns-lab-runtime` image and checks the real norns services. `npm run verify:awake` launches a fresh container, loads Awake, sends controls over the same gateway used by the browser, checks Awake's actual Lua state and non-silent audio, and writes a timestamped run to `artifacts/`. Its exit code is nonzero on failure. Inspect `report.json`, `runtime.log`, the PNG frames, and `awake-audio.wav` in that run directory.

## Browser

After the image is built, run `npm start` and open the printed `http://127.0.0.1:5151` address. Click **Load Awake**, then **Start Audio** to enable sound in the browser. Hold a virtual K button with the pointer. Use the visible −/+ buttons for exact encoder steps, or scroll over an E control for one step per wheel gesture. The page and audio receiver listen only on this computer.

## Source and scope

Pinned revisions are in [runtime/versions.json](runtime/versions.json). The image fetches upstream [norns](https://github.com/monome/norns) and [Awake](https://github.com/tehn/awake) at build time. Awake stays unmodified. The ARM64 build compatibility patch is in `runtime/patches/`.

The current acceptance check covers the framebuffer, key and encoder routing, script lifecycle, PolyPerc startup, softcut availability, and non-silent stereo audio from Crone. It does not judge musical sound quality or measure end-to-end audio latency. Grid, arc, MIDI, and GPIO are later work. The connected physical shield is not part of this test and is never written to by these commands.

See [the design](docs/superpowers/specs/2026-09-26-norns-emulator-design.md) for the backend boundary and future Raspberry Pi OS path.
