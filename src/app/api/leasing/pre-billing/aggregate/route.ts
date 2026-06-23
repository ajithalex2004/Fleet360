/**
 * POST /api/leasing/pre-billing/aggregate
 *
 * Body:
 *   {
 *     contractId: string,
 *     periodFrom: ISO date,
 *     periodTo:   ISO date,
 *     dueDate?:   ISO date  (defaults to periodTo + 30 days),
 *     billingPeriod?: string (e.g. "2026-05"; defaults from periodFrom),
 *     maintenanceCharges?: number,
 *     otherCharges?: number,
 *     vatPct?: number,
 *     commit?: boolean        (default false — preview-only)
 *   }
 *
 * Preview returns the aggregated charges + line-item sources without writing.
 * Commit additionally creates a LeasePreBillingStatement row in DRAFT status.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { aggregatePreBilling } from '@/lib/leasing/pre-billing-aggregator';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import { requireDangerApproval } from '@/lib/admin-policy';
import { recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';
import { assertContractBillingScope } from '@/lib/leasing-billing-reconciliation';

export const runtime = 'nodejs';

const bodySchema = z.object({
  contractId: z.string().uuid(),
  periodFrom: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  periodTo: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  dueDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  billingPeriod: z.string().optional(),
  maintenanceCharges: z.coerce.number().min(0).optional(),
  otherCharges: z.coerce.number().min(0).optional(),
  vatPct: z.coerce.number().min(0).max(100).optional(),
  commit: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.issues.map(i => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        },
        { status: 400 },
      );
    }

    const periodFrom = new Date(parsed.data.periodFrom);
    const periodTo = new Date(parsed.data.periodTo);
    if (periodTo < periodFrom) {
      return NextResponse.json(
        { error: 'periodTo must be on or after periodFrom' },
        { status: 400 },
      );
    }
    const ctx = requireOperationalContext(req, 'leasing', { write: Boolean(parsed.data.commit) });
    if (ctx instanceof NextResponse) return ctx;
    const boundary = await assertContractBillingScope(parsed.data.contractId, ctx);
    if (boundary) return boundary;

    const aggregated = await aggregatePreBilling({
      contractId: parsed.data.contractId,
      periodFrom,
      periodTo,
      maintenanceCharges: parsed.data.maintenanceCharges,
      otherCharges: parsed.data.otherCharges,
      vatPct: parsed.data.vatPct,
    });

    if (!parsed.data.commit) {
      return NextResponse.json({ mode: 'preview', ...aggregated });
    }

    const approval = await requireDangerApproval(req, {
      userId: ctx.userId,
      tenantId: ctx.tenantId,
      role: ctx.role,
      isSuperAdmin: ctx.isSuperAdmin,
      isTenantAdmin: ctx.role === 'TENANT_ADMIN',
    }, 'leasing.prebilling.commit', {
      tenantId: ctx.tenantId,
      targetType: 'LeasePreBillingStatement',
      targetId: parsed.data.contractId,
      summary: `Commit pre-billing for ${aggregated.contractNumber ?? aggregated.contractId}`,
      payload: { before: null, after: aggregated },
      requiredApprovals: 2,
    });
    if (approval) return approval;

    // Commit: persist as LeasePreBillingStatement.
    const dueDate = parsed.data.dueDate
      ? new Date(parsed.data.dueDate)
      : new Date(periodTo.getTime() + 30 * 86400000);
    const billingPeriod =
      parsed.data.billingPeriod ?? aggregated.periodFrom.toISOString().slice(0, 7);

    const count = await prisma.leasePreBillingStatement.count();
    const statementNo = `PBS-${String(count + 1).padStart(5, '0')}`;
    const duplicate = await prisma.leasePreBillingStatement.findFirst({
      where: { contractId: aggregated.contractId, billingPeriod, status: { not: 'CANCELLED' } },
      select: { id: true, statementNo: true },
    });
    if (duplicate) {
      return NextResponse.json(
        { error: 'Pre-billing already exists for this contract and period', statementId: duplicate.id, statementNo: duplicate.statementNo },
        { status: 409 },
      );
    }

    const statement = await prisma.leasePreBillingStatement.create({
      data: {
        statementNo,
        contractId: aggregated.contractId,
        lesseeId: aggregated.lesseeId,
        billingPeriod,
        dueDate,
        baseRent: aggregated.baseRent,
        fuelCharges: aggregated.fuelCharges,
        fineCharges: aggregated.fineCharges,
        maintenanceCharges: aggregated.maintenanceCharges,
        overageCharges: aggregated.overageCharges,
        otherCharges: aggregated.otherCharges,
        vatAmount: aggregated.vatAmount,
        totalAmount: aggregated.totalAmount,
        currency: aggregated.currency,
        status: 'DRAFT',
      },
    });

    void logAudit({
      tenantId: req.headers.get('x-tenant-id') ?? undefined,
      userId: req.headers.get('x-user-id') ?? undefined,
      userRole: req.headers.get('x-user-role') ?? undefined,
      entityType: 'LeasePreBillingStatement',
      entityId: statement.id,
      entityName: statementNo,
      action: 'CREATE',
      details: `Aggregated pre-billing ${statementNo} for contract ${aggregated.contractNumber ?? aggregated.contractId} (${billingPeriod}): base ${aggregated.baseRent}, fuel ${aggregated.fuelCharges}, fines ${aggregated.fineCharges}, overage ${aggregated.overageCharges}, total ${aggregated.totalAmount.toFixed(2)} ${aggregated.currency}`,
    });
    await recordOperationalChange({
      req,
      ctx,
      entityType: 'LeasePreBillingStatement',
      entityId: statement.id,
      action: 'CREATE',
      after: { statement, sources: aggregated.sources },
      summary: `Committed pre-billing ${statementNo} for ${aggregated.contractNumber ?? aggregated.contractId}`,
    });

    return NextResponse.json(
      { mode: 'commit', statement, sources: aggregated.sources },
      { status: 201 },
    );
  } catch (err) {
    captureException(err, { context: 'leasing.pre-billing.aggregate' });
    console.error('[pre-billing aggregate] error:', err);
    return NextResponse.json({ error: 'Aggregation failed' }, { status: 500 });
  }
}
