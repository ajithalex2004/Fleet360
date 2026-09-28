/**
 * Privileged actions are always recorded in the audit log: every write
 * handler in an area whose writes need an administrator (the /api/admin
 * routes, the tenant-admin and platform areas of the authorization matrix)
 * is wrapped by withAuditedAction, which records the action once, with its
 * outcome, unless the handler wrote its own audit row.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { AREAS, areaOf } from '@/lib/authz/policy-matrix';

const audits = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

let withAuditedAction: typeof import('@/lib/audited-action').withAuditedAction;
let routeTemplate: typeof import('@/lib/audited-action').routeTemplate;
let logAudit: typeof import('@/lib/audit').logAudit;

beforeAll(async () => {
  vi.resetModules();
  // The real logAudit (so it marks the request audited), writing into `audits`.
  vi.doMock('@/lib/rls-scope', () => ({ runOutsideRlsScope: async (fn: () => unknown) => fn() }));
  ({ logAudit } = await import('@/lib/audit'));
  ({ withAuditedAction, routeTemplate } = await import('@/lib/audited-action'));
});

beforeEach(() => { audits.length = 0; });

// Capture rows at the database boundary: writeAuditRow's INSERT parameters.
vi.mock('@/lib/rls', () => {
  const tx = {
    $executeRawUnsafe: async (_sql: string, ...v: unknown[]) => {
      audits.push({ tenantId: v[0], entityType: v[4], entityId: v[5], entityName: v[6], userId: v[7], userRole: v[10], action: v[11], details: v[12], ip: v[13], ua: v[14] });
      return 1;
    },
  };
  return {
    withPlatformAdmin: async (_p: unknown, fn: (t: unknown) => unknown) => fn(tx),
    withTenantRls: async (_p: unknown, _t: string, fn: (t: unknown) => unknown) => fn(tx),
  };
});

const API = path.resolve(__dirname, '../../src/app/api');
const WRITE = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? routeFiles(p) : e.name === 'route.ts' ? [p] : [];
  });
}

function privileged(file: string): boolean {
  const rel = path.relative(API, path.dirname(file)).split(path.sep).join('/');
  const area = areaOf(`/api/${rel}`);
  if (!area) return false;
  const r = AREAS[area];
  const write = 'kind' in r ? r : r.write;
  return write.kind === 'admin-level' || write.kind === 'tenant-admin' || write.kind === 'platform';
}

describe('coverage', () => {
  const files = routeFiles(API).filter(privileged);

  it('finds the privileged areas', () => {
    expect(files.length).toBeGreaterThan(80);
  });

  it('wraps every privileged write handler', () => {
    const unwrapped: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of WRITE) {
        if (new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b`).test(src)) unwrapped.push(`${m} ${path.relative(API, f)}`);
        const constExport = new RegExp(`export\\s+const\\s+${m}\\s*=\\s*([^;]+);`).exec(src);
        if (constExport && !/^withAuditedAction\(/.test(constExport[1].trim())) unwrapped.push(`${m} ${path.relative(API, f)}`);
      }
    }
    expect(unwrapped, 'wrap with withAuditedAction (src/lib/audited-action.ts)').toEqual([]);
  });
});

const req = (method: string, url: string, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${url}`, {
    method,
    headers: { 'x-tenant-id': 't1', 'x-user-id': 'u1', 'x-user-role': 'TENANT_ADMIN', 'x-forwarded-for': '203.0.113.9, 10.0.0.1', 'user-agent': 'test-agent', ...headers },
  });
const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) });

describe('withAuditedAction', () => {
  it('records an unaudited success once, with actor, route, target and outcome', async () => {
    const handler = withAuditedAction(async (...args: unknown[]) => { void args; return Response.json({ ok: true }); });
    await handler(req('PATCH', '/api/admin/roles/r-9'), ctx({ id: 'r-9' }));
    expect(audits).toEqual([expect.objectContaining({
      tenantId: 't1', entityType: 'AdminAction', entityId: 'r-9', entityName: 'PATCH /api/admin/roles/[id]',
      userId: 'u1', userRole: 'TENANT_ADMIN', action: 'UPDATE', ip: '203.0.113.9', ua: 'test-agent',
      details: 'PATCH /api/admin/roles/r-9: ok 200',
    })]);
  });

  it('adds nothing when the handler audited itself', async () => {
    const handler = withAuditedAction(async (...args: unknown[]) => {
      void args;
      await logAudit({ tenantId: 't1', entityType: 'Role', action: 'DELETE', details: 'own row' });
      return Response.json({ ok: true });
    });
    await handler(req('DELETE', '/api/admin/roles/r-1'), ctx({ id: 'r-1' }));
    expect(audits.map((a) => a.details)).toEqual(['own row']);
  });

  it('records refusals as DENIED, even after the handler audited', async () => {
    const handler = withAuditedAction(async (...args: unknown[]) => {
      void args;
      await logAudit({ tenantId: 't1', entityType: 'Role', action: 'UPDATE', details: 'attempt' });
      return Response.json({ error: 'no' }, { status: 403 });
    });
    await handler(req('PUT', '/api/admin/roles/r-2/permissions'), ctx({ id: 'r-2' }));
    expect(audits.at(-1)).toMatchObject({ action: 'DENIED', details: 'PUT /api/admin/roles/r-2/permissions: refused 403' });
  });

  it('does not record invalid requests (validation, not found, conflict)', async () => {
    for (const status of [400, 404, 409, 422]) {
      await withAuditedAction<unknown[], Response>(async () => Response.json({}, { status }))(req('POST', '/api/admin/users'));
    }
    expect(audits).toEqual([]);
  });

  it('records failures and rethrows errors', async () => {
    const failing = withAuditedAction<unknown[], Response>(async () => Response.json({ error: 'bad' }, { status: 500 }));
    await failing(req('POST', '/api/admin/seed'));
    const throwing = withAuditedAction<unknown[], Response>(async () => { throw new Error('boom'); });
    await expect(throwing(req('POST', '/api/admin/tenants'))).rejects.toThrow('boom');
    expect(audits.map((a) => [a.action, a.details])).toEqual([
      ['FAILED', 'POST /api/admin/seed: failed 500'],
      ['FAILED', 'POST /api/admin/tenants: error'],
    ]);
  });

  it('names the impersonator', async () => {
    const handler = withAuditedAction<unknown[], Response>(async () => Response.json({}, { status: 201 }));
    await handler(req('POST', '/api/admin/users', { 'x-impersonated-by': 'root' }));
    expect(audits[0]).toMatchObject({ action: 'CREATE', details: 'POST /api/admin/users: ok 201 (impersonated by root)' });
  });

  it('derives the route template from the params', () => {
    expect(routeTemplate('/api/admin/tenants/abc/invitations/i%201/revoke', { id: 'abc', invitationId: 'i 1' }))
      .toBe('/api/admin/tenants/[id]/invitations/[invitationId]/revoke');
  });
});
