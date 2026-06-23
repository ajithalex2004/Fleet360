import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withAudit } from '@/lib/with-audit';
import { requireDangerApproval } from '@/lib/admin-policy';
import { requireOperationalContext, requireOperationalPermission } from '@/lib/cross-module-governance';
import {
  preBillingLines,
  preBillingStatementInTenant,
  scopedLeaseContractIds,
} from '@/lib/leasing-billing-reconciliation';
import { getFinanceMirrorById, mirrorLeaseInvoiceToFinance } from '@/lib/finance-source-ledger';
import { recordOperationalChange } from '@/lib/cross-module-governance';
import { legacyLeasingBillingWriteMoved } from '@/lib/finance-leasing-billing-routing';

function uniqueStatementIds(value: unknown, fallback?: unknown) {
  const ids = Array.isArray(value) ? value : fallback ? [fallback] : [];
  return [...new Set(ids.map(id => String(id ?? '').trim()).filter(Boolean))];
}

function sameValue(values: Array<string | null | undefined>) {
  const present = values.map(value => value ?? '').filter(Boolean);
  return present.length <= 1 || present.every(value => value === present[0]);
}

function preBillingRef(statement: { statementNo?: string | null; id: string }) {
  return statement.statementNo ?? statement.id;
}

async function findExistingInvoiceForPreBillingRefs(refs: string[]) {
  if (refs.length === 0) return null;
  return prisma.leaseInvoice.findFirst({
    where: {
      OR: refs.map(ref => ({ notes: { contains: `pre-billing:${ref}` } })),
    },
    select: { id: true, invoiceNo: true, notes: true },
  });
}

export async function GET(req: NextRequest) {
  try {
    const ctx = requireOperationalContext(req, 'leasing', { requestedTenantId: req.nextUrl.searchParams.get('tenantId') });
    if (ctx instanceof NextResponse) return ctx;
    const permission = await requireOperationalPermission(ctx, [
      { module: 'finance', action: 'view', resource: 'leasing_billing' },
      { module: 'leasing', action: 'view', resource: '*' },
    ], { message: 'You do not have access to view Leasing invoices' });
    if (permission) return permission;
    const { searchParams } = new URL(req.url);
    const lesseeId = searchParams.get('lesseeId');
    const status   = searchParams.get('status');
    const contractIds = await scopedLeaseContractIds(ctx);
    const invoices = await prisma.leaseInvoice.findMany({
      where: {
        ...(lesseeId ? { lesseeId } : {}),
        ...(status ? { status } : {}),
        lines: { some: { contractId: { in: contractIds } } },
      },
      include: { lessee: { select: { name: true } }, lines: true },
      orderBy: { issueDate: 'desc' },
    });
    return NextResponse.json(invoices);
  } catch { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
export const POST = withAudit(
  async (req: NextRequest) => {
    try {
      const moved = legacyLeasingBillingWriteMoved(req, '/api/finance/leasing-billing/invoices');
      if (moved) return moved;
      const ctx = requireOperationalContext(req, 'leasing', { write: true });
      if (ctx instanceof NextResponse) return ctx;
      const permission = await requireOperationalPermission(ctx, [
        { module: 'finance', action: 'create', resource: 'leasing_billing' },
        { module: 'finance', action: 'edit', resource: 'leasing_billing' },
        { module: 'leasing', action: 'create', resource: 'invoices' },
      ], { message: 'You do not have access to create Leasing invoices' });
      if (permission) return permission;
      const body = await req.json();
      const { lines = [], preBillingStatementId, preBillingStatementIds, ...invoiceData } = body;
      const statementIds = uniqueStatementIds(preBillingStatementIds, preBillingStatementId);
      let resolvedLines = Array.isArray(lines) ? lines : [];
      let preBillingNote = '';

      if (statementIds.length > 0) {
        const statements = [];
        for (const statementId of statementIds) {
          const scoped = await preBillingStatementInTenant(statementId, ctx);
          if (scoped.error) return scoped.error;
          statements.push(scoped.statement);
        }

        const invalid = statements.find(statement => statement.status !== 'CONFIRMED');
        if (invalid) {
          return NextResponse.json(
            { error: `Pre-billing statement ${invalid.statementNo ?? invalid.id} must be CONFIRMED before invoicing` },
            { status: 409 },
          );
        }

        if (!sameValue(statements.map(statement => statement.lesseeId))) {
          return NextResponse.json({ error: 'Combined invoices can only include statements for one lessee/customer' }, { status: 400 });
        }
        if (!sameValue(statements.map(statement => statement.billingPeriod))) {
          return NextResponse.json({ error: 'Combined invoices can only include one billing period' }, { status: 400 });
        }
        if (!sameValue(statements.map(statement => statement.currency ?? 'AED'))) {
          return NextResponse.json({ error: 'Combined invoices can only include one currency' }, { status: 400 });
        }

        const refs = statements.map(preBillingRef);
        const existing = await findExistingInvoiceForPreBillingRefs(refs);
        if (existing) {
          return NextResponse.json(
            { error: `Invoice already exists for one of the selected pre-billing statements`, invoiceId: existing.id, invoiceNo: existing.invoiceNo },
            { status: 409 },
          );
        }

        resolvedLines = statements.flatMap(statement => preBillingLines(statement).map(line => ({
          contractId: line.contractId,
          description: line.description,
          lineType: line.lineType,
          quantity: 1,
          unitAmount: line.amount,
          totalAmount: line.amount,
          currency: statement.currency ?? 'AED',
        })));
        const first = statements[0];
        invoiceData.lesseeId = invoiceData.lesseeId ?? first.lesseeId;
        invoiceData.billingPeriod = invoiceData.billingPeriod ?? first.billingPeriod;
        invoiceData.currency = invoiceData.currency ?? first.currency ?? 'AED';
        invoiceData.dueDate = invoiceData.dueDate ?? statements
          .map(statement => statement.dueDate)
          .sort((a, b) => b.getTime() - a.getTime())[0];
        preBillingNote = refs.map(ref => `pre-billing:${ref}`).join('\n');
      }

      if (resolvedLines.length === 0) {
        return NextResponse.json({ error: 'At least one invoice line or preBillingStatementId is required' }, { status: 400 });
      }

      const approval = await requireDangerApproval(req, {
        userId: ctx.userId,
        tenantId: ctx.tenantId,
        role: ctx.role,
        isSuperAdmin: ctx.isSuperAdmin,
        isTenantAdmin: ctx.role === 'TENANT_ADMIN',
      }, 'leasing.invoice.create', {
        tenantId: ctx.tenantId,
        targetType: 'LeaseInvoice',
        targetId: statementIds.length > 0 ? invoiceData.lesseeId : invoiceData.lesseeId,
        summary: statementIds.length > 1
          ? `Create combined invoice from ${statementIds.length} pre-billing statements`
          : statementIds.length === 1
            ? 'Create invoice from pre-billing statement'
            : 'Create manual leasing invoice',
        payload: { before: null, after: { ...invoiceData, lines: resolvedLines, preBillingStatementId: statementIds[0], preBillingStatementIds: statementIds } },
        requiredApprovals: 2,
      });
      if (approval) return approval;

      const count = await prisma.leaseInvoice.count();
      const invoiceNo = `INV-${String(count + 1).padStart(6, '0')}`;
      const subTotal = resolvedLines.reduce((s: number, l: { totalAmount?: unknown }) => s + parseFloat(String(l.totalAmount || '0')), 0);
      const vatPct   = parseFloat(invoiceData.vatPct ?? '5');
      const vatAmount = subTotal * (vatPct / 100);
      const totalAmount = subTotal + vatAmount;
      const invoice = await prisma.leaseInvoice.create({
        data: {
          ...invoiceData, invoiceNo, subTotal, vatAmount, totalAmount,
          issueDate: invoiceData.issueDate ? new Date(invoiceData.issueDate) : new Date(),
          dueDate: invoiceData.dueDate ? new Date(invoiceData.dueDate) : new Date(Date.now() + 30 * 86400000),
          notes: [invoiceData.notes, preBillingNote].filter(Boolean).join('\n') || null,
          lines: { create: resolvedLines },
        },
        include: { lines: true, lessee: { select: { name: true } } },
      });
      if (statementIds.length > 0) {
        await prisma.leasePreBillingStatement.updateMany({
          where: { id: { in: statementIds } },
          data: { status: 'FINALIZED', confirmedAt: new Date() },
        }).catch(() => {});
      }
      const mirror = await mirrorLeaseInvoiceToFinance(invoice.id, ctx.tenantId, ctx.userId).catch(err => {
        console.error('[leasing/invoices] Finance mirror failed', err);
        return null;
      });
      if (mirror?.mirrored && mirror.financeInvoiceId) {
        const financeMirror = await getFinanceMirrorById(mirror.financeInvoiceId);
        await recordOperationalChange({
          req,
          ctx,
          entityType: 'FinanceInvoice',
          entityId: mirror.financeInvoiceId,
          action: mirror.mode === 'created' ? 'CREATE' : 'UPDATE',
          after: financeMirror,
          summary: `Synced Finance mirror for leasing invoice ${invoice.invoiceNo ?? invoice.id}`,
          sourceModule: 'LEASING',
          sourceEntityType: 'LeaseInvoice',
          sourceEntityId: invoice.id,
          relatedEntityType: 'LeaseInvoice',
          relatedEntityId: invoice.id,
          riskSeverity: 'low',
        });
      }
      return NextResponse.json(invoice, { status: 201 });
    } catch { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
  },
  {
    entityType: 'LeaseInvoice',
    action: 'CREATE',
    extractEntity: (body) => ({ id: body?.id, name: body?.invoiceNo }),
    describe: (_req, body) =>
      body?.invoiceNo
        ? `Issued invoice ${body.invoiceNo} for ${body.totalAmount ?? 0} ${body.currency ?? 'AED'} (lessee: ${body.lessee?.name ?? body.lesseeId ?? 'unknown'})`
        : undefined,
  },
);
