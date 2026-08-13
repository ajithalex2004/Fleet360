/**
 * /api/logistics/shippers/[id]  (id = customers.id; model A: shipper = customers)
 *
 *   GET   the freight-onboarding view of one shipper (customer)
 *   PATCH advance onboarding / compliance status, or edit trade license / TRN /
 *         credit limit on the customer record.
 *
 * Portal access (invite a portal user) is a separate concern handled by the
 * existing /api/admin/customers/[id]/portal-invitations endpoint.
 *
 * Auth: tenant operator session; tenantId from x-tenant-id.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getShipperOnboarding, updateShipperOnboarding } from '@/lib/logistics/domain';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  try {
    const shipper = await getShipperOnboarding({ tenantId, customerId: params.id });
    if (!shipper) return NextResponse.json({ error: 'Shipper not found' }, { status: 404 });
    return NextResponse.json({ data: shipper }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[logistics/shippers/:id GET]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to load shipper' },
      { status: 500 },
    );
  }
}

interface PatchBody {
  onboardingStatus?: string | null;
  complianceStatus?: string | null;
  tradeLicense?: string | null;
  taxRegistrationNumber?: string | null;
  creditLimit?: number | string | null;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: PatchBody;
  try { body = (await req.json()) as PatchBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  let credit: number | null | undefined = undefined;
  if (body.creditLimit !== undefined) {
    credit = body.creditLimit == null || body.creditLimit === '' ? null : Number(body.creditLimit);
    if (credit != null && !Number.isFinite(credit)) {
      return NextResponse.json({ error: 'Credit limit must be a number' }, { status: 400 });
    }
  }

  try {
    const shipper = await updateShipperOnboarding({
      tenantId,
      customerId: params.id,
      onboardingStatus: body.onboardingStatus ?? null,
      complianceStatus: body.complianceStatus ?? null,
      tradeLicense: body.tradeLicense ?? null,
      taxRegistrationNumber: body.taxRegistrationNumber ?? null,
      creditLimit: credit ?? null,
    });
    return NextResponse.json({ data: shipper });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'failed to update shipper';
    const status = msg.includes('not found') ? 404 : 500;
    if (status === 500) console.error('[logistics/shippers/:id PATCH]', e);
    return NextResponse.json({ error: msg }, { status });
  }
}
