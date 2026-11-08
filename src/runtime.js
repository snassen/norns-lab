import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

// JACK needs more shared memory than Docker's 64 MB default and permission to
// lock memory and use realtime priority. Without these jackd dies with a bus
// error on a Raspberry Pi 5 (Debian trixie, Docker 26).
export const REALTIME_AUDIO_ARGS = ['--shm-size=256m', '--ulimit', 'memlock=-1:-1', '--ulimit', 'rtprio=95', '--cap-add', 'SYS_NICE'];

const pngHeader = Buffer.from('89504e470d0a1a0a', 'hex');
const pngEnd = Buffer.from('0000000049454e44ae426082', 'hex');
const completePng = data => data?.length >= 36
  && data.subarray(0, 8).equals(pngHeader)
  && data.subarray(-12).equals(pngEnd);

export class Runtime extends EventEmitter {
  constructor({ command = 'docker', args, frameDir, containerFrameDir = '/frames', startupTimeoutMs = 30000, audioPort = 0, onwardDir } = {}) {
    super();
    if (!frameDir) throw new Error('frameDir is required');
    if (!Number.isInteger(audioPort) || audioPort < 0 || audioPort > 65535) throw new Error('Invalid audio receiver port');
    this.command = command;
    this.onwardDir = onwardDir;
    this.containerName = args ? null : `norns-lab-${randomUUID()}`;
    this.args = args ?? ['run', '--name', this.containerName, '-i', '--rm', ...REALTIME_AUDIO_ARGS, '-e', `NORN_LAB_AUDIO_PORT=${audioPort}`, '-v', `${frameDir}:/frames`, ...(onwardDir ? ['-v', `${onwardDir}:/home/we/dust/code/onward_norns:ro`] : []), 'norns-lab-runtime'];
    this.frameDir = frameDir;
    this.containerFrameDir = containerFrameDir;
    this.startupTimeoutMs = startupTimeoutMs;
    this.child = null;
    this.lines = [];
    this.sequence = 0;
    this.probeSequence = 0;
    this.ready = false;
    this.stopping = false;
  }

  async start() {
    if (this.child) throw new Error('Runtime already started');
    await fs.mkdir(this.frameDir, { recursive: true });
    this.stopping = false;
    this.ready = false;
    this.child = spawn(this.command, this.args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.on('close', code => {
      if (this.ready && !this.stopping) {
        this.emit('status', { state: 'failed', error: `Runtime exited (code ${code})` });
      }
    });
    for (const stream of [this.child.stdout, this.child.stderr]) {
      readline.createInterface({ input: stream }).on('line', line => {
        this.lines.push(line);
        if (this.lines.length > 2000) this.lines.shift();
        this.emit('line', line);
      });
    }
    try {
      await this.waitForLine(line => line.includes('NORN_LAB_READY'), this.startupTimeoutMs, 0);
      this.ready = true;
      this.emit('status', { state: 'ready' });
    } catch (error) {
      this.emit('status', { state: 'failed', error: error.message });
      throw error;
    }
  }

  waitForLine(predicate, timeoutMs, startIndex = this.lines.length) {
    return new Promise((resolve, reject) => {
      for (const line of this.lines.slice(startIndex)) {
        if (predicate(line)) return resolve(line);
      }
      const timer = setTimeout(() => finish(new Error('Runtime readiness timeout')), timeoutMs);
      const onLine = line => { if (predicate(line)) finish(null, line); };
      const onClose = code => finish(new Error(`Runtime exited before response (code ${code})`));
      const onError = error => finish(error);
      const finish = (error, result) => {
        clearTimeout(timer);
        this.off('line', onLine);
        this.child?.off('close', onClose);
        this.child?.off('error', onError);
        error ? reject(error) : resolve(result);
      };
      this.on('line', onLine);
      this.child?.once('close', onClose);
      this.child?.once('error', onError);
    });
  }

  sendLua(code) {
    if (!this.child || this.child.exitCode !== null || !this.child.stdin.writable) {
      throw new Error('Runtime is not running');
    }
    this.child.stdin.write(`${code}\n`);
  }

  sendControl(message) {
    if (message.type === 'key') this.sendLua(`_norns.key(${message.n},${message.z})`);
    else if (message.type === 'encoder') this.sendLua(`norns.encoders.callback(${message.n},${message.delta})`);
    else throw new Error('Unsupported norns control');
  }

  async loadScript(script) {
    const scriptPaths = {
      awake: '/home/we/dust/code/awake/awake.lua',
      onward: '/home/we/dust/code/onward_norns/onward_norns.lua'
    };
    if (!Object.hasOwn(scriptPaths, script)) throw new Error(`Unknown script: ${script}`);
    if (script === 'onward' && !this.onwardDir && this.containerName) throw new Error('Onward source folder is unavailable');
    const startIndex = this.lines.length;
    this.sendLua(`norns.script.load(${JSON.stringify(scriptPaths[script])})`);
    await this.waitForLine(line => line.includes('# script init'), 30000, startIndex);
    this.emit('status', { state: 'script-ready', script });
  }

  async loadAwake() {
    await this.loadScript('awake');
  }

  async playTestTone({ frequency = 440, toneMs = 500, totalMs = 2000 } = {}) {
    if (!this.containerName || !this.ready) throw new Error('Test tone requires a running Docker runtime');
    if (![frequency, toneMs, totalMs].every(Number.isInteger)) throw new Error('Invalid test tone arguments');
    await new Promise((resolve, reject) => {
      const child = spawn(this.command, ['exec', '--user', 'we', this.containerName, '/usr/local/bin/norns-lab-tone', String(frequency), String(toneMs), String(totalMs)], { stdio: ['ignore', 'ignore', 'pipe'] });
      let errors = '';
      child.stderr.on('data', chunk => { errors += chunk; });
      child.once('error', reject);
      child.once('close', code => code === 0 ? resolve() : reject(new Error(`Test tone failed: ${errors.trim() || `exit ${code}`}`)));
    });
  }

  async captureFrame({ timeoutMs = 3000 } = {}) {
    const sequence = ++this.sequence;
    const filename = `frame-${String(sequence).padStart(6, '0')}.png`;
    const hostPath = path.join(this.frameDir, filename);
    const runtimePath = path.posix.join(this.containerFrameDir, filename);
    this.sendLua(`_norns.screen_export_png(${JSON.stringify(runtimePath)})`);
    const deadline = Date.now() + timeoutMs;
    let data;
    while (Date.now() < deadline) {
      try {
        data = await fs.readFile(hostPath);
        if (completePng(data)) break;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    if (!completePng(data)) {
      throw new Error(`Frame ${sequence} export timeout`);
    }
    const width = data.readUInt32BE(16);
    const height = data.readUInt32BE(20);
    if (width !== 128 || height !== 64) throw new Error(`Unexpected frame size ${width}×${height}`);
    return { sequence, path: hostPath, width, height, time: new Date().toISOString() };
  }

  async probeAwake() {
    const marker = `__NL_STATE_${++this.probeSequence}:`;
    const startIndex = this.lines.length;
    // Awake keeps edit_ch local to its script. Read the captured value from its
    // real key handler, leaving the reference script and its state untouched.
    this.sendLua(`local __nl_ch=nil; for __nl_i=1,32 do local __nl_name,__nl_value=debug.getupvalue(key,__nl_i); if __nl_name=="edit_ch" then __nl_ch=__nl_value; break end end; print("${marker}"..tostring(mode)..":"..tostring(__nl_ch))`);
    const line = await this.waitForLine(value => value.includes(marker), 3000, startIndex);
    const match = line.match(new RegExp(`${marker}(\\d+):(\\d+)`));
    if (!match) throw new Error(`Invalid Awake state response: ${line}`);
    return { mode: Number(match[1]), edit_ch: Number(match[2]) };
  }

  async stop() {
    if (!this.child) return;
    const child = this.child;
    this.child = null;
    this.stopping = true;
    if (this.containerName) {
      // Stopping the Docker CLI alone can leave its container running. Remove
      // the named instance so subsequent runs start from a clean state.
      await new Promise(resolve => {
        const cleanup = spawn(this.command, ['rm', '-f', this.containerName], { stdio: 'ignore' });
        cleanup.once('error', resolve);
        cleanup.once('close', resolve);
      });
    }
    if (child.exitCode !== null) return;
    const closed = new Promise(resolve => child.once('close', () => resolve(true)));
    child.kill('SIGTERM');
    let timer;
    const exited = await Promise.race([closed, new Promise(resolve => { timer = setTimeout(() => resolve(false), 1500); })]);
    clearTimeout(timer);
    if (!exited && child.exitCode === null) child.kill('SIGKILL');
  }
}
