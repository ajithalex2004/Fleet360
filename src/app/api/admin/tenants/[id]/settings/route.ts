import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';
import { requireAdminPermission, resolveTenantBoundary } from '@/lib/admin-policy';
import { recordAdminChange } from '@/lib/admin-change-history';
import type { Prisma } from '@prisma/client';

type Params = { params: Promise<{ id: string }> };
type TenantSettingsRow = NonNullable<Awaited<ReturnType<typeof prisma.tenantSettings.findUnique>>>;

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const auth = await requireAdminPermission(req, 'view', 'tenants');
    if (auth instanceof NextResponse) return auth;
    const { id } = await params;
    const tenantId = resolveTenantBoundary(auth.ctx, id);
    if (tenantId instanceof NextResponse) return tenantId;

    let settings: TenantSettingsRow | Record<string, unknown> | null = await prisma.tenantSettings.findUnique({ where: { tenantId } });
    if (!settings) {
      // Return defaults without creating record yet
      settings = {
        id: '', createdAt: null, updatedAt: null, tenantId,
        tripMergingEnabled: false, pickupMatchType: 'DISTANCE',
        pickupDistanceKm: 7, pickupTimeWindowMin: 30,
        requireDropoffMatch: true, dropoffMatchType: 'DISTANCE',
        dropoffDistanceKm: 25, dropoffTimeWindowMin: 30,
        maxPassengers: 5, travelSpeedKmh: 40,
        stopDurationMin: 10, maxPickupDelayMin: 30,
        autoMergeEnabled: false, triggerBeforePickupMin: 30, lookAheadHours: 24,
        autoDispatchEnabled: false, maxDriverAttempts: 3,
        driverResponseTimeoutMin: 6, dispatchRadius: 10,
        preferNearestDriver: true,
        routeOptimizationEnabled: false, routingEngine: 'GOOGLE_MAPS',
        googleMapsApiKey: null, maxApiCallsPerHour: 500, maxApiCallsPerDay: 5000,
        roadDistanceMultiplier: 1.5, fallbackToStraightLine: true,
        emailNotificationsEnabled: false, smtpHost: null, smtpPort: '587',
        smtpUser: null, smtpPass: null, smtpFromEmail: null, smtpFromName: null,
        smsNotificationsEnabled: false, smsProvider: null, smsApiKey: null, smsFromNumber: null,
        pushNotificationsEnabled: true, notificationPreferences: null, tripReminderTimingMin: 60,
      };
    }
    return NextResponse.json(settings, {
      headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' },
    });
  } catch (e) {
    console.error('GET tenant settings error:', e);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const auth = await requireAdminPermission(req, 'edit', 'tenants');
    if (auth instanceof NextResponse) return auth;
    const { id } = await params;
    const tenantId = resolveTenantBoundary(auth.ctx, id);
    if (tenantId instanceof NextResponse) return tenantId;

    const before = await prisma.tenantSettings.findUnique({ where: { tenantId } });
    const body = await req.json() as Record<string, unknown>;
    const data = { ...body };
    delete data.id;
    delete data.createdAt;
    delete data.tenantId;

    const createData = { id: randomUUID(), tenantId, ...data } as Prisma.TenantSettingsUncheckedCreateInput;
    const updateData = { ...data, updatedAt: new Date() } as Prisma.TenantSettingsUncheckedUpdateInput;
    const settings = await prisma.tenantSettings.upsert({
      where:  { tenantId },
      create: createData,
      update: updateData,
    });
    await recordAdminChange({
      req,
      ctx: auth.ctx,
      tenantId,
      entityType: 'TenantSettings',
      entityId: tenantId,
      action: 'UPDATE',
      before,
      after: settings,
      summary: `Updated tenant settings for ${tenantId}.`,
    });
    return NextResponse.json(settings);
  } catch (e) {
    console.error('PUT tenant settings error:', e);
    return NextResponse.json({ error: getErrorMessage(e, 'Failed to save settings') }, { status: 500 });
  }
}
