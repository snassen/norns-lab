import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { Runtime } from '../src/runtime.js';
import { AudioBridge } from '../src/audio-bridge.js';
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

function wavFromFloatStereo(pcm) {
  const frames = pcm.length / 8;
  const wav = Buffer.alloc(44 + frames * 4);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(48000, 24);
  wav.writeUInt32LE(48000 * 4, 28);
  wav.writeUInt16LE(4, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(frames * 4, 40);
  for (let index = 0; index < frames * 2; index++) {
    const sample = Math.max(-1, Math.min(1, pcm.readFloatLE(index * 4)));
    wav.writeInt16LE(Math.round(sample * (sample < 0 ? 32768 : 32767)), 44 + index * 2);
  }
  return wav;
}

function captureAwakeAudio(audioBridge, timeoutMs = 8000) {
  const targetBytes = 48000 * 2 * 4;
  return new Promise((resolve, reject) => {
    let recording = false;
    let bytes = 0;
    const chunks = [];
    const cleanup = () => { clearTimeout(timer); audioBridge.off('pcm', onPcm); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Awake audio was silent or missing')); }, timeoutMs);
    const onPcm = chunk => {
      if (!recording) {
        for (let index = 0; index < chunk.length; index += 4) {
          if (Math.abs(chunk.readFloatLE(index)) > 0.005) { recording = true; break; }
        }
        if (!recording) return;
      }
      const copy = Buffer.from(chunk.subarray(0, Math.min(chunk.length, targetBytes - bytes)));
      chunks.push(copy);
      bytes += copy.length;
      if (bytes === targetBytes) { cleanup(); resolve(Buffer.concat(chunks)); }
    };
    audioBridge.on('pcm', onPcm);
  });
}

export async function runAwakeScenario({ runtime, audioBridge, artifactRoot = path.join(root, 'artifacts') } = {}) {
  const runId = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const artifactDir = path.join(artifactRoot, runId);
  await fs.mkdir(artifactDir, { recursive: true });
  const report = { runId, startedAt: new Date().toISOString(), events: [], states: [], frames: [], result: 'failed' };
  let app;
  let ws;
  try {
    report.versions = JSON.parse(await fs.readFile(path.join(root, 'runtime/versions.json'), 'utf8'));
    await runtime.start();
    app = createAppServer({ runtime, frameDir: runtime.frameDir, frameIntervalMs: 150 });
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
    const loadLogIndex = runtime.lines.length;
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
    if (audioBridge) {
      const pcm = await captureAwakeAudio(audioBridge);
      let peak = 0;
      let squareSum = 0;
      for (let index = 0; index < pcm.length; index += 4) {
        const value = pcm.readFloatLE(index);
        peak = Math.max(peak, Math.abs(value));
        squareSum += value * value;
      }
      const filename = 'awake-audio.wav';
      await fs.writeFile(path.join(artifactDir, filename), wavFromFloatStereo(pcm));
      report.audio = { filename, frames: pcm.length / 8, peak, rms: Math.sqrt(squareSum / (pcm.length / 4)) };
      if (report.audio.rms < 0.001) throw new Error('Awake audio level too low');
    }
    const runtimeError = runtime.lines.slice(loadLogIndex).find(line => /### SCRIPT ERROR|ERROR:/.test(line));
    if (runtimeError) throw new Error(`Awake runtime error: ${runtimeError}`);
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
  const frameRoot = path.join(root, 'artifacts');
  await fs.mkdir(frameRoot, { recursive: true });
  // Colima shares /Users with macOS, whereas a bind source in /var/folders
  // resolves only inside the Linux VM and its PNGs never reach this process.
  const frameDir = await fs.mkdtemp(path.join(frameRoot, 'runtime-frames-'));
  const audioBridge = new AudioBridge();
  try {
    const audioAddress = await audioBridge.listen(0);
    const result = await runAwakeScenario({ runtime: new Runtime({ frameDir, audioPort: audioAddress.port }), audioBridge });
    console.log(`Awake verification passed: ${result.artifactDir}`);
  } catch (error) {
    console.error(`Awake verification failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await audioBridge.close();
    await fs.rm(frameDir, { recursive: true, force: true });
  }
}
