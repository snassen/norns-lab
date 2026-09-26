import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { Runtime } from '../src/runtime.js';
import { createAppServer } from '../src/server.js';

const fixture = fileURLToPath(new URL('./fixtures/fake-norns.mjs', import.meta.url));

test('browser protocol drives OSC and receives a fresh native frame', async () => {
  const frameDir = await fs.mkdtemp(path.join(os.tmpdir(), 'norns-lab-server-'));
  const udp = dgram.createSocket('udp4');
  await new Promise(resolve => udp.bind(0, '127.0.0.1', resolve));
  const runtime = new Runtime({ command: process.execPath, args: [fixture], frameDir, containerFrameDir: frameDir, startupTimeoutMs: 1000 });
  await runtime.start();
  const app = createAppServer({ runtime, frameDir, controlPort: udp.address().port, frameIntervalMs: 50 });
  const address = await app.listen(0);
  const messages = [];
  const ws = new WebSocket(`ws://127.0.0.1:${address.port}`);
  ws.on('message', raw => messages.push(JSON.parse(String(raw))));
  const openPromise = new Promise(resolve => ws.once('open', resolve));
  try {
    const foreign = new WebSocket(`ws://127.0.0.1:${address.port}`, { origin: 'https://foreign.example' });
    const foreignResult = await new Promise(resolve => {
      foreign.once('unexpected-response', (_, response) => resolve(response.statusCode));
      foreign.once('open', () => resolve(101));
    });
    assert.equal(foreignResult, 403);
    await openPromise;
    const packetPromise = new Promise(resolve => udp.once('message', resolve));
    ws.send(JSON.stringify({ type: 'encoder', n: 1, delta: 1 }));
    const packet = await packetPromise;
    assert.equal(packet.subarray(0, 12).toString('utf8'), '/remote/enc\0');
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
    ws.send(JSON.stringify({ type: 'inspect' }));
    const stateDeadline = Date.now() + 1000;
    while (!messages.some(message => message.type === 'state') && Date.now() < stateDeadline) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.deepEqual(messages.find(message => message.type === 'state'), { type: 'state', mode: 1, edit_ch: 1 });
  } finally {
    ws.close();
    await app.close();
    await runtime.stop();
    udp.close();
    await fs.rm(frameDir, { recursive: true, force: true });
  }
});
