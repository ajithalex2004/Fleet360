/**
 * tests/unit/attachment-autofill-route.test.ts
 *
 * POST /api/admin/attachment-types/[id]/autofill: suggestions only, never
 * for a tenant whose data must stay in a region, and not when the platform
 * setting ff_attachment_autofill is off.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

const st = vi.hoisted(() => ({
  setting: 'true' as string | null,
  residency: 'GLOBAL',
  autofillCalls: 0,
}));

const tx = vi.hoisted(() => ({
  $queryRawUnsafe: async (sql: string) => {
    if (sql.includes('platform_settings')) return st.setting === null ? [] : [{ value: st.setting }];
    if (sql.includes('FROM tenant_attachment_types')) {
      return [{ id: 't-trade', code: 'TRADE_LICENSE', name: 'Trade License', description: null, isMandatory: true, requiresExpiry: true, isActive: true, sortOrder: 10 }];
    }
    return [];
  },
  tenant: { findUnique: async () => ({ dataResidency: st.residency }) },
}));

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/rls', () => ({ withPlatformAdmin: async (_p: unknown, fn: (t: unknown) => unknown) => fn(tx) }));
vi.mock('@/lib/audited-action', () => ({ withAuditedAction: (h: unknown) => h }));
vi.mock('@/lib/tenant-context', () => ({
  requireAuthorizedTenant: () => ({ ok: true, tenantId: 'platform', userId: 'u1', role: 'SUPER_ADMIN' }),
}));
vi.mock('@/lib/tenant-attachments-autofill', () => ({
  autofillAttachment: async () => {
    st.autofillCalls++;
    return { status: 'ok', documentNumber: 'CN-1', expiryDate: '2027-12-31', confidence: 0.9, warnings: [] };
  },
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/admin/attachment-types/[id]/autofill/route';

const pdf = () => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])], 'tl.pdf', { type: 'application/pdf' });
const call = (typeId: string, opts: { tenantId?: string; file?: File } = {}) => {
  const form = new FormData();
  form.append('file', opts.file ?? pdf(), (opts.file ?? pdf()).name);
  if (opts.tenantId) form.append('tenantId', opts.tenantId);
  return POST(new NextRequest(`http://x/api/admin/attachment-types/${typeId}/autofill`, { method: 'POST', body: form }),
    { params: Promise.resolve({ id: typeId }) });
};

beforeEach(() => { st.setting = 'true'; st.residency = 'GLOBAL'; st.autofillCalls = 0; });

describe('attachment autofill route', () => {
  it('returns the suggestions read from the document', async () => {
    const res = await call('t-trade');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', documentNumber: 'CN-1', expiryDate: '2027-12-31' });
  });

  it('is on when the setting has never been saved', async () => {
    st.setting = null;
    expect((await (await call('t-trade')).json()).status).toBe('ok');
  });

  it('does not read anything when the platform setting is off', async () => {
    st.setting = 'false';
    const body = await (await call('t-trade')).json();
    expect(body.status).toBe('skipped');
    expect(st.autofillCalls).toBe(0);
  });

  it('never sends the document of a region-resident tenant', async () => {
    st.residency = 'UAE';
    const body = await (await call('t-trade', { tenantId: 'tenant-uae' })).json();
    expect(body).toEqual({ status: 'skipped', reason: "Not read automatically: this tenant's data must stay in UAE." });
    expect(st.autofillCalls).toBe(0);
  });

  it('rejects unknown types and files that are not what they claim to be', async () => {
    expect((await call('t-nope')).status).toBe(404);
    const fake = new File([new TextEncoder().encode('MZ')], 'tl.pdf', { type: 'application/pdf' });
    expect((await call('t-trade', { file: fake })).status).toBe(400);
    expect(st.autofillCalls).toBe(0);
  });
});
