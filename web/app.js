const status = document.querySelector('#status');
const error = document.querySelector('#error');
const screen = document.querySelector('#screen');
const ws = new WebSocket(`ws://${location.host}`);
const heldKeys = new Set();

function send(message) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

ws.addEventListener('open', () => { status.textContent = 'Connected'; });
ws.addEventListener('close', () => { status.textContent = 'Disconnected'; });
ws.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.type === 'status') status.textContent = message.state === 'failed' ? `Failed: ${message.error}` : message.state;
  if (message.type === 'error') error.textContent = message.message;
  if (message.type === 'frame') screen.src = `${message.url}?seq=${message.sequence}`;
});

document.querySelector('#load').addEventListener('click', () => {
  error.textContent = '';
  send({ type: 'load', script: 'awake' });
});

for (const button of document.querySelectorAll('[data-key]')) {
  const n = Number(button.dataset.key);
  const release = () => {
    if (!heldKeys.delete(n)) return;
    button.classList.remove('pressed');
    send({ type: 'key', n, z: 0 });
  };
  button.addEventListener('pointerdown', event => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    if (heldKeys.has(n)) return;
    heldKeys.add(n);
    button.classList.add('pressed');
    send({ type: 'key', n, z: 1 });
  });
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', release);
}

for (const button of document.querySelectorAll('[data-encoder]')) {
  const n = Number(button.dataset.encoder);
  button.addEventListener('wheel', event => {
    event.preventDefault();
    send({ type: 'encoder', n, delta: event.deltaY < 0 ? 1 : -1 });
  }, { passive: false });
  button.addEventListener('click', () => send({ type: 'encoder', n, delta: 1 }));
  button.addEventListener('contextmenu', event => {
    event.preventDefault();
    send({ type: 'encoder', n, delta: -1 });
  });
}
