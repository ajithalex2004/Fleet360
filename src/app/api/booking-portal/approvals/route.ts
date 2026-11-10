export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { approvalGate } from '@/lib/workflow/approvals';
import { ensureDispatchSchema } from '@/lib/dispatch/schema';
import { runDispatch } from '@/lib/dispatch/engine';
import {
  evaluateBookingApprovalPolicy,
  BookingPolicyContext,
  ApprovalHistoryEntry,
} from '@/lib/booking-approval-policy';

function mapBookingToDispatchServiceType(serviceType: string): string {
  const upper = (serviceType || '').toUpperCase();
  if (['LOGISTICS', 'FREIGHT', 'CARGO'].includes(upper)) return 'FREIGHT';
  if (['DELIVERY', 'PARCEL'].includes(upper)) return 'DELIVERY';
  if (['AMBULANCE', 'EMS'].includes(upper)) return 'AMBULANCE';
  if (['TECHNICIAN', 'MAINTENANCE'].includes(upper)) return 'TECHNICIAN';
  return 'PASSENGER';
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const bookings = await tx.booking.findMany({
        where: {
          tenantId,
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });

      let tier1Count = 0;
      let tier2Count = 0;
      let tier3Count = 0;
      let autoApprovedCount = 0;
      let totalPending = 0;

      const enriched = bookings.map((b) => {
        let parsedNotes: Record<string, any> = {};
        if (b.notes) {
          try {
            parsedNotes = JSON.parse(b.notes);
          } catch {
            parsedNotes = {};
          }
        }

        const approvalHistory: ApprovalHistoryEntry[] = parsedNotes.approvalHistory || [];

        const ctx: BookingPolicyContext = {
          id: b.id,
          bookingRef: b.bookingRef,
          serviceType: b.serviceType,
          vehicleCategory: b.vehicleCategory,
          totalFareAed: parsedNotes.totalFareAed || 0,
          costCenter: parsedNotes.costCenter || 'CC-OPS-3003',
          budgetStatus: parsedNotes.budgetStatus || 'WITHIN_POLICY',
          startDate: b.startDate?.toISOString(),
          createdAt: b.createdAt?.toISOString(),
          approvalHistory,
        };

        const policyEvaluation = evaluateBookingApprovalPolicy(ctx);

        if (b.status === 'PENDING') {
          totalPending++;
          if (policyEvaluation.isAutoApproved) autoApprovedCount++;
          if (policyEvaluation.currentTier === 'TIER_1_PENDING') tier1Count++;
          if (policyEvaluation.currentTier === 'TIER_2_PENDING') tier2Count++;
          if (policyEvaluation.currentTier === 'TIER_3_PENDING') tier3Count++;
        }

        return {
          id: b.id,
          bookingRef: b.bookingRef,
          requestorName: b.requestorName,
          requestorEmail: b.requestorEmail,
          serviceType: b.serviceType,
          vehicleCategory: b.vehicleCategory,
          startDate: b.startDate,
          endDate: b.endDate,
          status: b.status,
          createdAt: b.createdAt,
          financials: {
            totalFareAed: parsedNotes.totalFareAed || 0,
            fareSubtotal: parsedNotes.fareSubtotal || 0,
            vatAmount: parsedNotes.vatAmount || 0,
            costCenter: parsedNotes.costCenter || 'CC-OPS-3003',
            projectCode: parsedNotes.projectCode || '',
            billingMethod: parsedNotes.billingMethod || 'CORPORATE_ACCOUNT',
            budgetStatus: parsedNotes.budgetStatus || 'WITHIN_POLICY',
            distanceKm: parsedNotes.distanceKm || 0,
            salikTollsAed: parsedNotes.salikTollsAed || 0,
            depotId: parsedNotes.depotId || '',
            sampleModels: parsedNotes.sampleModels || '',
          },
          policyEvaluation,
          approvalHistory,
        };
      });

      return NextResponse.json({
        bookings: enriched,
        stats: {
          totalPending,
          tier1Count,
          tier2Count,
          tier3Count,
          autoApprovedCount,
        },
      });
    } catch (err) {
      console.error('[api/booking-portal/approvals GET]', err);
      return NextResponse.json({ error: 'Failed to fetch bookings for approval' }, { status: 500 });
    }
  });
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  const body = stripTenantOwnershipFields(await req.json().catch(() => ({})));
  if (body?.bookingId && typeof body.action === 'string') {
    const gated = await approvalGate({
      headers: req.headers, tenantId, referenceType: 'booking', referenceId: String(body.bookingId),
      action: body.action === 'REJECT' ? 'REJECT' : 'APPROVE', comments: typeof body.remarks === 'string' ? body.remarks : '',
    });
    if (gated) return gated;
  }

  let dispatchJobIdToTrigger: string | null = null;
  const baseUrl = `${req.nextUrl.protocol}//${req.nextUrl.host}`;

  const response = await withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const {
        bookingId,
        action, // 'APPROVE_TIER_1' | 'APPROVE_TIER_2' | 'APPROVE_TIER_3' | 'REJECT'
        remarks = '',
        approverName = 'Corporate Approver',
        approverRole = 'Operations Manager',
      } = body;

      if (!bookingId || !action) {
        return NextResponse.json({ error: 'Missing bookingId or action' }, { status: 400 });
      }

      const booking = await tx.booking.findFirst({
        where: { id: bookingId, tenantId },
      });

      if (!booking) {
        return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
      }

      let parsedNotes: Record<string, any> = {};
      if (booking.notes) {
        try {
          parsedNotes = JSON.parse(booking.notes);
        } catch {
          parsedNotes = {};
        }
      }

      const history: ApprovalHistoryEntry[] = parsedNotes.approvalHistory || [];
      const timestamp = new Date().toISOString();

      let newStatus = booking.status;

      if (action === 'REJECT') {
        history.push({
          tier: 1,
          tierName: 'Manager Review',
          approverName,
          approverRole,
          action: 'REJECTED',
          timestamp,
          remarks: remarks || 'Booking rejected by corporate policy reviewer',
        });
        newStatus = 'CANCELLED';
      } else if (action === 'APPROVE_TIER_1') {
        history.push({
          tier: 1,
          tierName: 'Line Manager Review',
          approverName,
          approverRole,
          action: 'APPROVED',
          timestamp,
          remarks,
        });
      } else if (action === 'APPROVE_TIER_2') {
        history.push({
          tier: 2,
          tierName: 'Department Head Escalation',
          approverName,
          approverRole,
          action: 'APPROVED',
          timestamp,
          remarks,
        });
      } else if (action === 'APPROVE_TIER_3') {
        history.push({
          tier: 3,
          tierName: 'Fleet Operations Dispatch',
          approverName,
          approverRole,
          action: 'APPROVED',
          timestamp,
          remarks,
        });
        newStatus = 'CONFIRMED';
      }

      parsedNotes.approvalHistory = history;

      const updated = await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: newStatus,
          ...(action === 'APPROVE_TIER_3' ? { approvedBy: approverName, approvedAt: new Date(timestamp) } : {}),
          notes: JSON.stringify(parsedNotes),
        },
      });

      // When Tier 3 ("Fleet Operations Dispatch") is approved, create and trigger the dispatch job
      if (action === 'APPROVE_TIER_3' && newStatus === 'CONFIRMED') {
        await ensureDispatchSchema();
        const existingJobs = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM dispatch_jobs WHERE booking_id = $1 AND tenant_id = $2 LIMIT 1`,
          booking.id,
          tenantId,
        ).catch(() => [] as { id: string }[]);

        if (existingJobs.length > 0) {
          dispatchJobIdToTrigger = existingJobs[0].id;
        } else {
          const dispatchSvc = mapBookingToDispatchServiceType(booking.serviceType);
          const originLat  = parsedNotes.pickupLat ?? parsedNotes.originLat ?? null;
          const originLng  = parsedNotes.pickupLng ?? parsedNotes.originLng ?? null;
          const destLat    = parsedNotes.dropoffLat ?? parsedNotes.destLat ?? null;
          const destLng    = parsedNotes.dropoffLng ?? parsedNotes.destLng ?? null;
          const originAddr = parsedNotes.pickupLocation ?? parsedNotes.origin ?? parsedNotes.originAddress ?? null;
          const destAddr   = parsedNotes.dropoffLocation ?? parsedNotes.destination ?? parsedNotes.destinationAddress ?? null;
          const paxCount   = Number(parsedNotes.passengers ?? parsedNotes.passengerCount ?? 1) || 1;

          const assignedDriverId = typeof parsedNotes.driverId === 'string' ? parsedNotes.driverId : null;

          const [dj] = await tx.$queryRawUnsafe<{ id: string }[]>(`
            INSERT INTO dispatch_jobs (
              tenant_id, booking_id, service_type, priority, status,
              pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
              origin_lat, origin_lng, dest_lat, dest_lng,
              origin_address, destination_address,
              scheduled_pickup, passenger_count,
              assigned_driver_id, assigned_vehicle_id, driver_id, vehicle_id,
              metadata, meta
            ) VALUES (
              $1, $2, $3, 'NORMAL', 'PENDING',
              $4, $5, $6, $7,
              $4, $5, $6, $7,
              $8, $9,
              $10::timestamptz, $11,
              $12, $13, $12, $13,
              $14::jsonb, $14::jsonb
            )
            RETURNING id
          `,
            tenantId,
            booking.id,
            dispatchSvc,
            originLat != null ? Number(originLat) : null,
            originLng != null ? Number(originLng) : null,
            destLat   != null ? Number(destLat)   : null,
            destLng   != null ? Number(destLng)   : null,
            originAddr ? String(originAddr) : null,
            destAddr   ? String(destAddr)   : null,
            booking.startDate.toISOString(),
            paxCount,
            assignedDriverId,
            booking.vehicleId ?? null,
            JSON.stringify({ ...parsedNotes, bookingRef: booking.bookingRef, passengerCount: paxCount }),
          ).catch(() => [] as { id: string }[]);

          if (dj?.id) {
            dispatchJobIdToTrigger = dj.id;
          }
        }
      }

      return NextResponse.json({
        success: true,
        booking: updated,
        ...(dispatchJobIdToTrigger ? { dispatchJobId: dispatchJobIdToTrigger } : {}),
      });
    } catch (err) {
      console.error('[api/booking-portal/approvals POST]', err);
      return NextResponse.json({ error: 'Failed to process approval action' }, { status: 500 });
    }
  });

  if (dispatchJobIdToTrigger) {
    runDispatch(dispatchJobIdToTrigger, baseUrl).catch(() => {});
  }

  return response;
}
