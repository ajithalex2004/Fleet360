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
 * - Strict placeholders: Only exact, approved dummy placeholders on local/example domains are permitted.
 * - Safe reporting: Reports only file path, line number, and rule name (NEVER echoes lines or snippets).
 * - Full repository coverage: Scans all tracked text files (via git ls-files when available) or full directory tree.
 *
 * Exit code 0 = Clean (no hardcoded credentials detected)
 * Exit code 1 = Hardcoded credential detected (CI blocking failure)
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// Exact approved placeholder passwords
const APPROVED_PLACEHOLDER_PASSWORDS = new Set([
  'password',
  'pass',
  'postgres',
  'root',
  'unset',
  'test',
  'dummy',
  '',
]);

// Approved placeholder hostnames
const APPROVED_PLACEHOLDER_HOSTS = new Set([
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

// Regex to capture PostgreSQL connection URLs: postgres[ql]://[authority]
const PG_URL_REGEX = /postgres(?:ql)?:\/\/([^/\s"';]+)/gi;

export function inspectUrlTarget(urlAuthority) {
  // urlAuthority is: user:pass@hostname:port or just hostname:port
  const atIndex = urlAuthority.indexOf('@');
  if (atIndex === -1) {
    // No user credentials embedded
    return null;
  }

  const userInfo = urlAuthority.slice(0, atIndex);
  const hostPart = urlAuthority.slice(atIndex + 1).split('/')[0].toLowerCase();
  const hostWithoutPort = hostPart.split(':')[0];

  const colonIndex = userInfo.indexOf(':');
  if (colonIndex === -1) {
    // Only username, no password embedded
    return null;
  }

  let rawPassword = userInfo.slice(colonIndex + 1);
  try {
    rawPassword = decodeURIComponent(rawPassword);
  } catch {
    // Keep raw if decoding fails
  }

  // Check if password matches an approved exact placeholder
  const isApprovedPassword = APPROVED_PLACEHOLDER_PASSWORDS.has(rawPassword);
  // Check if host matches an approved placeholder host
  const isApprovedHost = APPROVED_PLACEHOLDER_HOSTS.has(hostPart) || APPROVED_PLACEHOLDER_HOSTS.has(hostWithoutPort);

  if (isApprovedPassword && isApprovedHost) {
    return null; // Valid placeholder combination
  }

  return {
    isViolation: true,
    rule: 'Hardcoded PostgreSQL connection credentials detected',
  };
}

export function scanContent(content, relativePath) {
  const violations = [];
  const lines = content.split(/\r?\n/);

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;

    // Rule 1: Standalone Neon token pattern (npg_*)
    // Matches npg_ followed by alphanumeric characters (min 8 chars)
    const npgMatches = line.match(/\bnpg_[A-Za-z0-9_]{6,}\b/g);
    if (npgMatches) {
      violations.push({
        file: relativePath,
        line: lineNum,
        rule: 'Unredacted Neon credential token detected (npg_*)',
      });
    }

    // Rule 2: PostgreSQL Connection URL analysis (provider-agnostic)
    let match;
    PG_URL_REGEX.lastIndex = 0;
    while ((match = PG_URL_REGEX.exec(line)) !== null) {
      const authority = match[1];
      const check = inspectUrlTarget(authority);
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
    const stdout = execSync('git ls-files', { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return stdout
      .split('\n')
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
      let entries;
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch {
        return;
      }
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
    if (relPath.endsWith('scripts/check-no-hardcoded-credentials.mjs')) continue;

    const fullPath = path.join(rootDir, relPath);
    let content;
    try {
      content = fs.readFileSync(fullPath, 'utf8');
    } catch {
      continue;
    }

    const fileViolations = scanContent(content, relPath);
    violations.push(...fileViolations);
  }

  return violations;
}

// CLI Execution
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename || '')) {
  const rootDir = process.cwd();
  const violations = scanRepository(rootDir);

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
