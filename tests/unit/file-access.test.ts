/**
 * tests/unit/file-access.test.ts
 *
 * Stored files (/uploads/*) were served from public/ by Next.js without any
 * authorization. They now go through middleware to /api/files, which checks
 * the caller against the file's owning record.
 *
 * Covered:
 *  - storage keys: traversal, encoded and malformed segments are refused
 *  - middleware: /uploads/* and /api/files/* always reach the authorizer;
 *    forged identity headers are dropped, a verified session's are forwarded
 *  - authorizeFileAccess: branding public (images only); lease documents only
 *    in the caller's tenant; portal lessees only their own record/contracts;
 *    rental handover files only for the tenant's own booking; unknown prefixes
 *  - GET /api/files: anonymous 401, cross-tenant 404, owner 200 with private,
 *    no-store, nosniff and sandbox headers; files are read from disk directly
 *
 * The database is an in-memory stand-in behind a mocked withTenantRls.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

// Set before the storage module loads; the directory is created in beforeAll.
const env = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR || '/tmp'}/fleet360-files-${process.pid}-${Date.now()}`;
  process.env.FILE_STORAGE_DIR = dir;
  return { dir };
});

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

const db = vi.hoisted(() => ({
  leaseDocuments: [] as Array<{ tenantId: string; fileUrl: string; entityType: string; entityId: string }>,
  contracts: [] as Array<{ id: string; tenantId: string; lesseeId: string }>,
  bookings: [] as Array<{ id: string; tenantId: string }>,
  rlsTenants: [] as string[],
}));

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/rls', () => ({
  withTenantRls: async (_p: unknown, tenantId: string, fn: (tx: unknown) => unknown) => {
    db.rlsTenants.push(tenantId);
    // RLS stand-in: only the context tenant's rows are visible.
    const visible = <T extends { tenantId: string }>(rows: T[]) => rows.filter((r) => r.tenantId === tenantId);
    return fn({
      leaseDocument: {
        findFirst: async ({ where }: { where: { tenantId: string; fileUrl: string } }) =>
          visible(db.leaseDocuments).find((d) => d.tenantId === where.tenantId && d.fileUrl === where.fileUrl) ?? null,
      },
      leaseContract2: {
        findFirst: async ({ where }: { where: { id: string; tenantId: string; lesseeId: string } }) =>
          visible(db.contracts).find((c) => c.id === where.id && c.tenantId === where.tenantId && c.lesseeId === where.lesseeId) ?? null,
      },
      rentalBooking: {
        findFirst: async ({ where }: { where: { id: string; tenantId: string } }) =>
          visible(db.bookings).find((b) => b.id === where.id && b.tenantId === where.tenantId) ?? null,
      },
    });
  },
}));
vi.mock('@/lib/leasing-portal/auth', async () => {
  const { NextResponse } = await import('next/server.js');
  return {
    // Cookie value "lessee:<tenant>:<lesseeId>" stands in for a verified portal session.
    requireLeasingPortal: async (req: { cookies: { get(n: string): { value: string } | undefined } }) => {
      const v = req.cookies.get('leasing-portal-session')?.value;
      const m = v?.match(/^lessee:([^:]+):(.+)$/);
      return m
        ? { tenantId: m[1], lesseeId: m[2], userId: 'portal-user' }
        : NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    },
  };
});

import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';
import { signSession } from '@/lib/tenant-session';
import { normalizeStorageKey } from '@/lib/storage';
import { storedFileKey } from '@/lib/storage/stored-file-path';
import { authorizeFileAccess, type FileCaller } from '@/lib/storage/file-access';
import { GET } from '@/app/api/files/[...key]/route';

const staffA: FileCaller = { kind: 'staff', tenantId: TENANT_A, userId: 'u-a' };
const staffB: FileCaller = { kind: 'staff', tenantId: TENANT_B, userId: 'u-b' };
const anon: FileCaller = { kind: 'anonymous' };

const LEASE_KEY = 'leasing/contract/c-1/0b7c2f7e-1111-4222-8333-444455556666-emirates-id.pdf';
const PORTAL_KEY = 'leasing-portal/lessee/lessee-1/0b7c2f7e-1111-4222-8333-444455556667-licence.pdf';
const RENTAL_KEY = 'rental/handover/booking-a/0b7c2f7e-1111-4222-8333-444455556668-sig-booking-.png';
const LOGO_KEY = `branding/${TENANT_A}/0b7c2f7e-1111-4222-8333-444455556669-logo.png`;

function writeFile(key: string, body: string) {
  const abs = path.join(env.dir, ...key.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

beforeAll(() => {
  fs.mkdirSync(env.dir, { recursive: true });
  db.leaseDocuments.push(
    { tenantId: TENANT_A, fileUrl: `/uploads/${LEASE_KEY}`, entityType: 'CONTRACT', entityId: 'c-1' },
    { tenantId: TENANT_A, fileUrl: `/uploads/${PORTAL_KEY}`, entityType: 'LESSEE', entityId: 'lessee-1' },
  );
  db.contracts.push({ id: 'c-1', tenantId: TENANT_A, lesseeId: 'lessee-1' });
  db.bookings.push({ id: 'booking-a', tenantId: TENANT_A });
  for (const k of [LEASE_KEY, PORTAL_KEY, RENTAL_KEY, LOGO_KEY]) writeFile(k, `content of ${k}`);
  writeFile(`branding/${TENANT_A}/0b7c2f7e-1111-4222-8333-44445555666a-page.html`, '<script>alert(1)</script>');
});

describe('storage keys', () => {
  it.each([
    ['../etc/passwd'],
    ['leasing/../../secret'],
    ['leasing/%2e%2e/x.pdf'],
    ['/leasing/x.pdf'],
    ['leasing//x.pdf'],
    ['leasing\\x.pdf'],
    ['leasing/./x.pdf'],
    [''],
  ])('refuses %j', (raw) => {
    expect(normalizeStorageKey(raw)).toBeNull();
  });

  it('accepts keys the upload routes write', () => {
    expect(normalizeStorageKey(LEASE_KEY)).toBe(LEASE_KEY);
  });

  it('recognises both stored-file URL forms and nothing else', () => {
    expect(storedFileKey(`/uploads/${LEASE_KEY}`)).toBe(LEASE_KEY);
    expect(storedFileKey(`/api/files/${LEASE_KEY}`)).toBe(LEASE_KEY);
    expect(storedFileKey('/api/leasing/documents')).toBeNull();
    expect(storedFileKey('/uploadsx/a')).toBeNull();
  });
});

describe('middleware routes stored files to the authorizer', () => {
  const rewriteTarget = (res: Response) => res.headers.get('x-middleware-rewrite');

  it('rewrites /uploads/* for an anonymous caller and drops forged identity headers', async () => {
    const res = await middleware(new NextRequest(`http://localhost/uploads/${LEASE_KEY}`, {
      headers: { 'x-tenant-id': TENANT_A, 'x-user-id': 'forged', 'x-user-role': 'SUPER_ADMIN' },
    }));
    expect(rewriteTarget(res)).toBe(`http://localhost/api/files/${LEASE_KEY}`);
    expect(res.headers.get('x-middleware-request-x-tenant-id')).toBeNull();
    expect(res.headers.get('x-middleware-request-x-user-role')).toBeNull();
  });

  it('forwards the verified session identity, not the client headers', async () => {
    const token = await signSession({ userId: 'u-b', tenantId: TENANT_B, plan: 'ENTERPRISE', role: 'TENANT_ADMIN' });
    const res = await middleware(new NextRequest(`http://localhost/uploads/${LEASE_KEY}`, {
      headers: { cookie: `xl-session=${token}`, 'x-tenant-id': TENANT_A },
    }));
    expect(rewriteTarget(res)).toBe(`http://localhost/api/files/${LEASE_KEY}`);
    expect(res.headers.get('x-middleware-request-x-tenant-id')).toBe(TENANT_B);
  });

  it('also routes direct /api/files/* requests through the same path', async () => {
    const res = await middleware(new NextRequest(`http://localhost/api/files/${LEASE_KEY}`, {
      headers: { 'x-tenant-id': TENANT_A },
    }));
    expect(rewriteTarget(res)).toBe(`http://localhost/api/files/${LEASE_KEY}`);
    expect(res.headers.get('x-middleware-request-x-tenant-id')).toBeNull();
  });
});

describe('authorizeFileAccess', () => {
  it('serves branding to anyone, images only', async () => {
    expect(await authorizeFileAccess(LOGO_KEY, anon)).toMatchObject({ allowed: true, imageOnly: true });
  });

  it('lets staff read their own tenant lease document', async () => {
    expect((await authorizeFileAccess(LEASE_KEY, staffA)).allowed).toBe(true);
  });

  it('refuses another tenant staff and anonymous callers for a lease document', async () => {
    expect((await authorizeFileAccess(LEASE_KEY, staffB)).allowed).toBe(false);
    expect((await authorizeFileAccess(LEASE_KEY, anon)).allowed).toBe(false);
  });

  it('lets a portal lessee read documents on their own record and contracts only', async () => {
    const own: FileCaller = { kind: 'leasing-portal', tenantId: TENANT_A, lesseeId: 'lessee-1' };
    const other: FileCaller = { kind: 'leasing-portal', tenantId: TENANT_A, lesseeId: 'lessee-2' };
    const foreign: FileCaller = { kind: 'leasing-portal', tenantId: TENANT_B, lesseeId: 'lessee-1' };
    expect((await authorizeFileAccess(PORTAL_KEY, own)).allowed).toBe(true);
    expect((await authorizeFileAccess(LEASE_KEY, own)).allowed).toBe(true);
    expect((await authorizeFileAccess(PORTAL_KEY, other)).allowed).toBe(false);
    expect((await authorizeFileAccess(LEASE_KEY, other)).allowed).toBe(false);
    expect((await authorizeFileAccess(PORTAL_KEY, foreign)).allowed).toBe(false);
  });

  it('limits rental handover files to staff of the booking tenant', async () => {
    expect((await authorizeFileAccess(RENTAL_KEY, staffA)).allowed).toBe(true);
    expect((await authorizeFileAccess(RENTAL_KEY, staffB)).allowed).toBe(false);
    expect((await authorizeFileAccess(RENTAL_KEY, { kind: 'leasing-portal', tenantId: TENANT_A, lesseeId: 'lessee-1' })).allowed).toBe(false);
  });

  it('refuses unknown prefixes even for signed-in staff', async () => {
    expect((await authorizeFileAccess('misc/x.pdf', staffA)).allowed).toBe(false);
  });

  it('checks ownership under the caller tenant context', async () => {
    db.rlsTenants.length = 0;
    await authorizeFileAccess(LEASE_KEY, staffB);
    expect(db.rlsTenants).toEqual([TENANT_B]);
  });
});

describe('GET /api/files', () => {
  const call = (key: string, headers: Record<string, string> = {}) =>
    GET(new NextRequest(`http://localhost/api/files/${key}`, { headers }), {
      params: Promise.resolve({ key: key.split('/') }),
    });
  // Headers as middleware sets them from a verified session.
  const staffHeaders = (tenantId: string) => ({ 'x-tenant-id': tenantId, 'x-user-id': 'u', 'x-user-role': 'TENANT_ADMIN' });

  it('returns 401 to an anonymous caller', async () => {
    expect((await call(LEASE_KEY)).status).toBe(401);
  });

  it('returns 404 to another tenant, exactly as for a missing file', async () => {
    const res = await call(LEASE_KEY, staffHeaders(TENANT_B));
    expect(res.status).toBe(404);
    expect((await call('leasing/contract/c-1/missing.pdf', staffHeaders(TENANT_A))).status).toBe(404);
  });

  it('streams the file to its tenant with private, sandboxed headers', async () => {
    const res = await call(LEASE_KEY, staffHeaders(TENANT_A));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(`content of ${LEASE_KEY}`);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
  });

  it('serves a portal lessee through their portal session', async () => {
    const res = await call(PORTAL_KEY, { cookie: `leasing-portal-session=lessee:${TENANT_A}:lessee-1` });
    expect(res.status).toBe(200);
    const other = await call(PORTAL_KEY, { cookie: `leasing-portal-session=lessee:${TENANT_A}:lessee-2` });
    expect(other.status).toBe(404);
  });

  it('serves logos publicly but never non-image content from branding/', async () => {
    const logo = await call(LOGO_KEY);
    expect(logo.status).toBe(200);
    expect(logo.headers.get('content-type')).toBe('image/png');
    expect((await call(`branding/${TENANT_A}/0b7c2f7e-1111-4222-8333-44445555666a-page.html`)).status).toBe(404);
  });

  it('refuses traversal keys before touching the disk', async () => {
    const res = await GET(new NextRequest('http://localhost/api/files/x'), {
      params: Promise.resolve({ key: ['..', '..', 'etc', 'passwd'] }),
    });
    expect(res.status).toBe(404);
  });
});

afterAll(() => fs.rmSync(env.dir, { recursive: true, force: true }));
