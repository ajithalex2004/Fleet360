export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashDriverToken } from '@/lib/exchange/outsource-engine';
import { TelematicsService } from '@/lib/exchange/telematics-service';

export const runtime = 'nodejs';

/**
 * POST /api/public/partner-driver/[token]/telemetry
 * Continuous driver GPS ping ingestion
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const rawToken = params.token;
    const body = await req.json().catch(() => ({}));
    const { latitude, longitude, speed, heading, accuracy } = body;

    if (latitude == null || longitude == null) {
      return NextResponse.json({ error: 'Latitude and longitude are required' }, { status: 400 });
    }

    const result = await TelematicsService.ingestDriverGpsPing(rawToken, {
      latitude: Number(latitude),
      longitude: Number(longitude),
      speed: speed != null ? Number(speed) : undefined,
      heading: heading != null ? Number(heading) : undefined,
      accuracy: accuracy != null ? Number(accuracy) : undefined,
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Telemetry ping failed' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/public/partner-driver/[token]/telemetry
 * Retrieve latest live vehicle position and breadcrumbs
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const rawToken = params.token;
    const tokenHash = hashDriverToken(rawToken);

    const assignment = await prisma.partnerAssignment.findUnique({
      where: { driverTokenHash: tokenHash },
      include: {
        events: {
          where: { eventType: 'GPS_PING' },
          orderBy: { occurredAt: 'desc' },
          take: 30, // Last 30 coordinates for breadcrumb trail
        },
        award: {
          include: { request: true },
        },
      },
    });

    if (!assignment) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 404 });
    }

    const latestPing = assignment.events[0];

    return NextResponse.json({
      assignmentId: assignment.id,
      vehiclePlate: assignment.vehiclePlate,
      driverName: assignment.driverName,
      latestPosition: latestPing
        ? {
            latitude: latestPing.latitude,
            longitude: latestPing.longitude,
            occurredAt: latestPing.occurredAt,
            payload: latestPing.payload,
          }
        : null,
      breadcrumbs: assignment.events.map((e) => ({
        latitude: e.latitude,
        longitude: e.longitude,
        occurredAt: e.occurredAt,
      })),
      pickupLocation: {
        name: assignment.award.request.pickupLocation,
        latitude: assignment.award.request.pickupLatitude,
        longitude: assignment.award.request.pickupLongitude,
      },
      dropoffLocation: {
        name: assignment.award.request.dropoffLocation,
        latitude: assignment.award.request.dropoffLatitude,
        longitude: assignment.award.request.dropoffLongitude,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch telemetry' },
      { status: 500 }
    );
  }
}
