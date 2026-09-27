import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { Runtime } from '../src/runtime.js';
import { createAppServer } from '../src/server.js';
import { AudioBridge } from '../src/audio-bridge.js';

const fixture = fileURLToPath(new URL('./fixtures/fake-norns.mjs', import.meta.url));

test('browser protocol drives norns controls and receives a fresh native frame', async () => {
  const frameDir = await fs.mkdtemp(path.join(os.tmpdir(), 'norns-lab-server-'));
  const runtime = new Runtime({ command: process.execPath, args: [fixture], frameDir, containerFrameDir: frameDir, startupTimeoutMs: 1000 });
  await runtime.start();
  const audioBridge = new AudioBridge();
  const audioAddress = await audioBridge.listen(0);
  const app = createAppServer({ runtime, frameDir, audioBridge, frameIntervalMs: 50 });
  const address = await app.listen(0);
  const messages = [];
  const audioChunks = [];
  const ws = new WebSocket(`ws://127.0.0.1:${address.port}`);
  ws.on('message', (raw, binary) => binary ? audioChunks.push(Buffer.from(raw)) : messages.push(JSON.parse(String(raw))));
  const openPromise = new Promise(resolve => ws.once('open', resolve));
  try {
    const foreign = new WebSocket(`ws://127.0.0.1:${address.port}`, { origin: 'https://foreign.example' });
    const foreignResult = await new Promise(resolve => {
      foreign.once('unexpected-response', (_, response) => resolve(response.statusCode));
      foreign.once('open', () => resolve(101));
    });
    assert.equal(foreignResult, 403);
    await openPromise;
    ws.send(JSON.stringify({ type: 'load', script: 'awake' }));
    const deadline = Date.now() + 2000;
    while (!messages.some(message => message.type === 'frame') && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const frame = messages.find(message => message.type === 'frame');
    assert.ok(frame, 'a frame event arrived');
    const response = await fetch(`http://127.0.0.1:${address.port}${frame.url}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal((await response.arrayBuffer()).byteLength > 24, true);
    const missing = await fetch(`http://127.0.0.1:${address.port}/frames/999999.png`);
    assert.equal(missing.status, 404);
    ws.send(JSON.stringify({ type: 'encoder', n: 1, delta: 1 }));
    ws.send(JSON.stringify({ type: 'inspect' }));
    const stateDeadline = Date.now() + 1000;
    while (!messages.some(message => message.type === 'state') && Date.now() < stateDeadline) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.deepEqual(messages.find(message => message.type === 'state'), { type: 'state', mode: 2, edit_ch: 1 });
    ws.send(JSON.stringify({ type: 'audio', enabled: true }));
    const subscriptionDeadline = Date.now() + 1000;
    while (!messages.some(message => message.type === 'audio-subscription' && message.enabled) && Date.now() < subscriptionDeadline) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(messages.some(message => message.type === 'audio-subscription' && message.enabled));
    const source = net.createConnection(audioAddress.port, '127.0.0.1');
    await new Promise(resolve => source.once('connect', resolve));
    const pcm = Buffer.alloc(8);
    pcm.writeFloatLE(0.5, 0);
    pcm.writeFloatLE(-0.5, 4);
    source.write(pcm);
    const audioDeadline = Date.now() + 1000;
    while (!audioChunks.length && Date.now() < audioDeadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(audioChunks[0], pcm);
    source.destroy();
  } finally {
    ws.close();
    await app.close();
    await runtime.stop();
    await audioBridge.close();
    await fs.rm(frameDir, { recursive: true, force: true });
  }
});
