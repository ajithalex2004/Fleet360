/**
 * The security harness end to end against a fake deployment that answers
 * with the real policy code: a clean deployment passes; a planted
 * cross-tenant leak, a Go decision that differs, and a role that drifts
 * from the policy are each caught; the evidence report is written.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach } from 'vitest';
import { SYSTEM_ROLES } from '@/lib/permissions';
import { decide, POLICY_VERSION } from '@/lib/authz/policy';
import { dryRunHeaders } from '@/lib/authz/dry-run';
import { isAdminApiPath, requiredAdminLevel, roleSatisfies } from '@/lib/admin-access';
import { goStepUpRequired, stepUpRouteFor } from '@/lib/auth/step-up-policy';
import { main } from '../../scripts/security-harness/run.mjs';
import { extractIds, leaks, parseDryRun, stable, totp } from '../../scripts/security-harness/lib.mjs';
import { totpNow } from '@/lib/totp';

const BASE = 'https://app.test';
const GO = 'https://go.test';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const USERS: Record<string, { role: string; tenant: string }> = {
  'admin@a.test': { role: 'TENANT_ADMIN', tenant: A },
  'viewer@a.test': { role: 'VIEWER', tenant: A },
  'admin@b.test': { role: 'TENANT_ADMIN', tenant: B },
};
const B_RECORD = 'veh-b-0000000001';

interface Faults { leakOnTenantQuery?: boolean; goDiffers?: boolean; adminDrift?: boolean; mode?: 'report' | 'enforce' }

function fakeDeployment(faults: Faults = {}) {
  const permsOf = (role: string) => SYSTEM_ROLES.find((r) => r.code === role)!.permissions.map((p) => `${p.module}:${p.action}:${p.resource}`);
  const whoIs = (headers: Headers) => {
    const cookie = headers.get('cookie') ?? '';
    const auth = headers.get('authorization') ?? '';
    const email = /xl-session=([^;]+)/.exec(cookie)?.[1] ?? auth.replace('Bearer tok-', '');
    return { email, ...USERS[email] };
  };
  return async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const headers = new Headers(init.headers);
    const method = (init.method ?? 'GET').toUpperCase();
    const isGo = url.origin === GO;
    const pathname = isGo ? url.pathname.replace(/^\/api\/v1\//, '/api/') : url.pathname;

    if (pathname === '/api/health') return Response.json({ release: 'abc1234' });
    if (pathname === '/api/auth/login') {
      const body = JSON.parse(String(init.body));
      const u = USERS[body.email];
      if (!u || body.password !== `pw-${body.email}`) return Response.json({ message: 'Invalid' }, { status: 401 });
      return new Response(JSON.stringify({
        user: { roleCode: u.role, originalRoleCode: u.role, isTenantOverride: false },
        tenant: { id: u.tenant, plan: 'PRO' },
        backendToken: `tok-${body.email}`,
      }), { status: 200, headers: { 'set-cookie': `xl-session=${body.email}; Path=/; HttpOnly` } });
    }
    const who = whoIs(headers);
    if (!who.role) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const mode = faults.mode ?? 'report';
    const d = decide(
      { pathname, method, requestedTenantId: url.searchParams.get('tenantId') },
      { role: who.role, tenantId: who.tenant, plan: 'PRO', permissions: permsOf(who.role) },
    );
    if (faults.adminDrift && who.role === 'TENANT_ADMIN' && pathname === '/api/admin/users/set-password') d.allow = true;

    if (headers.get('x-authz-dry-run') === '1') {
      const level = isAdminApiPath(pathname) ? requiredAdminLevel(pathname, method) : null;
      const gate = !faults.adminDrift && level && !roleSatisfies(who.role, level) ? level : null;
      const route = isGo ? (goStepUpRequired(pathname, method) ? 'x' : null) : stepUpRouteFor(pathname, method);
      const h = dryRunHeaders({ policyVersion: POLICY_VERSION, mode, decision: d, adminGateRefusal: isGo ? null : gate, stepUpRoute: route, stepUpSatisfied: false, stepUpMode: 'enforce' });
      if (isGo) {
        h['x-authz-backend'] = 'go';
        if (faults.goDiffers && pathname === '/api/fleet/vehicles' && method === 'POST') h['x-authz-decision'] = h['x-authz-decision'] === 'allow' ? 'deny' : 'allow';
      }
      return new Response(null, { status: 204, headers: h });
    }
    // The admin gate always refuses; the policy only in enforce mode.
    const gateLevel = !isGo && isAdminApiPath(pathname) ? requiredAdminLevel(pathname, method) : null;
    if (gateLevel && !roleSatisfies(who.role, gateLevel)) return Response.json({ error: 'Forbidden' }, { status: 403 });
    if (mode === 'enforce' && !d.allow) return Response.json({ error: 'Forbidden' }, { status: 403 });

    // Data: tenant B owns one vehicle; tenant A owns one.
    if (pathname === '/api/fleet/vehicles') {
      const asTenant = faults.leakOnTenantQuery && url.searchParams.get('tenantId') ? url.searchParams.get('tenantId') : who.tenant;
      return Response.json({ data: [{ id: asTenant === B ? B_RECORD : 'veh-a-0000000001' }] });
    }
    if (pathname === `/api/fleet/vehicles/${B_RECORD}`) {
      return who.tenant === B ? Response.json({ id: B_RECORD, plate: 'B-1' }) : Response.json({ error: 'Not found' }, { status: 404 });
    }
    return Response.json({ data: [] });
  };
}

let dir: string;
let accountsFile: string;
const env = Object.fromEntries(Object.keys(USERS).map((e) => [`PW_${e.replace(/[@.]/g, '_')}`, `pw-${e}`]));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-'));
  accountsFile = path.join(dir, 'accounts.json');
  const acct = (email: string) => ({ role: USERS[email].role, email, passwordEnv: `PW_${email.replace(/[@.]/g, '_')}` });
  fs.writeFileSync(accountsFile, JSON.stringify({
    tenants: {
      A: { id: A, accounts: [acct('admin@a.test'), acct('viewer@a.test')] },
      B: { id: B, accounts: [acct('admin@b.test')] },
    },
  }));
});

const run = async (faults: Faults, extra: string[] = []) => {
  const out = path.join(dir, 'out');
  const code = await main(['--base', BASE, '--go', GO, '--accounts', accountsFile, '--out', out, ...extra],
    { env: env as unknown as NodeJS.ProcessEnv, fetchImpl: fakeDeployment(faults) as typeof fetch, log: () => {} });
  const results = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8'));
  const report = fs.readFileSync(path.join(out, 'report.md'), 'utf8');
  const failures = results.checks.filter((c: { status: string }) => c.status === 'fail');
  return { code, results, report, failures };
};

describe('security harness', () => {
  it('passes a deployment that follows the policy, with evidence', async () => {
    const { code, results, report, failures } = await run({});
    expect(failures).toEqual([]);
    expect(code).toBe(0);
    expect(report).toContain('**Result:** PASS');
    expect(report).toContain('**Deployed commit:** abc1234');
    expect(report).toContain('AUTHZ_MODE report');
    const names = results.checks.map((c: { name: string }) => c.name);
    expect(names).toEqual(expect.arrayContaining([
      expect.stringMatching(/every decision matches the policy for TENANT_ADMIN/),
      expect.stringMatching(/every decision matches the policy for VIEWER/),
      expect.stringMatching(/Go decisions equal Next\.js/),
      expect.stringMatching(/\/api\/fleet\/vehicles: list \?tenantId=B shows none of B's records/),
      expect.stringMatching(/\/api\/fleet\/vehicles\/\{B id\}: read by id/),
    ]));
    // Not configured: reported as not covered, never as passed.
    expect(results.checks).toEqual(expect.arrayContaining([expect.objectContaining({ phase: 'database', status: 'skip' })]));
    expect(results.checks).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'AUTHZ_MODE is enforce', status: 'warn' })]));
    // Passwords never reach the evidence.
    expect(JSON.stringify(results) + report).not.toMatch(/pw-/);
  });

  it('catches tenant B records leaking to tenant A', async () => {
    const { code, failures } = await run({ leakOnTenantQuery: true });
    expect(code).toBe(1);
    expect(failures.map((f: { name: string }) => f.name)).toContain("/api/fleet/vehicles: list ?tenantId=B shows none of B's records");
  });

  it('catches the Go backend deciding differently from Next.js', async () => {
    const { code, failures } = await run({ goDiffers: true });
    expect(code).toBe(1);
    expect(failures.some((f: { name: string }) => /POST \/api\/fleet\/vehicles same decision as Next\.js/.test(f.name))).toBe(true);
  });

  it('reports a role that drifts from the policy: a warning, a failure with --strict', async () => {
    const lenient = await run({ adminDrift: true });
    expect(lenient.results.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'warn', name: expect.stringMatching(/decisions differ from the policy for TENANT_ADMIN/) }),
    ]));
    const strict = await run({ adminDrift: true }, ['--strict']);
    expect(strict.code).toBe(1);
  });

  it('with enforcement on, proves denied reads are really refused', async () => {
    const { code, failures, report } = await run({ mode: 'enforce' });
    expect(failures).toEqual([]);
    expect(code).toBe(0);
    expect(report).toContain('AUTHZ_MODE enforce');
  });

  it('refuses --writes unless the target is confirmed as a test environment', async () => {
    await expect(main(['--base', BASE, '--accounts', accountsFile, '--writes'], { env: env as unknown as NodeJS.ProcessEnv, fetchImpl: fakeDeployment() as typeof fetch, log: () => {} }))
      .rejects.toThrow(/HARNESS_ALLOW_WRITES=app\.test/);
  });
});

describe('harness helpers', () => {
  it('computes the same TOTP as the server', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    expect(totp(secret)).toBe(totpNow(secret));
  });

  it('extracts ids, finds leaks, reads dry runs, ignores volatile fields', () => {
    expect(extractIds([{ id: 'a' }, { id: 2 }])).toEqual(['a', '2']);
    expect(extractIds({ data: { items: [{ id: 'x' }] } })).toEqual(['x']);
    expect(extractIds({ contracts: [{ id: 'c1' }], total: 1 })).toEqual(['c1']);
    expect(leaks('{"id":"veh-b-0000000001"}', [B_RECORD, 'short'])).toEqual([B_RECORD]);
    expect(parseDryRun(new Response(null, { status: 403 }))).toMatchObject({ answered: false, allow: false });
    expect(stable({ a: 1, updatedAt: 'x' })).toBe(stable({ a: 1, updatedAt: 'y' }));
  });
});
