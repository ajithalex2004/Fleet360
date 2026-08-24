import { NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
// GET /api/maintenance/[id]/warranty-check
// Returns active warranties for the vehicle linked to this request.
// Useful to call when request reaches ESTIMATION_APPROVED.
export async function GET(
    _request: Request,
    { params }: { params: { id: string } },
) {

    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const { id } = params;

            // Resolve the vehicleId from the request
            const req = await tx.maintenanceRequest.findUnique({
                where:  { id },
                select: { vehicleId: true },
            });

            if (!req) {
                return NextResponse.json({ error: 'Request not found' }, { status: 404 });
            }

            const today = new Date();

            const warranties = req.vehicleId
                ? await tx.vehicleWarranty.findMany({
                      where: {
                          vehicleId:  req.vehicleId,
                          isActive:   true,
                          startDate:  { lte: today },
                          expiryDate: { gte: today },
                      },
                      include: { claims: { orderBy: { createdAt: 'desc' }, take: 5 } },
                      orderBy: { expiryDate: 'asc' },
                  })
                : [];

            const result = {
                hasActiveWarranty: warranties.length > 0,
                warranties: warranties.map((w) => ({
                    ...w,
                    coverageNote: w.coverageDescription
                        ?? `${w.warrantyType} warranty — expires ${w.expiryDate.toISOString().split('T')[0]}`,
                })),
            };

            return NextResponse.json(JSON.parse(JSON.stringify(result)));
        } catch (e) {
            console.error('Failed to check warranty:', e);
            return NextResponse.json(
                { error: 'Internal Server Error', details: String(e) },
                { status: 500 },
            );
        }
  });
}

