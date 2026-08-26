import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(req: NextRequest) {

    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const requests = await tx.maintenanceRequest.findMany({
                where: { tenantId, deletedAt: null },
                include: {
                    Vehicle: true,
                    Garage: true,
                    Driver: true,
                    quotations: true,
                    WorkOrder: true,
                    attachments: true,
                    comments: true,
                    histories: true,
                },
                orderBy: { createdAt: 'desc' }
            });
            return NextResponse.json(JSON.parse(JSON.stringify(requests)));
        } catch (e) {
            console.error('Failed to fetch maintenance requests:', e);
            return NextResponse.json({ error: 'Internal Server Error', details: String(e) }, { status: 500 });
        }
  });
}


export async function POST(request: NextRequest) {

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const body = await request.json();

            const req = await tx.maintenanceRequest.create({
                data: {
                    // TODO: read tenantId from request headers via getTenantContext()
                    tenantId: '',
                    vehicleId: body.vehicleId || body.vehicle_id,
                    driverId: body.driverId || body.driver_id,
                    description: body.description,
                    status: body.status || 'Open',
                    priority: body.priority || 'Medium',
                    maintenanceType: body.maintenanceType || body.maintenance_type,
                    workOrderNo: body.workOrderNo || body.work_order_no,
                    odometer: body.odometer ? BigInt(body.odometer) : null,
                    garageId: body.garageId || body.garage_id,
                    estimatedCost: body.estimatedCost,
                    requestDate: body.requestDate ? new Date(body.requestDate) : new Date(),
                    expectedEndDate: body.expectedEndDate ? new Date(body.expectedEndDate) : null,
                    maintenanceJobs: body.maintenanceJobs || body.maintenance_jobs || [],
                }
            });

            return NextResponse.json(JSON.parse(JSON.stringify(req)), { status: 201 });
            } catch (e) {
            console.error('Failed to create maintenance request:', e);
            return NextResponse.json({ error: 'Internal Server Error', details: String(e) }, { status: 500 });
        }
  });
}

