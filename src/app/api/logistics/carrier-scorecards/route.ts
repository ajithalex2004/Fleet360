import { NextRequest, NextResponse } from 'next/server';
import {
  listCarrierScorecards,
  setCarrierPreference,
  upsertCarrierScorecard,
  type LogisticsCarrierScorecardInput,
} from '@/lib/logistics/domain';
import { logisticsErrorResponse } from '@/lib/logistics/api-context';

function requestContext(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id') ?? req.nextUrl.searchParams.get('tenantId') ?? '';
  const role = req.headers.get('x-user-role') ?? '';
  const isSuperAdmin = role === 'SUPER_ADMIN';
  if (!tenantId) return null;
  return { tenantId, role, isSuperAdmin };
}

function resolveTenant(ctx: NonNullable<ReturnType<typeof requestContext>>, requestedTenantId?: string | null) {
  if (requestedTenantId && requestedTenantId !== ctx.tenantId && !ctx.isSuperAdmin) return null;
  return requestedTenantId && ctx.isSuperAdmin ? requestedTenantId : ctx.tenantId;
}

function boolParam(value: string | null) {
  if (value == null) return null;
  return value === 'true';
}

export async function GET(req: NextRequest) {
  try {
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Tenant context is required' }, { status: 401 });
    const tenantId = resolveTenant(ctx, req.nextUrl.searchParams.get('tenantId'));
    if (!tenantId) return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });

    const scorecards = await listCarrierScorecards({
      tenantId,
      carrierId: req.nextUrl.searchParams.get('carrierId'),
      status: req.nextUrl.searchParams.get('status'),
      preferred: boolParam(req.nextUrl.searchParams.get('preferred')),
      blacklisted: boolParam(req.nextUrl.searchParams.get('blacklisted')),
      search: req.nextUrl.searchParams.get('search'),
      limit: Number(req.nextUrl.searchParams.get('limit') ?? 100),
    });
    return NextResponse.json({ scorecards });
  } catch (error) {
    console.error('[logistics/carrier-scorecards GET]', error);
    return NextResponse.json({ error: 'Failed to fetch carrier scorecards' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Tenant context is required' }, { status: 401 });
    const body = await req.json() as LogisticsCarrierScorecardInput & { tenantId?: string };
    const tenantId = resolveTenant(ctx, body.tenantId);
    if (!tenantId) return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });

    const scorecard = await upsertCarrierScorecard({ ...body, tenantId });
    return NextResponse.json({ scorecard }, { status: 201 });
  } catch (error) {
    console.error('[logistics/carrier-scorecards POST]', error);
    return logisticsErrorResponse(error, 'Failed to save carrier scorecard');
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Tenant context is required' }, { status: 401 });
    const body = await req.json() as {
      tenantId?: string;
      carrierId?: string;
      preferred?: boolean | null;
      blacklisted?: boolean | null;
      blacklistReason?: string | null;
    };
    const tenantId = resolveTenant(ctx, body.tenantId);
    if (!tenantId) return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });
    if (!body.carrierId) return NextResponse.json({ error: 'carrierId is required' }, { status: 400 });

    const scorecard = await setCarrierPreference({
      tenantId,
      carrierId: body.carrierId,
      preferred: body.preferred,
      blacklisted: body.blacklisted,
      blacklistReason: body.blacklistReason,
    });
    return NextResponse.json({ scorecard });
  } catch (error) {
    console.error('[logistics/carrier-scorecards PATCH]', error);
    return logisticsErrorResponse(error, 'Failed to update carrier rule');
  }
}
