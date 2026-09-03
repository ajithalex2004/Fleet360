export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import {
  evaluateBookingApprovalPolicy,
  BookingPolicyContext,
  ApprovalHistoryEntry,
} from '@/lib/booking-approval-policy';

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
          deletedAt: null,
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

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const body = await req.json();
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
        where: { id: bookingId, tenantId, deletedAt: null },
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
        where: { id: bookingId },
        data: {
          status: newStatus,
          notes: JSON.stringify(parsedNotes),
        },
      });

      return NextResponse.json({ success: true, booking: updated });
    } catch (err) {
      console.error('[api/booking-portal/approvals POST]', err);
      return NextResponse.json({ error: 'Failed to process approval action' }, { status: 500 });
    }
  });
}
