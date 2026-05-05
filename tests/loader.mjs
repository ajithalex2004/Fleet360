/**
 * Node.js ESM loader hook for integration tests.
 * Handles:
 * - @/ path alias → src/
 * - TypeScript files (.ts) via built-in strip-types (Node v22+)
 * - vitest module shimming
 */

import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { existsSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

// ── Resolve hook ─────────────────────────────────────────────────────────────

export async function resolve(specifier, context, nextResolve) {
  // Shim vitest module
  if (specifier === 'vitest') {
    return {
      url: pathToFileURL(path.join(ROOT, 'tests/vitest-shim.mjs')).href,
      shortCircuit: true,
    };
  }

  // Handle @/ path alias
  if (specifier.startsWith('@/')) {
    const relative = specifier.slice(2); // remove '@/'
    const resolved = path.join(SRC, relative);

    // Try .ts first, then .tsx, then assume it's a directory with index.ts
    for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx', '.js', '.mjs', '/index.js']) {
      const candidate = resolved + ext;
      if (existsSync(candidate)) {
        return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
    // If no extension match, try exact path
    if (existsSync(resolved)) {
      return { url: pathToFileURL(resolved).href, shortCircuit: true };
    }
    // Fallback: let Node try
    const fallback = resolved + '.ts';
    return { url: pathToFileURL(fallback).href, shortCircuit: true };
  }

  return nextResolve(specifier, context);
}

// ── Load hook: handle .ts files ───────────────────────────────────────────────
// Node v22 with --experimental-strip-types handles .ts internally,
// but we still need to declare the format as 'module' for ESM .ts files.
