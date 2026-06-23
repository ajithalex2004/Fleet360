import { NextRequest, NextResponse } from 'next/server';
import { backfillLegacyLogisticsBookings, LogisticsValidationError } from '@/lib/logistics/domain';
import { logisticsErrorResponse } from '@/lib/logistics/api-context';

function requestContext(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id') ?? req.nextUrl.searchParams.get('tenantId') ?? '';
  const userId = req.headers.get('x-user-id') ?? '';
  const role = req.headers.get('x-user-role') ?? '';
  const isSuperAdmin = role === 'SUPER_ADMIN';
  if (!tenantId) return null;
  return { tenantId, userId, role, isSuperAdmin };
}

export async function POST(req: NextRequest) {
  try {
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Tenant context is required' }, { status: 401 });

    const body = await req.json().catch(() => ({})) as {
      tenantId?: string;
      limit?: number;
      dryRun?: boolean;
    };

    if (body.tenantId && body.tenantId !== ctx.tenantId && !ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });
    }
    if (body.limit != null && (!Number.isInteger(Number(body.limit)) || Number(body.limit) <= 0 || Number(body.limit) > 1000)) {
      throw new LogisticsValidationError(['Backfill limit must be between 1 and 1000.']);
    }

    const tenantId = body.tenantId && ctx.isSuperAdmin ? body.tenantId : ctx.tenantId;
    const result = await backfillLegacyLogisticsBookings({
      tenantId,
      actorUserId: ctx.userId || 'logistics-backfill-api',
      limit: body.limit,
      dryRun: Boolean(body.dryRun),
    });

    return NextResponse.json({ tenantId, ...result });
  } catch (error) {
    console.error('[logistics/shipments/backfill POST]', error);
    return logisticsErrorResponse(error, 'Failed to backfill logistics shipments');
  }
}
