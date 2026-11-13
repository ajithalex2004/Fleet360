export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { paginate, paginatedResponse } from '@/lib/pagination';
import { pricingRuleToRow, rowToCamel } from '@/lib/pricing-rule-helpers';
import { requireRentalPermission } from '@/lib/rental/rbac';
import {
  assertRentalForeignKeysInTenant,
  escapeIlikePattern,
  isRentalSecurityError,
} from '@/lib/rental/security-guards';

// GET  /api/rental/rates  — list pricing rules (paginated, filterable)
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'view',
    '*',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const sp = req.nextUrl.searchParams;
      const vehicleCategory = sp.get('vehicleCategory') ?? '';
      const customerType = sp.get('customerType') ?? '';
      const channel = sp.get('channel') ?? '';
      const isActiveParam = sp.get('isActive') ?? '';
      const search = (sp.get('search') ?? '').trim();
      const { take, skip, page, limit } = paginate(sp, 100);

      let where = 'WHERE tenant_id::text = $1';
      const args: unknown[] = [tenantId];
      let idx = 2;

      if (vehicleCategory) {
        where += ' AND vehicle_category = $' + idx++;
        args.push(vehicleCategory);
      }
      if (customerType) {
        where += ' AND customer_type = $' + idx++;
        args.push(customerType);
      }
      if (channel) {
        where += ' AND channel = $' + idx++;
        args.push(channel);
      }
      if (isActiveParam) {
        where += ' AND is_active = $' + idx++;
        args.push(isActiveParam === 'true');
      }
      if (search) {
        const escaped = `%${escapeIlikePattern(search)}%`;
        where += ` AND (COALESCE(name, '') ILIKE $${idx} ESCAPE '\\' OR COALESCE(promo_code, '') ILIKE $${idx} ESCAPE '\\')`;
        args.push(escaped);
        idx++;
      }

      const dataRows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
        'SELECT * FROM pricing_rules ' +
          where +
          ' ORDER BY priority DESC, vehicle_category ASC' +
          ' LIMIT $' +
          idx +
          ' OFFSET $' +
          (idx + 1),
        ...args,
        take,
        skip,
      );

      const countRows = await tx.$queryRawUnsafe<{ count: bigint }[]>(
        'SELECT COUNT(*) AS count FROM pricing_rules ' + where,
        ...args,
      );

      const total = Number(countRows[0]?.count ?? 0);
      return NextResponse.json(paginatedResponse(dataRows.map(rowToCamel), total, page, limit));
    } catch (e) {
      console.error('Failed to fetch pricing rules:', e);
      return NextResponse.json({ error: 'Failed to fetch pricing rules' }, { status: 500 });
    }
  });
}

// POST /api/rental/rates  — create a pricing rule
export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await requireRentalPermission(
    req.headers,
    tenantId,
    'create',
    'rates',
    req.nextUrl.pathname,
  );
  if (denied) return denied;

  let bodyRaw: unknown;
  try {
    bodyRaw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }
  if (!bodyRaw || typeof bodyRaw !== 'object' || Array.isArray(bodyRaw)) {
    return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
  }

  const body = stripTenantOwnershipFields(bodyRaw as Record<string, unknown>);

  if (!body.vehicleCategory || body.baseDailyRate === undefined || body.baseDailyRate === null) {
    return NextResponse.json(
      { error: 'vehicleCategory and baseDailyRate are required' },
      { status: 400 },
    );
  }

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      if (body.corporateAccountId) {
        await assertRentalForeignKeysInTenant(tx, tenantId, {
          corporateAccountId: String(body.corporateAccountId),
        });
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      const { cols, params, values } = pricingRuleToRow(body, id, now, tenantId);
      await tx.$executeRawUnsafe(
        'INSERT INTO pricing_rules (' + cols + ') VALUES (' + params + ')',
        ...values,
      );

      const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(
        'SELECT * FROM pricing_rules WHERE id::text = $1 AND tenant_id::text = $2',
        id,
        tenantId,
      );
      if (!rows.length) {
        return NextResponse.json({ error: 'Failed to create rule' }, { status: 500 });
      }
      return NextResponse.json(rowToCamel(rows[0]), { status: 201 });
    } catch (e: unknown) {
      if (isRentalSecurityError(e)) {
        return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
      }
      console.error('Failed to create pricing rule:', e);
      return NextResponse.json({ error: 'Failed to create rule' }, { status: 500 });
    }
  });
}
