import net from 'node:net';
import { spawn } from 'node:child_process';
import path from 'node:path';

const port = Number(process.env.PORT || 3000);

function canConnect(host, targetPort) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port: targetPort, timeout: 1_000 });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function main() {
  const inUse = await canConnect('127.0.0.1', port) || await canConnect('localhost', port);
  if (inUse) {
    console.error(`Port ${port} is already in use.`);
    console.error('Stop the existing Fleet360 dev server first, then run npm run dev again.');
    console.error('PowerShell helper: Get-NetTCPConnection -LocalPort 3000 | Select-Object OwningProcess');
    process.exit(1);
  }

  const nextBin = path.join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');
  const child = spawn(process.execPath, [nextBin, 'dev', '--turbopack', '-p', String(port)], {
    stdio: 'inherit',
    shell: false,
  });

  child.on('exit', code => {
    process.exit(code ?? 0);
  });
}

main().catch(err => {
  console.error('Failed to start Fleet360 dev server:', err);
  process.exit(1);
});
