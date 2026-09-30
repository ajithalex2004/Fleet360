export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { parseWarrantyInput } from '@/lib/maintenance/warranty';
// GET /api/maintenance/warranties
// Query params: vehicleId?, activeOnly?
export async function GET(request: NextRequest) {

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const { searchParams } = new URL(request.url);
            const vehicleId = searchParams.get('vehicleId') ?? undefined;
            const activeOnly = searchParams.get('activeOnly') !== 'false';

            const warranties = await tx.vehicleWarranty.findMany({
                where: {
                    ...(tenantId  ? { tenantId }  : {}),
                    ...(vehicleId ? { vehicleId } : {}),
                    ...(activeOnly ? { isActive: true } : {}),
                },
                include: { claims: { orderBy: { createdAt: 'desc' } } },
                orderBy: { expiryDate: 'asc' },
            });

            return NextResponse.json(JSON.parse(JSON.stringify(warranties)));
        } catch (e) {
            console.error('Failed to fetch warranties:', e);
            return NextResponse.json(
                { error: 'Internal Server Error', details: String(e) },
                { status: 500 },
            );
        }
  });
}


// POST /api/maintenance/warranties
// Body: { vehicleId, warrantyType, provider?, startDate, expiryDate,
//         coverageDescription?, maxClaimAmount? }
export async function POST(request: NextRequest) {

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const body = await request.json().catch(() => null);
            if (!body || typeof body !== 'object') {
                return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
            }
            const input = parseWarrantyInput(body);
            if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });

            // The vehicle must be one of this tenant's (RLS scopes the lookup).
            const vehicle = await tx.vehicle.findFirst({
                where: { id: input.data.vehicleId, deletedAt: null },
                select: { id: true },
            });
            if (!vehicle) return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });

            const warranty = await tx.vehicleWarranty.create({
                data: { tenantId, ...input.data, isActive: true },
                include: { claims: true },
            });

            return NextResponse.json(
                JSON.parse(JSON.stringify(warranty)),
                { status: 201 },
            );
        } catch (e) {
            console.error('Failed to create warranty:', e);
            return NextResponse.json(
                { error: 'Internal Server Error', details: String(e) },
                { status: 500 },
            );
        }
  });
}

