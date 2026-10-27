export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { ensureFleetSchema } from '@/lib/fleet/schema';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { DEFAULT_NUI_REASONS, NuiReasonSeed } from '@/lib/fleet/nui-reasons';

export type { NuiReasonSeed };

const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const rowToCamel = (r: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [toCamel(k), v]));

async function seedIfEmpty(tx: any) {
  try {
    const existing = await tx.$queryRawUnsafe(`SELECT COUNT(*)::int AS count FROM fleet_nui_reasons`);
    const count = Number(existing[0]?.count ?? 0);
    if (count === 0) {
      for (const item of DEFAULT_NUI_REASONS) {
        await tx.$executeRawUnsafe(
          `INSERT INTO fleet_nui_reasons (
            id, code, name, reason_type, description, impact_level, is_billable, is_active, created_at, updated_at
          ) VALUES (
            gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW(), NOW()
          )`,
          item.code,
          item.name,
          item.reasonType,
          item.description,
          item.impactLevel,
          item.isBillable,
          item.isActive,
        );
      }
    }
  } catch (err) {
    console.warn('[admin/nui-reasons seed warning]:', err);
  }
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(
    { headers: req.headers, nextUrl: req.nextUrl },
    { allowPlatformSwitch: true },
  );
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

  await ensureFleetSchema();

  return withTenantRls(prisma, authz.tenantId, async (tx) => {
    try {
      await seedIfEmpty(tx);

      const sp = req.nextUrl.searchParams;
      const search = sp.get('search')?.trim() || '';
      const type = sp.get('type')?.trim() || '';
      const impact = sp.get('impact')?.trim() || '';
      const activeOnly = sp.get('activeOnly') === 'true';

      const conditions: string[] = [];
      const params: unknown[] = [];

      if (activeOnly) {
        conditions.push(`is_active = TRUE`);
      }
      if (type && type !== 'ALL_TYPES') {
        params.push(type);
        conditions.push(`(reason_type = $${params.length} OR reason_type = 'ALL')`);
      }
      if (impact) {
        params.push(impact);
        conditions.push(`impact_level = $${params.length}`);
      }
      if (search) {
        params.push(`%${search}%`);
        conditions.push(`(code ILIKE $${params.length} OR name ILIKE $${params.length} OR description ILIKE $${params.length})`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT * FROM fleet_nui_reasons ${whereClause} ORDER BY reason_type ASC, code ASC`,
        ...params,
      );

      const items = rows.map(rowToCamel);
      return NextResponse.json({ success: true, count: items.length, data: items });
    } catch (err) {
      console.error('[admin/nui-reasons GET error]:', err);
      return NextResponse.json({ error: 'Failed to fetch NUI reasons' }, { status: 500 });
    }
  });
}

export async function POST(req: NextRequest) {
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

      if (!body.code || !body.name || !body.reasonType) {
        return NextResponse.json(
          { error: 'Bad Request', message: 'Reason code, name, and reasonType are required' },
          { status: 400 },
        );
      }

      const cleanCode = String(body.code).trim().toUpperCase();

      // Check unique code
      const dup = await tx.$queryRawUnsafe<any[]>(
        `SELECT id FROM fleet_nui_reasons WHERE UPPER(code) = $1`,
        cleanCode,
      );
      if (dup.length > 0) {
        return NextResponse.json(
          { error: 'Conflict', message: `Reason code "${cleanCode}" is already registered` },
          { status: 409 },
        );
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
        `INSERT INTO fleet_nui_reasons (
          id, code, name, reason_type, description, impact_level, is_billable, is_active, notes, created_at, updated_at
        ) VALUES (
          $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz
        ) RETURNING *`,
        id,
        cleanCode,
        String(body.name).trim(),
        String(body.reasonType).trim().toUpperCase(),
        body.description?.trim() || null,
        body.impactLevel?.trim() || 'MEDIUM',
        Boolean(body.isBillable),
        body.isActive !== false,
        body.notes?.trim() || null,
        now,
        now,
      );

      return NextResponse.json(rowToCamel(rows[0]), { status: 201 });
    } catch (err) {
      console.error('[admin/nui-reasons POST error]:', err);
      return NextResponse.json({ error: 'Failed to create NUI reason' }, { status: 500 });
    }
  });
}
