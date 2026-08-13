/**
 * Architectural test: every page.tsx under src/app/ is covered by the
 * middleware route policy.
 *
 * Why this test exists:
 *   src/middleware.ts redirects unauthenticated UI requests to /login
 *   only for pathnames listed in PROTECTED_UI_PREFIXES (or lets them
 *   through if listed in PUBLIC_EXACT / PUBLIC_PREFIXES). Any page
 *   that is NOT in either list will render unauthenticated and crash
 *   inside the server component when Prisma queries fire with no
 *   tenant context.
 *
 *   This test scans src/app/ for every page.tsx and confirms its
 *   top-level segment is covered. Adding a new module under src/app/?
 *   Either add the prefix to PROTECTED_UI_PREFIXES (tenant-scoped UI)
 *   or to the public lists (truly public). The test fails until you do.
 *
 *   Audit history: docs/AUDIT_PROTECTED_UI_PREFIXES.md.
 *
 * Prerequisites: none — pure file-system test, no DB or server required.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  isPublicPath,
  isProtectedUiPath,
  isRouted,
  topLevelSegment,
  PUBLIC_EXACT,
  PUBLIC_PREFIXES,
  PROTECTED_UI_PREFIXES,
} from '@/lib/auth-route-policies';

// ── Helpers ──────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '../..');
const APP_DIR = path.join(REPO_ROOT, 'src', 'app');

/**
 * Recursively collect every page.tsx path under src/app/, returned as
 * a URL-style path (forward slashes, leading slash) so it can be fed
 * into the policy functions.
 */
function collectPagePaths(root: string, dir = root, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip Next.js private dirs and dynamic-route bucket
      if (entry.name.startsWith('_') || entry.name === 'node_modules') continue;
      collectPagePaths(root, full, acc);
    } else if (entry.name === 'page.tsx' || entry.name === 'page.ts') {
      // Strip Next.js route group segments (e.g. "(app)") from the
      // returned path — parentheses are URL-orthogonal in the Next.js
      // routing model, so src/app/(app)/logistics/page.tsx serves at
      // /logistics, not /(app)/logistics. Without this strip, the test
      // would see a phantom top-level segment of "/(app)" and complain
      // about it being orphaned.
      const rel = path.relative(root, dir).replace(/\\/g, '/');
      const urlPath = '/' + rel.split('/').filter(seg => !seg.startsWith('(')).join('/');
      acc.push(urlPath);
    }
  }
  return acc;
}

// ── Pure-function unit tests ─────────────────────────────────────────────────

describe('auth-route-policies helpers', () => {
  describe('topLevelSegment()', () => {
    it('extracts the first path segment with a leading slash', () => {
      expect(topLevelSegment('/customer/my-bookings/x')).toBe('/customer');
      expect(topLevelSegment('/login')).toBe('/login');
      expect(topLevelSegment('/api/auth/login')).toBe('/api');
    });

    it('returns "/" for empty or root inputs', () => {
      expect(topLevelSegment('/')).toBe('/');
      expect(topLevelSegment('')).toBe('/');
    });
  });

  describe('isPublicPath()', () => {
    it('matches PUBLIC_EXACT entries', () => {
      expect(isPublicPath('/login')).toBe(true);
      expect(isPublicPath('/api/health')).toBe(true);
    });

    it('matches PUBLIC_PREFIXES prefixes', () => {
      expect(isPublicPath('/shipper-portal/shipments')).toBe(true);
      expect(isPublicPath('/carrier-portal/abc-123')).toBe(true);
      expect(isPublicPath('/api/driver-app/heartbeat')).toBe(true);
    });

    it('does not match protected or unknown paths', () => {
      expect(isPublicPath('/fleet')).toBe(false);
      expect(isPublicPath('/finance/invoices')).toBe(false);
      expect(isPublicPath('/some/random/page')).toBe(false);
    });
  });

  describe('isProtectedUiPath()', () => {
    it('matches every PROTECTED_UI_PREFIXES prefix', () => {
      for (const prefix of PROTECTED_UI_PREFIXES) {
        expect(isProtectedUiPath(prefix)).toBe(true);
        expect(isProtectedUiPath(prefix + '/sub/path')).toBe(true);
      }
    });

    it('does not match public or unknown paths', () => {
      expect(isProtectedUiPath('/login')).toBe(false);
      expect(isProtectedUiPath('/platform')).toBe(false);
      expect(isProtectedUiPath('/sign/one-time-token')).toBe(false);
      expect(isProtectedUiPath('/unknown')).toBe(false);
    });

    it('protects every formerly ambiguous operator UI surface', () => {
      for (const path of [
        '/booking-portal',
        '/customer',
        '/mobile-apps',
        '/portal/acme',
        '/driver/feedback',
        '/approvals',
      ]) {
        expect(isProtectedUiPath(path)).toBe(true);
      }
    });
  });

  describe('isRouted()', () => {
    it('returns true for public or protected, false for neither', () => {
      expect(isRouted('/login')).toBe(true);
      expect(isRouted('/fleet')).toBe(true);
      expect(isRouted('/random-unknown-page-xyz')).toBe(false);
    });
  });

  describe('list invariants', () => {
    it('PUBLIC_PREFIXES entries all start with "/"', () => {
      for (const p of PUBLIC_PREFIXES) expect(p.startsWith('/')).toBe(true);
    });

    it('PROTECTED_UI_PREFIXES entries all start with "/"', () => {
      for (const p of PROTECTED_UI_PREFIXES) expect(p.startsWith('/')).toBe(true);
    });

    it('no protected prefix is a duplicate of an exact public path', () => {
      for (const p of PROTECTED_UI_PREFIXES) {
        expect(PUBLIC_EXACT.includes(p)).toBe(false);
      }
    });
  });
});

// ── Architectural invariant ──────────────────────────────────────────────────

describe('every src/app/<X>/page.tsx is covered by a route policy', () => {
  const pages = collectPagePaths(APP_DIR);

  it('finds at least one page.tsx under src/app/ (sanity check)', () => {
    expect(pages.length).toBeGreaterThan(50);
  });

  it('every page\'s top-level segment is in PROTECTED_UI_PREFIXES or PUBLIC_*', () => {
    const orphans: Array<{ page: string; segment: string }> = [];

    for (const pagePath of pages) {
      const segment = topLevelSegment(pagePath);
      // /api/* is API, handled by the 401-JSON branch in middleware, not
      // the redirect branch — it's "routed" via the API check.
      if (segment === '/api') continue;
      if (isRouted(pagePath)) continue;
      orphans.push({ page: pagePath, segment });
    }

    if (orphans.length > 0) {
      const lines = orphans.map(o => `  ${o.page}  (top-level: ${o.segment})`).join('\n');
      throw new Error(
        `Found ${orphans.length} page.tsx files whose top-level segment ` +
        `is not in PROTECTED_UI_PREFIXES or PUBLIC_*. Either:\n` +
        `  • add the segment to PROTECTED_UI_PREFIXES in src/lib/auth-route-policies.ts (tenant-scoped UI), or\n` +
        `  • add it to PUBLIC_EXACT / PUBLIC_PREFIXES (truly public), or\n` +
        `  • add it to AMBIGUOUS_TOP_LEVEL_SEGMENTS in this test if you need a product-owner decision first.\n\n` +
        `Orphan pages:\n${lines}`,
      );
    }
  });
});
