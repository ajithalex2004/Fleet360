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

/**
 * Validates that essential dependencies are present in node_modules.
 * Prevents broken/corrupted environments (e.g. missing next/package.json) from qualifying as clean or establishing a false baseline.
 */
export function verifyDependencyPreflight(customRoot = root) {
  const criticalDeps = [
    { name: 'typescript', pkgPath: join(customRoot, 'node_modules', 'typescript', 'package.json') },
    { name: 'next', pkgPath: join(customRoot, 'node_modules', 'next', 'package.json') },
    { name: '@prisma/client', pkgPath: join(customRoot, 'node_modules', '@prisma', 'client', 'package.json') },
  ];

  const missing = [];
  for (const dep of criticalDeps) {
    if (!existsSync(dep.pkgPath)) {
      missing.push(dep.name);
    }
  }

  if (missing.length > 0) {
    return {
      valid: false,
      error: `Missing or incomplete core dependencies in node_modules: ${missing.join(', ')}. ` +
        `Run 'npm ci --legacy-peer-deps' and 'npx prisma generate' before running the typecheck ratchet.`,
    };
  }
  return { valid: true, error: null };
}

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

  // Truncated property lists (e.g. "... 14 more ...") contain non-deterministic subsets of fields
  // across V8 engines and operating system property iteration orders.
  // Normalize truncated structural types to '{...}' to ensure cross-platform reproducibility,
  // while preserving full structural type fidelity for non-truncated types.
  if (content.trim() === '...' || parts.some(p => p.startsWith('...'))) {
    return '...';
  }

  parts.sort((a, b) => a.localeCompare(b));
  return parts.length > 0 ? parts.join('; ') + ';' : '';
}

export function normalizeMessage(msg) {
  let s = msg.trim().replace(/\s+/g, ' ');

  // Semantic missing-properties normalization:
  // Extracts the missing property names, sorts them alphabetically, and preserves the target type.
  // e.g. "is missing the following properties from type 'Foo': id, name" -> "is missing properties [id, name] from type 'Foo'"
  // e.g. "is missing the following properties from type 'Foo': tenantId, currency" -> "is missing properties [currency, tenantId] from type 'Foo'"
  s = s.replace(/is missing the following properties from type (.+?):\s*([^\n\r.]+)/g, (_, targetType, propListStr) => {
    const rawProps = propListStr.split(',').map(p => {
      let cleaned = p.trim().replace(/^["']|["']$/g, '');
      if (/^and \d+ more$/i.test(cleaned)) return '';
      return cleaned;
    }).filter(Boolean);
    rawProps.sort((a, b) => a.localeCompare(b));
    return `is missing properties [${rawProps.join(', ')}] from type ${targetType}`;
  });

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

  // Sort string literal union members: "A" | "B" or 'A' | 'B' to eliminate non-deterministic union ordering
  s = s.replace(/"[^"]+"(?:\s*\|\s*"[^"]+")+/g, (match) => {
    const parts = match.split('|').map(p => p.trim());
    parts.sort((a, b) => a.localeCompare(b));
    return parts.join(' | ');
  });
  s = s.replace(/'[^']+'(?:\s*\|\s*'[^']+)+/g, (match) => {
    const parts = match.split('|').map(p => p.trim());
    parts.sort((a, b) => a.localeCompare(b));
    return parts.join(' | ');
  });

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
    const out = execFileSync(
      process.execPath,
      [bin, '--noEmit', '--pretty', 'false', '--noErrorTruncation'],
      {
        cwd: customRoot,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      }
    );
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

  const lines = tscOutput.split('\n');
  let currentDiag = null;

  function flushCurrentDiag() {
    if (!currentDiag) return;
    const { rel, code, rawLines } = currentDiag;
    const normalized = rawLines
      .map(line => normalizeMessage(line))
      .filter(Boolean)
      .join('\n');
    const fingerprint = `${code}:${normalized}`;

    const entry = fileDiagnostics.get(rel) || {
      total: 0,
      codes: {},
      fingerprints: {},
    };

    entry.total += 1;
    entry.codes[code] = (entry.codes[code] || 0) + 1;
    entry.fingerprints[fingerprint] = (entry.fingerprints[fingerprint] || 0) + 1;
    fileDiagnostics.set(rel, entry);
    currentDiag = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // 1. Line starts a new file diagnostic: `path/to/file.ts(line,col): error TSxxxx: message`
    const fileMatch = DIAGNOSTIC_LINE_RE.exec(trimmed);
    if (fileMatch) {
      flushCurrentDiag();
      const rel = fileMatch[1].trim().replace(/\\/g, '/');
      const code = fileMatch[3];
      const headline = fileMatch[4];
      currentDiag = {
        rel,
        code,
        rawLines: [headline],
      };
      continue;
    }

    // 2. Global compiler error: `error TSxxxx: message`
    const globalMatch = GLOBAL_ERROR_RE.exec(trimmed);
    if (globalMatch) {
      flushCurrentDiag();
      globalErrors.push(trimmed);
      continue;
    }

    // 3. Indented continuation line belonging to the active diagnostic
    if (currentDiag && (rawLine.startsWith('  ') || rawLine.startsWith('\t'))) {
      currentDiag.rawLines.push(trimmed);
      continue;
    }
  }

  flushCurrentDiag();
  return { fileDiagnostics, globalErrors };
}

/**
 * Validates baseline schema version and mathematical integrity.
 * Requires schemaVersion: 2, non-empty fingerprints, and asserts sum(codes) === sum(fingerprints) === total.
 * Rejects malformed or weakened baseline structures.
 */
export function validateBaselineStructure(data, baselinePath = BASELINE_PATH) {
  if (!data || typeof data !== 'object') {
    throw new Error(`Invalid baseline in ${baselinePath}: must be a JSON object.`);
  }
  if (data.schemaVersion !== 2) {
    throw new Error(
      `Incompatible baseline schema version (${data.schemaVersion ?? 'unversioned'}) in ${baselinePath}. ` +
      `Expected schemaVersion: 2. Run 'node scripts/check-typecheck-ratchet.mjs --update-baseline' to migrate.`
    );
  }
  if (typeof data.totalErrors !== 'number' || typeof data.totalFiles !== 'number') {
    throw new Error(`Invalid baseline in ${baselinePath}: missing totalErrors or totalFiles summary.`);
  }
  if (!data.files || typeof data.files !== 'object') {
    throw new Error(`Invalid baseline in ${baselinePath}: missing or invalid 'files' map.`);
  }

  let computedTotalErrors = 0;
  for (const [file, entry] of Object.entries(data.files)) {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Malformed baseline entry for file "${file}": entry must be an object.`);
    }
    if (typeof entry.total !== 'number' || entry.total <= 0) {
      throw new Error(`Malformed baseline entry for file "${file}": total must be a positive integer.`);
    }
    if (!entry.codes || typeof entry.codes !== 'object' || Object.keys(entry.codes).length === 0) {
      throw new Error(`Malformed baseline entry for file "${file}": codes map must be non-empty.`);
    }
    if (!entry.fingerprints || typeof entry.fingerprints !== 'object' || Object.keys(entry.fingerprints).length === 0) {
      throw new Error(`Malformed baseline entry for file "${file}": fingerprints map must be non-empty.`);
    }

    let codesSum = 0;
    for (const [code, count] of Object.entries(entry.codes)) {
      if (typeof count !== 'number' || count <= 0) {
        throw new Error(`Malformed baseline entry for file "${file}": code ${code} count must be positive.`);
      }
      codesSum += count;
    }
    if (codesSum !== entry.total) {
      throw new Error(
        `Baseline integrity failure for file "${file}": sum of error codes (${codesSum}) does not match total (${entry.total}).`
      );
    }

    let fingerprintsSum = 0;
    for (const [fp, count] of Object.entries(entry.fingerprints)) {
      if (typeof count !== 'number' || count <= 0) {
        throw new Error(`Malformed baseline entry for file "${file}": fingerprint count must be positive.`);
      }
      fingerprintsSum += count;
    }
    if (fingerprintsSum !== entry.total) {
      throw new Error(
        `Baseline integrity failure for file "${file}": sum of fingerprints (${fingerprintsSum}) does not match total (${entry.total}).`
      );
    }

    computedTotalErrors += entry.total;
  }

  if (computedTotalErrors !== data.totalErrors) {
    throw new Error(
      `Baseline summary integrity failure: sum of file errors (${computedTotalErrors}) does not match totalErrors (${data.totalErrors}).`
    );
  }

  return true;
}

export function compareDiagnostics(currentDiagnostics, baseline) {
  const violations = [];
  const cleanFiles = [];
  const reducedFiles = [];

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

    if (current.total < base.total) {
      reducedFiles.push({ file, before: base.total, after: current.total });
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

    // Check diagnostic fingerprints (code + normalized multi-line message) and multiplicity
    for (const [fingerprint, count] of Object.entries(current.fingerprints)) {
      const baseCount = base.fingerprints?.[fingerprint] || 0;
      if (count > baseCount) {
        violations.push(
          `[NEW/INCREASED FINGERPRINT] ${file}: [${fingerprint}] occurred ${count} time(s), baseline allowed ${baseCount}`
        );
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

  return { violations, cleanFiles, reducedFiles };
}

export function loadBaseline(baselinePath = BASELINE_PATH) {
  if (!existsSync(baselinePath)) {
    return { schemaVersion: 2, totalErrors: 0, totalFiles: 0, files: {} };
  }
  try {
    const data = JSON.parse(readFileSync(baselinePath, 'utf8'));
    validateBaselineStructure(data, baselinePath);
    return data;
  } catch (err) {
    console.error(`✗ Error validating baseline file ${baselinePath}:`, err.message);
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
      'Stores multi-line diagnostic fingerprints and error code counts per file. ' +
      'The gate fails if new files fail, total errors increase, new error codes appear, or diagnostic fingerprints change.',
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    totalErrors,
    totalFiles: sortedKeys.length,
    files: sortedFiles,
  };

  validateBaselineStructure(payload, baselinePath);

  console.log(`Writing baseline (schemaVersion 2) to ${baselinePath} (${totalErrors} errors, ${sortedKeys.length} files)...`);
  writeFileSync(baselinePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`Successfully wrote ${baselinePath}`);
  return payload;
}

export function runRatchetGate(options = {}) {
  const customRoot = options.customRoot || root;
  const updateMode = options.updateMode ?? argv.includes('--update-baseline');
  const baselinePath = options.baselinePath || BASELINE_PATH;

  // 1. Dependency Preflight Guard: fail closed if essential project packages are missing/incomplete
  const preflight = options.preflightResult || verifyDependencyPreflight(customRoot);
  if (!preflight.valid) {
    console.error(`\n✗ typecheck ratchet FAILED — dependency preflight check failed:\n  ${preflight.error}\n`);
    if (options.throwOnError) {
      throw new Error(preflight.error);
    }
    exit(1);
  }

  console.log('Running `tsc --noEmit`… (analyzing project diagnostics with complete diagnostic chains)');
  const tscResult = options.tscResult || runTsc(customRoot);
  const { exitCode, signal, output } = tscResult;

  // Crash guard 1: abnormal exit, OOM, SIGKILL/SIGSEGV, or compiler crash
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

  // Global compiler error guard: fail closed on tsconfig or environment errors
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
      `\nBaseline written (schemaVersion 2): ${payload.totalErrors} total error(s) across ${payload.totalFiles} file(s).`
    );
    return { success: true, mode: 'updated', payload };
  }

  const baseline = loadBaseline(baselinePath);
  const { violations, cleanFiles, reducedFiles } = compareDiagnostics(fileDiagnostics, baseline);

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

  if (reducedFiles.length > 0) {
    console.log(`  🎉 Debt reduced in ${reducedFiles.length} file(s):`);
    reducedFiles.forEach(r => console.log(`     - ${r.file}: ${r.before} -> ${r.after} errors`));
  }

  console.log(
    `✓ typecheck ratchet passed — ${fileDiagnostics.size} file(s) with pre-existing errors (${cleanFiles.length} file(s) now completely clean).`
  );
  return { success: true, mode: 'verified', cleanFiles, reducedFiles, errorFiles: fileDiagnostics.size };
}

// Execute main if invoked directly from CLI
const isDirectCli = process.argv[1] && (
  process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1].endsWith('check-typecheck-ratchet.mjs')
);

if (isDirectCli) {
  runRatchetGate();
}
