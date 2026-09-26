import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { encodeOsc, sendControl } from '../src/osc.js';

test('encodes a typed OSC message for norns remote control', () => {
  const packet = encodeOsc('/remote/enc', [1, -2]);
  assert.equal(packet.subarray(0, 12).toString('utf8'), '/remote/enc\0');
  assert.equal(packet.subarray(12, 16).toString('utf8'), ',ii\0');
  assert.equal(packet.readInt32BE(16), 1);
  assert.equal(packet.readInt32BE(20), -2);
});

test('sends controls only to the selected local UDP destination', async () => {
  const server = dgram.createSocket('udp4');
  await new Promise(resolve => server.bind(0, '127.0.0.1', resolve));
  try {
    const received = new Promise(resolve => server.once('message', resolve));
    await sendControl({ type: 'key', n: 3, z: 1 }, { port: server.address().port });
    const packet = await received;
    assert.equal(packet.subarray(0, 12).toString('utf8'), '/remote/key\0');
    assert.equal(packet.readInt32BE(16), 3);
    assert.equal(packet.readInt32BE(20), 1);
  } finally {
    server.close();
  }
});

test('does not turn unsupported commands into encoder OSC', async () => {
  await assert.rejects(sendControl({ type: 'load', script: 'awake' }), /control/);
});
