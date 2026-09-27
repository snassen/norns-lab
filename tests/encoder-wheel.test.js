import test from 'node:test';
import assert from 'node:assert/strict';
import { createWheelStepper } from '../web/encoder-wheel.js';

test('a burst of wheel events moves one step and the next gesture moves one step', () => {
  const steps = [];
  const timers = new Map();
  let nextTimer = 0;
  const handler = createWheelStepper(step => steps.push(step), {
    schedule(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
    cancel(id) { timers.delete(id); }
  });
  const event = deltaY => ({ deltaY, preventDefault() {} });
  handler(event(20));
  handler(event(12));
  handler(event(-3));
  assert.deepEqual(steps, [-1]);
  assert.equal(timers.size, 1);
  [...timers.values()][0]();
  handler(event(-5));
  assert.deepEqual(steps, [-1, 1]);
});
