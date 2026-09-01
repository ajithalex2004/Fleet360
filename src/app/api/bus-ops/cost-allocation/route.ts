export const dynamic = 'force-dynamic';

/**
 * /api/bus-ops/cost-allocation
 *
 * GET  - Departmental cost allocation breakdown and Pax-Km summary
 * POST - Post draft recharge journal entries to General Ledger
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { getTenantCostAllocation, postRechargeJournalBatch, type RateConfig } from '@/lib/bus-ops/cost-allocation';
import { logAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }

  const { tenantId } = authz;
  const sp = req.nextUrl.searchParams;

  const yearParam = sp.get('year');
  const monthParam = sp.get('month');
  const baseFee = sp.get('baseFee');
  const scanFee = sp.get('scanFee');
  const kmFee = sp.get('kmFee');

  const rateConfig: RateConfig = {
    baseFeePerDept: baseFee ? parseFloat(baseFee) : undefined,
    scanFeePerBoarding: scanFee ? parseFloat(scanFee) : undefined,
    kmFeePerPaxKm: kmFee ? parseFloat(kmFee) : undefined,
  };

  const year = yearParam ? parseInt(yearParam, 10) : undefined;
  const month = monthParam ? parseInt(monthParam, 10) : undefined;

  try {
    const summary = await getTenantCostAllocation(tenantId, {
      year,
      month,
      rateConfig,
    });

    return NextResponse.json(summary, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (err) {
    console.error('[api/bus-ops/cost-allocation GET]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to calculate departmental cost allocation' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }

  const { tenantId } = authz;
  const rawBody = await req.json().catch(() => ({}));
  const body = stripTenantOwnershipFields(rawBody);

  const year = typeof body.year === 'number' ? body.year : undefined;
  const month = typeof body.month === 'number' ? body.month : undefined;
  const rateConfig = body.rateConfig as RateConfig | undefined;

  try {
    const summary = await getTenantCostAllocation(tenantId, {
      year,
      month,
      rateConfig,
    });

    const result = await postRechargeJournalBatch(tenantId, summary);

    void logAudit({
      tenantId,
      action: 'POST_RECHARGE_JOURNAL_BATCH',
      entityType: 'JournalEntry',
      entityId: result.journalEntryId || 'NONE',
      details: {
        period: summary.period,
        totalDebited: result.totalDebited,
        departmentsCount: summary.departments.length,
      },
    });

    return NextResponse.json({
      ok: true,
      message: `Draft General Ledger recharge entry created for ${summary.period}. Total recharged: AED ${result.totalDebited.toLocaleString('en-AE')}`,
      journalEntryId: result.journalEntryId,
      totalDebited: result.totalDebited,
      summary,
    });
  } catch (err) {
    console.error('[api/bus-ops/cost-allocation POST]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to post recharge journal batch' },
      { status: 500 },
    );
  }
}
