export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { ensureFleetSchema } from '@/lib/fleet/schema';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';

const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const rowToCamel = (r: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [toCamel(k), v]));

export async function GET(_: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(
    { headers: _.headers, nextUrl: _.nextUrl },
    { allowPlatformSwitch: true },
  );
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  await ensureFleetSchema();

  return withTenantRls(prisma, authz.tenantId, async (tx) => {
    try {
      const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT * FROM fleet_nui_reasons WHERE id::text = $1`,
        params.id,
      );
      if (!rows.length) return NextResponse.json({ error: 'NUI Reason not found' }, { status: 404 });
      return NextResponse.json(rowToCamel(rows[0]));
    } catch (err) {
      console.error('[admin/nui-reasons/:id GET error]:', err);
      return NextResponse.json({ error: 'Failed to fetch NUI reason' }, { status: 500 });
    }
  });
}

async function handlePUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(
    { headers: req.headers, nextUrl: req.nextUrl },
    { allowPlatformSwitch: true },
  );
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  await ensureFleetSchema();

  return withTenantRls(prisma, authz.tenantId, async (tx) => {
    try {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
      const now = new Date().toISOString();

      const existing = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT id FROM fleet_nui_reasons WHERE id::text = $1`,
        params.id,
      );
      if (!existing.length) {
        return NextResponse.json({ error: 'NUI Reason not found' }, { status: 404 });
      }

      const fieldMap: Record<string, string> = {
        name: 'name',
        reasonType: 'reason_type',
        description: 'description',
        impactLevel: 'impact_level',
        isBillable: 'is_billable',
        isActive: 'is_active',
        notes: 'notes',
      };

      const sets: string[] = [`updated_at = $1::timestamptz`];
      const vals: unknown[] = [now];
      let idx = 2;

      for (const [key, col] of Object.entries(fieldMap)) {
        if (key in body) {
          if (key === 'isBillable' || key === 'isActive') {
            sets.push(`${col} = $${idx++}::boolean`);
            vals.push(Boolean(body[key]));
          } else {
            sets.push(`${col} = $${idx++}`);
            vals.push(body[key] ?? null);
          }
        }
      }

      vals.push(params.id);
      await tx.$executeRawUnsafe(
        `UPDATE fleet_nui_reasons SET ${sets.join(', ')} WHERE id::text = $${idx}`,
        ...vals,
      );

      const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT * FROM fleet_nui_reasons WHERE id::text = $1`,
        params.id,
      );

      return NextResponse.json(rowToCamel(rows[0]));
    } catch (err) {
      console.error('[admin/nui-reasons/:id PUT error]:', err);
      return NextResponse.json({ error: 'Failed to update NUI reason' }, { status: 500 });
    }
  });
}

async function handleDELETE(_: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant(
    { headers: _.headers, nextUrl: _.nextUrl },
    { allowPlatformSwitch: true },
  );
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  await ensureFleetSchema();

  return withTenantRls(prisma, authz.tenantId, async (tx) => {
    try {
      await tx.$executeRawUnsafe(
        `DELETE FROM fleet_nui_reasons WHERE id::text = $1`,
        params.id,
      );
      return NextResponse.json({ success: true });
    } catch (err) {
      console.error('[admin/nui-reasons/:id DELETE error]:', err);
      return NextResponse.json({ error: 'Failed to delete NUI reason' }, { status: 500 });
    }
  });
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const PUT = withAuditedAction(handlePUT);

// Privileged writes are always audited (src/lib/audited-action.ts).
export const DELETE = withAuditedAction(handleDELETE);
