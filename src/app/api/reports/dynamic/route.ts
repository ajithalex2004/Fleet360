import { NextRequest, NextResponse } from 'next/server';
import {
  assertCanUseDynamicReportDataset,
  ensureDynamicReportTables,
  listVisibleDynamicReportDatasets,
  listSavedDynamicReports,
  saveDynamicReport,
  type DynamicReportDefinition,
} from '@/lib/reports/dynamic-reports';
import { recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const ctx = requireOperationalContext(req, 'reports', {
      requestedTenantId: req.nextUrl.searchParams.get('tenantId'),
    });
    if (ctx instanceof NextResponse) return ctx;

    await ensureDynamicReportTables();
    const [datasets, reports] = await Promise.all([
      listVisibleDynamicReportDatasets(ctx),
      listSavedDynamicReports(ctx.tenantId),
    ]);
    const visibleDatasetKeys = new Set(datasets.map((dataset) => dataset.key));

    return NextResponse.json({
      datasets,
      reports: reports.filter((report) => visibleDatasetKeys.has(report.datasetKey)),
    });
  } catch (error) {
    console.error('[reports.dynamic.GET]', error);
    return NextResponse.json({ error: 'Failed to load dynamic reports' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = requireOperationalContext(req, 'reports', { write: true });
    if (ctx instanceof NextResponse) return ctx;

    const body = await req.json().catch(() => ({}));
    const name = String(body.name ?? '').trim();
    if (!name) {
      return NextResponse.json({ error: 'Report name is required' }, { status: 400 });
    }

    const definition = body.definition as DynamicReportDefinition;
    const catalog = await assertCanUseDynamicReportDataset(definition?.datasetKey, ctx);
    const report = await saveDynamicReport({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      id: body.id ? String(body.id) : null,
      name,
      description: body.description ? String(body.description) : null,
      definition,
      catalog,
    });

    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    await recordOperationalChange({
      req,
      ctx,
      entityType: 'DynamicReport',
      entityId: report.id,
      action: body.id ? 'UPDATE' : 'CREATE',
      after: report,
      summary: `${body.id ? 'Updated' : 'Created'} dynamic report ${report.name}`,
    });

    return NextResponse.json({ report }, { status: body.id ? 200 : 201 });
  } catch (error) {
    console.error('[reports.dynamic.POST]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save dynamic report' },
      { status: 500 },
    );
  }
}
