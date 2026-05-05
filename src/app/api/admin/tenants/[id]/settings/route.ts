import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let settings = await (prisma as any).tenantSettings.findUnique({ where: { tenantId: params.id } });
    if (!settings) {
      // Return defaults without creating record yet
      settings = {
        id: '', createdAt: null, updatedAt: null, tenantId: params.id,
        tripMergingEnabled: false, pickupMatchType: 'DISTANCE',
        pickupDistanceKm: 7 as any, pickupTimeWindowMin: 30,
        requireDropoffMatch: true, dropoffMatchType: 'DISTANCE',
        dropoffDistanceKm: 25 as any, dropoffTimeWindowMin: 30,
        maxPassengers: 5, travelSpeedKmh: 40 as any,
        stopDurationMin: 10, maxPickupDelayMin: 30,
        autoMergeEnabled: false, triggerBeforePickupMin: 30, lookAheadHours: 24,
        autoDispatchEnabled: false, maxDriverAttempts: 3,
        driverResponseTimeoutMin: 6, dispatchRadius: 10 as any,
        preferNearestDriver: true,
        routeOptimizationEnabled: false, routingEngine: 'GOOGLE_MAPS',
        googleMapsApiKey: null, maxApiCallsPerHour: 500, maxApiCallsPerDay: 5000,
        roadDistanceMultiplier: 1.5 as any, fallbackToStraightLine: true,
        emailNotificationsEnabled: false, smtpHost: null, smtpPort: '587',
        smtpUser: null, smtpPass: null, smtpFromEmail: null, smtpFromName: null,
        smsNotificationsEnabled: false, smsProvider: null, smsApiKey: null, smsFromNumber: null,
        pushNotificationsEnabled: true, notificationPreferences: null, tripReminderTimingMin: 60,
      } as any;
    }
    return NextResponse.json(settings, {
      headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' },
    });
  } catch (e) {
    console.error('GET tenant settings error:', e);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const { id: _id, createdAt: _c, tenantId: _t, ...data } = body;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const settings = await (prisma as any).tenantSettings.upsert({
      where:  { tenantId: params.id },
      create: { id: randomUUID(), tenantId: params.id, ...data },
      update: { ...data, updatedAt: new Date() },
    });
    return NextResponse.json(settings);
  } catch (e: any) {
    console.error('PUT tenant settings error:', e);
    return NextResponse.json({ error: e?.message ?? 'Failed to save settings' }, { status: 500 });
  }
}
