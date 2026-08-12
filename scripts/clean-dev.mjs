#!/usr/bin/env node
/**
 * scripts/clean-dev.mjs
 *
 * One-shot "kill + wipe + restart" for a stuck dev server.
 *
 * The default `dev:clean` script refuses to run if a dev server is
 * already listening on port 3000/3001, because wiping .next while
 * Next.js is still serving chunks from it can corrupt the next
 * build. But when the dev server IS the broken thing (Turbopack
 * cache corruption, chunk-graph desync, the
 * "Cannot find module '../chunks/ssr/[turbopack]_runtime.js'" error,
 * etc.), you can't stop it cleanly because it's stuck. The trap:
 *   - kill the dev server? You can't easily from a script.
 *   - wipe .next while it's running? Corrupts the next build.
 *   - skip wiping and restart? Same corrupted state returns.
 *
 * This script solves it in four steps:
 *   1. Find whatever is listening on the dev port (Windows: netstat
 *      + taskkill; Unix: fuser -k) and kill it.
 *   2. Also kill any lingering Next.js transform workers (the
 *      "transform.js" sub-processes that hang around after the
 *      parent server is killed).
 *   3. Wait until the port is actually free (up to 5s).
 *   4. Wipe .next (and mobile-app/.next + out for safety) and start
 *      the dev server in the foreground.
 *
 * Cross-platform. No external dependencies. Idempotent — safe to
 * run when nothing is wrong (it just starts a fresh server).
 *
 * Usage:  npm run clean:dev
 */

import { execSync, spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join, resolve } from 'node:path';

const root = resolve(process.cwd());
const isWindows = process.platform === 'win32';
// Default to 3000 (matches `next dev`); the script will also try the
// common fallback 3001 in case a previous dev run fell back to it.
// Override with `DEV_PORT=4000 npm run clean:dev` for a different port.
const PRIMARY_PORT = Number(process.env.DEV_PORT || 3000);
const FALLBACK_PORT = PRIMARY_PORT === 3000 ? 3001 : PRIMARY_PORT + 1;
const PORTS_TO_KILL = [PRIMARY_PORT, FALLBACK_PORT];

function log(msg) {
  process.stdout.write(`[clean:dev] ${msg}\n`);
}

function err(msg) {
  process.stderr.write(`[clean:dev] ${msg}\n`);
}

/** Run a shell command, swallowing non-zero exit codes. */
function tryExec(cmd, opts = {}) {
  try {
    return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...opts });
  } catch {
    return '';
  }
}

// ── 1) Kill anything listening on the dev port ─────────────────────────────
function killPort(port) {
  log(`Killing anything listening on port ${port}…`);
  const pids = new Set();

  if (isWindows) {
    // netstat -ano lists all connections with the owning PID
    // Lines look like:
    //   TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    1234
    const out = tryExec(`netstat -ano | findstr :${port}`);
    for (const line of out.split(/\r?\n/)) {
      // Match LISTENING entries only — the source port column ends in :PORT
      if (!line.includes('LISTENING')) continue;
      const m = line.match(/\s(\d+)\s*$/);
      if (m) pids.add(m[1]);
    }
  } else {
    // lsof -ti tcp:PORT returns the PIDs listening on PORT
    const out = tryExec(`lsof -ti tcp:${port} 2>/dev/null || true`, { shell: '/bin/sh' });
    for (const id of out.split(/\s+/).filter(Boolean)) pids.add(id);
  }

  if (pids.size === 0) {
    log(`  port ${port} is already free`);
    return;
  }

  for (const pid of pids) {
    if (!/^\d+$/.test(pid)) continue;
    if (isWindows) {
      tryExec(`taskkill /F /PID ${pid}`);
    } else {
      tryExec(`kill -9 ${pid}`);
    }
    log(`  killed pid ${pid}`);
  }
}

// ── 2) Kill any lingering Next.js transform workers ────────────────────────
function killNextWorkers() {
  log('Killing lingering Next.js workers…');
  const projectMarker = root.toLowerCase().replace(/\\/g, '\\\\');
  if (isWindows) {
    // wmic returns CSV: Node,PID,...,"CommandLine"
    const out = tryExec(
      `wmic process where "name='node.exe'" get processid,commandline /format:csv`,
    );
    let killed = 0;
    for (const rawLine of out.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('Node')) continue; // header
      // CSV is tricky because command lines can contain commas. The
      // safest split is on '","' boundaries or use a regex that grabs
      // the PID (last numeric column) and the command line (rest).
      const m = line.match(/^([^,]+),(\d+),?(.*)$/);
      if (!m) continue;
      const cmd = (m[3] || '').toLowerCase();
      const pid = parseInt(m[2], 10);
      if (!Number.isFinite(pid)) continue;
      const isOurs =
        cmd.includes(projectMarker) ||
        cmd.includes('next dev') ||
        cmd.includes('next start') ||
        cmd.includes('next-server') ||
        cmd.includes('transform.js');
      if (!isOurs) continue;
      tryExec(`taskkill /F /PID ${pid}`);
      killed++;
      log(`  killed pid ${pid}`);
    }
    if (killed === 0) log('  (no matching workers found)');
  } else {
    let killed = 0;
    for (const pat of [projectMarker, 'next dev', 'next-server', 'transform.js']) {
      const out = tryExec(`pgrep -f "${pat}" 2>/dev/null || true`, { shell: '/bin/sh' });
      for (const pid of out.split(/\s+/).filter(Boolean)) {
        tryExec(`kill -9 ${pid}`);
        killed++;
        log(`  killed pid ${pid}`);
      }
    }
    if (killed === 0) log('  (no matching workers found)');
  }
}

// ── 3) Wait until the port is actually free ────────────────────────────────
async function waitForPortFree(port, maxMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const free = await new Promise((resolve) => {
      const socket = createConnection({ host: '127.0.0.1', port });
      let done = false;
      const finish = (result) => {
        if (done) return;
        done = true;
        socket.removeAllListeners();
        socket.destroy();
        resolve(result);
      };
      socket.setTimeout(300);
      socket.once('connect', () => finish(false)); // port is BUSY
      socket.once('timeout', () => finish(true));  // port is FREE
      socket.once('error', () => finish(true));    // port is FREE
    });
    if (free) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// ── 4) Wipe caches with retry (Windows file handles can be slow to release)
function wipeDir(target, label) {
  if (!existsSync(target)) {
    log(`${label}: already gone`);
    return;
  }
  log(`Wiping ${label}…`);
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      rmSync(target, { recursive: true, force: true });
      log(`  ${label} removed`);
      return;
    } catch (e) {
      if (attempt === 5) {
        err(`  warning: could not remove ${target} after 5 attempts: ${e.message}`);
        return;
      }
      // Sync sleep without async/await (rmSync is synchronous)
      tryExec(isWindows
        ? `powershell -NoProfile -Command "Start-Sleep -Milliseconds ${attempt * 500}"`
        : `sleep ${attempt / 2}`,
      );
    }
  }
}

// ── 5) Start the dev server in the foreground ──────────────────────────────
function startDevServer() {
  log('Starting dev server (npm run dev:turbo)…');
  // We always use dev:turbo — that's the one with the chunk-graph bug
  // this whole script exists to recover from.
  //
  // On Windows, Node's spawn() rejects `npm.cmd` (or any .cmd shim) with
  // EINVAL unless `shell: true` is set, because .cmd is a batch file and
  // Windows requires the shell to interpret it. We pass the command as a
  // single shell string with `shell: true`, which also dodges the
  // PATHEXT lookup dance on different shells.
  let child;
  if (isWindows) {
    child = spawn('npm.cmd', ['run', 'dev:turbo'], {
      stdio: 'inherit',
      shell: true,
      windowsHide: true,
    });
  } else {
    child = spawn('npm', ['run', 'dev:turbo'], {
      stdio: 'inherit',
      shell: false,
    });
  }
  child.on('exit', (code, signal) => {
    if (signal) {
      log(`dev server stopped by ${signal}`);
      process.exit(0);
    }
    process.exit(code ?? 0);
  });
  // Forward Ctrl+C / SIGTERM so the child gets killed cleanly when
  // the user hits Ctrl+C in the terminal.
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      try { child.kill(sig); } catch { /* already dead */ }
    });
  }
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  // Kill any listener on the dev port (and the fallback port).
  for (const port of PORTS_TO_KILL) {
    killPort(port);
  }
  killNextWorkers();

  // Wait for all known dev ports to free up.
  for (const port of PORTS_TO_KILL) {
    const free = await waitForPortFree(port, 5000);
    if (free) {
      log(`Port ${port} is free`);
    } else {
      err(`warning: port ${port} still busy after 5s — proceeding anyway`);
    }
  }

  wipeDir(join(root, '.next'), '.next (root)');
  wipeDir(join(root, 'mobile-app', '.next'), 'mobile-app/.next');
  wipeDir(join(root, 'mobile-app', 'out'), 'mobile-app/out');

  startDevServer();
}

main().catch((e) => {
  err(`failed: ${e?.stack || e?.message || e}`);
  process.exit(1);
});
