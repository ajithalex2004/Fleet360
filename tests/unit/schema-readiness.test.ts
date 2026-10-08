/**
 * tests/unit/schema-readiness.test.ts
 *
 * Architecture audit A9: provisionSchemaOnce logged a missing table when the
 * runtime role could not create it, cached that as success for the life of
 * the process, and the request failed later with "relation does not exist".
 * Now a missing object raises MissingSchemaError (production never attempts
 * DDL), the result is re-checked so the app recovers once migrations run,
 * and readiness reports it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const db = vi.hoisted(() => ({ missing: [] as string[], queries: 0 }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: async () => { db.queries++; return [{ missing: db.missing }]; },
    $executeRawUnsafe: async () => 0,
  },
}));
vi.mock('@/lib/rls-scope', () => ({ runOutsideRlsScope: (fn: () => unknown) => fn() }));

import { MissingSchemaError, provisionSchemaOnce } from '@/lib/db/schema-init';
import { REQUIRED_SCHEMAS, schemaReport } from '@/lib/db/schema-registry';

let n = 0;
const uniqueName = () => `test-${++n}`;

beforeEach(() => { db.missing = []; db.queries = 0; });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('provisionSchemaOnce', () => {
  it('runs no DDL and succeeds when everything exists', async () => {
    const ddl = vi.fn();
    await provisionSchemaOnce(uniqueName(), { tables: ['t'] }, ddl);
    expect(ddl).not.toHaveBeenCalled();
  });

  it('in production, names the missing objects instead of attempting DDL', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    db.missing = ['fleet_transfers'];
    const ddl = vi.fn();
    const err = await provisionSchemaOnce(uniqueName(), { tables: ['fleet_transfers'] }, ddl).catch((e) => e);
    expect(err).toBeInstanceOf(MissingSchemaError);
    expect(err.message).toContain('missing fleet_transfers');
    expect(err.message).toContain('prisma migrate deploy');
    expect(ddl).not.toHaveBeenCalled();
  });

  it('recovers by itself once the migration is applied', async () => {
    vi.useFakeTimers();
    vi.stubEnv('NODE_ENV', 'production');
    const name = uniqueName();
    db.missing = ['dispatch_weights'];
    await expect(provisionSchemaOnce(name, { tables: ['dispatch_weights'] }, vi.fn())).rejects.toBeInstanceOf(MissingSchemaError);
    // Within the re-check window the same answer is reused (no query storm).
    const before = db.queries;
    await expect(provisionSchemaOnce(name, { tables: ['dispatch_weights'] }, vi.fn())).rejects.toBeInstanceOf(MissingSchemaError);
    expect(db.queries).toBe(before);
    db.missing = []; // migration applied
    await vi.advanceTimersByTimeAsync(31_000);
    await expect(provisionSchemaOnce(name, { tables: ['dispatch_weights'] }, vi.fn())).resolves.toBeUndefined();
  });

  it('outside production runs the DDL, and fails clearly if objects are still missing', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    db.missing = ['agent_runs'];
    const ddl = vi.fn(async () => { /* role may not create it: still missing */ });
    await expect(provisionSchemaOnce(uniqueName(), { tables: ['agent_runs'] }, ddl)).rejects.toThrow('missing agent_runs');
    expect(ddl).toHaveBeenCalledOnce();

    const fixes = vi.fn(async () => { db.missing = []; });
    db.missing = ['agent_runs'];
    await expect(provisionSchemaOnce(uniqueName(), { tables: ['agent_runs'] }, fixes)).resolves.toBeUndefined();
  });
});

describe('schema registry', () => {
  it('lists every module that uses provisionSchemaOnce', () => {
    const names: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && !p.endsWith('schema-init.ts')) {
          for (const m of readFileSync(p, 'utf8').matchAll(/provisionSchemaOnce\(\s*'([^']+)'/g)) names.push(m[1]);
        }
      }
    };
    walk(join(process.cwd(), 'src'));
    expect(names.length).toBeGreaterThan(0);
    // Every provisionSchemaOnce module is listed; 'migrated-columns' is the
    // one entry that is not a module (columns migrations now own).
    expect(new Set(names)).toEqual(new Set(Object.keys(REQUIRED_SCHEMAS).filter((k) => k !== 'migrated-columns')));
  });

  it('reports missing objects per module with a count', async () => {
    db.missing = ['x'];
    const r = await schemaReport({ fresh: true });
    expect(r.status).toBe('incomplete');
    expect(r.missingCount).toBe(Object.keys(REQUIRED_SCHEMAS).length);
    db.missing = [];
    expect((await schemaReport({ fresh: true })).status).toBe('ok');
  });
});

describe('/api/readyz', () => {
  it('is not ready while the schema is incomplete', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ status: 'ready' }), { status: 200 })));
    const { GET } = await import('@/app/api/readyz/route');
    db.missing = ['fleet_transfers'];
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: 'not_ready', missingObjects: expect.any(Number) });
    db.missing = [];
    expect((await GET()).status).toBe(200);
    vi.unstubAllGlobals();
  });
});
