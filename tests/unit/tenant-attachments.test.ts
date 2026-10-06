/**
 * tests/unit/tenant-attachments.test.ts
 *
 * Tenant attachments and the Attachment Type master: Create Tenant must
 * refuse a tenant without the mandatory Trade License, store the files with
 * the tenant, and clean the files up again when the database write fails.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

const TYPES = [
  { id: 't-trade', code: 'TRADE_LICENSE', name: 'Trade License', description: null, isMandatory: true, requiresExpiry: true, isActive: true, sortOrder: 10 },
  { id: 't-vat', code: 'VAT_CERTIFICATE', name: 'VAT Certificate', description: null, isMandatory: false, requiresExpiry: false, isActive: true, sortOrder: 30 },
  { id: 't-old', code: 'OLD', name: 'Retired type', description: null, isMandatory: false, requiresExpiry: false, isActive: false, sortOrder: 99 },
];

const st = vi.hoisted(() => ({
  uploads: [] as string[],
  deleted: [] as string[],
  inserts: [] as unknown[][],
  tenantCreates: [] as Record<string, unknown>[],
  failTenantCreate: false,
  attachmentRows: [] as { id: string }[],
}));

const tx = vi.hoisted(() => ({
  $queryRawUnsafe: async (sql: string) => {
    if (sql.includes('FROM tenant_attachment_types')) {
      return sql.includes('is_active = true') ? TYPES.filter((t) => t.isActive) : TYPES;
    }
    if (sql.includes('FROM tenant_attachments')) return st.attachmentRows;
    return [];
  },
  $executeRawUnsafe: async (sql: string, ...args: unknown[]) => {
    if (sql.includes('INSERT INTO tenant_attachments')) st.inserts.push(args);
    return 1;
  },
  $executeRaw: async () => 1,
  tenant: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      if (st.failTenantCreate) throw Object.assign(new Error('unique'), { code: 'P2002' });
      st.tenantCreates.push(data);
      return { id: data.id, name: data.name, modules: [] };
    },
  },
  tenantSettings: { upsert: async () => ({}) },
}));

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/rls', () => ({
  withPlatformAdmin: async (_p: unknown, fn: (t: unknown) => unknown) => fn(tx),
  withTenantRls: async (_p: unknown, _t: string, fn: (t: unknown) => unknown) => fn(tx),
}));
vi.mock('@/lib/storage', () => ({
  UPLOAD_URL_PREFIX: '/uploads/',
  getStorage: () => ({
    upload: async ({ originalName, prefix }: { originalName: string; prefix: string }) => {
      const key = `${prefix}/u-${st.uploads.length}-${originalName}`;
      st.uploads.push(key);
      return { url: `/uploads/${key}`, key, size: 10, mimeType: 'application/pdf', originalName };
    },
    delete: async (key: string) => { st.deleted.push(key); },
  }),
}));
vi.mock('@/lib/server-cache', () => ({ cacheRead: (fn: unknown) => fn, revalidateCache: async () => {} }));
vi.mock('@/lib/audited-action', () => ({ withAuditedAction: (h: unknown) => h }));
vi.mock('@/lib/tenant-context', () => ({
  requireAuthorizedTenant: () => ({ ok: true, tenantId: 'platform', userId: 'u1', role: 'SUPER_ADMIN' }),
  stripTenantOwnershipFields: (b: unknown) => b,
}));

import { NextRequest } from 'next/server';
import { attachmentUploadProblem, uploadsFromFormData } from '@/lib/tenant-attachments';
import { attachmentTypeInput } from '@/lib/attachment-type-input';
import { authorizeFileAccess } from '@/lib/storage/file-access';
import { POST as createTenant } from '@/app/api/admin/tenants/route';

const pdf = (name = 'licence.pdf') => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])], name, { type: 'application/pdf' });
const fake = (name: string) => new File([new TextEncoder().encode('MZ not a pdf')], name, { type: 'application/pdf' });

function createForm(files: Record<string, File>, extra: Record<string, string> = {}) {
  const form = new FormData();
  form.append('payload', JSON.stringify({ name: 'Acme Transport', enabledModules: ['rental'] }));
  for (const [typeId, f] of Object.entries(files)) form.append(`file:${typeId}`, f, f.name);
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return new NextRequest('http://x/api/admin/tenants', { method: 'POST', body: form });
}

beforeEach(() => {
  st.uploads = []; st.deleted = []; st.inserts = []; st.tenantCreates = [];
  st.failTenantCreate = false; st.attachmentRows = [];
});

describe('attachmentUploadProblem', () => {
  it('requires every active mandatory type', async () => {
    expect(await attachmentUploadProblem([], TYPES, { requireMandatory: true }))
      .toBe('Required attachment missing: Trade License');
    expect(await attachmentUploadProblem([], TYPES, { requireMandatory: false })).toBeNull();
  });

  it('accepts a real PDF with its required expiry date', async () => {
    const ok = [{ attachmentTypeId: 't-trade', file: pdf(), expiryDate: '2027-12-31' }];
    expect(await attachmentUploadProblem(ok, TYPES, { requireMandatory: true })).toBeNull();
  });

  it('rejects a missing expiry date, an inactive type and a file whose content is not a PDF', async () => {
    expect(await attachmentUploadProblem([{ attachmentTypeId: 't-trade', file: pdf() }], TYPES, { requireMandatory: true }))
      .toBe('Trade License: expiry date is required');
    expect(await attachmentUploadProblem([{ attachmentTypeId: 't-old', file: pdf() }], TYPES, { requireMandatory: false }))
      .toBe('Unknown or inactive attachment type');
    expect(await attachmentUploadProblem([{ attachmentTypeId: 't-vat', file: fake('cert.pdf') }], TYPES, { requireMandatory: false }))
      .toMatch(/^VAT Certificate: The file type is not accepted/);
  });
});

describe('uploadsFromFormData', () => {
  it('reads file:<typeId> with its document number and expiry date', () => {
    const form = new FormData();
    form.append('file:t-trade', pdf(), 'licence.pdf');
    form.append('documentNumber:t-trade', ' TL-123 ');
    form.append('expiryDate:t-trade', '2027-12-31');
    form.append('payload', '{}');
    const [u, ...rest] = uploadsFromFormData(form);
    expect(rest).toHaveLength(0);
    expect(u).toMatchObject({ attachmentTypeId: 't-trade', documentNumber: 'TL-123', expiryDate: '2027-12-31' });
    expect(u.file.name).toBe('licence.pdf');
  });
});

describe('attachmentTypeInput', () => {
  it('normalises the code and requires a name on create', () => {
    expect(attachmentTypeInput({ code: 'insurance cert', name: 'Insurance' }, { partial: false }))
      .toEqual({ ok: true, value: { code: 'INSURANCE_CERT', name: 'Insurance' } });
    expect(attachmentTypeInput({ code: 'X1' }, { partial: false }).ok).toBe(false);
    expect(attachmentTypeInput({ isMandatory: 'yes' }, { partial: true }).ok).toBe(false);
    expect(attachmentTypeInput({}, { partial: true })).toEqual({ ok: false, error: 'Nothing to update' });
  });
});

describe('POST /api/admin/tenants attachments', () => {
  it('refuses a tenant without the mandatory Trade License (JSON or multipart)', async () => {
    const json = await createTenant(new NextRequest('http://x/api/admin/tenants', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Acme' }),
    }));
    expect(json.status).toBe(400);
    expect((await json.json()).error).toBe('Required attachment missing: Trade License');

    const multi = await createTenant(createForm({ 't-vat': pdf('vat.pdf') }));
    expect(multi.status).toBe(400);
    expect(st.tenantCreates).toHaveLength(0);
    expect(st.uploads).toHaveLength(0);
  });

  it('creates the tenant and stores its documents under the tenant folder', async () => {
    const res = await createTenant(createForm(
      { 't-trade': pdf(), 't-vat': pdf('vat.pdf') },
      { 'expiryDate:t-trade': '2027-12-31', 'documentNumber:t-trade': 'TL-1' },
    ));
    expect(res.status).toBe(201);
    const tenantId = st.tenantCreates[0].id as string;
    expect(tenantId).toMatch(/^[0-9a-f-]{36}$/);
    expect(st.uploads.every((k) => k.startsWith(`tenant-attachments/${tenantId}/`))).toBe(true);
    expect(st.inserts).toHaveLength(2);
    expect(st.inserts[0]).toEqual(expect.arrayContaining([tenantId, 't-trade', 'TL-1', '2027-12-31']));
    expect(st.deleted).toHaveLength(0);
  });

  it('removes the stored files when the tenant cannot be created', async () => {
    st.failTenantCreate = true;
    const res = await createTenant(createForm({ 't-trade': pdf() }, { 'expiryDate:t-trade': '2027-12-31' }));
    expect(res.status).toBe(409);
    expect(st.uploads).toHaveLength(1);
    expect(st.deleted).toEqual(st.uploads);
  });
});

describe('authorizeFileAccess tenant-attachments', () => {
  const key = 'tenant-attachments/tenant-a/u-0-licence.pdf';

  it('lets the tenant itself and platform admins open a document that is on file', async () => {
    st.attachmentRows = [{ id: 'a1' }];
    expect((await authorizeFileAccess(key, { kind: 'staff', tenantId: 'tenant-a', userId: 'u' })).allowed).toBe(true);
    expect((await authorizeFileAccess(key, { kind: 'staff', tenantId: 'platform', userId: 'u', isPlatformAdmin: true })).allowed).toBe(true);
  });

  it('refuses other tenants, anonymous callers and removed documents', async () => {
    st.attachmentRows = [{ id: 'a1' }];
    expect((await authorizeFileAccess(key, { kind: 'staff', tenantId: 'tenant-b', userId: 'u' })).allowed).toBe(false);
    expect((await authorizeFileAccess(key, { kind: 'anonymous' })).allowed).toBe(false);
    st.attachmentRows = [];
    expect((await authorizeFileAccess(key, { kind: 'staff', tenantId: 'tenant-a', userId: 'u' })).allowed).toBe(false);
  });
});
