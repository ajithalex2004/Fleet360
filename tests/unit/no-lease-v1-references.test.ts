/**
 * Layer 2.6 guard: no V1 lease model references in application code.
 *
 * LeaseContract (V1), LeasePayment (V1), and LeaseVehicleReturn were
 * removed from prisma/schema.prisma. Audit logs and docs must use V2 names
 * (LeaseContract2, LeasePayment2) so operators and downstream tooling
 * don't query dead entity types.
 *
 * Prerequisites: none — pure filesystem scan, no DB required.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../..');

const SCAN_ROOTS = ['src', 'tests'] as const;

const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  'dist',
  'coverage',
]);

const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);

interface GrepHit {
  file: string;
  line: number;
  text: string;
}

/**
 * Walk SCAN_ROOTS and return every line matching `pattern`.
 * Paths in hits are repo-relative with forward slashes.
 */
function repoGrep(pattern: RegExp): GrepHit[] {
  const hits: GrepHit[] = [];

  function walk(absDir: string): void {
    if (!fs.existsSync(absDir)) return;
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const ext = path.extname(entry.name);
      if (!SCAN_EXTENSIONS.has(ext)) continue;

      const rel = path.relative(REPO_ROOT, full).replace(/\\/g, '/');
      const content = fs.readFileSync(full, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) {
          hits.push({ file: rel, line: i + 1, text: lines[i].trim() });
        }
        pattern.lastIndex = 0;
      }
    }
  }

  for (const root of SCAN_ROOTS) {
    walk(path.join(REPO_ROOT, root));
  }
  return hits;
}

describe('no V1 lease model references in src/', () => {
  it('no V1 lease entity types in audit logs', () => {
    const hits = repoGrep(/entityType:\s*['"]LeaseContract['"]/);
    expect(hits).toHaveLength(0);
  });

  it('no V1 LeasePayment entity types in audit logs', () => {
    const hits = repoGrep(/entityType:\s*['"]LeasePayment['"]/);
    expect(hits).toHaveLength(0);
  });

  it('no exported V1 LeaseContract / LeasePayment interfaces', () => {
    const contractHits = repoGrep(/export\s+(interface|type)\s+LeaseContract[^2]/);
    const paymentHits = repoGrep(/export\s+(interface|type)\s+LeasePayment[^2S]/);
    expect(contractHits).toHaveLength(0);
    expect(paymentHits).toHaveLength(0);
  });
});
