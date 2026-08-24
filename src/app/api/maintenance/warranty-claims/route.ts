import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { publishWarrantyClaimRaised } from '@/lib/maintenance/publish-event';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
// GET /api/maintenance/warranty-claims
// Query params: tenantId?, warrantyId?, requestId?, status?
export async function GET(request: Request) {
    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

    try {
        const { searchParams } = new URL(request.url);
        const tenantId   = searchParams.get('tenantId')   ?? '';
        const warrantyId = searchParams.get('warrantyId') ?? undefined;
        const requestId  = searchParams.get('requestId')  ?? undefined;
        const status     = searchParams.get('status')     ?? undefined;

        const claims = await prisma.warrantyClaim.findMany({
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
    } catch (error) {
        console.error('Failed to fetch warranty claims:', error);
        return NextResponse.json(
            { error: 'Internal Server Error', details: String(error) },
            { status: 500 },
        );
    }
}

// POST /api/maintenance/warranty-claims
// Body: { warrantyId, requestId?, claimDate?, claimedAmount?, description?, tenantId? }
export async function POST(request: Request) {
    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

    try {
        const body = await request.json();

        const claim = await prisma.warrantyClaim.create({
            data: {
                tenantId:        body.tenantId        ?? '',
                warrantyId:      body.warrantyId,
                requestId:       body.requestId       ?? null,
                claimDate:       body.claimDate ? new Date(body.claimDate) : null,
                claimedAmount:   body.claimedAmount   ?? null,
                approvedAmount:  body.approvedAmount  ?? null,
                status:          body.status          ?? 'PENDING',
                description:     body.description     ?? null,
                referenceNumber: body.referenceNumber ?? null,
            },
            include: { VehicleWarranty: true },
        });

        // Publish WarrantyClaimRaised event (fire-and-forget)
        const tenantId = (claim as any).tenantId as string | null;
        if (tenantId) {
            publishWarrantyClaimRaised(
                (claim as any).id,
                tenantId,
                {
                    claimId:       (claim as any).id,
                    warrantyId:    (claim as any).warrantyId,
                    requestId:     (claim as any).requestId       ?? null,
                    vehicleId:     (claim as any).VehicleWarranty?.vehicleId ?? '',
                    tenantId,
                    claimedAmount: (claim as any).claimedAmount != null
                        ? Number((claim as any).claimedAmount)
                        : null,
                    currency:      'AED',
                    description:   (claim as any).description     ?? null,
                    claimDate:     (claim as any).claimDate
                        ? new Date((claim as any).claimDate).toISOString()
                        : null,
                },
            ).catch(err => console.warn('[maintenance] warranty_claim_raised publish failed:', err));
        }

        return NextResponse.json(
            JSON.parse(JSON.stringify(claim)),
            { status: 201 },
        );
    } catch (error) {
        console.error('Failed to create warranty claim:', error);
        return NextResponse.json(
            { error: 'Internal Server Error', details: String(error) },
            { status: 500 },
        );
    }
}
