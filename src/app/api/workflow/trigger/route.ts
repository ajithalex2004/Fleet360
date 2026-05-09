import { NextRequest, NextResponse } from 'next/server';
import { triggerWorkflow } from '@/lib/workflow-db';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      // Phase 2 canonical keying — preferred for new callers. The engine
      // resolves these via the service-type / scope chain.
      serviceTypeId, tenantId, scopeId,
      // Legacy keying — still accepted. Engine falls back to (module,
      // procedure) lookup when serviceTypeId isn't supplied or doesn't
      // resolve to an active workflow.
      module, procedure,
      referenceType, referenceId, referenceNumber,
      initiatedByEmail, initiatedByName,
      contextData,
    } = body;

    if (!referenceId) {
      return NextResponse.json({ error: 'referenceId is required' }, { status: 400 });
    }
    // At least one of the two keying paths must be supplied.
    if (!(serviceTypeId && tenantId) && !(module && procedure)) {
      return NextResponse.json(
        { error: 'Either (serviceTypeId + tenantId) or (module + procedure) is required to resolve a workflow.' },
        { status: 400 },
      );
    }

    const result = await triggerWorkflow({
      serviceTypeId, tenantId, scopeId,
      module, procedure,
      referenceType: referenceType ?? module ?? 'UNKNOWN',
      referenceId, referenceNumber: referenceNumber ?? referenceId,
      initiatedByEmail: initiatedByEmail ?? 'system',
      initiatedByName: initiatedByName ?? null,
      contextData,
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: 422 });
    }

    return NextResponse.json(result, { status: 201 });
  } catch (e: any) {
    console.error('POST /api/workflow/trigger error:', e?.message);
    return NextResponse.json({ error: e?.message ?? 'Failed to trigger workflow' }, { status: 500 });
  }
}
