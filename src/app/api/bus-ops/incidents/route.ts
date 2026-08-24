import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { cacheRead, privateCacheControl, revalidateCache } from '@/lib/server-cache';
import { raiseAlert } from '@/lib/alerts/raise';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
const CACHE_TAG = 'bus-ops:incidents';

const getIncidents = cacheRead(
  async (tenantId: string, status: string | null, severity: string | null) => {
    return prisma.tripIncident.findMany({
      where: {
        tenantId,
        ...(status   ? { status }   : {}),
        ...(severity ? { severity } : {}),
      },
      orderBy: { incidentDate: 'desc' },
    });
  },
  [CACHE_TAG],
  30,
);

export async function GET(req: NextRequest) {
  try {
    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

    if (!authz.ok) {

      return NextResponse.json({ error: authz.error }, { status: authz.status });

    }

    const { tenantId } = authz;, { status: 401 });
    const { searchParams } = new URL(req.url);
    const status   = searchParams.get('status');
    const severity = searchParams.get('severity');

    const incidents = await getIncidents(tenantId, status, severity);
    return NextResponse.json(incidents, {
      headers: { 'Cache-Control': privateCacheControl(30, 120) },
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

const SEV_TO_ALERT: Record<string, string> = {
  LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', CRITICAL: 'CRITICAL',
};

export async function POST(req: NextRequest) {
  try {
    const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

    if (!authz.ok) {

      return NextResponse.json({ error: authz.error }, { status: authz.status });

    }

    const { tenantId } = authz;, { status: 401 });
    const body = await req.json();
    const count = await prisma.tripIncident.count();
    const incidentNo = body.incidentNo ?? `INC-${String(count + 1).padStart(5, '0')}`;
    const source = req.headers.get('x-incident-source') ?? body.source ?? 'ops-ui';
    const incident = await prisma.tripIncident.create({
      data: { ...body, incidentNo, tenantId },
    });

    // Alert Engine — reference migration. Instead of writing prisma.alert
    // directly with a hardcoded severity map, publish alert.condition_detected
    // and let AlertEngineConsumer resolve severity / channels / recipients /
    // SLA using the tenant's AlertRule for VEHICLE_BREAKDOWN.
    //
    // The code below deliberately keeps mapping of incident types → alert
    // codes minimal (only BREAKDOWN → VEHICLE_BREAKDOWN). Other incident
    // types still surface via the ops incidents page; a follow-up can map
    // ACCIDENT / DELAY / MEDICAL to their own codes with their own rules.
    const codeForType: Record<string, string | undefined> = {
      BREAKDOWN: 'VEHICLE_BREAKDOWN',
    };
    const alertCode = codeForType[incident.incidentType ?? ''];
    if (alertCode) {
      const originLabel = source === 'driver-app' ? 'driver app' : 'operations UI';
      // Best-effort — raiseAlert already swallows its own errors unless
      // throwOnError is set; keeping the top-level await lets the outbox
      // write land in the same request if the publish is fast.
      await raiseAlert({
        tenantId,
        code:         alertCode,
        sourceModule: 'bus-ops',
        subjectType:  incident.vehicleId ? 'Vehicle' : 'Other',
        subjectId:    incident.vehicleId ?? incident.id,
        title:        `Incident ${incidentNo} · ${incident.incidentType}`,
        description:  [
          `Reported via ${originLabel}.`,
          incident.location ? `Location: ${incident.location}.` : null,
          incident.description ? `Details: ${incident.description}` : null,
        ].filter(Boolean).join(' '),
        severity: (SEV_TO_ALERT[incident.severity ?? 'LOW'] ?? 'MEDIUM') as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
        context: {
          incidentId:   incident.id,
          incidentNo,
          incidentType: incident.incidentType,
          vehicleId:    incident.vehicleId,
          driverId:     incident.driverId,
          location:     incident.location,
          source,
        },
      });
    }

    revalidateCache([CACHE_TAG]);
    return NextResponse.json(incident, { status: 201 });
  } catch (error) {
    console.error('[incidents.POST]', error);
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }
}
