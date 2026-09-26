# Awake Real-Runtime Emulator Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans task by task. Steps use checkboxes for tracking. Sebastian has authorized the agent to perform the design and plan reviews and carry implementation through without repeated review requests.

**Goal:** Run the unmodified Awake script in upstream norns on this Mac, show its native screen in a browser, and verify key/encoder interactions unattended.

**Architecture:** A pinned ARM64 Linux container runs JACK, SuperCollider, and the current upstream `norns` binary. A local Node gateway owns the container process, sends Lua REPL lines over stdin, invokes norns' key and normalized encoder callbacks, and serves PNG exports of the native Cairo framebuffer over WebSocket to a browser. The browser and automated runner share one protocol so a later Pi OS backend can replace the container without changing them.

**Tech Stack:** Apple Silicon macOS, Colima/Docker CLI, Ubuntu ARM64, norns C/C++/Lua, JACK dummy audio, SuperCollider, Node 22, WebSocket, static browser HTML/CSS/JS.

**Spec:** [2026-09-26-norns-emulator-design.md](../specs/2026-09-26-norns-emulator-design.md)

## Global Constraints

- Pin norns at `42df84420774ef4d0961cf37946ed30e4078920f` and Awake at `73d4accfc090aaab58f1586eaf4d9cf54d3cff01` initially; record any justified change.
- Awake remains unmodified and is fetched as a fixture, not copied into this project.
- Localhost only; no write to the active shield or Onward project.
- Screen frames come from norns' Cairo framebuffer; K/E events enter through existing norns callbacks in the live Lua runtime. Colima does not forward norns' UDP OSC port to macOS on this host.
- A run has explicit timeouts, a nonzero failure exit, and saved frames/logs/trace.

## Review Focus

- Missing container runtime: setup reports the missing dependency plainly and does not claim the emulator started.
- Container or engine exits early: gateway reports a failed status and the runner fails within its timeout.
- Stale screenshot file: every `frame` carries a new sequence and export path so the runner cannot accept an old image.
- Invalid control number or delta: gateway rejects it before sending a Lua control call.
- Browser disconnect or runner interruption: child processes terminate and temporary run state is cleaned up.

---

### Task 1: Boot the pinned upstream runtime

**Files:**
- Create: `.gitignore`, `runtime/Dockerfile`, `runtime/entrypoint.sh`, `runtime/matronrc.lua`, `runtime/versions.json`, `runtime/patches/arm64-build.patch`, `scripts/check-host.sh`, `README.md`
- Test: `scripts/smoke-runtime.sh`

**Interfaces:**
- Produces: `docker build -t norns-lab-runtime -f runtime/Dockerfile .` and `docker run -i --rm ... norns-lab-runtime` with norns REPL on stdin and a shared frame directory.
- Runtime input: `norns.script.load('/home/we/dust/code/awake/awake.lua')` through stdin.

- [x] Check Colima/Docker availability; install CLI-managed ARM64 Linux runtime if needed and verify an ARM64 container starts.
- [x] Write `smoke-runtime.sh` to assert pinned source revisions, `norns --check`, JACK readiness, SuperCollider startup, and Awake load markers; run it to establish the initial failure.
- [x] Build the Docker image from pinned upstream sources and dependencies, applying only the ARM64 compile compatibility patch required by the actual compiler output.
- [x] Configure desktop norns with no GPIO device; start JACK dummy, sclang, then norns while retaining stdin/stdout, and make failures visible.
- [x] Re-run smoke check and save logs proving Awake loads and PolyPerc registers. Commit the task.

### Task 2: Backend-neutral gateway and live browser

**Files:**
- Create: `package.json`, `package-lock.json`, `src/protocol.js`, `src/runtime.js`, `src/server.js`, `web/index.html`, `web/app.js`, `web/style.css`
- Test: `tests/protocol.test.js`, `tests/gateway.test.js`, `tests/server.test.js`

**Interfaces:**
- Produces: `npm start` on `127.0.0.1:5151`; WebSocket commands `load`, `key`, `encoder`; events `status`, `frame`; native PNG endpoint for each numbered frame.
- `src/runtime.js` owns one container process, line-oriented REPL, and screenshot exports into a unique temporary directory.
- `src/runtime.js` sends validated controls through norns' key and encoder callbacks in its Lua REPL.

- [x] Write protocol validation tests for accepted/rejected K/E inputs and malformed messages; confirm red.
- [x] Implement protocol parser and norns callback routing; confirm focused tests pass.
- [x] Write gateway lifecycle tests for startup, readiness timeout, process exit, screenshot freshness, and cleanup; confirm red.
- [x] Implement runtime process wrapper and localhost server. Ask norns to export its Cairo framebuffer to a fresh PNG path; send frames at a bounded rate only after completed exports. Confirm lifecycle tests pass.
- [x] Add a small browser view that renders the 128 × 64 native frame at a readable integer scale and sends press/release and signed encoder steps through the same WebSocket protocol. Manually verify a real Awake frame and live E1 transition. Commit the task.

### Task 3: Unattended Awake scenario and evidence

**Files:**
- Create: `runner/awake.mjs`, `runner/scenario.mjs`, `tests/awake-runner.test.js`
- Modify: `package.json`, `README.md`

**Interfaces:**
- Produces: `npm run verify:awake` with exit 0 only when the real runtime completes the Awake scenario; writes `artifacts/<run-id>/` with revisions, trace, PNGs, and logs.
- Runner drives the Task 2 protocol and reads diagnostic state from the native Lua REPL.

- [x] Write a runner test that distinguishes true `STEP → LOOP → STEP` mode and K2 edit-selection change from mere frame traffic; confirm red.
- [x] Implement deterministic startup/timeout handling, native state probes, sequenced input timeline, frame capture, and failure report. Avoid whole-frame equality because Awake animates.
- [x] Run a fresh real-runtime scenario twice without keyboard interaction. Inspect saved frames and logs for load or engine errors; fix concrete failures.
- [x] Document setup, one-command start, verification, evidence locations, and known platform limits. Commit the task.

### Task 4: Final review and handoff

**Files:**
- Modify only files implicated by review findings.

- [x] Review the diff against every acceptance condition in the spec, including separation from Onward and the live shield.
- [x] Run focused unit tests, container smoke, and full Awake verification from a clean state; record exact commands and results.
- [x] Open the browser result and at least one captured frame for visual inspection; correct any real UI or framebuffer defect.
- [x] Report working scope, remaining audio/device limitations, and next increment without claiming Pi OS emulation is complete.
