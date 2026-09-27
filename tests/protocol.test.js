import test from 'node:test';
import assert from 'node:assert/strict';
import { parseClientMessage } from '../src/protocol.js';

test('accepts real norns key press and release', () => {
  assert.deepEqual(parseClientMessage('{"type":"key","n":2,"z":1}'), { type: 'key', n: 2, z: 1 });
  assert.deepEqual(parseClientMessage('{"type":"key","n":2,"z":0}'), { type: 'key', n: 2, z: 0 });
});

test('accepts signed encoder steps and Awake load', () => {
  assert.deepEqual(parseClientMessage('{"type":"encoder","n":1,"delta":-1}'), { type: 'encoder', n: 1, delta: -1 });
  assert.deepEqual(parseClientMessage('{"type":"load","script":"awake"}'), { type: 'load', script: 'awake' });
  assert.deepEqual(parseClientMessage('{"type":"inspect"}'), { type: 'inspect' });
  assert.deepEqual(parseClientMessage('{"type":"audio","enabled":true}'), { type: 'audio', enabled: true });
  assert.deepEqual(parseClientMessage('{"type":"load","script":"onward"}'), { type: 'load', script: 'onward' });
  assert.deepEqual(parseClientMessage('{"type":"test-tone"}'), { type: 'test-tone' });
  assert.deepEqual(parseClientMessage('{"type":"matron","code":"onward_status()"}'), { type: 'matron', code: 'onward_status()' });
});

test('rejects invalid control numbers, values and extra commands', () => {
  for (const message of [
    '{"type":"key","n":0,"z":1}',
    '{"type":"key","n":4,"z":1}',
    '{"type":"key","n":2,"z":2}',
    '{"type":"encoder","n":1,"delta":0}',
    '{"type":"encoder","n":1,"delta":1.5}',
    '{"type":"encoder","n":1,"delta":1000}',
    '{"type":"load","script":"../../other"}',
    '{"type":"audio","enabled":"yes"}',
    '{"type":"matron","code":"print(1)\\nprint(2)"}',
    '{"type":"eval","code":"os.execute(1)"}',
    'garbage'
  ]) assert.throws(() => parseClientMessage(message));
});
