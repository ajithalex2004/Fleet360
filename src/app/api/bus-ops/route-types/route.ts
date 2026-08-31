export const dynamic = 'force-dynamic';

/**
 * /api/bus-ops/route-types
 *
 *   GET  — list every route type for the current tenant (system + custom)
 *   POST — add a new custom route type: { name: "SHUTTLE" }
 *
 * On the first GET each tenant sees, we auto-create the three system defaults
 * (STAFF, SCHOOL, BOTH) so the form dropdown is never empty. Custom types
 * added here appear in the New Route form's Route Type dropdown immediately.
 *
 * Table is created lazily if the Prisma migration hasn't been applied yet —
 * matches the pattern used by ensureBusGpsTables so a dev DB works without
 * a manual migration step. Production should still run `prisma migrate deploy`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export const runtime = 'nodejs';

const SYSTEM_TYPES = ['STAFF', 'SCHOOL', 'BOTH'] as const;

let ensured = false;

async function ensureRouteTypesTable(): Promise<void> {
  if (ensured) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS bus_route_types (
      id         TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      tenant_id  TEXT,
      name       TEXT NOT NULL,
      is_system  BOOLEAN DEFAULT FALSE
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS uniq_bus_route_types_tenant_name ON bus_route_types (tenant_id, name)`,
  );
  ensured = true;
}

async function seedSystemDefaults(tenantId: string): Promise<void> {
  for (const name of SYSTEM_TYPES) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO bus_route_types (id, tenant_id, name, is_system)
       VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (tenant_id, name) DO NOTHING`,
      randomUUID(), tenantId, name,
    );
  }
}

interface TypeRow { id: string; name: string; is_system: boolean | null }

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      try {
        await ensureRouteTypesTable();
        await seedSystemDefaults(tenantId);

        const rows = await tx.$queryRawUnsafe<TypeRow[]>(
          `SELECT id, name, is_system FROM bus_route_types WHERE tenant_id = $1 ORDER BY is_system DESC, name ASC`,
          tenantId,
        );

        return NextResponse.json({
          types: rows.map(r => ({ id: r.id, name: r.name, isSystem: r.is_system === true })),
        }, { headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=180' } });
        } catch (e) {
        console.error('[bus-ops/route-types GET]', e);
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to load route types' }, { status: 500 });
      }
  });
}


export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      let bodyRaw: { name?: string };
      try {
        bodyRaw = await req.json() as { name?: string };
      } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
      const body = stripTenantOwnershipFields(bodyRaw);

      // Normalise: uppercase + trim + collapse internal whitespace → underscore.
      // Matches the shape of the system defaults so mixed types render uniformly.
      const raw = (body.name ?? '').trim();
      if (!raw) return NextResponse.json({ error: 'Route type name is required' }, { status: 400 });
      if (raw.length > 40) return NextResponse.json({ error: 'Route type name is too long (max 40 chars)' }, { status: 400 });
      const name = raw.toUpperCase().replace(/\s+/g, '_');

      try {
        await ensureRouteTypesTable();
        const id = randomUUID();
        // ON CONFLICT so re-adding an existing name is a no-op and returns the
        // existing row — idempotent from the caller's perspective.
        await tx.$executeRawUnsafe(
          `INSERT INTO bus_route_types (id, tenant_id, name, is_system)
           VALUES ($1, $2, $3, FALSE)
           ON CONFLICT (tenant_id, name) DO NOTHING`,
          id, tenantId, name,
        );

        // Return the row that now exists — either the freshly-inserted one or
        // the pre-existing match.
        const rows = await tx.$queryRawUnsafe<TypeRow[]>(
          `SELECT id, name, is_system FROM bus_route_types WHERE tenant_id = $1 AND name = $2 LIMIT 1`,
          tenantId, name,
        );
        const row = rows[0];
        if (!row) return NextResponse.json({ error: 'Failed to save route type' }, { status: 500 });

        return NextResponse.json({
          type: { id: row.id, name: row.name, isSystem: row.is_system === true },
        }, { status: 201 });
        } catch (e) {
        console.error('[bus-ops/route-types POST]', e);
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to add route type' }, { status: 500 });
      }
  });
}

