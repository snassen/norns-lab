import { createWheelStepper } from './encoder-wheel.js';

const status = document.querySelector('#status');
const error = document.querySelector('#error');
const screen = document.querySelector('#screen');
const scriptSelect = document.querySelector('#script');
const matronCode = document.querySelector('#matron-code');
const matronLog = document.querySelector('#matron-log');
const ws = new WebSocket(`ws://${location.host}`);
ws.binaryType = 'arraybuffer';
const heldKeys = new Set();
const audioButton = document.querySelector('#audio-toggle');
const audioStatus = document.querySelector('#audio-status');
let audioContext;
let audioNode;
let audioSourceConnected = false;
let lastMeterAt = 0;

function send(message) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

ws.addEventListener('open', () => { status.textContent = 'Connected'; });
ws.addEventListener('close', () => {
  status.textContent = 'Disconnected';
  audioStatus.textContent = 'Audio disconnected';
});
ws.addEventListener('message', event => {
  if (event.data instanceof ArrayBuffer) {
    if (!audioNode) return;
    const now = performance.now();
    if (now - lastMeterAt > 250) {
      const samples = new Float32Array(event.data);
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      audioStatus.textContent = `Audio live · peak ${peak.toFixed(2)}`;
      lastMeterAt = now;
    }
    audioNode.port.postMessage(event.data, [event.data]);
    return;
  }
  const message = JSON.parse(event.data);
  if (message.type === 'status') status.textContent = message.state === 'failed' ? `Failed: ${message.error}` : message.script ? `${message.script} ready` : message.state;
  if (message.type === 'audio-status') {
    audioSourceConnected = message.connected;
    if (audioContext && !message.connected) audioStatus.textContent = message.error ? `Audio error: ${message.error}` : 'Waiting for norns audio…';
  }
  if (message.type === 'error') {
    error.textContent = message.message;
    document.querySelector('#test-tone').disabled = false;
  }
  if (message.type === 'matron-log') {
    const lines = matronLog.textContent ? matronLog.textContent.split('\n').slice(-119) : [];
    lines.push(message.line);
    matronLog.textContent = lines.join('\n');
    matronLog.scrollTop = matronLog.scrollHeight;
  }
  if (message.type === 'test-tone') document.querySelector('#test-tone').disabled = false;
  if (message.type === 'frame') screen.src = `${message.url}?seq=${message.sequence}`;
});

audioButton.addEventListener('click', async () => {
  if (audioContext) {
    send({ type: 'audio', enabled: false });
    await audioContext.close();
    audioContext = undefined;
    audioNode = undefined;
    audioButton.textContent = 'Start Audio';
    audioStatus.textContent = 'Audio off';
    return;
  }
  let context;
  try {
    context = new AudioContext({ sampleRate: 48000 });
    await context.audioWorklet.addModule('/audio-worklet.js');
    const node = new AudioWorkletNode(context, 'norns-stereo', { outputChannelCount: [2] });
    node.connect(context.destination);
    await context.resume();
    audioContext = context;
    audioNode = node;
    send({ type: 'audio', enabled: true });
    audioButton.textContent = 'Stop Audio';
    audioStatus.textContent = audioSourceConnected ? 'Buffering audio…' : 'Waiting for norns audio…';
  } catch (failure) {
    await context?.close();
    audioStatus.textContent = `Audio error: ${failure.message}`;
  }
});

document.querySelector('#load').addEventListener('click', () => {
  error.textContent = '';
  send({ type: 'load', script: scriptSelect.value });
});

document.querySelector('#test-tone').addEventListener('click', event => {
  error.textContent = '';
  event.currentTarget.disabled = true;
  send({ type: 'test-tone' });
});

document.querySelector('#matron-form').addEventListener('submit', event => {
  event.preventDefault();
  const code = matronCode.value.trim();
  if (!code) return;
  send({ type: 'matron', code });
  matronCode.value = '';
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
  button.addEventListener('wheel', createWheelStepper(delta => send({ type: 'encoder', n, delta })), { passive: false });
  button.addEventListener('click', () => send({ type: 'encoder', n, delta: 1 }));
  button.addEventListener('contextmenu', event => {
    event.preventDefault();
    send({ type: 'encoder', n, delta: -1 });
  });
}

for (const button of document.querySelectorAll('[data-encoder-step]')) {
  const n = Number(button.dataset.encoderStep);
  const delta = Number(button.dataset.delta);
  button.addEventListener('click', () => send({ type: 'encoder', n, delta }));
}
