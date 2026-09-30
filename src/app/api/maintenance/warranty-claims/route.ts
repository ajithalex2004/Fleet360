export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { publishWarrantyClaimRaised } from '@/lib/maintenance/publish-event';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { runAsTenant } from '@/lib/rls-scope';
import { parseClaimInput, warrantyOpenForClaims } from '@/lib/maintenance/warranty';
// GET /api/maintenance/warranty-claims
// Query params: warrantyId?, requestId?, status?
export async function GET(request: NextRequest) {

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const { searchParams } = new URL(request.url);
            const warrantyId = searchParams.get('warrantyId') ?? undefined;
            const requestId  = searchParams.get('requestId')  ?? undefined;
            const status     = searchParams.get('status')     ?? undefined;

            const claims = await tx.warrantyClaim.findMany({
                where: {
                    ...(tenantId   ? { tenantId }   : {}),
                    ...(warrantyId ? { warrantyId }  : {}),
                    ...(requestId  ? { requestId }   : {}),
                    ...(status     ? { status }      : {}),
                },
                include: { VehicleWarranty: true },
                orderBy: { createdAt: 'desc' },
            });

            return NextResponse.json(JSON.parse(JSON.stringify(claims)));
        } catch (e) {
            console.error('Failed to fetch warranty claims:', e);
            return NextResponse.json(
                { error: 'Internal Server Error', details: String(e) },
                { status: 500 },
            );
        }
  });
}


// POST /api/maintenance/warranty-claims
// Body: { warrantyId, description, requestId?, claimDate?, claimedAmount?, referenceNumber? }
export async function POST(request: NextRequest) {

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  // Published once the claim is committed: an event written from inside the
  // transaction would run after it had closed.
  const pending: { raised: Parameters<typeof publishWarrantyClaimRaised> | null } = { raised: null };
  const response = await withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const body = await request.json().catch(() => null);
            if (!body || typeof body !== 'object') {
                return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
            }
            const input = parseClaimInput(body);
            if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });

            // RLS scopes the lookup to this tenant's warranties.
            const warranty = await tx.vehicleWarranty.findUnique({ where: { id: input.data.warrantyId } });
            if (!warranty) return NextResponse.json({ error: 'Warranty not found' }, { status: 404 });
            if (!warrantyOpenForClaims(warranty, input.data.claimDate)) {
                return NextResponse.json(
                    { error: 'This warranty is inactive or did not cover the claim date.' },
                    { status: 409 },
                );
            }

            // A new claim always starts PENDING; it is approved separately.
            const claim = await tx.warrantyClaim.create({
                data: { tenantId, ...input.data, status: 'PENDING' },
                include: { VehicleWarranty: true },
            });

            pending.raised = [
                claim.id,
                tenantId,
                {
                    claimId:       claim.id,
                    warrantyId:    claim.warrantyId,
                    requestId:     claim.requestId       ?? null,
                    vehicleId:     claim.VehicleWarranty?.vehicleId ?? '',
                    tenantId,
                    claimedAmount: claim.claimedAmount != null
                        ? Number(claim.claimedAmount)
                        : null,
                    currency:      'AED',
                    description:   claim.description     ?? null,
                    claimDate:     claim.claimDate
                        ? new Date(claim.claimDate).toISOString()
                        : null,
                },
            ];

            return NextResponse.json(
                JSON.parse(JSON.stringify(claim)),
                { status: 201 },
            );
        } catch (e) {
            console.error('Failed to create warranty claim:', e);
            return NextResponse.json(
                { error: 'Internal Server Error', details: String(e) },
                { status: 500 },
            );
        }
  });
  const raised = pending.raised;
  if (raised) {
    void runAsTenant(tenantId, () => publishWarrantyClaimRaised(...raised))
      .catch(err => console.warn('[maintenance] warranty_claim_raised publish failed:', err));
  }
  return response;
}

