export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { randomUUID } from 'crypto';

import { requireAuthorizedTenant, requireSuperAdminForTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';

const SECRET_MASK = '••••••••';
const SECRET_KEYS = ['smtpPass', 'smsApiKey', 'googleMapsApiKey'] as const;

export interface TenantSecurityPolicy {
  enforceMfaForAdmins: boolean;
  enforceMfaForAllUsers: boolean;
  enforceSsoOnly: boolean;
  sessionIdleTimeoutMin: number;
  allowedIpCidrs: string;
}

const DEFAULT_SECURITY_POLICY: TenantSecurityPolicy = {
  enforceMfaForAdmins: false,
  enforceMfaForAllUsers: false,
  enforceSsoOnly: false,
  sessionIdleTimeoutMin: 480,
  allowedIpCidrs: '',
};

function extractSecurityPolicy(notificationPreferences: unknown): TenantSecurityPolicy {
  if (typeof notificationPreferences !== 'string' || !notificationPreferences.trim()) {
    return { ...DEFAULT_SECURITY_POLICY };
  }
  try {
    const parsed = JSON.parse(notificationPreferences) as Record<string, unknown>;
    const raw = (parsed?._securityPolicy ?? {}) as Partial<TenantSecurityPolicy>;
    return {
      enforceMfaForAdmins: Boolean(raw.enforceMfaForAdmins ?? DEFAULT_SECURITY_POLICY.enforceMfaForAdmins),
      enforceMfaForAllUsers: Boolean(raw.enforceMfaForAllUsers ?? DEFAULT_SECURITY_POLICY.enforceMfaForAllUsers),
      enforceSsoOnly: Boolean(raw.enforceSsoOnly ?? DEFAULT_SECURITY_POLICY.enforceSsoOnly),
      sessionIdleTimeoutMin: Math.min(
        1440,
        Math.max(15, Number(raw.sessionIdleTimeoutMin ?? DEFAULT_SECURITY_POLICY.sessionIdleTimeoutMin) || 480),
      ),
      allowedIpCidrs: typeof raw.allowedIpCidrs === 'string' ? raw.allowedIpCidrs.trim() : '',
    };
  } catch {
    return { ...DEFAULT_SECURITY_POLICY };
  }
}

function maskTenantSecrets<T extends Record<string, unknown>>(row: T): T {
  const masked: Record<string, unknown> = {
    ...row,
    securityPolicy: extractSecurityPolicy(row.notificationPreferences),
  };
  for (const key of SECRET_KEYS) {
    if (typeof masked[key] === 'string' && (masked[key] as string).length > 0) {
      masked[key] = SECRET_MASK;
    }
  }
  return masked as T;
}

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
          securityPolicy: { ...DEFAULT_SECURITY_POLICY },
        };
        return NextResponse.json(defaults, {
          headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' },
        });
      }
      return NextResponse.json(maskTenantSecrets(settings as unknown as Record<string, unknown>), {
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
      const data: Record<string, unknown> = { ...body };
      delete data.id;
      delete data.createdAt;
      delete data.tenantId;

      // Merge structured `securityPolicy` into `notificationPreferences` JSON so
      // it persists without requiring an immediate DDL migration.
      if (data.securityPolicy !== undefined) {
        const existingRow = await tx.tenantSettings.findUnique({ where: { tenantId: params.id } });
        let basePrefs: Record<string, unknown> = {};
        const rawPrefs =
          typeof data.notificationPreferences === 'string'
            ? data.notificationPreferences
            : existingRow?.notificationPreferences;
        if (typeof rawPrefs === 'string' && rawPrefs.trim()) {
          try {
            basePrefs = JSON.parse(rawPrefs) as Record<string, unknown>;
          } catch {
            basePrefs = {};
          }
        }
        const incoming = (data.securityPolicy ?? {}) as Partial<TenantSecurityPolicy>;
        const normalizedPolicy: TenantSecurityPolicy = {
          enforceMfaForAdmins: Boolean(incoming.enforceMfaForAdmins) || Boolean(incoming.enforceMfaForAllUsers),
          enforceMfaForAllUsers: Boolean(incoming.enforceMfaForAllUsers),
          enforceSsoOnly: Boolean(incoming.enforceSsoOnly),
          sessionIdleTimeoutMin: Math.min(
            1440,
            Math.max(15, Number(incoming.sessionIdleTimeoutMin ?? 480) || 480),
          ),
          allowedIpCidrs: typeof incoming.allowedIpCidrs === 'string' ? incoming.allowedIpCidrs.trim() : '',
        };
        data.notificationPreferences = JSON.stringify({
          ...basePrefs,
          _securityPolicy: normalizedPolicy,
        });
        delete data.securityPolicy;
      }

      // Preserve existing secrets when the client submits the redacted mask.
      for (const key of SECRET_KEYS) {
        if (data[key] === SECRET_MASK) {
          delete data[key];
        }
      }

      const settings = await tx.tenantSettings.upsert({
        where:  { tenantId: params.id },
        create: { id: randomUUID(), tenantId: params.id, ...data },
        update: { ...data, updatedAt: new Date() },
      });
      return NextResponse.json(maskTenantSecrets(settings as unknown as Record<string, unknown>));
    });
  } catch (e) {
    console.error('PUT tenant settings error:', e);
    return NextResponse.json({ error: errorMessage(e, 'Failed to save settings') }, { status: 500 });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const PUT = withAuditedAction(handlePUT);
