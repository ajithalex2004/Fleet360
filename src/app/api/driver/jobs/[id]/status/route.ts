export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { updateDrayageJobExecutionStatus } from '@/lib/logistics/drayage-domain';

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const params = await props.params;
  const jobId = params.id;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const rawBody = await req.json().catch(() => ({}));
    const body = stripTenantOwnershipFields(rawBody);

    const status = String(body.status ?? 'PLACED_AT_RAMP');
    const etcTime = body.etc || body.etcTime || null;
    const notes = body.notes ? String(body.notes) : undefined;
    const placementLocation =
      body.placementLocation === 'YARD'
        ? 'YARD'
        : body.placementLocation === 'RAMP'
        ? 'RAMP'
        : status.includes('RAMP')
        ? 'RAMP'
        : status.includes('YARD')
        ? 'YARD'
        : undefined;
    const detachTrailer =
      body.detachTrailer !== undefined
        ? Boolean(body.detachTrailer)
        : status.includes('DETACHED') || status === 'PLACED_AT_RAMP' || status === 'PLACED_AT_YARD';

    const result = await withTenantRls(prisma, tenantId, async (tx) => {
      return updateDrayageJobExecutionStatus(tx, {
        tenantId,
        jobId,
        status,
        placementLocation,
        detachTrailer,
        etcTime,
        notes,
        actor: body.driverName || 'Driver Mobile App',
      });
    });

    return NextResponse.json({
      success: true,
      jobId,
      status: result.status,
      etcTime: result.etcTime,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[api/driver/jobs/[id]/status POST]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update job status from driver app' },
      { status: 500 },
    );
  }
}
