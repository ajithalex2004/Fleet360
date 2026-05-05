import { NextRequest, NextResponse } from 'next/server';
import { triggerWorkflow } from '@/lib/workflow-db';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      module, procedure,
      referenceType, referenceId, referenceNumber,
      initiatedByEmail, initiatedByName,
      contextData,
    } = body;

    if (!module || !procedure || !referenceId) {
      return NextResponse.json({ error: 'module, procedure and referenceId are required' }, { status: 400 });
    }

    const result = await triggerWorkflow({
      module, procedure,
      referenceType: referenceType ?? module,
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
