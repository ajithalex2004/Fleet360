export const dynamic = 'force-dynamic';

/**
 * GET /api/logistics/carriers
 *
 * Lists the tenant's carriers (the partner network) for the marketplace
 * invite picker. Thin wrapper over domain.listCarriers. Defaults to ACTIVE
 * carriers (the ones eligible to be invited / awarded).
 *
 * Auth: tenant operator session; tenantId from the x-tenant-id header.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { createCarrier, listCarriers } from '@/lib/logistics/domain';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  const sp = req.nextUrl.searchParams;
  const status = sp.get('status') ?? 'ACTIVE';
  const search = sp.get('search');
  const limit = Math.min(Math.max(parseInt(sp.get('limit') ?? '300', 10) || 300, 1), 500);

  try {
    const data = await listCarriers({ tenantId, status, search, limit });
    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'private, max-age=30' } });
    } catch (e) {
    console.error('[logistics/carriers GET]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to list carriers' },
      { status: 500 },
    );
  }
}

interface CarrierBody {
  carrierCode?: string | null;
  carrierType?: string | null;
  name?: string | null;
  tradeLicense?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  status?: string | null;
  onboardingStatus?: string | null;
  complianceStatus?: string | null;
  commissionModel?: string | null;
  commissionRate?: number | string | null;
  serviceRegions?: unknown;
  capacityProfile?: unknown;
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  let body: CarrierBody;
  try { body = (await req.json()) as CarrierBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: 'Carrier name is required' }, { status: 400 });
  }

  try {
    const data = await createCarrier({
      tenantId,
      carrierCode: body.carrierCode?.trim() || null,
      carrierType: body.carrierType ?? 'TRANSPORT_COMPANY',
      name,
      tradeLicense: body.tradeLicense ?? null,
      contactName: body.contactName ?? null,
      contactEmail: body.contactEmail ?? null,
      contactPhone: body.contactPhone ?? null,
      status: body.status ?? 'ACTIVE',
      onboardingStatus: body.onboardingStatus ?? 'DRAFT',
      complianceStatus: body.complianceStatus ?? 'PENDING',
      commissionModel: body.commissionModel ?? null,
      commissionRate: num(body.commissionRate),
      serviceRegions: body.serviceRegions ?? [],
      capacityProfile: body.capacityProfile ?? {},
    });
    return NextResponse.json({ data }, { status: 201 });
    } catch (e) {
    console.error('[logistics/carriers POST]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to save carrier' },
      { status: 500 },
    );
  }
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
