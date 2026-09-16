#!/usr/bin/env node
/**
 * scripts/check-no-hardcoded-credentials.mjs
 *
 * Contractual Static Analysis Guard:
 * Asserts that no hardcoded database credentials, Neon passwords (npg_*),
 * or production/staging connection strings with real credentials exist
 * in the repository code, tests, scripts, documentation, or workflows.
 *
 * Exit code 0 = Clean (no hard-coded credentials detected)
 * Exit code 1 = Hard-coded credential detected (CI blocking failure)
 */

import fs from 'fs';
import path from 'path';

const SCAN_DIRS = ['src', 'scripts', 'tests', 'docs', '.github', 'prisma'];
const SCAN_FILES = ['package.json', 'README.md', 'DEPLOYMENT_CHECKLIST.md'];

// Patterns indicating compromised or live credential patterns
const FORBIDDEN_PATTERNS = [
  {
    name: 'Neon password token (npg_*)',
    regex: /\bnpg_[A-Za-z0-9_]{8,}\b/,
  },
  {
    name: 'Retired fleet360_app credential hash',
    regex: /\b87f855bb8b0d868fc1b4d4f1038b283ae2895405ac563ec1\b/,
  },
  {
    name: 'Live remote database connection URL with embedded password',
    // Matches postgresql://user:pass@remote-host where host is not localhost/127.0.0.1 and pass is not a placeholder
    regex: /postgres(?:ql)?:\/\/(?!unset:unset)(?!user:pass)(?!user:password)[A-Za-z0-9_]+:[^@\s/:]+@[A-Za-z0-9.-]+\.(?:neon\.tech|railway\.app|aws\.com|azure\.com)/,
  },
];

const IGNORE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot',
  '.lock', '.map',
]);

const IGNORE_DIRS = new Set([
  'node_modules', '.next', '.git', 'dist', 'coverage', '.system_generated'
]);

function redactSnippet(str) {
  return str.replace(/postgres(?:ql)?:\/\/[^@\s]+@/g, 'postgresql://[REDACTED]@')
            .replace(/npg_[A-Za-z0-9_]+/g, 'npg_[REDACTED]');
}

function scanFile(filePath, violations) {
  const ext = path.extname(filePath);
  if (IGNORE_EXTENSIONS.has(ext)) return;

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return;
  }

  const lines = content.split(/\r?\n/);
  lines.forEach((line, idx) => {
    for (const rule of FORBIDDEN_PATTERNS) {
      if (rule.regex.test(line)) {
        violations.push({
          file: path.relative(process.cwd(), filePath).replace(/\\/g, '/'),
          line: idx + 1,
          rule: rule.name,
          preview: redactSnippet(line.trim()),
        });
      }
    }
  });
}

function scanDir(dirPath, violations) {
  if (!fs.existsSync(dirPath)) return;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      scanDir(fullPath, violations);
    } else if (entry.isFile()) {
      scanFile(fullPath, violations);
    }
  }
}

const violations = [];

for (const dir of SCAN_DIRS) {
  scanDir(path.resolve(dir), violations);
}

for (const file of SCAN_FILES) {
  const filePath = path.resolve(file);
  if (fs.existsSync(filePath)) {
    scanFile(filePath, violations);
  }
}

if (violations.length > 0) {
  console.error('\n❌ CRITICAL SECURITY ERROR: Hard-coded database credentials detected in repository!\n');
  violations.forEach(v => {
    console.error(`  - ${v.file}:${v.line} [${v.rule}]`);
    console.error(`    Snippet: ${v.preview}`);
  });
  console.error('\nAll credentials must be supplied via environment variables. See docs/KNOWN_GAPS.md.\n');
  process.exit(1);
} else {
  console.log('✅ Credential check passed: No hard-coded database credentials or tokens found.');
  process.exit(0);
}
