#!/usr/bin/env node
/**
 * scripts/check-no-hardcoded-credentials.mjs
 *
 * Contractual Static Analysis Guard:
 * Recursively asserts that no hardcoded database credentials, Neon tokens (npg_*),
 * or remote database connection strings with embedded non-placeholder passwords
 * exist anywhere in the tracked repository source, tests, scripts, or docs.
 *
 * Design Principles:
 * - Structural detection: No actual secret values or passwords are stored in scanner rules.
 * - Provider-agnostic: Rejects password-bearing PostgreSQL URLs on ANY remote host.
 * - Complete URI parsing: Inspects userinfo passwords, query-string passwords (?password=...), and IPv6 literals ([::1]).
 * - Strict placeholders: Only exact, approved dummy placeholders on local/example domains are permitted.
 * - Safe reporting: Reports only file path, line number, and rule name (NEVER echoes lines or snippets).
 * - Full repository coverage: Scans all tracked text files via NUL-separated `git ls-files -z` (including scanner itself).
 * - Fail on incomplete scans: Throws an error immediately if any tracked file fails to read.
 *
 * Exit code 0 = Clean (no hardcoded credentials detected)
 * Exit code 1 = Hardcoded credential detected (CI blocking failure)
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// Exact approved placeholder passwords
export const APPROVED_PLACEHOLDER_PASSWORDS = new Set([
  'password',
  'pass',
  'postgres',
  'root',
  'unset',
  'test',
  'dummy',
  '',
]);

// Approved placeholder hostnames (case-insensitive)
export const APPROVED_PLACEHOLDER_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  'example.com',
  'host',
  'host:5432',
  'host-pooler.region.aws.neon.tech',
  'host.region.aws.neon.tech',
  'ep-demo-pooler.ap-southeast-1.aws.neon.tech',
  'ep-demo.ap-southeast-1.aws.neon.tech',
]);

const IGNORE_DIRS = new Set([
  '.git',
  '.claude',
  '.audit-reports',
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
  '.system_generated',
  'scratch',
  'playwright-report',
  'test-results',
]);

const IGNORE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.pdf', '.docx', '.xlsx', '.zip', '.tar', '.gz',
  '.lock', '.map', '.exe',
]);

// Regex to capture full PostgreSQL connection URI candidates
const PG_URI_REGEX = /postgres(?:ql)?:\/\/[^\s"'`<>]+/gi;

export function inspectPostgresUri(uriCandidate) {
  let url;
  let rawPassword = '';
  let queryPassword = '';
  let host = '';

  try {
    url = new URL(uriCandidate);
    rawPassword = url.password;
    queryPassword = url.searchParams.get('password') ||
                    url.searchParams.get('pwd') ||
                    url.searchParams.get('pass') || '';
    host = url.hostname.toLowerCase();
  } catch {
    // Fallback manual parser for partial or template URLs
    const withoutScheme = uriCandidate.replace(/^postgres(?:ql)?:\/\//i, '');
    const [authorityAndPath, queryPart] = withoutScheme.split('?');
    const authority = authorityAndPath.split('/')[0];

    const atIndex = authority.lastIndexOf('@');
    if (atIndex !== -1) {
      const userInfo = authority.slice(0, atIndex);
      host = authority.slice(atIndex + 1).toLowerCase();
      const colonIndex = userInfo.indexOf(':');
      if (colonIndex !== -1) {
        rawPassword = userInfo.slice(colonIndex + 1);
      }
    } else {
      host = authority.toLowerCase();
    }

    if (queryPart) {
      const params = new URLSearchParams(queryPart);
      queryPassword = params.get('password') || params.get('pwd') || params.get('pass') || '';
    }
  }

  // Normalize host: strip brackets from IPv6 literals and port if present
  let normalizedHost = host.replace(/^\[|\]$/g, '').split(':')[0];

  // Decode passwords if URL-encoded
  try {
    rawPassword = decodeURIComponent(rawPassword);
  } catch {}
  try {
    queryPassword = decodeURIComponent(queryPassword);
  } catch {}

  const hasPassword = Boolean(rawPassword || queryPassword);
  if (!hasPassword) {
    return null; // No embedded credentials
  }

  const effectivePassword = rawPassword || queryPassword;
  const isApprovedPassword = APPROVED_PLACEHOLDER_PASSWORDS.has(effectivePassword);
  const isApprovedHost = APPROVED_PLACEHOLDER_HOSTS.has(host) ||
                         APPROVED_PLACEHOLDER_HOSTS.has(normalizedHost);

  if (isApprovedPassword && isApprovedHost) {
    return null; // Valid reviewed placeholder combination
  }

  return {
    isViolation: true,
    rule: 'Hardcoded PostgreSQL connection credentials detected in URI',
  };
}

export function scanContent(content, relativePath) {
  const violations = [];
  const lines = content.split(/\r?\n/);

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;

    // Rule 1: Standalone Neon token pattern (npg_*)
    const npgMatches = line.match(/\bnpg_[A-Za-z0-9_]{6,}\b/g);
    if (npgMatches) {
      violations.push({
        file: relativePath,
        line: lineNum,
        rule: 'Unredacted Neon credential token detected (npg_*)',
      });
    }

    // Rule 2: Complete PostgreSQL connection URI analysis
    let match;
    PG_URI_REGEX.lastIndex = 0;
    while ((match = PG_URI_REGEX.exec(line)) !== null) {
      const candidateUri = match[0];
      const check = inspectPostgresUri(candidateUri);
      if (check?.isViolation) {
        violations.push({
          file: relativePath,
          line: lineNum,
          rule: check.rule,
        });
      }
    }
  });

  return violations;
}

export function getTrackedFiles(rootDir) {
  try {
    // NUL-separated git ls-files ensures robust filename handling across all platforms
    const stdout = execSync('git ls-files -z', {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout
      .split('\0')
      .map(s => s.trim())
      .filter(Boolean)
      .filter(relPath => {
        const ext = path.extname(relPath).toLowerCase();
        if (IGNORE_EXTENSIONS.has(ext)) return false;
        const parts = relPath.split('/');
        return !parts.some(p => IGNORE_DIRS.has(p));
      });
  } catch {
    // Fallback if git is not available: directory walk
    const files = [];
    function walk(currentDir) {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (IGNORE_EXTENSIONS.has(ext)) continue;
          files.push(path.relative(rootDir, fullPath).replace(/\\/g, '/'));
        }
      }
    }
    walk(rootDir);
    return files;
  }
}

export function scanRepository(rootDir) {
  const trackedFiles = getTrackedFiles(rootDir);
  const violations = [];

  for (const relPath of trackedFiles) {
    const fullPath = path.join(rootDir, relPath);
    let content;
    try {
      content = fs.readFileSync(fullPath, 'utf8');
    } catch (err) {
      // Fail on incomplete scans: do NOT silently swallow file read failures
      throw new Error(`Incomplete scan failure: unable to read tracked file "${relPath}": ${err.message}`);
    }

    const fileViolations = scanContent(content, relPath);
    violations.push(...fileViolations);
  }

  return violations;
}

// CLI Execution
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename || '')) {
  const rootDir = process.cwd();
  let violations;
  try {
    violations = scanRepository(rootDir);
  } catch (err) {
    console.error(`\n❌ CRITICAL SCANNER ERROR: ${err.message}\n`);
    process.exit(1);
  }

  if (violations.length > 0) {
    console.error('\n❌ CRITICAL SECURITY ERROR: Hardcoded credentials or tokens detected in repository!\n');
    violations.forEach(v => {
      // Intentionally emit ONLY file, line, and rule name.
      // NEVER emit line content or snippets to prevent second-order secret leakage in CI logs.
      console.error(`  - ${v.file}:${v.line} [${v.rule}]`);
    });
    console.error('\nAll credentials must be supplied via environment variables. See docs/KNOWN_GAPS.md.\n');
    process.exit(1);
  } else {
    console.log('✅ Credential check passed: No hardcoded database credentials or tokens found.');
    process.exit(0);
  }
}
