/**
 * Facilities service desk — Phase 1.
 *
 *  - /api/service-tickets accepts any catalogue type linked to
 *    SERVICE_TICKETING (not just the seven system types), rejects unlinked,
 *    disabled and malformed types, and accepts the Critical priority
 *  - GET ?mine=1 limits the list to the caller's own tickets (Booking Portal)
 *  - Critical has its own SLA tier and falls back to High when unset
 *  - tenant departments merge over the built-ins; triage can't be hidden
 *  - the Facilities template is internally consistent
 *
 * No database: every dependency of the route is mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/server', async () => await import('next/server.js'));

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = 'user-42';

const st = vi.hoisted(() => ({
  sql: [] as Array<{ sql: string; params: unknown[] }>,
  cfg: null as null | Record<string, unknown>,
  enabled: [] as string[],
}));

vi.mock('@/lib/tenant-context', () => ({
  requireAuthorizedTenant: () => ({ ok: true, tenantId: TENANT, userId: USER }),
  stripTenantOwnershipFields: (b: unknown) => b,
}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/rls', () => ({
  withTenantRls: async (_p: unknown, _t: string, fn: (tx: unknown) => unknown) => fn({
    $queryRawUnsafe: async (sql: string, ...params: unknown[]) => {
      st.sql.push({ sql, params });
      if (sql.includes('INSERT INTO service_tickets')) {
        return [{
          id: 'tk-1', tenant_id: TENANT, ticket_type: params[1], readable_id: params[2],
          requestor_id: params[3], requestor_name: null, vehicle_id: null, related_driver_id: null,
          title: params[7], description: params[8], priority: params[9], status: params[10],
          due_date: null, assigned_to: null, maintenance_request_id: null,
          history: [], attachments: [], comments: [], custom_fields: JSON.parse(String(params[13])),
          created_at: '2026-11-24T10:00:00Z', updated_at: '2026-11-24T10:00:00Z',
        }];
      }
      return [];
    },
  }),
}));
vi.mock('@/lib/service-config/load', () => ({ loadServiceConfig: async () => st.cfg }));
vi.mock('@/lib/service-tickets/catalogue', () => ({
  listEnabledTicketTypes: async () => st.enabled.map((key) => ({ key })),
}));
vi.mock('@/lib/service-tickets/schema', () => ({ nextReadableId: async (_t: string, _k: string, p: string) => `ST2026-${p}-0001` }));
vi.mock('@/lib/audit', () => ({ logAudit: async () => undefined }));
vi.mock('@/lib/sentry', () => ({ captureException: () => undefined }));
vi.mock('@/lib/service-config/resolvers', async (orig) => {
  const real = await orig<typeof import('@/lib/service-config/resolvers')>();
  return {
    ...real,
    resolveTicketInitialStatus: async () => ({ status: 'Pending', source: 'service_rules' }),
    resolveTicketSlaMatrixBatch: async (_t: string, types: string[]) =>
      new Map(types.map((t) => [t, { Low: 24, Medium: 8, High: 4, Critical: 2 }])),
  };
});

import { GET, POST } from '@/app/api/service-tickets/route';
import { pickSlaHours, normalizeTicketPriority } from '@/lib/service-config/resolvers';
import { mergeDepartments, validateDepartmentInput } from '@/lib/service-tickets/departments';
import { FACILITIES_CATALOGUE, FACILITIES_DEPARTMENTS, facilitiesTypeKeys } from '@/lib/service-config/facilities-template';
import { NextRequest } from 'next/server';

function fmConfig(linkedModule = 'SERVICE_TICKETING') {
  return {
    type: { name: 'Air conditioning / HVAC', defaultPriority: 'High' },
    mapping: { linkedModule },
    rules: {
      vehicle: { vehicleRequired: false },
      formFields: { fields: [{ key: 'building', label: 'Building / site', type: 'text', required: true }] },
      ticketing: { ticketPrefix: 'HVC' },
    },
  };
}

function post(body: unknown) {
  return POST(new NextRequest('http://localhost/api/service-tickets', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  }));
}

beforeEach(() => {
  st.sql = [];
  st.cfg = fmConfig();
  st.enabled = ['FM_HVAC', 'MAINTENANCE'];
});

describe('POST /api/service-tickets — catalogue types', () => {
  it('creates a ticket for a tenant-defined type linked to SERVICE_TICKETING', async () => {
    const res = await post({ ticketType: 'FM_HVAC', title: 'AC not cooling', priority: 'Critical', customFields: { building: 'HQ', source: 'BOOKING_PORTAL' } });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ticket.ticketType).toBe('FM_HVAC');
    expect(body.ticket.priority).toBe('Critical');
    expect(body.ticket.readableId).toBe('ST2026-HVC-0001');
    expect(body.ticket.source).toBe('BOOKING_PORTAL');
    expect(body.ticket.slaTargetHours).toBe(2); // Critical tier
  });

  it('rejects a catalogue type that is not linked to the ticketing module', async () => {
    st.cfg = fmConfig('ADMIN');
    const res = await post({ ticketType: 'FM_HVAC', title: 'x', customFields: { building: 'HQ' } });
    expect(res.status).toBe(400);
    expect(st.sql.some((q) => q.sql.includes('INSERT'))).toBe(false);
  });

  it('rejects a type the tenant has disabled', async () => {
    st.enabled = ['MAINTENANCE'];
    const res = await post({ ticketType: 'FM_HVAC', title: 'x', customFields: { building: 'HQ' } });
    expect(res.status).toBe(403);
  });

  it('rejects malformed type keys before touching config', async () => {
    const res = await post({ ticketType: "fm_hvac'; DROP TABLE x;--", title: 'x' });
    expect(res.status).toBe(400);
  });

  it('enforces the type\'s required form fields', async () => {
    const res = await post({ ticketType: 'FM_HVAC', title: 'x' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Building/);
  });

  it('falls back to the type default for an unknown priority', async () => {
    const res = await post({ ticketType: 'FM_HVAC', title: 'x', priority: 'Whenever', customFields: { building: 'HQ' } });
    expect((await res.json()).ticket.priority).toBe('High');
  });
});

describe('GET /api/service-tickets', () => {
  it('mine=1 limits results to the caller', async () => {
    await GET(new NextRequest('http://localhost/api/service-tickets?mine=1'));
    const q = st.sql.find((x) => x.sql.includes('FROM service_tickets'))!;
    expect(q.sql).toContain('requestor_id = $');
    expect(q.params).toContain(USER);
  });

  it('filters by a catalogue type key but ignores malformed ones', async () => {
    await GET(new NextRequest('http://localhost/api/service-tickets?type=FM_HVAC'));
    expect(st.sql.at(-1)!.params).toContain('FM_HVAC');
    st.sql = [];
    await GET(new NextRequest('http://localhost/api/service-tickets?type=bad%20key'));
    expect(st.sql.at(-1)!.sql).not.toContain('ticket_type =');
  });
});

describe('Critical SLA tier', () => {
  it('uses the Critical tier when set, otherwise High', () => {
    expect(pickSlaHours({ Low: 72, Medium: 24, High: 4, Critical: 1 }, 'Critical')).toBe(1);
    expect(pickSlaHours({ Low: 72, Medium: 24, High: 4 }, 'CRITICAL')).toBe(4);
    expect(pickSlaHours({ Low: 72, Medium: 24, High: 4, Critical: 1 }, 'High')).toBe(4);
  });
  it('normalises urgent/critical to Critical', () => {
    expect(normalizeTicketPriority('urgent')).toBe('Critical');
    expect(normalizeTicketPriority('Critical')).toBe('Critical');
    expect(normalizeTicketPriority('HIGH')).toBe('High');
  });
});

describe('departments', () => {
  const row = (key: string, extra: Record<string, unknown> = {}) => ({
    key, label: `${key} label`, short_label: key, description: '', tone: 'cyan', sort_order: 5, is_active: true, ...extra,
  });

  it('keeps the six built-ins when a tenant has no rows', () => {
    const list = mergeDepartments([]);
    expect(list).toHaveLength(6);
    expect(list[0].key).toBe('OPERATIONS_TRIAGE');
  });

  it('renames and hides built-ins, appends custom ones, keeps triage first and visible', () => {
    const list = mergeDepartments([
      row('WORKSHOP_MAINTENANCE', { label: 'Fleet workshop' }),
      row('RECOVERY_DISPATCH', { is_active: false }),
      row('OPERATIONS_TRIAGE', { is_active: false, sort_order: 999 }),
      row('FM_HARD_SERVICES', { label: 'FM — Hard services', sort_order: 1 }),
    ]);
    expect(list[0].key).toBe('OPERATIONS_TRIAGE');
    expect(list[0].isActive).toBe(true);
    expect(list.find((d) => d.key === 'WORKSHOP_MAINTENANCE')!.label).toBe('Fleet workshop');
    expect(list.find((d) => d.key === 'RECOVERY_DISPATCH')!.isActive).toBe(false);
    const fm = list.find((d) => d.key === 'FM_HARD_SERVICES')!;
    expect(fm.isSystem).toBe(false);
    expect(list).toHaveLength(7);
  });

  it('validates admin input', () => {
    expect(validateDepartmentInput({ key: 'FM_MEP', label: 'MEP' })).toBeNull();
    expect(validateDepartmentInput({ key: 'bad key', label: 'x' })).toMatch(/Key/);
    expect(validateDepartmentInput({ key: 'FM_MEP', label: ' ' })).toMatch(/Label/);
    expect(validateDepartmentInput({ key: 'OPERATIONS_TRIAGE', label: 'Triage', isActive: false })).toMatch(/cannot be hidden/);
  });
});

describe('Facilities template', () => {
  const types = FACILITIES_CATALOGUE.flatMap((c) => c.types);

  it('ships 16 uniquely keyed FM_ types with unique 3-letter prefixes', () => {
    expect(types).toHaveLength(16);
    expect(new Set(facilitiesTypeKeys()).size).toBe(16);
    expect(types.every((t) => /^FM_[A-Z_]+$/.test(t.key))).toBe(true);
    const prefixes = types.map((t) => t.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(prefixes.every((p) => /^[A-Z]{3}$/.test(p))).toBe(true);
    // Must not collide with the system types' prefixes.
    for (const sys of ['MNT', 'REN', 'CLN', 'SUP', 'INC', 'TOW', 'COM']) expect(prefixes).not.toContain(sys);
  });

  it('gives tighter SLAs to higher priorities', () => {
    for (const t of types) {
      expect(t.sla.Critical).toBeLessThanOrEqual(t.sla.High);
      expect(t.sla.High).toBeLessThanOrEqual(t.sla.Medium);
      expect(t.sla.Medium).toBeLessThanOrEqual(t.sla.Low);
    }
  });

  it('adds four FM departments with valid keys', () => {
    expect(FACILITIES_DEPARTMENTS).toHaveLength(4);
    for (const d of FACILITIES_DEPARTMENTS) expect(validateDepartmentInput(d)).toBeNull();
  });
});

describe('admin route policy for the new service-config routes', () => {
  it('lets tenant admins (not just platform admins) use departments and the Facilities template', async () => {
    const { requiredAdminLevel, roleSatisfies } = await import('@/lib/admin-access');
    for (const [path, method] of [
      ['/api/admin/service-config/departments', 'GET'],
      ['/api/admin/service-config/departments', 'PUT'],
      ['/api/admin/service-config/templates/facilities', 'GET'],
      ['/api/admin/service-config/templates/facilities', 'POST'],
    ] as const) {
      const level = requiredAdminLevel(path, method);
      expect(level).toBe('admin');
      expect(roleSatisfies('TENANT_ADMIN', level!)).toBe(true);
      expect(roleSatisfies('DISPATCHER', level!)).toBe(false);
    }
  });
});
