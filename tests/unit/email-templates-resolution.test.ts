/**
 * tests/unit/email-templates-resolution.test.ts
 *
 * Which wording renderEmail (src/lib/email-templates/index.ts) uses:
 * an override (a workflow step's own wording), else the tenant's saved
 * template, else the platform default, else the built-in wording; in the
 * tenant's language; with each variable's fallback for empty values.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  language: 'en' as string | null,
  queries: [] as unknown[][],
}));

vi.mock('@/lib/branding', () => ({ getBranding: async () => ({ productName: null, logoUrl: null, primaryColor: '#0f766e' }) }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
      state.queries.push([sql, ...params]);
      if (sql.includes('FROM tenants')) return [{ name: 'Acme Fleet', default_language: state.language }];
      if (sql.includes('FROM email_templates')) {
        const [key, locale, tenant] = params;
        return state.rows.filter((r) => r.template_key === key && r.locale === locale && (r.tenant_id === tenant || r.tenant_id === null));
      }
      return [];
    },
  },
}));

import { renderEmail } from '@/lib/email-templates';

const TENANT = 'aaaaaaaa-0000-4000-8000-000000000001';
const row = (tenant: string | null, locale: string, subject: string, body: string) =>
  ({ tenant_id: tenant, template_key: 'workflow.approval_request', locale, subject, body, version: 1 });
const approval = (extra: Partial<Parameters<typeof renderEmail>[0]> = {}) => renderEmail({
  tenantId: TENANT, key: 'workflow.approval_request',
  values: { referenceNumber: 'QT-1', approverName: '', approvalUrl: 'https://app.example/approvals' },
  ...extra,
});

beforeEach(() => { state.rows = []; state.language = 'en'; state.queries = []; });

describe('renderEmail', () => {
  it('uses the built-in wording, with fallbacks and the tenant name', async () => {
    const r = await approval();
    expect(r.source).toBe('default');
    expect(r.subject).toBe('Action Required: QT-1 awaiting your approval');
    expect(r.text).toContain('Dear Approver,');
    expect(r.html).toContain('Acme Fleet');
    expect(r.html).toContain('background:#0f766e');
  });

  it('prefers the tenant template over the platform default', async () => {
    state.rows = [row(null, 'en', 'Platform {{referenceNumber}}', 'p'), row(TENANT, 'en', 'Tenant {{referenceNumber}}', 't')];
    const r = await approval();
    expect([r.source, r.subject]).toEqual(['tenant', 'Tenant QT-1']);
    state.rows = [row(null, 'en', 'Platform {{referenceNumber}}', 'p'), row('bbbbbbbb-0000-4000-8000-000000000002', 'en', 'Other', 'o')];
    const p = await approval();
    expect([p.source, p.subject]).toEqual(['platform', 'Platform QT-1']);
  });

  it("uses the tenant's language, and the Arabic built-in wording", async () => {
    state.language = 'ar';
    state.rows = [row(TENANT, 'en', 'English only', 'e')];
    const r = await approval();
    expect(r.locale).toBe('ar');
    expect(r.source).toBe('default');
    expect(r.subject).toBe('مطلوب إجراء: QT-1 بانتظار موافقتك');
    expect(r.text).toContain('المعتمد');
    expect(r.html).toContain('dir="rtl"');
  });

  it('lets an override (a step\'s own wording) win', async () => {
    state.rows = [row(TENANT, 'en', 'Tenant', 't')];
    const r = await approval({ override: { subject: 'Step {referenceNumber}', body: null } });
    expect(r.source).toBe('override');
    expect(r.subject).toBe('Step QT-1');
    expect(r.text).toBe('t');
  });

  it('looks templates up for the tenant only', async () => {
    await approval();
    const lookup = state.queries.find((q) => String(q[0]).includes('FROM email_templates'))!;
    expect(lookup[0]).toContain('(tenant_id = $3 OR tenant_id IS NULL)');
    expect(lookup.slice(1)).toEqual(['workflow.approval_request', 'en', TENANT]);
  });
});
