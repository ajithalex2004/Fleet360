#!/usr/bin/env node
/**
 * scripts/check-typecheck-ratchet.mjs
 *
 * CI ratchet for `tsc --noEmit`.
 *
 * Enforces diagnostic fingerprinting and occurrence counts per file:
 * - Fails if the compiler crashes, runs out of memory, or exits non-zero without recognizable diagnostics.
 * - Fails if any global compiler configuration error occurs.
 * - Fails if any file NOT in the baseline has a type error.
 * - Fails if an allowed file has MORE total errors than in the baseline.
 * - Fails if an allowed file introduces a NEW error code or increases occurrences of a code.
 * - Fails if an allowed file introduces a NEW diagnostic fingerprint (`code:normalizedMessage`) or increases occurrences of a fingerprint.
 *
 * USAGE
 * ─────
 *   node scripts/check-typecheck-ratchet.mjs
 *       Run the gate: fail if any new error, code increase, or fingerprint change occurs.
 *
 *   node scripts/check-typecheck-ratchet.mjs --update-baseline
 *       Regenerate scripts/typecheck-baseline.json from current tsc output.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { exit, argv } from 'node:process';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const BASELINE_PATH = join(root, 'scripts', 'typecheck-baseline.json');
const TSC_BIN = join(root, 'node_modules', 'typescript', 'bin', 'tsc');

const DIAGNOSTIC_LINE_RE = /^(.+?)\((\d+,\d+)\): error (TS\d+): (.*)$/;
const GLOBAL_ERROR_RE = /^error (TS\d+): (.*)$/;

export function normalizeMessage(msg) {
  let s = msg.trim().replace(/\s+/g, ' ');

  // Truncated missing properties list is non-deterministic across OS engines/iteration order
  // e.g. "is missing the following properties from type 'Foo': "a", "b", and 2 more."
  s = s.replace(/is missing the following properties from type (.+?):.*$/, 'is missing properties from type $1');

  // Collapse anonymous structural type literals {...} into {...} to avoid platform-dependent property ordering
  while (/\{[^{}]*\}/.test(s)) {
    s = s.replace(/\{[^{}]*\}/g, '{...}');
  }

  return s;
}

export function runTsc(customRoot = root) {
  const bin = join(customRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!existsSync(bin)) {
    console.error(`✗ Error: TypeScript binary not found at ${bin}`);
    return { exitCode: 1, output: `TypeScript binary not found at ${bin}` };
  }

  try {
    const out = execFileSync(process.execPath, [bin, '--noEmit', '--pretty', 'false'], {
      cwd: customRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return { exitCode: 0, output: out };
  } catch (err) {
    const combined = `${err.stdout || ''}\n${err.stderr || ''}`.trim();
    return { exitCode: err.status ?? 1, output: combined };
  }
}

export function parseDiagnostics(tscOutput) {
  const fileDiagnostics = new Map();
  const globalErrors = [];

  for (const line of tscOutput.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const fileMatch = DIAGNOSTIC_LINE_RE.exec(trimmed);
    if (fileMatch) {
      const rel = fileMatch[1].trim().replace(/\\/g, '/');
      if (rel.startsWith('.next/')) continue; // Next.js generated route types

      const code = fileMatch[3];
      const rawMessage = fileMatch[4];
      const fingerprint = `${code}:${normalizeMessage(rawMessage)}`;

      const entry = fileDiagnostics.get(rel) || {
        total: 0,
        codes: {},
        fingerprints: {},
      };

      entry.total += 1;
      entry.codes[code] = (entry.codes[code] || 0) + 1;
      entry.fingerprints[fingerprint] = (entry.fingerprints[fingerprint] || 0) + 1;
      fileDiagnostics.set(rel, entry);
      continue;
    }

    const globalMatch = GLOBAL_ERROR_RE.exec(trimmed);
    if (globalMatch) {
      globalErrors.push(trimmed);
      continue;
    }
  }

  return { fileDiagnostics, globalErrors };
}

export function compareDiagnostics(currentDiagnostics, baseline) {
  const violations = [];
  const cleanFiles = [];

  for (const [file, current] of currentDiagnostics.entries()) {
    const base = baseline.files?.[file];
    if (!base) {
      violations.push(`[NEW FILE] ${file}: ${current.total} error(s) (file was not in baseline)`);
      continue;
    }

    if (current.total > base.total) {
      violations.push(
        `[COUNT INCREASE] ${file}: error count increased from ${base.total} to ${current.total}`
      );
      continue;
    }

    // Check individual error codes
    for (const [code, count] of Object.entries(current.codes)) {
      const baseCount = base.codes?.[code] || 0;
      if (count > baseCount) {
        violations.push(
          `[NEW/INCREASED CODE] ${file}: code ${code} increased from ${baseCount} to ${count}`
        );
      }
    }

    // Check diagnostic fingerprints (code + normalized message) and multiplicity
    if (base.fingerprints) {
      for (const [fingerprint, count] of Object.entries(current.fingerprints)) {
        const baseCount = base.fingerprints?.[fingerprint] || 0;
        if (count > baseCount) {
          violations.push(
            `[NEW/INCREASED FINGERPRINT] ${file}: [${fingerprint}] occurred ${count} time(s), baseline allowed ${baseCount}`
          );
        }
      }
    }
  }

  if (baseline.files) {
    for (const baseFile of Object.keys(baseline.files)) {
      if (!currentDiagnostics.has(baseFile)) {
        cleanFiles.push(baseFile);
      }
    }
  }

  return { violations, cleanFiles };
}

export function loadBaseline(baselinePath = BASELINE_PATH) {
  if (!existsSync(baselinePath)) {
    return { files: {} };
  }
  try {
    const data = JSON.parse(readFileSync(baselinePath, 'utf8'));
    if (Array.isArray(data.files)) {
      const filesMap = {};
      for (const f of data.files) {
        filesMap[f] = { total: 9999, codes: {}, fingerprints: {} };
      }
      return { files: filesMap };
    }
    return data;
  } catch (err) {
    console.error(`✗ Error parsing baseline file ${baselinePath}:`, err.message);
    exit(1);
  }
}

export function writeBaseline(fileDiagnostics, baselinePath = BASELINE_PATH) {
  const sortedFiles = {};
  let totalErrors = 0;

  const sortedKeys = [...fileDiagnostics.keys()].sort();
  for (const k of sortedKeys) {
    const entry = fileDiagnostics.get(k);

    const sortedCodes = Object.keys(entry.codes)
      .sort()
      .reduce((acc, code) => {
        acc[code] = entry.codes[code];
        return acc;
      }, {});

    const sortedFingerprints = Object.keys(entry.fingerprints)
      .sort()
      .reduce((acc, fp) => {
        acc[fp] = entry.fingerprints[fp];
        return acc;
      }, {});

    sortedFiles[k] = {
      total: entry.total,
      codes: sortedCodes,
      fingerprints: sortedFingerprints,
    };
    totalErrors += entry.total;
  }

  const payload = {
    _comment:
      'Generated by `node scripts/check-typecheck-ratchet.mjs --update-baseline`. ' +
      'Stores diagnostic fingerprints and error code counts per file. ' +
      'The gate fails if new files fail, total errors increase, new error codes appear, or diagnostic fingerprints change.',
    generatedAt: new Date().toISOString(),
    totalErrors,
    totalFiles: sortedKeys.length,
    files: sortedFiles,
  };

  console.log(`Writing baseline to ${baselinePath} (${totalErrors} errors, ${sortedKeys.length} files)...`);
  writeFileSync(baselinePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`Successfully wrote ${baselinePath}`);
  return payload;
}

export function runRatchetGate(options = {}) {
  const updateMode = options.updateMode ?? argv.includes('--update-baseline');
  const baselinePath = options.baselinePath || BASELINE_PATH;

  console.log('Running `tsc --noEmit`… (analyzing project diagnostics)');
  const { exitCode, output } = runTsc();
  const { fileDiagnostics, globalErrors } = parseDiagnostics(output);

  // Crash guard: if tsc exited non-zero but produced no diagnostics, it crashed or aborted
  if (exitCode !== 0 && fileDiagnostics.size === 0 && globalErrors.length === 0) {
    console.error(
      `\n✗ typecheck ratchet FAILED — TypeScript compiler exited with code ${exitCode} without recognizable diagnostics (compiler crash, OOM, or unparseable exit):\n`
    );
    console.error(output || '(no output produced)');
    if (options.throwOnError) {
      throw new Error(`TypeScript compiler crashed or failed to execute (exit code ${exitCode})`);
    }
    exit(1);
  }

  if (globalErrors.length > 0) {
    console.error(`\n✗ typecheck ratchet FAILED — global compiler configuration error(s):\n`);
    globalErrors.forEach(e => console.error(`   ${e}`));
    if (options.throwOnError) {
      throw new Error(`Global TypeScript compiler errors detected: ${globalErrors.join(', ')}`);
    }
    exit(1);
  }

  if (updateMode) {
    const payload = writeBaseline(fileDiagnostics, baselinePath);
    console.log(
      `\nBaseline written: ${payload.totalErrors} total error(s) across ${payload.totalFiles} file(s).`
    );
    return { success: true, mode: 'updated', payload };
  }

  const baseline = loadBaseline(baselinePath);
  const { violations, cleanFiles } = compareDiagnostics(fileDiagnostics, baseline);

  if (violations.length > 0) {
    console.error(`\n✗ typecheck ratchet FAILED — ${violations.length} new or increased diagnostic violation(s):\n`);
    violations.slice(0, 50).forEach(v => console.error(`   ${v}`));
    if (violations.length > 50) {
      console.error(`   ... and ${violations.length - 50} more violation(s)`);
    }
    console.error(
      '\nFix the new/increased error(s), or run `node scripts/check-typecheck-ratchet.mjs --update-baseline` ' +
        'as a deliberate, reviewed change if debt was intentionally accepted.'
    );
    if (options.throwOnError) {
      throw new Error(`Typecheck ratchet violations: ${violations.join('\n')}`);
    }
    exit(1);
  }

  console.log(
    `✓ typecheck ratchet passed — ${fileDiagnostics.size} file(s) with pre-existing errors (${cleanFiles.length} file(s) now completely clean).`
  );
  return { success: true, mode: 'verified', cleanFiles, errorFiles: fileDiagnostics.size };
}

// Execute main if invoked directly from CLI
const isDirectCli = process.argv[1] && (
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1].endsWith('check-typecheck-ratchet.mjs')
);

if (isDirectCli) {
  runRatchetGate();
}
