import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { cacheRead, privateCacheControl, revalidateCache } from '@/lib/server-cache';

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
    const tenantId = req.headers.get('x-tenant-id');
    if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
    const tenantId = req.headers.get('x-tenant-id');
    if (!tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json();
    const count = await prisma.tripIncident.count();
    const incidentNo = body.incidentNo ?? `INC-${String(count + 1).padStart(5, '0')}`;
    const source = req.headers.get('x-incident-source') ?? body.source ?? 'ops-ui';
    const incident = await prisma.tripIncident.create({
      data: { ...body, incidentNo, tenantId },
    });

    // Ops notification + work-item. Fleet360 has no dedicated Ticket model —
    // the Alert row (with status = PENDING and assignedTo = ops queue) IS the
    // ticket the operations team actions from the alerts console. Best-effort:
    // a failure here must never break incident creation itself.
    try {
      const sev = incident.severity ?? 'LOW';
      const originLabel = source === 'driver-app' ? 'driver app' : 'operations UI';
      await prisma.alert.create({
        data: {
          tenantId,
          type: 'INCIDENT',
          title: `Incident ${incidentNo} · ${incident.incidentType}`,
          description: [
            `Reported via ${originLabel}.`,
            incident.location ? `Location: ${incident.location}.` : null,
            incident.description ? `Details: ${incident.description}` : null,
          ].filter(Boolean).join(' '),
          severity: SEV_TO_ALERT[sev] ?? 'MEDIUM',
          status: 'PENDING',
          relatedEntityId: incident.id,
          dateCreated: new Date(),
        },
      });
    } catch (alertErr) {
      console.error('[incidents.POST] alert/ticket create failed:', alertErr);
    }

    revalidateCache([CACHE_TAG]);
    return NextResponse.json(incident, { status: 201 });
  } catch (error) {
    console.error('[incidents.POST]', error);
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }
}
