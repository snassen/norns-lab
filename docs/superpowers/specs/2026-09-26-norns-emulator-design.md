# Norns emulator: real-runtime first milestone

## Intent and boundary

Sebastian wants fast, unattended feedback while developing existing norns scripts. The emulator should execute upstream norns code, show its real 128 × 64 screen in a browser, accept virtual keys and encoders, and report whether a scripted interaction succeeded. The longer-term goal includes audio, more devices, and possibly booting the norns Raspberry Pi OS. The first milestone must contribute reusable browser and test infrastructure to that longer-term emulator.

The reference script is **Awake**, not a test-only Lua script. Pin the revision used on Sebastian's shield, `tehn/awake` commit `73d4acc`, and keep it unmodified. Awake's default audio path uses PolyPerc and softcut; its K1–K3 and E1–E3 controls and on-screen mode labels provide an end-to-end check. Do not use the active Onward project as the first acceptance case.

## Approach

Run the upstream norns services natively inside an ARM64 Linux environment on the Apple Silicon Mac. Build upstream with its desktop configuration and use virtual I/O adapters where it expects GPIO, OLED, or a physical audio codec. This executes the real Lua runtime, SuperCollider engine bridge, softcut, screen renderer, and script lifecycle. The Mac hosts a small local web gateway and browser UI.

The initial Linux host will be a CLI-managed ARM64 VM/container environment (Colima is the preferred candidate; the implementation plan must verify it on this Mac). Current inspection found Parallels installed but no working Docker or Tart command. Upstream's Raspberry Pi OS container is intended for CI builds, not responsive interaction; a full Pi image is therefore a later backend experiment rather than the first interactive runtime. Pin the exact norns source revision selected during implementation and record it alongside the Awake pin.

The browser and automated runner speak one backend-neutral protocol:

| Direction | Message | Meaning |
| --- | --- | --- |
| Backend → client | `frame` | Native norns framebuffer, 128 × 64 pixels, plus sequence number and time. |
| Backend → client | `status` | Runtime, script, and engine readiness or a structured error. |
| Backend → client | `state` | Read-only diagnostic state for the current reference script. |
| Client → backend | `key` | K1–K3 press/release, preserving hold duration. |
| Client → backend | `encoder` | E1–E3 signed delta. |
| Client → backend | `load` | Load a script from the isolated development script directory. |
| Client → backend | `inspect` | Request the reference script's current diagnostic state. |

The frame source must be norns' rendered framebuffer, not a second implementation of the `screen` Lua API. Current upstream provides `_norns.screen_export_png` for the native Cairo framebuffer. It also provides OSC `/remote/key` and `/remote/enc`, but Colima does not forward this UDP port to macOS on this host. The first backend therefore uses norns' existing stdin Lua console to invoke `_norns.key` and the active `norns.encoders.callback` with normalized encoder steps. These callbacks dispatch into the real script and retain key hold behavior. The gateway listens on localhost by default. A future Pi OS or physical-shield backend can implement this protocol without replacing the UI or test scenarios.

## First milestone behavior

1. One documented command starts the isolated Linux runtime and local browser UI. It displays Awake's live screen and provides K1–K3 and E1–E3 controls. Browser interaction updates the native script, not a JavaScript reimplementation.
2. The runtime loads unmodified Awake from a pinned source revision, starts PolyPerc and softcut without a Lua or SuperCollider load error, and reports failures visibly and in logs. Audio quality and browser audio playback are outside this milestone's pass criteria.
3. An unattended runner starts from a clean data directory, waits for readiness with a finite timeout, loads Awake, captures a frame, sends E1 `+1`, and verifies the actual script mode changes from `STEP` to `LOOP` while a new native frame arrives. It then sends E1 `-1`, presses and releases K2, and verifies that Awake's edit selection changes in `STEP`. The runner checks script state through the runtime's own diagnostic channel and saves the before/after frames. It does not use fixed whole-frame hashes because Awake's sequencers animate.
4. Every run returns a nonzero exit code on failure and saves a compact report with the pinned revisions, event trace, frames, relevant logs, and the first failing assertion. A watch mode may rerun the same scenario after source changes without further user interaction.

## Future increments

- Add browser audio output and automated audio assertions once the real runtime and visual/input loop work. Keep musical listening judgments separate from programmatic checks.
- Add grid, arc, MIDI, sample files, and script-specific engine coverage according to scripts being developed.
- Run the same event trace against a **dedicated** physical norns for comparison. The currently active shield at `10.0.250.104` is a read-only reference until Sebastian chooses a device for automated runs.
- Investigate booting a norns Pi OS image only if system-level compatibility is needed. This backend must reuse the protocol and scenario runner. GPIO, display, codec, and timing differences are explicit feasibility questions, not assumed solved by booting ARM Linux.

## Constraints and evidence

- Work in this new project; preserve the separate WYSIWYG clone and the Onward repository, which currently has uncommitted edits.
- Treat the local WYSIWYG clone as a visual reference only. It has no explicit license or full norns runtime.
- Record source revisions and upstream licenses before vendoring or distributing code. Prefer fetching Awake as a pinned test fixture rather than copying it into this repository.
- No unattended test writes to the live shield. The first milestone is fully local and can be run without approving each input or assertion.
- Official norns [setup](https://github.com/monome/norns/blob/main/readme-setup.md), [source](https://github.com/monome/norns), and [CI container notes](https://github.com/monome/norns/blob/main/Dockerfile) define the build and runtime boundary. Monome's [Awake guide](https://monome.org/docs/norns/play/) and [Awake source](https://github.com/tehn/awake) define the reference behavior.

## Acceptance

The milestone is complete when a fresh run on this Mac starts the real norns runtime, shows Awake in the browser, handles live K/E input, and passes the unattended Awake scenario with saved evidence. A failing engine load, missing frame, incorrect mode/edit transition, or timeout must fail the run clearly. The browser, input protocol, and runner must remain usable if the backend is later replaced by a Pi OS emulator.
