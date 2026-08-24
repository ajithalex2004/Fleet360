import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(
    request: NextRequest,
    { params }: { params: { id: string } }
) {

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const vehicle = await tx.vehicle.findFirst({
                where: { id: params.id, deletedAt: null }
            });
            if (!vehicle) {
                return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
            }
            return NextResponse.json(JSON.parse(JSON.stringify(vehicle)));
        } catch (e) {
            console.error('Failed to fetch vehicle:', e);
            return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
        }
  });
}


export async function PATCH(
    request: NextRequest,
    { params }: { params: { id: string } }
) {

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const body = await request.json();

            const data: Record<string, unknown> = {};
            if (body.make !== undefined) data.make = body.make;
            if (body.model !== undefined) data.model = body.model;
            if (body.type !== undefined) data.type = body.type;
            if (body.year !== undefined) data.year = body.year ? BigInt(body.year) : null;
            if (body.licensePlate !== undefined) data.licensePlate = body.licensePlate;
            if (body.license_plate !== undefined) data.licensePlate = body.license_plate;
            if (body.vin !== undefined) data.vin = body.vin;
            if (body.status !== undefined) data.status = body.status;
            if (body.currentOdometer !== undefined) data.currentMileage = body.currentOdometer ? BigInt(body.currentOdometer) : null;
            if (body.currentMileage !== undefined) data.currentMileage = body.currentMileage ? BigInt(body.currentMileage) : null;
            if (body.registrationExpiry !== undefined) data.registrationExpiry = body.registrationExpiry ? new Date(body.registrationExpiry) : null;
            if (body.insuranceExpiry !== undefined) data.insuranceExpiry = body.insuranceExpiry ? new Date(body.insuranceExpiry) : null;

            const updated = await tx.vehicle.update({
                where: { id: params.id },
                data,
            });

            return NextResponse.json(JSON.parse(JSON.stringify(updated)));
        } catch (e) {
            console.error('Failed to update vehicle:', e);
            return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
        }
  });
}


export async function DELETE(
    request: NextRequest,
    { params }: { params: { id: string } }
) {

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            await tx.vehicle.update({
                where: { id: params.id },
                data: { deletedAt: new Date() },
            });
            return NextResponse.json({ success: true });
            } catch (e) {
            console.error('Failed to delete vehicle:', e);
            return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
        }
  });
}

