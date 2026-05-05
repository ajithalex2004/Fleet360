/**
 * Custom integration test runner for Linux environments where esbuild isn't available.
 * Uses Node.js v22 native TypeScript stripping + node:test framework.
 *
 * Usage: node --experimental-strip-types --import ./tests/loader.mjs tests/run-integration.mjs
 */

import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import path from 'path';
import { fileURLToPath } from 'url';
import { readdirSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDir = path.join(__dirname, 'integration');

const files = readdirSync(testDir)
  .filter(f => f.endsWith('.test.ts'))
  .map(f => path.join(testDir, f));

console.log(`\nRunning ${files.length} integration test files...\n`);

const stream = run({
  files,
  concurrency: false, // run sequentially to avoid DB race conditions
  timeout: 30_000,
});

stream.compose(spec()).pipe(process.stdout);

stream.on('test:fail', () => {
  process.exitCode = 1;
});
