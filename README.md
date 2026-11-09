# Norns Lab

Norns Lab runs the upstream norns application and an unmodified, pinned copy of Awake in an ARM64 Linux container. It can also mount a local Onward script read-only. A local browser displays norns' native 128 × 64 framebuffer, plays its stereo audio, and sends K1–K3 and E1–E3 input through norns' own key and encoder callbacks. Unattended scenarios check state and audio, then save frames, WAV files, and runtime logs.

This is the first working slice toward a broader norns emulator. The browser and scenario use a small protocol that can later connect to a Raspberry Pi OS backend. The current backend runs norns natively on ARM64 Linux; it does not boot a Raspberry Pi OS image. It runs the real Matron script loader and console.

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
npm run verify:onward
npm run evaluate:onward
```

The smoke command builds the `norns-lab-runtime` image and checks the real norns services. `npm run verify:awake` launches a fresh container, loads Awake, sends controls over the same gateway used by the browser, checks Awake's actual Lua state and non-silent audio, and writes a timestamped run to `artifacts/`. `npm run verify:onward` loads the sibling `onward-norns` source folder read-only, changes pages, sends a 440 Hz test note to norns' JACK inputs, and checks that both channels select sound and the output is non-silent. It waits for norns' startup sound to decay before measuring the note. `npm run evaluate:onward` tests automatic and manual capture, independent locks, held audio across new input, and Freeze-to-Glitch routing. It saves a JSON assessment, WAVs, and runtime logs in a timestamped `artifacts/onward-evaluation-*` folder. A false assessment field is a measured behavior gap and makes the command exit nonzero, so an unattended run catches it. These checks use synthetic notes; they do not establish a sonic match with the physical pedal.

## Browser

After the image is built, run `npm start` and open the printed `http://127.0.0.1:5151` address. Select **Awake** or **Onward** and click **Load Script**, then **Start Audio** to enable sound in the browser. Onward needs input: click **Play Test Input** to send a short note through its actual audio input path. Hold a virtual K button with the pointer. Use the visible −/+ buttons for exact encoder steps, or scroll over an E control for one step per wheel gesture. Expand **Matron console** to send a single line of Lua and read its output; for example, `onward_status()`. The page and audio receiver listen only on this computer.

By default Onward is mounted from `../onward-norns` without write access. Set `NORN_LAB_ONWARD_DIR` to another absolute source folder if needed. The test note is synthetic; live microphone or instrument input is not yet connected to the browser.

## Start and stop on macOS

Run `./scripts/install-mac-launcher.sh` once to install **Norns Lab** in `~/Applications`, then open it from Finder or Spotlight. Its menu bar item shows **● Norns Lab** while the emulator is running and **○ Norns Lab** while it is stopped. The menu has **Start and Open**, **Open Browser**, **Stop Emulator**, and **Stop and Quit**. It also recognizes a Norns Lab instance started from Terminal or Codex. The launcher writes its own startup log to `~/Library/Logs/NornsLab.log`.

From a terminal, use `npm run stop` to stop the server and its Docker container cleanly. If you started Norns Lab in a terminal, Ctrl+C does the same. Stopping browser audio alone only mutes playback in that browser tab.

## Source and scope

Pinned revisions are in [runtime/versions.json](runtime/versions.json). The image fetches upstream [norns](https://github.com/monome/norns) and [Awake](https://github.com/tehn/awake) at build time. Awake stays unmodified. The ARM64 build compatibility patch is in `runtime/patches/`.

The current acceptance check covers the framebuffer, key and encoder routing, script lifecycle, PolyPerc startup, softcut availability, and non-silent stereo audio from Crone. It does not judge musical sound quality or measure end-to-end audio latency. Grid, arc, MIDI, and GPIO are later work. The connected physical shield is not part of this test and is never written to by these commands.

See [the design](docs/superpowers/specs/2026-09-26-norns-emulator-design.md) for the backend boundary and future Raspberry Pi OS path.

## License

Norns Lab is released under the GNU General Public License, version 3 or later (see `LICENSE`), the same license as [norns](https://github.com/monome/norns). Scripts it loads, such as Awake, keep their own licenses.
