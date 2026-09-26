import fs from 'node:fs/promises';
import readline from 'node:readline';
import dgram from 'node:dgram';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAIAAAABACAYAAADDPmHLAAAABmJLR0QA/wD/AP+gvaeTAAAAGklEQVR4nO3BMQEAAADCoPVPbQhfoAAAAAAAAIAb4DgAAQzFV4EAAAAASUVORK5CYII=', 'base64');
let mode = 1;
let editChannel = 1;
if (process.env.FAKE_CONTROL_PORT) {
  const udp = dgram.createSocket('udp4');
  udp.on('message', packet => {
    const pathEnd = packet.indexOf(0);
    const path = packet.subarray(0, pathEnd).toString('utf8');
    const argsOffset = Math.ceil((pathEnd + 1) / 4) * 4 + 4;
    const n = packet.readInt32BE(argsOffset);
    const value = packet.readInt32BE(argsOffset + 4);
    if (path === '/remote/enc' && n === 1) mode = Math.max(1, Math.min(4, mode + value));
    if (path === '/remote/key' && n === 2 && value === 1 && mode === 1) editChannel = editChannel === 1 ? 2 : 1;
  });
  await new Promise(resolve => udp.bind(Number(process.env.FAKE_CONTROL_PORT), '127.0.0.1', resolve));
}
console.log('NORN_LAB_READY');
if (process.env.FAKE_EXIT_AFTER_READY) setTimeout(() => process.exit(7), 50);
const input = readline.createInterface({ input: process.stdin });
input.on('line', async line => {
  if (line.includes('norns.script.load')) console.log('# script init');
  const frame = line.match(/screen_export_png\("([^"]+)"\)/);
  if (frame) {
    if (process.env.FAKE_PARTIAL_FRAME_MS) {
      await fs.writeFile(frame[1], png.subarray(0, 24));
      await new Promise(resolve => setTimeout(resolve, Number(process.env.FAKE_PARTIAL_FRAME_MS)));
      await fs.appendFile(frame[1], png.subarray(24));
    } else {
      await fs.writeFile(frame[1], png);
    }
  }
  const probe = line.match(/__NL_STATE_(\d+):/);
  if (probe) console.log(`__NL_STATE_${probe[1]}:${mode}:${editChannel}`);
});
