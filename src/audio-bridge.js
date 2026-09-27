import net from 'node:net';
import { EventEmitter } from 'node:events';

// ffmpeg in the runtime sends interleaved stereo f32le at 48 kHz here. Keep
// complete stereo frames before forwarding a TCP chunk to WebSocket clients.
export class AudioBridge extends EventEmitter {
  constructor() {
    super();
    this.source = null;
    this.remainder = Buffer.alloc(0);
    this.server = net.createServer(socket => {
      this.source?.destroy();
      this.source = socket;
      this.remainder = Buffer.alloc(0);
      this.emit('status', { connected: true });
      socket.on('data', chunk => {
        const data = this.remainder.length ? Buffer.concat([this.remainder, chunk]) : chunk;
        const alignedLength = data.length - (data.length % 8);
        if (alignedLength) this.emit('pcm', data.subarray(0, alignedLength));
        this.remainder = Buffer.from(data.subarray(alignedLength));
      });
      socket.on('close', () => {
        if (this.source !== socket) return;
        this.source = null;
        this.remainder = Buffer.alloc(0);
        this.emit('status', { connected: false });
      });
      socket.on('error', error => this.emit('status', { connected: false, error: error.message }));
    });
  }

  async listen(port = 5152) {
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, '127.0.0.1', () => {
        this.server.off('error', reject);
        resolve();
      });
    });
    return this.server.address();
  }

  async close() {
    this.source?.destroy();
    if (!this.server.listening) return;
    await new Promise(resolve => this.server.close(resolve));
  }
}
