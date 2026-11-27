import fs from 'node:fs';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

const env = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR || '/tmp'}/fleet360-cp-uploads-${process.pid}-${Date.now()}`;
  process.env.FILE_STORAGE_DIR = dir;
  process.env.STORAGE_BACKEND = 'local';
  return { dir };
});

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const CUST_A = 'aaaa1111-1111-4111-8111-111111111111';
const CUST_B = 'bbbb2222-2222-4222-8222-222222222222';

const state = vi.hoisted(() => ({
  activeCustomerId: 'aaaa1111-1111-4111-8111-111111111111',
  activeTenantId: '11111111-1111-4111-8111-111111111111',
}));

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/sentry', () => ({ captureException: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/rls', () => ({
  withTenantRls: async (_p: unknown, _t: string, fn: (tx: unknown) => unknown) => fn({}),
}));
vi.mock('@/lib/customer-portal/session', () => ({
  requireCustomerPortal: vi.fn(async () => ({
    tenantId: state.activeTenantId,
    customerId: state.activeCustomerId,
    user: { id: 'cp-user-1', email: 'requester@acme.ae', fullName: 'Acme Requester', role: 'REQUESTER' },
  })),
}));

import { NextRequest } from 'next/server';
import { resetStorageForTests, readStoredFile } from '@/lib/storage';
import { authorizeFileAccess, type FileCaller } from '@/lib/storage/file-access';
import { POST, DELETE } from '@/app/api/customer-portal/transport/uploads/route';

const VALID_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const VALID_PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF', 'utf8');
const SPOOFED_HTML = Buffer.from('<script>alert(1)</script>', 'utf8');

function makeUploadReq(domain: string, docType: string, fileName: string, content: Buffer, mimeType: string) {
  const fd = new FormData();
  fd.append('domain', domain);
  fd.append('docType', docType);
  fd.append('file', new File([new Uint8Array(content)], fileName, { type: mimeType }));
  return new NextRequest('http://localhost/api/customer-portal/transport/uploads', {
    method: 'POST',
    body: fd,
  });
}

beforeAll(() => {
  fs.mkdirSync(env.dir, { recursive: true });
  resetStorageForTests();
});

afterAll(() => {
  fs.rmSync(env.dir, { recursive: true, force: true });
  resetStorageForTests();
});

describe('Customer Portal Transport Cloud Storage Uploads & Authorization', () => {
  const customerA: FileCaller = { kind: 'customer-portal', tenantId: TENANT_A, customerId: CUST_A, userId: 'u-a' };
  const customerB: FileCaller = { kind: 'customer-portal', tenantId: TENANT_A, customerId: CUST_B, userId: 'u-b' };
  const staffA: FileCaller = { kind: 'staff', tenantId: TENANT_A, userId: 'staff-a' };
  const staffB: FileCaller = { kind: 'staff', tenantId: TENANT_B, userId: 'staff-b' };
  const anon: FileCaller = { kind: 'anonymous' };

  it('enforces customer-to-customer and cross-tenant isolation in authorizeFileAccess', async () => {
    const photoKey = `customer-portal/${TENANT_A}/${CUST_A}/school-bus/student-photo/00000000-0000-4000-8000-000000000001-student.png`;
    const invKey = `customer-portal/${TENANT_A}/${CUST_A}/logistics/commercial-invoice/00000000-0000-4000-8000-000000000002-inv.pdf`;

    expect((await authorizeFileAccess(photoKey, anon)).allowed).toBe(false);
    expect((await authorizeFileAccess(photoKey, customerB)).allowed).toBe(false);
    expect((await authorizeFileAccess(photoKey, staffB)).allowed).toBe(false);

    expect(await authorizeFileAccess(photoKey, customerA)).toEqual({
      allowed: true,
      category: 'customer-portal-attachment',
      imageOnly: true,
    });
    expect(await authorizeFileAccess(photoKey, staffA)).toEqual({
      allowed: true,
      category: 'customer-portal-attachment',
      imageOnly: true,
    });
    expect(await authorizeFileAccess(invKey, customerA)).toEqual({
      allowed: true,
      category: 'customer-portal-attachment',
      imageOnly: false,
    });
    expect(await authorizeFileAccess(invKey, staffA)).toEqual({
      allowed: true,
      category: 'customer-portal-attachment',
      imageOnly: false,
    });
  });

  it('uploads under customer-scoped storage prefix and blocks cross-customer deletion', async () => {
    state.activeTenantId = TENANT_A;
    state.activeCustomerId = CUST_A;

    const res = await POST(makeUploadReq('school-bus', 'student-photo', 'student.png', VALID_PNG, 'image/png'));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.file.url).toMatch(new RegExp(`^/uploads/customer-portal/${TENANT_A}/${CUST_A}/school-bus/student-photo/`));
    expect((await readStoredFile(body.file.key))?.equals(VALID_PNG)).toBe(true);

    // Another customer in the SAME tenant cannot delete Customer A's file
    state.activeCustomerId = CUST_B;
    const crossCustomerDel = await DELETE(
      new NextRequest(`http://localhost/api/customer-portal/transport/uploads?key=${encodeURIComponent(body.file.key)}`, {
        method: 'DELETE',
      }),
    );
    expect(crossCustomerDel.status).toBe(404);

    // Customer A can delete its own file
    state.activeCustomerId = CUST_A;
    const ownDel = await DELETE(
      new NextRequest(`http://localhost/api/customer-portal/transport/uploads?key=${encodeURIComponent(body.file.key)}`, {
        method: 'DELETE',
      }),
    );
    expect(ownDel.status).toBe(200);
    expect(await readStoredFile(body.file.key)).toBeNull();
  });

  it('validates file magic bytes and accepts Logistics PDF documents', async () => {
    state.activeTenantId = TENANT_A;
    state.activeCustomerId = CUST_A;

    const invRes = await POST(makeUploadReq('logistics', 'commercial-invoice', 'CI-99.pdf', VALID_PDF, 'application/pdf'));
    expect(invRes.status).toBe(201);

    const spoofRes = await POST(makeUploadReq('school-bus', 'student-photo', 'xss.png', SPOOFED_HTML, 'image/png'));
    expect(spoofRes.status).toBe(400);

    const pdfPhotoRes = await POST(makeUploadReq('school-bus', 'student-photo', 'not-image.pdf', VALID_PDF, 'application/pdf'));
    expect(pdfPhotoRes.status).toBe(400);
  });
});
