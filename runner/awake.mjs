import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { Runtime } from '../src/runtime.js';
import { createAppServer } from '../src/server.js';
import { assertAwakeStates } from './scenario.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function inbox(ws) {
  const messages = [];
  const waiters = new Set();
  ws.on('message', raw => {
    const message = JSON.parse(String(raw));
    messages.push(message);
    for (const waiter of waiters) {
      if (waiter.predicate(message)) {
        waiters.delete(waiter);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      }
    }
  });
  return {
    get length() { return messages.length; },
    waitFor(predicate, since = messages.length, timeoutMs = 5000) {
      const found = messages.slice(since).find(predicate);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve };
        waiter.timer = setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error('Timed out waiting for emulator response'));
        }, timeoutMs);
        waiters.add(waiter);
      });
    }
  };
}

export async function runAwakeScenario({ runtime, artifactRoot = path.join(root, 'artifacts'), controlPort = 10111 } = {}) {
  const runId = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const artifactDir = path.join(artifactRoot, runId);
  await fs.mkdir(artifactDir, { recursive: true });
  const report = { runId, startedAt: new Date().toISOString(), events: [], states: [], frames: [], result: 'failed' };
  let app;
  let ws;
  try {
    report.versions = JSON.parse(await fs.readFile(path.join(root, 'runtime/versions.json'), 'utf8'));
    await runtime.start();
    app = createAppServer({ runtime, frameDir: runtime.frameDir, controlPort, frameIntervalMs: 150 });
    const address = await app.listen(0);
    ws = new WebSocket(`ws://127.0.0.1:${address.port}`);
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const received = inbox(ws);
    const send = message => {
      report.events.push({ at: new Date().toISOString(), ...message });
      ws.send(JSON.stringify(message));
    };
    const inspect = async () => {
      const since = received.length;
      send({ type: 'inspect' });
      const state = await received.waitFor(message => message.type === 'state', since, 4000);
      report.states.push({ mode: state.mode, edit_ch: state.edit_ch });
      return state;
    };
    const waitState = async predicate => {
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline) {
        const state = await inspect();
        if (predicate(state)) return state;
        await delay(100);
      }
      throw new Error('Awake did not reach the expected state');
    };
    const saveFrame = async afterSequence => {
      const since = received.length;
      const frame = await received.waitFor(message => message.type === 'frame' && message.sequence > afterSequence, since, 5000);
      const response = await fetch(`http://127.0.0.1:${address.port}${frame.url}`);
      if (!response.ok) throw new Error(`Frame HTTP ${response.status}`);
      const filename = `frame-${frame.sequence}.png`;
      await fs.writeFile(path.join(artifactDir, filename), Buffer.from(await response.arrayBuffer()));
      report.frames.push({ sequence: frame.sequence, filename });
      return frame.sequence;
    };

    const loadSince = received.length;
    send({ type: 'load', script: 'awake' });
    await received.waitFor(message => message.type === 'status' && message.state === 'script-ready', loadSince, 35000);
    const states = [];
    states.push(await waitState(state => state.mode === 1 && state.edit_ch === 1));
    let sequence = await saveFrame(0);
    send({ type: 'encoder', n: 1, delta: 1 });
    states.push(await waitState(state => state.mode === 2));
    sequence = await saveFrame(sequence);
    send({ type: 'encoder', n: 1, delta: -1 });
    states.push(await waitState(state => state.mode === 1));
    send({ type: 'key', n: 2, z: 1 });
    await delay(100);
    send({ type: 'key', n: 2, z: 0 });
    states.push(await waitState(state => state.mode === 1 && state.edit_ch === 2));
    await saveFrame(sequence);
    assertAwakeStates(states);
    report.result = 'passed';
  } catch (error) {
    report.error = error.message;
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(artifactDir, 'report.json'), JSON.stringify(report, null, 2));
    await fs.writeFile(path.join(artifactDir, 'runtime.log'), `${runtime.lines.join('\n')}\n`);
    ws?.terminate();
    await app?.close();
    await runtime.stop();
  }
  return { artifactDir, report };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const frameDir = await fs.mkdtemp(path.join(os.tmpdir(), 'norns-lab-run-'));
  try {
    const result = await runAwakeScenario({ runtime: new Runtime({ frameDir }) });
    console.log(`Awake verification passed: ${result.artifactDir}`);
  } catch (error) {
    console.error(`Awake verification failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await fs.rm(frameDir, { recursive: true, force: true });
  }
}
