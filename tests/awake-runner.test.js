import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Runtime } from '../src/runtime.js';
import { assertAwakeStates } from '../runner/scenario.mjs';
import { runAwakeScenario } from '../runner/awake.mjs';

const fixture = fileURLToPath(new URL('./fixtures/fake-norns.mjs', import.meta.url));

test('accepts Awake STEP to LOOP to STEP and K2 edit selection', () => {
  assert.doesNotThrow(() => assertAwakeStates([
    { mode: 1, edit_ch: 1 },
    { mode: 2, edit_ch: 1 },
    { mode: 1, edit_ch: 1 },
    { mode: 1, edit_ch: 2 }
  ]));
});

test('rejects frame traffic without actual Awake state changes', () => {
  assert.throws(() => assertAwakeStates([
    { mode: 1, edit_ch: 1 },
    { mode: 1, edit_ch: 1 },
    { mode: 1, edit_ch: 1 },
    { mode: 1, edit_ch: 1 }
  ]), /LOOP/);
});

test('runs Awake controls unattended and saves trace, frames and logs', async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'norns-lab-runner-'));
  try {
    const runtime = new Runtime({ command: process.execPath, args: [fixture], frameDir: path.join(scratch, 'frames'), containerFrameDir: path.join(scratch, 'frames'), startupTimeoutMs: 1000 });
    const { artifactDir, report } = await runAwakeScenario({ runtime, artifactRoot: path.join(scratch, 'artifacts') });
    assert.equal(report.result, 'passed');
    assert.equal(report.frames.length, 3);
    assert.deepEqual(report.states.filter((state, i, all) => i === 0 || state.mode !== all[i - 1].mode || state.edit_ch !== all[i - 1].edit_ch).map(({ mode, edit_ch }) => [mode, edit_ch]), [[1, 1], [2, 1], [1, 1], [1, 2]]);
    assert.equal((await fs.readFile(path.join(artifactDir, 'report.json'), 'utf8')).includes('"result": "passed"'), true);
    assert.equal((await fs.readFile(path.join(artifactDir, 'runtime.log'), 'utf8')).includes('# script init'), true);
  } finally {
    await fs.rm(scratch, { recursive: true, force: true });
  }
});
