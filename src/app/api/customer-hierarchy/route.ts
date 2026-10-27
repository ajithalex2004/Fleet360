export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(
    { headers: req.headers, nextUrl: req.nextUrl },
    { allowPlatformSwitch: true },
  );
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const { searchParams } = new URL(req.url);
      const level = searchParams.get('level');
      const parentId = searchParams.get('parentId') || searchParams.get('parent_id');
      const tree = searchParams.get('tree') === 'true';
      const all = searchParams.get('all') === 'true';
      const includeInactive = searchParams.get('includeInactive') === 'true';

      // ── Tree Mode: returns nested hierarchy [Region -> Department -> Section] ──
      if (tree) {
        const rows = await tx.$queryRawUnsafe<any[]>(
          `SELECT h.*, p.name as parent_name, p.code as parent_code
           FROM customer_hierarchy h
           LEFT JOIN customer_hierarchy p ON p.id = h.parent_id
           WHERE (h.tenant_id = $1 OR h.tenant_id IS NULL)
             AND ${includeInactive ? '1=1' : 'h.is_active = true'}
           ORDER BY h.name ASC`,
          tenantId,
        );

        const regions = rows.filter(r => r.level === 'REGION');
        const departments = rows.filter(r => r.level === 'DEPARTMENT');
        const units = rows.filter(r => r.level === 'UNIT');

        const nestedTree = regions.map(reg => {
          const regDepts = departments.filter(d => d.parent_id === reg.id);
          const deptsWithUnits = regDepts.map(d => {
            const deptUnits = units.filter(u => u.parent_id === d.id);
            return {
              ...d,
              sections: deptUnits,
              unitsCount: deptUnits.length,
            };
          });
          return {
            ...reg,
            departments: deptsWithUnits,
            departmentsCount: deptsWithUnits.length,
            sectionsCount: deptsWithUnits.reduce((acc, curr) => acc + curr.sections.length, 0),
          };
        });

        // Any orphaned departments or units
        const orphanDepts = departments
          .filter(d => !regions.some(r => r.id === d.parent_id))
          .map(d => ({
            ...d,
            sections: units.filter(u => u.parent_id === d.id),
          }));

        return NextResponse.json({
          success: true,
          tree: nestedTree,
          orphans: orphanDepts,
          counts: {
            regions: regions.length,
            departments: departments.length,
            sections: units.length,
            total: rows.length,
          },
        });
      }

      // ── All Mode: flat list with joined parent details ──
      if (all) {
        const rows = await tx.$queryRawUnsafe<any[]>(
          `SELECT h.*, p.name as parent_name, p.code as parent_code, p.level as parent_level
           FROM customer_hierarchy h
           LEFT JOIN customer_hierarchy p ON p.id = h.parent_id
           WHERE (h.tenant_id = $1 OR h.tenant_id IS NULL)
             AND ${includeInactive ? '1=1' : 'h.is_active = true'}
           ORDER BY h.level ASC, h.name ASC`,
          tenantId,
        );
        return NextResponse.json(rows);
      }

      // ── Filtered Mode (used by dropdowns in Allocations, Vehicles & Transfers) ──
      const params: unknown[] = [tenantId];
      let where = `WHERE (tenant_id = $1 OR tenant_id IS NULL)`;
      if (!includeInactive) {
        where += ` AND is_active = true`;
      }

      if (level) {
        const normalizedLevel = level.toUpperCase() === 'SECTION' ? 'UNIT' : level.toUpperCase();
        params.push(normalizedLevel);
        where += ` AND level = $${params.length}`;
      }
      if (parentId) {
        params.push(parentId);
        where += ` AND parent_id = $${params.length}`;
      } else if (level === 'REGION') {
        where += ` AND parent_id IS NULL`;
      }

      let items = await tx.$queryRawUnsafe<any[]>(
        `SELECT * FROM customer_hierarchy ${where} ORDER BY name ASC`,
        ...params,
      );

      // Auto-seed initial defaults if empty so users have immediate options
      if (items.length === 0 && level === 'REGION') {
        const defaultRegions = [
          { id: `reg-dxb-${tenantId.slice(0, 8)}`, name: 'Dubai', code: 'DXB' },
          { id: `reg-auh-${tenantId.slice(0, 8)}`, name: 'Abu Dhabi', code: 'AUH' },
          { id: `reg-shj-${tenantId.slice(0, 8)}`, name: 'Sharjah', code: 'SHJ' },
          { id: `reg-ne-${tenantId.slice(0, 8)}`, name: 'Northern Emirates', code: 'NE' },
        ];
        for (const r of defaultRegions) {
          await tx.$executeRawUnsafe(
            `INSERT INTO customer_hierarchy (id, tenant_id, level, name, code, is_active)
             VALUES ($1, $2, 'REGION', $3, $4, true)
             ON CONFLICT (id) DO NOTHING`,
            r.id, tenantId, r.name, r.code,
          ).catch(() => {});
        }
        items = await tx.$queryRawUnsafe<any[]>(
          `SELECT * FROM customer_hierarchy ${where} ORDER BY name ASC`,
          ...params,
        );
      }

      if (items.length === 0 && level === 'DEPARTMENT' && parentId) {
        const defaultDepts = [
          { id: `dept-flt-${randomUUID().slice(0, 8)}`, name: 'Fleet Operations', code: 'FLT' },
          { id: `dept-trans-${randomUUID().slice(0, 8)}`, name: 'Transport & Logistics', code: 'TRANS' },
          { id: `dept-comm-${randomUUID().slice(0, 8)}`, name: 'Commercial & Rental', code: 'COMM' },
        ];
        for (const d of defaultDepts) {
          await tx.$executeRawUnsafe(
            `INSERT INTO customer_hierarchy (id, tenant_id, level, name, code, parent_id, is_active)
             VALUES ($1, $2, 'DEPARTMENT', $3, $4, $5, true)
             ON CONFLICT (id) DO NOTHING`,
            d.id, tenantId, d.name, d.code, parentId,
          ).catch(() => {});
        }
        items = await tx.$queryRawUnsafe<any[]>(
          `SELECT * FROM customer_hierarchy ${where} ORDER BY name ASC`,
          ...params,
        );
      }

      if (items.length === 0 && (level === 'UNIT' || level === 'SECTION') && parentId) {
        const defaultUnits = [
          { id: `unit-light-${randomUUID().slice(0, 8)}`, name: 'Light Passenger Unit', code: 'LPU' },
          { id: `unit-heavy-${randomUUID().slice(0, 8)}`, name: 'Heavy Commercial Section', code: 'HCS' },
          { id: `unit-vip-${randomUUID().slice(0, 8)}`, name: 'Executive & VIP Unit', code: 'VIP' },
        ];
        for (const u of defaultUnits) {
          await tx.$executeRawUnsafe(
            `INSERT INTO customer_hierarchy (id, tenant_id, level, name, code, parent_id, is_active)
             VALUES ($1, $2, 'UNIT', $3, $4, $5, true)
             ON CONFLICT (id) DO NOTHING`,
            u.id, tenantId, u.name, u.code, parentId,
          ).catch(() => {});
        }
        items = await tx.$queryRawUnsafe<any[]>(
          `SELECT * FROM customer_hierarchy ${where} ORDER BY name ASC`,
          ...params,
        );
      }

      return NextResponse.json(items);
    } catch (e) {
      return NextResponse.json({ error: errorMessage(e, 'Failed') }, { status: 500 });
    }
  });
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(
    { headers: req.headers, nextUrl: req.nextUrl },
    { allowPlatformSwitch: true },
  );
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);

      if (!body.name || !body.level) {
        return NextResponse.json(
          { error: 'Name and level (REGION, DEPARTMENT, or SECTION/UNIT) are required' },
          { status: 400 },
        );
      }

      const rawLevel = String(body.level).toUpperCase();
      const normalizedLevel = rawLevel === 'SECTION' ? 'UNIT' : rawLevel;

      if (normalizedLevel !== 'REGION' && !body.parentId) {
        return NextResponse.json(
          { error: `${rawLevel} must be assigned to a parent` },
          { status: 400 },
        );
      }

      const id = body.id || randomUUID();
      const code = body.code ? String(body.code).trim().toUpperCase() : null;

      const rows = await tx.$queryRawUnsafe<any[]>(
        `INSERT INTO customer_hierarchy (id, tenant_id, level, parent_id, name, code, description, is_active, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
         RETURNING *`,
        id,
        tenantId,
        normalizedLevel,
        body.parentId || null,
        String(body.name).trim(),
        code,
        body.description ? String(body.description).trim() : null,
        body.isActive !== false,
      );

      return NextResponse.json(rows[0], { status: 201 });
    } catch (e) {
      return NextResponse.json({ error: errorMessage(e, 'Failed to create hierarchy node') }, { status: 500 });
    }
  });
}
