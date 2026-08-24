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
 * Tenant scoping: requires x-tenant-id. The contract is verified to belong
 * to that tenant before preview/commit. The created LeasePreBillingStatement
 * row is stamped with the caller's tenant id.
 *
 * Preview returns the aggregated charges + line-item sources without writing.
 * Commit additionally creates a LeasePreBillingStatement row in DRAFT status.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { aggregatePreBilling } from '@/lib/leasing/pre-billing-aggregator';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

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
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  try {
    const jsonRaw = await req.json();
  const json = stripTenantOwnershipFields(jsonRaw);
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

    // Confirm the contract belongs to the caller's tenant before we expose
    // any aggregated figures (otherwise we'd leak base rent + fuel + fine
    // totals from other tenants via the preview response).
    const contract = await prisma.leaseContract2.findFirst({
      where: { id: parsed.data.contractId, tenantId },
      select: { id: true },
    });
    if (!contract) {
      return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
    }

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

    const dueDate = parsed.data.dueDate
      ? new Date(parsed.data.dueDate)
      : new Date(periodTo.getTime() + 30 * 86400000);
    const billingPeriod =
      parsed.data.billingPeriod ?? aggregated.periodFrom.toISOString().slice(0, 7);

    const count = await prisma.leasePreBillingStatement.count({ where: { tenantId } });
    const statementNo = `PBS-${String(count + 1).padStart(5, '0')}`;

    const statement = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.leasePreBillingStatement.create({
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
        tenantId,
      },
    }),
    );

    void logAudit({
      tenantId,
      userId: req.headers.get('x-user-id') ?? undefined,
      userRole: req.headers.get('x-user-role') ?? undefined,
      entityType: 'LeasePreBillingStatement',
      entityId: statement.id,
      entityName: statementNo,
      action: 'CREATE',
      details: `Aggregated pre-billing ${statementNo} for contract ${aggregated.contractNumber ?? aggregated.contractId} (${billingPeriod}): base ${aggregated.baseRent}, fuel ${aggregated.fuelCharges}, fines ${aggregated.fineCharges}, overage ${aggregated.overageCharges}, total ${aggregated.totalAmount.toFixed(2)} ${aggregated.currency}`,
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
