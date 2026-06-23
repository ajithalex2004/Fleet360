import { NextRequest, NextResponse } from 'next/server';
import {
  assertCanUseDynamicReportDataset,
  runDynamicReport,
  type DynamicReportDefinition,
} from '@/lib/reports/dynamic-reports';
import { recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const ctx = requireOperationalContext(req, 'reports');
    if (ctx instanceof NextResponse) return ctx;

    const body = await req.json().catch(() => ({}));
    const definition = body.definition as DynamicReportDefinition;
    const catalog = await assertCanUseDynamicReportDataset(definition?.datasetKey, ctx);
    const result = await runDynamicReport(definition, ctx.tenantId, catalog);

    void recordOperationalChange({
      req,
      ctx,
      entityType: 'DynamicReport',
      entityId: body.reportId ? String(body.reportId) : result.dataset.key,
      action: 'EXPORT',
      after: { dataset: result.dataset.key, rows: result.rows.length },
      summary: `Previewed dynamic report dataset ${result.dataset.label}`,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[reports.dynamic.run.POST]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to run dynamic report' },
      { status: 500 },
    );
  }
}
