import { NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { processNotificationRules } from '@/lib/notifications';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET() {

    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const requests = await tx.serviceRequest.findMany({
                where: { deletedAt: null },
                include: {
                    attachments: true,
                    histories: true,
                },
                orderBy: { createdAt: 'desc' }
            });
            return NextResponse.json(JSON.parse(JSON.stringify(requests)));
        } catch (e) {
            console.error('Proxy Error GET /service-requests:', e);
            return NextResponse.json({ error: `Internal Server Error: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
        }
  });
}


export async function POST(request: Request) {

    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const body = await request.json();

            const data = await tx.serviceRequest.create({
                data: {
                    // TODO: read tenantId from request headers via getTenantContext()
                    tenantId: '',
                    requestorId: body.requestorId || body.requestor_id,
                    serviceType: body.serviceType || body.service_type,
                    vehicleId: body.vehicleId || body.vehicle_id,
                    priority: body.priority,
                    description: body.description,
                    date: body.date ? new Date(body.date) : new Date(),
                    status: body.status || 'Open',
                    maintenanceRequestId: body.maintenanceRequestId || body.maintenance_request_id,
                    assignedTo: body.assignedTo || body.assigned_to,
                    relatedDriverId: body.relatedDriverId || body.related_driver_id,
                }
            });

            // Trigger notification in background
            if (data && data.id) {
                const templateData = {
                    requestId: data.id,
                    status: data.status || 'Open',
                    assignee: data.assignedTo || 'Unassigned',
                    description: data.description || '',
                    vehicle: data.vehicleId || 'Unknown',
                };

                // Fire and forget - DO NOT await to avoid blocking UI
                processNotificationRules('SR_CREATED', templateData, data.assignedTo ?? undefined).catch(err => {
                    console.error('Background Notification Failed:', err);
                });
            }

            return NextResponse.json(JSON.parse(JSON.stringify(data)), { status: 201 });
            } catch (e) {
            console.error('Failed to create service request:', e);
            return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
        }
  });
}

