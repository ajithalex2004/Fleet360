/**
 * /api/logistics/shippers  (model A: shipper = customers)
 *
 *   GET   list onboarded shippers — the freight-onboarding view of the tenant's
 *         customers (onboarding/compliance status, portal-access summary, and
 *         activity counts), for the operator console.
 *   POST  onboard a new shipper = create a tenant-scoped customer with the
 *         freight onboarding fields. Portal access is granted separately via the
 *         existing invitation endpoint (/api/admin/customers/[id]/portal-invitations).
 *
 * Auth: tenant operator session; tenantId from the x-tenant-id header.
 */

import { NextRequest, NextResponse } from 'next/server';
import { listShipperOnboarding, onboardShipperCustomer, LogisticsValidationError } from '@/lib/logistics/domain';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const onboardingStatus = sp.get('onboardingStatus');
  const search = sp.get('search');
  const limit = Math.min(Math.max(parseInt(sp.get('limit') ?? '200', 10) || 200, 1), 500);

  try {
    const data = await listShipperOnboarding({ tenantId, onboardingStatus, search, limit });
    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'private, max-age=15' } });
  } catch (e) {
    console.error('[logistics/shippers GET]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to list shippers' },
      { status: 500 },
    );
  }
}

interface OnboardBody {
  name?: string;
  email?: string | null;
  phone?: string | null;
  tradeLicense?: string | null;
  taxRegistrationNumber?: string | null;
  creditLimit?: number | string | null;
  onboardingStatus?: string | null;
  complianceStatus?: string | null;
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;, { status: 401 });

  let body: OnboardBody;
  try { body = (await req.json()) as OnboardBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const name = (body.name ?? '').trim();
  if (!name) return NextResponse.json({ error: 'Shipper name is required' }, { status: 400 });

  const credit = body.creditLimit == null || body.creditLimit === '' ? null : Number(body.creditLimit);
  if (credit != null && !Number.isFinite(credit)) {
    return NextResponse.json({ error: 'Credit limit must be a number' }, { status: 400 });
  }

  try {
    const shipper = await onboardShipperCustomer({
      tenantId,
      name,
      email: body.email ?? null,
      phone: body.phone ?? null,
      tradeLicense: body.tradeLicense ?? null,
      taxRegistrationNumber: body.taxRegistrationNumber ?? null,
      creditLimit: credit,
      onboardingStatus: body.onboardingStatus ?? null,
      complianceStatus: body.complianceStatus ?? null,
    });
    return NextResponse.json({ data: shipper }, { status: 201 });
  } catch (e) {
    if (e instanceof LogisticsValidationError) {
      return NextResponse.json({ error: e.message, issues: e.issues }, { status: 422 });
    }
    console.error('[logistics/shippers POST]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to onboard shipper' },
      { status: 500 },
    );
  }
}
