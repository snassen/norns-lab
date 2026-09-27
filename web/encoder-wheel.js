// A trackpad gesture emits many wheel events. Dispatch its first direction and
// wait until the stream has been idle before accepting another gesture.
export function createWheelStepper(send, { idleMs = 220, schedule = setTimeout, cancel = clearTimeout } = {}) {
  let idleTimer;
  return event => {
    event.preventDefault();
    if (event.deltaY === 0) return;
    if (idleTimer === undefined) send(event.deltaY < 0 ? 1 : -1);
    if (idleTimer !== undefined) cancel(idleTimer);
    idleTimer = schedule(() => { idleTimer = undefined; }, idleMs);
  };
}
