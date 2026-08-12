import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const ports = [3000, 3001];
const root = process.cwd();
const nextDir = path.join(root, '.next');

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const done = (result) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(400);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function removeWithRetry(target) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
}

const activePorts = [];
for (const port of ports) {
  if (await canConnect(port)) activePorts.push(port);
}

if (activePorts.length) {
  console.error(
    `[dev:clean] A local dev server appears to be running on port(s): ${activePorts.join(', ')}.`,
  );
  console.error('[dev:clean] Stop it with Ctrl+C first, then run npm run dev:clean again.');
  console.error('[dev:clean] This prevents deleting .next while Next is still serving stale chunks.');
  process.exit(1);
}

await removeWithRetry(nextDir);
console.log('[dev:clean] Removed .next successfully.');
