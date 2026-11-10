export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { PartnerServiceDomain } from '@prisma/client';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { runAsTenant } from '@/lib/rls-scope';
import { publishRecoveryDispatched } from '@/lib/maintenance/publish-event';
import { ensureDispatchSchema } from '@/lib/dispatch/schema';
import { runDispatch } from '@/lib/dispatch/engine';
import { AdapterRegistry } from '@/lib/exchange/adapters/adapter-registry';
import { OutsourceEngine } from '@/lib/exchange/outsource-engine';
import { MarketplaceService } from '@/lib/exchange/marketplace-service';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
// POST /api/maintenance/breakdown-reports/[id]/dispatch-recovery
// Body: { recoveryVehicleId?, recoveryDriverId?, estimatedArrivalAt?, recoveryNotes? }

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const pending: { publish: (() => Promise<unknown>) | null; dispatchJobId: string | null } = {
    publish: null,
    dispatchJobId: null,
  };
  const baseUrl = `${request.nextUrl.protocol}//${request.nextUrl.host}`;

  const response = await withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const { id }  = params;
      const bodyRaw = await request.json();
      const body    = stripTenantOwnershipFields(bodyRaw);
      const now     = new Date();

      const existing = await tx.breakdownReport.findFirst({
        where: { id, tenantId },
      });

      if (!existing || existing.deletedAt) {
        return NextResponse.json({ error: 'Breakdown report not found' }, { status: 404 });
      }

      if (existing.status !== 'REPORTED') {
        return NextResponse.json(
          { error: `Cannot dispatch recovery from status: ${existing.status}` },
          { status: 422 },
        );
      }

      // Verify recovery vehicle & driver belong to this tenant if supplied
      if (body.recoveryVehicleId) {
        const veh = await tx.vehicle.findFirst({
          where: { id: String(body.recoveryVehicleId), tenantId, deletedAt: null },
          select: { id: true },
        });
        if (!veh) {
          return NextResponse.json({ error: 'Recovery vehicle not found in this tenant' }, { status: 404 });
        }
      }

      if (body.recoveryDriverId) {
        const drv = await tx.driver.findFirst({
          where: { id: String(body.recoveryDriverId), tenantId, deletedAt: null },
          select: { id: true },
        });
        if (!drv) {
          return NextResponse.json({ error: 'Recovery driver not found in this tenant' }, { status: 404 });
        }
      }

      const updated = await tx.breakdownReport.update({
        where: { id: existing.id },
        data: {
          status:               'RECOVERY_DISPATCHED',
          recoveryVehicleId:    body.recoveryVehicleId   ?? null,
          recoveryDriverId:     body.recoveryDriverId    ?? null,
          recoveryNotes:        body.recoveryNotes       ?? null,
          recoveryDispatchedAt: now,
          estimatedArrivalAt:   body.estimatedArrivalAt
            ? new Date(body.estimatedArrivalAt)
            : null,
        },
        include: {
          MaintenanceRequest: {
            select: { id: true, status: true, workOrderNo: true },
          },
        },
      });

      // Create corresponding dispatch_jobs record and lock assigned recovery unit
      try { await ensureDispatchSchema(); } catch { /* ignore in unit test mocks */ }
      const hasDirectAssignment = Boolean(updated.recoveryDriverId && updated.recoveryVehicleId);
      const initialJobStatus = hasDirectAssignment ? 'ACCEPTED' : 'PENDING';
      const metaJson = JSON.stringify({
        breakdownReportId: id,
        brokenVehicleId:   updated.vehicleId,
        recoveryNotes:     updated.recoveryNotes,
        requiredSkills:    ['RECOVERY', 'ROADSIDE'],
      });

      const [dj] = await tx.$queryRawUnsafe<{ id: string }[]>(`
        INSERT INTO dispatch_jobs (
          tenant_id, booking_id, service_type, priority, status,
          pickup_lat, pickup_lng, origin_lat, origin_lng,
          origin_address,
          assigned_driver_id, assigned_vehicle_id, driver_id, vehicle_id,
          metadata, meta
        ) VALUES (
          $1, $2, 'TECHNICIAN', 'URGENT', $3,
          $4, $5, $4, $5,
          $6,
          $7, $8, $7, $8,
          $9::jsonb, $9::jsonb
        )
        RETURNING id
      `,
        tenantId,
        id,
        initialJobStatus,
        existing.latitude  != null ? Number(existing.latitude)  : null,
        existing.longitude != null ? Number(existing.longitude) : null,
        existing.location ?? null,
        updated.recoveryDriverId  ?? null,
        updated.recoveryVehicleId ?? null,
        metaJson,
      ).catch(() => [] as { id: string }[]);

      if (hasDirectAssignment && dj?.id) {
        await tx.$executeRawUnsafe(
          `UPDATE driver_availability
           SET status = 'BUSY', current_job_id = $2::uuid, updated_at = NOW()
           WHERE driver_id = $1`,
          String(updated.recoveryDriverId),
          dj.id,
        ).catch(() => {});

        await tx.$executeRawUnsafe(
          `UPDATE vehicles SET status = 'IN_USE' WHERE id::text = $1 AND tenant_id::text = $2`,
          String(updated.recoveryVehicleId),
          tenantId,
        ).catch(() => {});
      } else if (dj?.id) {
        pending.dispatchJobId = dj.id;
      }

      let exchangeRequest: { id: string; requestNumber: string; opportunityId: string } | undefined;
      if (body.outsourceToExchange === true) {
        const actorUserId = request.headers.get('x-user-id') || 'system';
        const adapter = AdapterRegistry.getAdapter(PartnerServiceDomain.RECOVERY);
        const source = await adapter.getSourceReference(id, tenantId);
        const reqPayload = await adapter.buildRequirementsPayload(source);
        const rfq = await OutsourceEngine.createOutsourceRequest({
          tenantId,
          domain: PartnerServiceDomain.RECOVERY,
          sourceReferenceType: 'BREAKDOWN_REPORT',
          sourceReferenceId: id,
          serviceDate: new Date().toISOString().slice(0, 10),
          pickupTime: source.pickupTime || 'Immediate Dispatch',
          pickupLocation: source.pickupLocation,
          dropoffLocation: source.dropoffLocation,
          requiredCapacity: 1,
          vehicleTypeRequired: typeof reqPayload.recoveryType === 'string' ? reqPayload.recoveryType : 'FLATBED',
          specialInstructions: source.specialInstructions,
          invitedPartnerIds: Array.isArray(body.partnerIds) ? (body.partnerIds as string[]) : [],
          createdByUserId: actorUserId,
        });
        const opp = await MarketplaceService.publishOpportunity({
          outsourceRequestId: rfq.id,
          tenantId,
          createdByUserId: actorUserId,
          requirementsPayload: reqPayload,
        });
        exchangeRequest = {
          id: rfq.id,
          requestNumber: rfq.requestNumber,
          opportunityId: opp.id,
        };
      }

      // Publish event (fire-and-forget)
      pending.publish = () => publishRecoveryDispatched(id, updated.tenantId, {
        reportId:           id,
        vehicleId:          updated.vehicleId ?? '',
        tenantId:           updated.tenantId,
        recoveryVehicleId:  updated.recoveryVehicleId,
        recoveryDriverId:   updated.recoveryDriverId,
        estimatedArrivalAt: updated.estimatedArrivalAt?.toISOString() ?? null,
        dispatchedAt:       now.toISOString(),
      });

      const payload = JSON.parse(JSON.stringify(updated));
      if (exchangeRequest) {
        payload.exchangeRequest = exchangeRequest;
      }
      return NextResponse.json(payload);
    } catch (e) {
      console.error('Failed to dispatch recovery:', e);
      return NextResponse.json(
        { error: 'Internal Server Error', details: String(e) },
        { status: 500 },
      );
    }
  });

  if (pending.dispatchJobId) {
    void runDispatch(pending.dispatchJobId, baseUrl).catch(() => {});
  }

  const publish = pending.publish;
  if (publish) {
    void runAsTenant(tenantId, publish)
      .catch(err => console.warn('[maintenance] breakdown event publish failed:', err));
  }
  return response;
}
