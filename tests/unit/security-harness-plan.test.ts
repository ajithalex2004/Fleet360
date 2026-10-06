/**
 * scripts/security-harness/plan.json is generated from the policy code and
 * the route files: the probes, what each system role should get, and the
 * list/detail endpoints for the cross-tenant tests. Regenerate after a
 * policy or route change with:
 *
 *   UPDATE_SECURITY_HARNESS=1 npx vitest run tests/unit/security-harness-plan.test.ts
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { AREAS, areaOf } from '@/lib/authz/policy-matrix';
import { buildHarnessPlan, type Resource } from '@/lib/authz/harness-plan';

const ROOT = path.resolve(__dirname, '../..');
const API = path.join(ROOT, 'src/app/api');
const PLAN_FILE = path.join(ROOT, 'scripts/security-harness/plan.json');

const exportsOf = (file: string): string[] => {
  const src = fs.readFileSync(file, 'utf8');
  return [...src.matchAll(/export\s+(?:async\s+function|const|function)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
};

/**
 * Tenant-owned collections: a module area route that lists (GET) with no
 * dynamic segment, whose single [param] child reads one record (GET).
 */
function discoverResources(): Resource[] {
  const out: Resource[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const sub = path.join(dir, e.name);
      const rel = path.relative(API, sub).split(path.sep).join('/');
      if (!rel.includes('[')) {
        const listFile = path.join(sub, 'route.ts');
        const params = fs.readdirSync(sub, { withFileTypes: true })
          .filter((d) => d.isDirectory() && /^\[[^.\]]+\]$/.test(d.name));
        if (fs.existsSync(listFile) && exportsOf(listFile).includes('GET') && params.length === 1) {
          const detailFile = path.join(sub, params[0].name, 'route.ts');
          const area = areaOf(`/api/${rel}`);
          const rule = area ? AREAS[area] : null;
          const read = rule && ('kind' in rule ? rule : rule.read);
          if (fs.existsSync(detailFile) && exportsOf(detailFile).includes('GET') && read?.kind === 'module') {
            out.push({
              area: area!,
              list: `/api/${rel}`,
              detail: `/api/${rel}/{id}`,
              writes: exportsOf(detailFile).filter((m) => m !== 'GET').sort(),
            });
          }
        }
        walk(sub);
      }
    }
  };
  walk(API);
  return out.sort((a, b) => a.list.localeCompare(b.list));
}

describe('security harness plan', () => {
  const plan = buildHarnessPlan(discoverResources());

  it('covers every module, the admin routes, Go, and cross-tenant tests', () => {
    expect(plan.probes.length).toBeGreaterThan(300);
    expect(plan.probes.some((p) => p.backend === 'go')).toBe(true);
    expect(plan.probes.some((p) => p.path.startsWith('/api/admin/'))).toBe(true);
    expect(plan.resources.length).toBeGreaterThan(20);
    // Every probe id is unique, and each role has an answer for each probe.
    expect(new Set(plan.probes.map((p) => p.id)).size).toBe(plan.probes.length);
    for (const byPlan of Object.values(plan.expected)) {
      for (const answers of Object.values(byPlan)) expect(answers).toHaveLength(plan.probes.length);
    }
  });

  it('encodes the invariants the harness asserts', () => {
    const idx = (id: string) => plan.probes.findIndex((p) => p.id === id);
    const answers = (role: string, p = 'PRO') => plan.expected[role][p].split('').map((c) => c === '1');
    const viewer = answers('VIEWER');
    const admin = answers('TENANT_ADMIN');
    const superAdmin = answers('SUPER_ADMIN');
    // A viewer reads but never writes a module.
    expect(viewer[idx('GET /api/fleet')]).toBe(true);
    expect(viewer[idx('POST /api/fleet')]).toBe(false);
    // Platform actions: super admin only.
    expect(admin[idx('POST /api/admin/users/set-password')]).toBe(false);
    expect(superAdmin[idx('POST /api/admin/users/set-password')]).toBe(true);
    // Naming another tenant is refused below platform level.
    expect(admin[idx('GET /api/fleet/vehicles?tenantId={other}')]).toBe(false);
    // Trial tenants are read-only outside trial-free modules.
    expect(answers('TENANT_ADMIN', 'TRIAL')[idx('POST /api/leasing')]).toBe(false);
  });

  it('matches scripts/security-harness/plan.json', () => {
    const content = `${JSON.stringify(plan, null, 1)}\n`;
    if (process.env.UPDATE_SECURITY_HARNESS) fs.writeFileSync(PLAN_FILE, content);
    expect(fs.existsSync(PLAN_FILE), 'plan.json missing: UPDATE_SECURITY_HARNESS=1').toBe(true);
    expect(fs.readFileSync(PLAN_FILE, 'utf8') === content, 'plan.json is out of date: regenerate with UPDATE_SECURITY_HARNESS=1').toBe(true);
  });
});
