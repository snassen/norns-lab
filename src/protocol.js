export function parseClientMessage(raw) {
  let message;
  try {
    message = JSON.parse(String(raw));
  } catch {
    throw new Error('Invalid JSON message');
  }
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw new Error('Message must be an object');
  }

  const control = Number.isInteger(message.n) && message.n >= 1 && message.n <= 3;
  if (message.type === 'key' && control && (message.z === 0 || message.z === 1)) {
    return { type: 'key', n: message.n, z: message.z };
  }
  if (message.type === 'encoder' && control && Number.isInteger(message.delta)
    && message.delta !== 0 && Math.abs(message.delta) <= 64) {
    return { type: 'encoder', n: message.n, delta: message.delta };
  }
  if (message.type === 'load' && message.script === 'awake') {
    return { type: 'load', script: 'awake' };
  }
  if (message.type === 'inspect') return { type: 'inspect' };
  throw new Error('Unsupported norns command or invalid control value');
}
