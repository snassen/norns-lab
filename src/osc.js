import dgram from 'node:dgram';

function oscString(value) {
  const data = Buffer.from(`${value}\0`, 'utf8');
  const padded = Buffer.alloc(Math.ceil(data.length / 4) * 4);
  data.copy(padded);
  return padded;
}

export function encodeOsc(path, values) {
  if (!/^\/[a-z/]+$/.test(path) || !Array.isArray(values)
      || !values.every(value => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647)) {
    throw new Error('Invalid OSC path or integer arguments');
  }
  const packet = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => packet.writeInt32BE(value, index * 4));
  return Buffer.concat([oscString(path), oscString(`,${'i'.repeat(values.length)}`), packet]);
}

export async function sendControl(message, { port = 10111 } = {}) {
  if (message.type !== 'key' && message.type !== 'encoder') throw new Error('Unsupported OSC control');
  const path = message.type === 'key' ? '/remote/key' : '/remote/enc';
  const value = message.type === 'key' ? message.z : message.delta;
  const packet = encodeOsc(path, [message.n, value]);
  const socket = dgram.createSocket('udp4');
  try {
    await new Promise((resolve, reject) => {
      socket.send(packet, port, '127.0.0.1', error => error ? reject(error) : resolve());
    });
  } finally {
    socket.close();
  }
}
