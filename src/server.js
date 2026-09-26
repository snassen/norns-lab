import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { parseClientMessage } from './protocol.js';
import { sendControl } from './osc.js';
import { Runtime } from './runtime.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, '../web');

export function createAppServer({ runtime, frameDir, controlPort = 10111, frameIntervalMs = 200 }) {
  let scriptReady = false;
  let capturing = false;
  const clients = new Set();
  const broadcast = message => {
    const data = JSON.stringify(message);
    for (const client of clients) if (client.readyState === WebSocket.OPEN) client.send(data);
  };

  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const asset = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] }[pathname];
    const frame = pathname.match(/^\/frames\/(\d+)\.png$/);
    try {
      if (asset) {
        const data = await fs.readFile(path.join(webDir, asset[0]));
        response.writeHead(200, { 'content-type': asset[1], 'cache-control': 'no-store' });
        response.end(data);
      } else if (frame) {
        const filename = `frame-${frame[1].padStart(6, '0')}.png`;
        const data = await fs.readFile(path.join(frameDir, filename));
        response.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
        response.end(data);
      } else {
        response.writeHead(404);
        response.end('Not found');
      }
    } catch (error) {
      if (!response.headersSent) response.writeHead(error.code === 'ENOENT' ? 404 : 500);
      response.end(error.code === 'ENOENT' ? 'Not found' : 'Read failed');
    }
  });
  const wss = new WebSocketServer({
    server,
    verifyClient: ({ origin }, done) => {
      const allowed = !origin || origin === `http://127.0.0.1:${server.address()?.port}`;
      done(allowed, allowed ? undefined : 403, allowed ? undefined : 'Forbidden');
    }
  });
  runtime.on('status', status => broadcast({ type: 'status', ...status }));
  wss.on('connection', client => {
    clients.add(client);
    client.send(JSON.stringify({ type: 'status', state: scriptReady ? 'script-ready' : 'ready' }));
    client.on('close', () => clients.delete(client));
    client.on('message', async raw => {
      try {
        const message = parseClientMessage(raw);
        if (message.type === 'load') {
          await runtime.loadAwake();
          scriptReady = true;
        } else if (message.type === 'inspect') {
          client.send(JSON.stringify({ type: 'state', ...await runtime.probeAwake() }));
        } else {
          await sendControl(message, { port: controlPort });
        }
      } catch (error) {
        client.send(JSON.stringify({ type: 'error', message: error.message }));
      }
    });
  });
  const timer = setInterval(async () => {
    if (!scriptReady || capturing || clients.size === 0) return;
    capturing = true;
    try {
      const frame = await runtime.captureFrame();
      broadcast({ type: 'frame', sequence: frame.sequence, time: frame.time, url: `/frames/${frame.sequence}.png` });
    } catch (error) {
      broadcast({ type: 'status', state: 'failed', error: error.message });
    } finally {
      capturing = false;
    }
  }, frameIntervalMs);

  return {
    async listen(port = 5151) {
      await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', error => error ? reject(error) : resolve()));
      return server.address();
    },
    async close() {
      clearInterval(timer);
      for (const client of clients) client.terminate();
      await new Promise(resolve => wss.close(resolve));
      await new Promise(resolve => server.close(resolve));
    }
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const frameDir = await fs.mkdtemp(path.join(os.tmpdir(), 'norns-lab-'));
  const runtime = new Runtime({ frameDir });
  let app;
  const shutdown = async () => {
    await app?.close();
    await runtime.stop();
    await fs.rm(frameDir, { recursive: true, force: true });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  try {
    await runtime.start();
    app = createAppServer({ runtime, frameDir });
    const address = await app.listen();
    console.log(`Norns Lab: http://127.0.0.1:${address.port}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    await shutdown();
  }
}
