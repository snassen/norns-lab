import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Runtime } from '../src/runtime.js';

const fixture = fileURLToPath(new URL('./fixtures/fake-norns.mjs', import.meta.url));

test('starts a runtime, loads Awake and captures a fresh native PNG', async () => {
  const frameDir = await fs.mkdtemp(path.join(os.tmpdir(), 'norns-lab-test-'));
  const runtime = new Runtime({ command: process.execPath, args: [fixture], frameDir, containerFrameDir: frameDir, startupTimeoutMs: 1000 });
  try {
    await runtime.start();
    await runtime.loadAwake();
    const first = await runtime.captureFrame();
    const second = await runtime.captureFrame();
    assert.equal(first.sequence, 1);
    assert.equal(second.sequence, 2);
    assert.notEqual(first.path, second.path);
    assert.equal((await fs.readFile(second.path)).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.deepEqual(await runtime.probeAwake(), { mode: 1, edit_ch: 1 });
  } finally {
    await runtime.stop();
    await fs.rm(frameDir, { recursive: true, force: true });
  }
});

test('fails promptly when a child never reports readiness', async () => {
  const frameDir = await fs.mkdtemp(path.join(os.tmpdir(), 'norns-lab-test-'));
  const runtime = new Runtime({ command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], frameDir, startupTimeoutMs: 100 });
  try {
    await assert.rejects(runtime.start(), /readiness timeout/);
  } finally {
    await runtime.stop();
    await fs.rm(frameDir, { recursive: true, force: true });
  }
});

test('waits for a complete PNG instead of publishing a partial frame', async () => {
  const frameDir = await fs.mkdtemp(path.join(os.tmpdir(), 'norns-lab-test-'));
  const previous = process.env.FAKE_PARTIAL_FRAME_MS;
  process.env.FAKE_PARTIAL_FRAME_MS = '150';
  const runtime = new Runtime({ command: process.execPath, args: [fixture], frameDir, containerFrameDir: frameDir, startupTimeoutMs: 1000 });
  try {
    await runtime.start();
    const frame = await runtime.captureFrame();
    const data = await fs.readFile(frame.path);
    assert.equal(data.subarray(-12).toString('hex'), '0000000049454e44ae426082');
  } finally {
    await runtime.stop();
    if (previous === undefined) delete process.env.FAKE_PARTIAL_FRAME_MS;
    else process.env.FAKE_PARTIAL_FRAME_MS = previous;
    await fs.rm(frameDir, { recursive: true, force: true });
  }
});

test('reports a runtime that exits after initial readiness', async () => {
  const frameDir = await fs.mkdtemp(path.join(os.tmpdir(), 'norns-lab-test-'));
  const previous = process.env.FAKE_EXIT_AFTER_READY;
  process.env.FAKE_EXIT_AFTER_READY = '1';
  const runtime = new Runtime({ command: process.execPath, args: [fixture], frameDir, startupTimeoutMs: 1000 });
  try {
    await runtime.start();
    const failed = await Promise.race([
      new Promise(resolve => runtime.on('status', state => {
        if (state.state === 'failed') resolve(state);
      })),
      new Promise((_, reject) => setTimeout(() => reject(new Error('missing failed status')), 500))
    ]);
    assert.match(failed.error, /exited/);
  } finally {
    await runtime.stop();
    if (previous === undefined) delete process.env.FAKE_EXIT_AFTER_READY;
    else process.env.FAKE_EXIT_AFTER_READY = previous;
    await fs.rm(frameDir, { recursive: true, force: true });
  }
});
