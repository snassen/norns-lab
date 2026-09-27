import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { Runtime } from '../src/runtime.js';
import { AudioBridge } from '../src/audio-bridge.js';
import { createAppServer } from '../src/server.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(messages, predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = messages.find(predicate);
    if (found) return found;
    await delay(20);
  }
  throw new Error('Timed out waiting for Onward browser response');
}

function recordAudibleSecond(bridge) {
  return new Promise((resolve, reject) => {
    const targetBytes = 48000 * 2 * 4;
    let started = false;
    let bytes = 0;
    let peak = 0;
    let square = 0;
    const cleanup = () => { clearTimeout(timer); bridge.off('pcm', onPcm); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Onward test input produced no audible output')); }, 8000);
    const onPcm = chunk => {
      for (let offset = 0; offset < chunk.length && bytes < targetBytes; offset += 4) {
        const sample = chunk.readFloatLE(offset);
        if (!started && Math.abs(sample) <= 0.005) continue;
        started = true;
        peak = Math.max(peak, Math.abs(sample));
        square += sample * sample;
        bytes += 4;
      }
      if (bytes === targetBytes) {
        cleanup();
        const rms = Math.sqrt(square / (bytes / 4));
        if (rms < 0.001) reject(new Error('Onward audio level too low'));
        else resolve({ frames: bytes / 8, peak, rms });
      }
    };
    bridge.on('pcm', onPcm);
  });
}

async function waitForQuietBaseline(bridge) {
  let quietWindows = 0;
  const deadline = Date.now() + 20000;
  while (quietWindows < 2 && Date.now() < deadline) {
    const chunks = [];
    const onPcm = chunk => chunks.push(Buffer.from(chunk));
    bridge.on('pcm', onPcm);
    await delay(1000);
    bridge.off('pcm', onPcm);
    const pcm = Buffer.concat(chunks);
    if (!pcm.length) throw new Error('Onward audio stream is missing');
    let square = 0;
    for (let offset = 0; offset < pcm.length; offset += 4) square += pcm.readFloatLE(offset) ** 2;
    const rms = Math.sqrt(square / (pcm.length / 4));
    quietWindows = rms < 0.0005 ? quietWindows + 1 : 0;
  }
  if (quietWindows < 2) throw new Error('Norns startup audio did not settle to silence');
}

export async function runOnwardScenario({ onwardDir = process.env.NORN_LAB_ONWARD_DIR || path.resolve(root, '../onward-norns'), artifactRoot = path.join(root, 'artifacts') } = {}) {
  await fs.access(path.join(onwardDir, 'onward_norns.lua'));
  await fs.access(path.join(onwardDir, 'lib/Engine_OnwardGrain.sc'));
  const runId = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const artifactDir = path.join(artifactRoot, `onward-${runId}`);
  const frameDir = path.join(artifactDir, 'runtime-frames');
  await fs.mkdir(frameDir, { recursive: true });
  const report = { runId, script: 'onward', source: onwardDir, result: 'failed', frames: [] };
  const bridge = new AudioBridge();
  let runtime;
  let app;
  let ws;
  try {
    const address = await bridge.listen(0);
    runtime = new Runtime({ frameDir, onwardDir, audioPort: address.port });
    await runtime.start();
    app = createAppServer({ runtime, frameDir, audioBridge: bridge, frameIntervalMs: 150 });
    const webAddress = await app.listen(0);
    ws = new WebSocket(`ws://127.0.0.1:${webAddress.port}`);
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const messages = [];
    ws.on('message', (raw, binary) => { if (!binary) messages.push(JSON.parse(String(raw))); });
    const loadLogIndex = runtime.lines.length;
    ws.send(JSON.stringify({ type: 'load', script: 'onward' }));
    await waitFor(messages, message => message.type === 'status' && message.state === 'script-ready' && message.script === 'onward', 35000);
    const page = async marker => {
      const from = runtime.lines.length;
      runtime.sendLua(`local p=nil; for i=1,32 do local n,v=debug.getupvalue(enc,i); if n=="page" then p=v; break end end; print("${marker}"..tostring(p))`);
      const line = await runtime.waitForLine(value => value.includes(marker), 3000, from);
      const match = line.match(new RegExp(`${marker}(\\d+)`));
      if (!match) throw new Error(`Invalid Onward page response: ${line}`);
      return Number(match[1]);
    };
    const saveFrame = async (name, afterSequence) => {
      const frame = await waitFor(messages, message => message.type === 'frame' && message.sequence > afterSequence);
      const response = await fetch(`http://127.0.0.1:${webAddress.port}${frame.url}`);
      if (!response.ok) throw new Error(`Onward frame HTTP ${response.status}`);
      await fs.writeFile(path.join(artifactDir, name), Buffer.from(await response.arrayBuffer()));
      report.frames.push(name);
      return frame.sequence;
    };
    report.pages = [await page('__NL_ONWARD_PAGE_1:')];
    let sequence = await saveFrame('onward-live.png', 0);
    ws.send(JSON.stringify({ type: 'encoder', n: 1, delta: 1 }));
    let nextPage;
    for (let attempt = 0; attempt < 20; attempt++) {
      nextPage = await page(`__NL_ONWARD_PAGE_2_${attempt}:`);
      if (nextPage === 2) break;
      await delay(50);
    }
    report.pages.push(nextPage);
    sequence = await saveFrame('onward-freeze.png', sequence);
    if (report.pages[0] !== 1 || report.pages[1] !== 2) throw new Error(`Onward page change failed: ${report.pages}`);
    await waitForQuietBaseline(bridge);
    const audio = recordAudibleSecond(bridge);
    const tone = runtime.playTestTone();
    [report.audio] = await Promise.all([audio, tone]);
    const statusFrom = runtime.lines.length;
    runtime.sendLua('onward_status()');
    const freeze = await runtime.waitForLine(line => /freeze enabled=true.*selections=[1-9]/.test(line), 3000, statusFrom);
    const glitch = await runtime.waitForLine(line => /glitch enabled=true.*selections=[1-9]/.test(line), 3000, statusFrom);
    report.selections = { freeze, glitch };
    const error = runtime.lines.slice(loadLogIndex).find(line => /### SCRIPT ERROR|ERROR:/.test(line));
    if (error) throw new Error(`Onward runtime error: ${error}`);
    report.result = 'passed';
  } catch (error) {
    report.error = error.message;
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(artifactDir, 'report.json'), JSON.stringify(report, null, 2));
    await fs.writeFile(path.join(artifactDir, 'runtime.log'), `${runtime?.lines.join('\n') || ''}\n`);
    ws?.terminate();
    await app?.close();
    await runtime?.stop();
    await bridge.close();
    await fs.rm(frameDir, { recursive: true, force: true });
  }
  return { artifactDir, report };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await runOnwardScenario();
    console.log(`Onward verification passed: ${result.artifactDir}`);
  } catch (error) {
    console.error(`Onward verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
