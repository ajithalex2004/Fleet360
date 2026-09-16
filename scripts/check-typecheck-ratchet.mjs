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

export function sortTypeProperties(content) {
  const parts = [];
  let paren = 0, bracket = 0, brace = 0, angle = 0;
  let inSingle = false, inDouble = false;
  let current = '';

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      continue;
    }
    if (inSingle || inDouble) {
      current += ch;
      continue;
    }

    if (ch === '(') paren++;
    else if (ch === ')' && paren > 0) paren--;
    else if (ch === '[') bracket++;
    else if (ch === ']' && bracket > 0) bracket--;
    else if (ch === '{') brace++;
    else if (ch === '}' && brace > 0) brace--;
    else if (ch === '<') angle++;
    else if (ch === '>' && content[i - 1] !== '=' && angle > 0) angle--;
    else if ((ch === ';' || ch === ',') && paren === 0 && bracket === 0 && brace === 0 && angle === 0) {
      if (current.trim()) parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());

  if (content.trim() === '...') {
    return '...';
  }

  // Sort properties alphabetically; place '... N more ...' at the end
  parts.sort((a, b) => {
    const aMore = a.startsWith('...');
    const bMore = b.startsWith('...');
    if (aMore && !bMore) return 1;
    if (!aMore && bMore) return -1;
    return a.localeCompare(b);
  });

  return parts.length > 0 ? parts.join('; ') + ';' : '';
}

export function normalizeMessage(msg) {
  let s = msg.trim().replace(/\s+/g, ' ');

  // Truncated missing properties list is non-deterministic across OS engines/iteration order
  // e.g. "is missing the following properties from type 'Foo': "a", "b", and 2 more."
  s = s.replace(/is missing the following properties from type (.+?):.*$/, 'is missing properties from type $1');

  // Terminating bracket-aware normalization for structural type literals:
  // Replaces innermost `{...}` with tokens to guarantee termination and sort properties deterministically
  const tokens = [];
  let maxPasses = 20;
  while (/\{[^{}]*\}/.test(s) && maxPasses-- > 0) {
    s = s.replace(/\{([^{}]*)\}/g, (_, inner) => {
      const sorted = sortTypeProperties(inner);
      const token = `__TYPE_TOKEN_${tokens.length}__`;
      tokens.push(sorted ? (sorted === '...' ? '{...}' : `{ ${sorted} }`) : '{}');
      return token;
    });
  }

  // Restore tokens in reverse (outside-in)
  for (let i = tokens.length - 1; i >= 0; i--) {
    s = s.replaceAll(`__TYPE_TOKEN_${i}__`, tokens[i]);
  }

  return s;
}

export function isCompilerCrash(result) {
  if (!result) return true;
  if (result.signal) return true;
  if (typeof result.exitCode === 'number' && result.exitCode > 128) return true;
  if (result.exitCode !== 0 && result.exitCode !== 1 && result.exitCode !== 2) return true;
  if (result.error && (result.error.code === 'ENOBUFS' || result.error.code === 'ETIMEDOUT')) return true;

  const out = result.output || '';
  if (/JavaScript heap out of memory/i.test(out)) return true;
  if (/FATAL ERROR:/i.test(out)) return true;
  if (/Internal compiler error/i.test(out)) return true;

  return false;
}

export function runTsc(customRoot = root) {
  const bin = join(customRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!existsSync(bin)) {
    console.error(`✗ Error: TypeScript binary not found at ${bin}`);
    return { exitCode: 1, signal: null, output: `TypeScript binary not found at ${bin}`, error: new Error('Binary not found') };
  }

  try {
    const out = execFileSync(process.execPath, [bin, '--noEmit', '--pretty', 'false'], {
      cwd: customRoot,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return { exitCode: 0, signal: null, output: out, error: null };
  } catch (err) {
    const combined = `${err.stdout || ''}\n${err.stderr || ''}`.trim();
    return {
      exitCode: err.status ?? (err.signal ? 128 : 1),
      signal: err.signal ?? null,
      output: combined,
      error: err,
    };
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
  const tscResult = options.tscResult || runTsc();
  const { exitCode, signal, output } = tscResult;

  // Crash guard 1: abnormal exit, OOM, SIGKILL/SIGSEGV, or compiler crash
  // Fails closed immediately, even if partial diagnostics were emitted before crash
  if (isCompilerCrash(tscResult)) {
    console.error(
      `\n✗ typecheck ratchet FAILED — TypeScript compiler crashed or exited abnormally (code: ${exitCode}, signal: ${signal || 'none'}):\n`
    );
    console.error(output || '(no output produced)');
    if (options.throwOnError) {
      throw new Error(
        `TypeScript compiler crashed or terminated abnormally (code: ${exitCode}, signal: ${signal || 'none'})`
      );
    }
    exit(1);
  }

  const { fileDiagnostics, globalErrors } = parseDiagnostics(output);

  // Crash guard 2: non-zero exit code without recognizable diagnostics
  if (exitCode !== 0 && fileDiagnostics.size === 0 && globalErrors.length === 0) {
    console.error(
      `\n✗ typecheck ratchet FAILED — TypeScript compiler exited with code ${exitCode} without recognizable diagnostics:\n`
    );
    console.error(output || '(no output produced)');
    if (options.throwOnError) {
      throw new Error(`TypeScript compiler exited with code ${exitCode} without recognizable diagnostics`);
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
