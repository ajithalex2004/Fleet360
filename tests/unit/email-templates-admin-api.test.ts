/**
 * tests/unit/email-templates-admin-api.test.ts
 *
 * Admin > Email templates API (src/app/api/admin/email-templates).
 *
 * Covered:
 *  - a tenant admin saves and resets their own tenant's wording only
 *  - the platform defaults (scope=platform) are for platform admins, and run
 *    in platform context
 *  - unknown variables, unknown templates and bad languages are refused
 *  - "send test" goes to the signed-in user only
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

const state = vi.hoisted(() => ({
  saves: [] as Array<Record<string, unknown>>,
  resets: [] as Array<Record<string, unknown>>,
  actingTenants: [] as string[],
  acting: undefined as string | undefined,
  mails: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/audited-action', () => ({ withAuditedAction: <T>(h: T) => h }));
vi.mock('@/lib/session-user', () => ({ sessionUser: async () => ({ email: 'admin@a.test', name: 'Ada' }) }));
vi.mock('@/lib/email', () => ({ sendEmail: async (m: Record<string, unknown>) => { state.mails.push(m); return { sent: true }; } }));
vi.mock('@/lib/rls-scope', () => ({
  runAsTenant: async <T>(tenant: string, fn: () => Promise<T>) => {
    state.actingTenants.push(tenant); state.acting = tenant;
    try { return await fn(); } finally { state.acting = undefined; }
  },
}));
vi.mock('@/lib/email-templates', () => ({
  saveTemplate: async (args: Record<string, unknown>) => { state.saves.push({ ...args, acting: state.acting }); return { version: 1, updated_at: new Date() }; },
  resetTemplate: async (args: Record<string, unknown>) => { state.resets.push({ ...args, acting: state.acting }); return true; },
  tenantEmailContext: async () => ({ companyName: 'Acme', locale: 'en', productName: null, logoUrl: null, primaryColor: null }),
}));

import { PUT, DELETE } from '@/app/api/admin/email-templates/[key]/route';
import { POST as TEST } from '@/app/api/admin/email-templates/[key]/test/route';
import { NextRequest } from 'next/server';

const TENANT = 'aaaaaaaa-0000-4000-8000-000000000001';
const KEY = 'workflow.approval_request';
const headers = (role = 'TENANT_ADMIN') => ({ 'content-type': 'application/json', 'x-user-id': 'u1', 'x-tenant-id': TENANT, 'x-user-role': role });
const ctx = (key = KEY) => ({ params: Promise.resolve({ key }) });
const put = (body: Record<string, unknown>, role?: string, key?: string) =>
  PUT(new NextRequest(`http://x/api/admin/email-templates/${key ?? KEY}`, { method: 'PUT', headers: headers(role), body: JSON.stringify(body) }), ctx(key));
const good = { locale: 'en', subject: 'Approve {{referenceNumber}}', body: 'Dear {{approverName}}' };

beforeEach(() => { state.saves = []; state.resets = []; state.actingTenants = []; state.mails = []; });

describe('email templates admin API', () => {
  it("saves the tenant admin's own tenant wording", async () => {
    const res = await put(good);
    expect(res.status).toBe(200);
    expect(state.saves).toEqual([expect.objectContaining({ tenantId: TENANT, key: KEY, locale: 'en', savedBy: 'admin@a.test', acting: undefined })]);
  });

  it('keeps platform defaults for platform admins, run in platform context', async () => {
    expect((await put({ ...good, scope: 'platform' })).status).toBe(403);
    expect(state.saves).toHaveLength(0);
    expect((await put({ ...good, scope: 'platform' }, 'SUPER_ADMIN')).status).toBe(200);
    expect(state.saves[0]).toMatchObject({ tenantId: null, acting: '*' });
  });

  it('refuses unknown variables, templates and languages', async () => {
    const bad = await put({ ...good, body: 'Hi {{password}}' });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain('{{password}}');
    expect((await put(good, undefined, 'nope.template')).status).toBe(404);
    expect((await put({ ...good, locale: 'fr' })).status).toBe(400);
    expect(state.saves).toHaveLength(0);
  });

  it('resets only the requested scope', async () => {
    const res = await DELETE(new NextRequest(`http://x/api/admin/email-templates/${KEY}?locale=ar`, { method: 'DELETE', headers: headers() }), ctx());
    expect(res.status).toBe(200);
    expect(state.resets).toEqual([expect.objectContaining({ tenantId: TENANT, locale: 'ar' })]);
    const denied = await DELETE(new NextRequest(`http://x/api/admin/email-templates/${KEY}?locale=en&scope=platform`, { method: 'DELETE', headers: headers() }), ctx());
    expect(denied.status).toBe(403);
  });

  it('sends a test only to the signed-in user', async () => {
    const res = await TEST(new NextRequest(`http://x/api/admin/email-templates/${KEY}/test`, {
      method: 'POST', headers: headers(), body: JSON.stringify({ ...good, to: 'someone@else.test' }),
    }), ctx());
    expect(res.status).toBe(200);
    expect(state.mails).toEqual([expect.objectContaining({ to: 'admin@a.test' })]);
    expect(String(state.mails[0].subject)).toMatch(/^\[Test\] Approve /);
  });
});
