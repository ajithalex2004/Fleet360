export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { randomUUID } from 'crypto';

import { requireAuthorizedTenant, requireSuperAdminForTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: _req.headers, nextUrl: _req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const guard = requireSuperAdminForTenant(authz, params.id);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  try {
    return await withTenantRls(prisma, params.id, async (tx) => {
      const settings = await tx.tenantSettings.findUnique({ where: { tenantId: params.id } });
      if (!settings) {
        // Return defaults without creating record yet
        const defaults = {
          id: '', createdAt: null, updatedAt: null, tenantId: params.id,
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
        return NextResponse.json(defaults, {
          headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' },
        });
      }
      return NextResponse.json(settings, {
        headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' },
      });
    });
    } catch (e) {
    console.error('GET tenant settings error:', e);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

async function handlePUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const guard = requireSuperAdminForTenant(authz, params.id);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  try {
    return await withTenantRls(prisma, params.id, async (tx) => {
      const body = stripTenantOwnershipFields(await req.json());
      const data = { ...body };
      delete (data as Record<string, unknown>).id;
      delete (data as Record<string, unknown>).createdAt;
      delete (data as Record<string, unknown>).tenantId;

      const settings = await tx.tenantSettings.upsert({
        where:  { tenantId: params.id },
        create: { id: randomUUID(), tenantId: params.id, ...data },
        update: { ...data, updatedAt: new Date() },
      });
      return NextResponse.json(settings);
    });
    } catch (e) {
    console.error('PUT tenant settings error:', e);
    return NextResponse.json({ error: errorMessage(e, 'Failed to save settings') }, { status: 500 });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const PUT = withAuditedAction(handlePUT);
