import fs from 'node:fs/promises';
import readline from 'node:readline';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAIAAAABACAYAAADDPmHLAAAABmJLR0QA/wD/AP+gvaeTAAAAGklEQVR4nO3BMQEAAADCoPVPbQhfoAAAAAAAAIAb4DgAAQzFV4EAAAAASUVORK5CYII=', 'base64');
let mode = 1;
let editChannel = 1;
console.log('NORN_LAB_READY');
if (process.env.FAKE_EXIT_AFTER_READY) setTimeout(() => process.exit(7), 50);
const input = readline.createInterface({ input: process.stdin });
input.on('line', async line => {
  if (line.includes('norns.script.load')) console.log('# script init');
  const encoder = line.match(/norns\.encoders\.callback\((\d+),(-?\d+)\)/);
  if (encoder && Number(encoder[1]) === 1) mode = Math.max(1, Math.min(4, mode + Number(encoder[2])));
  const key = line.match(/_norns\.key\((\d+),(\d+)\)/);
  if (key && Number(key[1]) === 2 && Number(key[2]) === 1 && mode === 1) editChannel = editChannel === 1 ? 2 : 1;
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
