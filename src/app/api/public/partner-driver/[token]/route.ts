export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { OutsourceEngine, hashDriverToken } from '@/lib/exchange/outsource-engine';
import { BusOpsOutsourcingAdapter } from '@/lib/exchange/bus-ops-adapter';
import { withPartnerTokenTenant } from '@/lib/exchange/partner-token-tenant';

export const runtime = 'nodejs';

/**
 * GET /api/public/partner-driver/[token]
 *
 * Public endpoint for external partner driver to load trip details without login.
 * Queries assignment via SHA-256 hash of the opaque URL token.
 */
async function handleGET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token || token.length < 16) {
    return NextResponse.json({ error: 'Invalid driver token format' }, { status: 400 });
  }

  const tokenHash = hashDriverToken(token);

  const assignment = await prisma.partnerAssignment.findUnique({
    where: { driverTokenHash: tokenHash },
    include: {
      award: {
        include: {
          request: true,
          partner: true,
        },
      },
      pod: true,
    },
  });

  if (!assignment) {
    return NextResponse.json({ error: 'Trip not found or invalid link' }, { status: 404 });
  }

  if (assignment.isTokenRevoked) {
    return NextResponse.json({ error: 'This driver link has been revoked or rotated' }, { status: 404 });
  }

  if (new Date() > assignment.driverTokenExp) {
    return NextResponse.json({ error: 'This driver trip link has expired' }, { status: 410 });
  }

  const { award, pod } = assignment;
  const { request, partner } = award;

  return NextResponse.json({
    trip: {
      requestNumber: request.requestNumber,
      serviceDate: request.serviceDate,
      pickupTime: request.pickupTime,
      pickupLocation: request.pickupLocation,
      dropoffLocation: request.dropoffLocation,
      requiredCapacity: request.requiredCapacity,
      specialInstructions: request.specialInstructions,
      partnerName: partner.legalName,
      vehiclePlate: assignment.vehiclePlate,
      driverName: assignment.driverName,
      reachedAt: assignment.reachedAt,
      startedAt: assignment.startedAt,
      completedAt: assignment.completedAt,
      status: award.status,
      pod,
    },
  });
}

/**
 * POST /api/public/partner-driver/[token]
 *
 * Milestone action: REACHED | STARTED | COMPLETED + POD submission
 */
async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token || token.length < 16) {
    return NextResponse.json({ error: 'Invalid driver token format' }, { status: 400 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { action, passengerCount, signedByName, signatureUrl, photoUrl, completionNotes } = body;

    if (!action || !['REACHED', 'STARTED', 'COMPLETED'].includes(action)) {
      return NextResponse.json({ error: "action must be 'REACHED', 'STARTED', or 'COMPLETED'" }, { status: 400 });
    }

    const updated = await OutsourceEngine.updateDriverMilestone(token, action, {
      passengerCount: passengerCount ? Number(passengerCount) : undefined,
      signedByName,
      signatureUrl,
      photoUrl,
      completionNotes,
    });

    // Synchronize native TripSchedule if applicable
    const assignment = await prisma.partnerAssignment.findUnique({
      where: { id: updated.id },
      include: { award: { include: { request: true } } },
    });

    if (assignment && assignment.award.request.sourceReferenceType === 'TRIP_SCHEDULE') {
      const adapter = new BusOpsOutsourcingAdapter();
      await adapter.syncExecutionStatus({
        sourceReferenceId: assignment.award.request.sourceReferenceId,
        eventType: action,
      });
    }

    return NextResponse.json({
      ok: true,
      action,
      assignment: updated,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to update milestone';
    const status = msg.includes('finalized') || msg.includes('already') || msg.includes('cancelled') ? 409 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

// Runs each handler in the tenant of the link's award (src/lib/exchange/partner-token-tenant.ts):
// the award and request tables are tenant-isolated by RLS and this route has no session.
export async function GET(
  req: Parameters<typeof handleGET>[0],
  ctx: { params: Promise<{ token: string }> },
) {
  return withPartnerTokenTenant((await ctx.params).token, () => handleGET(req, ctx));
}
export async function POST(
  req: Parameters<typeof handlePOST>[0],
  ctx: { params: Promise<{ token: string }> },
) {
  return withPartnerTokenTenant((await ctx.params).token, () => handlePOST(req, ctx));
}
