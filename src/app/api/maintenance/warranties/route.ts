import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
// GET /api/maintenance/warranties
// Query params: tenantId?, vehicleId?, activeOnly?
export async function GET(request: NextRequest) {

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const { searchParams } = new URL(request.url);
            const tenantId  = searchParams.get('tenantId')  ?? '';
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
//         coverageDescription?, maxClaimAmount?, isActive?, tenantId? }
export async function POST(request: NextRequest) {

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const body = await request.json();

            const warranty = await tx.vehicleWarranty.create({
                data: {
                    tenantId:            body.tenantId            ?? '',
                    vehicleId:           body.vehicleId,
                    warrantyType:        body.warrantyType,
                    provider:            body.provider            ?? null,
                    startDate:           new Date(body.startDate),
                    expiryDate:          new Date(body.expiryDate),
                    coverageDescription: body.coverageDescription ?? null,
                    maxClaimAmount:      body.maxClaimAmount      ?? null,
                    isActive:            body.isActive            ?? true,
                },
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

