import fs from 'node:fs';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

const env = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR || '/tmp'}/fleet360-bp-uploads-${process.pid}-${Date.now()}`;
  process.env.FILE_STORAGE_DIR = dir;
  process.env.STORAGE_BACKEND = 'local';
  return { dir };
});

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock('@/lib/sentry', () => ({ captureException: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/rls', () => ({
  withTenantRls: async (_p: unknown, _t: string, fn: (tx: unknown) => unknown) => fn({}),
}));

import { NextRequest } from 'next/server';
import { resetStorageForTests, readStoredFile } from '@/lib/storage';
import { authorizeFileAccess, type FileCaller } from '@/lib/storage/file-access';
import { POST, DELETE } from '@/app/api/booking-portal/uploads/route';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

// Minimal valid magic-byte payloads
const VALID_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const VALID_PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF', 'utf8');
const SPOOFED_HTML = Buffer.from('<script>alert(1)</script>', 'utf8');

function authHeaders(tenantId = TENANT_A): Record<string, string> {
  return {
    'x-tenant-id': tenantId,
    'x-user-id': 'user-1',
    'x-user-role': 'TENANT_ADMIN',
  };
}

function makeUploadReq(domain: string, docType: string, fileName: string, content: Buffer, mimeType: string, tenantId = TENANT_A) {
  const fd = new FormData();
  fd.append('domain', domain);
  fd.append('docType', docType);
  fd.append('file', new File([new Uint8Array(content)], fileName, { type: mimeType }));
  return new NextRequest('http://localhost/api/booking-portal/uploads', {
    method: 'POST',
    headers: authHeaders(tenantId),
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

describe('Booking Portal Cloud Storage Uploads & Authorization', () => {
  const staffA: FileCaller = { kind: 'staff', tenantId: TENANT_A, userId: 'u-a' };
  const staffB: FileCaller = { kind: 'staff', tenantId: TENANT_B, userId: 'u-b' };
  const anon: FileCaller = { kind: 'anonymous' };

  it('enforces tenant isolation and imageOnly on booking-portal storage keys in authorizeFileAccess', async () => {
    const photoKey = `booking-portal/${TENANT_A}/school-bus/student-photo/00000000-0000-4000-8000-000000000001-kid.png`;
    const invoiceKey = `booking-portal/${TENANT_A}/logistics/commercial-invoice/00000000-0000-4000-8000-000000000002-inv.pdf`;
    const badDomainKey = `booking-portal/${TENANT_A}/executive/passport/00000000-0000-4000-8000-000000000003-id.pdf`;

    expect((await authorizeFileAccess(photoKey, anon)).allowed).toBe(false);
    expect((await authorizeFileAccess(photoKey, staffB)).allowed).toBe(false);
    expect((await authorizeFileAccess(badDomainKey, staffA)).allowed).toBe(false);

    const photoDecision = await authorizeFileAccess(photoKey, staffA);
    expect(photoDecision).toEqual({ allowed: true, category: 'booking-portal-attachment', imageOnly: true });

    const invoiceDecision = await authorizeFileAccess(invoiceKey, staffA);
    expect(invoiceDecision).toEqual({ allowed: true, category: 'booking-portal-attachment', imageOnly: false });
  });

  it('uploads a valid student photo to school-bus storage and allows same-tenant deletion', async () => {
    const res = await POST(makeUploadReq('school-bus', 'student-photo', 'student.png', VALID_PNG, 'image/png'));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.file.url).toMatch(new RegExp(`^/uploads/booking-portal/${TENANT_A}/school-bus/student-photo/`));
    expect(body.file.docType).toBe('student-photo');

    const storedBytes = await readStoredFile(body.file.key);
    expect(storedBytes).not.toBeNull();
    expect(storedBytes!.equals(VALID_PNG)).toBe(true);

    // Cross-tenant delete must fail with 404
    const crossDel = await DELETE(
      new NextRequest(`http://localhost/api/booking-portal/uploads?key=${encodeURIComponent(body.file.key)}`, {
        method: 'DELETE',
        headers: authHeaders(TENANT_B),
      })
    );
    expect(crossDel.status).toBe(404);

    // Same-tenant delete succeeds and removes stored object
    const ownDel = await DELETE(
      new NextRequest(`http://localhost/api/booking-portal/uploads?key=${encodeURIComponent(body.file.key)}`, {
        method: 'DELETE',
        headers: authHeaders(TENANT_A),
      })
    );
    expect(ownDel.status).toBe(200);
    expect(await readStoredFile(body.file.key)).toBeNull();
  });

  it('uploads valid Logistics commercial invoice & MSDS PDFs', async () => {
    const invRes = await POST(makeUploadReq('logistics', 'commercial-invoice', 'INV-2026.pdf', VALID_PDF, 'application/pdf'));
    expect(invRes.status).toBe(201);
    const invBody = await invRes.json();
    expect(invBody.file.key).toContain(`booking-portal/${TENANT_A}/logistics/commercial-invoice/`);

    const msdsRes = await POST(makeUploadReq('logistics', 'msds', 'UN1950-MSDS.pdf', VALID_PDF, 'application/pdf'));
    expect(msdsRes.status).toBe(201);
  });

  it('rejects spoofed HTML disguised as image and rejects PDFs in student-photo slot', async () => {
    const spoofRes = await POST(makeUploadReq('school-bus', 'student-photo', 'evil.png', SPOOFED_HTML, 'image/png'));
    expect(spoofRes.status).toBe(400);

    const pdfInPhotoRes = await POST(makeUploadReq('school-bus', 'student-photo', 'doc.pdf', VALID_PDF, 'application/pdf'));
    expect(pdfInPhotoRes.status).toBe(400);

    const badDomainRes = await POST(makeUploadReq('executive', 'commercial-invoice', 'INV.pdf', VALID_PDF, 'application/pdf'));
    expect(badDomainRes.status).toBe(400);
  });
});
