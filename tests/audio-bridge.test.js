import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { AudioBridge } from '../src/audio-bridge.js';

test('audio bridge forwards complete stereo float frames across TCP chunk boundaries', async () => {
  const bridge = new AudioBridge();
  const address = await bridge.listen(0);
  const received = [];
  bridge.on('pcm', chunk => received.push(Buffer.from(chunk)));
  const source = net.createConnection(address.port, '127.0.0.1');
  await new Promise(resolve => source.once('connect', resolve));
  const samples = Buffer.alloc(16);
  samples.writeFloatLE(0.25, 0);
  samples.writeFloatLE(-0.25, 4);
  samples.writeFloatLE(0.5, 8);
  samples.writeFloatLE(-0.5, 12);
  try {
    source.write(samples.subarray(0, 3));
    await new Promise(resolve => setTimeout(resolve, 10));
    source.write(samples.subarray(3));
    const deadline = Date.now() + 1000;
    while (Buffer.concat(received).length < 16 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.deepEqual(Buffer.concat(received), samples);
    assert.ok(received.every(chunk => chunk.length % 8 === 0));
  } finally {
    source.destroy();
    await bridge.close();
  }
});
