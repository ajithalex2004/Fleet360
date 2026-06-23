import { prisma } from '@/lib/prisma';
import type { OperationalContext } from '@/lib/cross-module-governance';
import { scopedLeaseContractIds } from '@/lib/leasing-billing-reconciliation';
import { ensureAdminApprovalTables } from '@/lib/admin-approvals';

const DASHBOARD_CACHE_TTL_MS = 30_000;
const dashboardCache = new Map<string, { expiresAt: number; value: Awaited<ReturnType<typeof buildDashboardFresh>> }>();
const dashboardInflight = new Map<string, Promise<Awaited<ReturnType<typeof buildDashboardFresh>>>>();

type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface LeasingOperationalException {
  id: string;
  severity: Severity;
  category: string;
  title: string;
  detail: string;
  count: number;
  amount?: number;
  entityType?: string;
  entityId?: string;
  actionHref: string;
  actionLabel: string;
}

function amount(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function count(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function daysUntil(date: Date, now = new Date()) {
  return Math.ceil((date.getTime() - now.getTime()) / 86400000);
}

function exception(args: LeasingOperationalException) {
  return args;
}

export async function buildLeasingOperationalDashboard(ctx: OperationalContext) {
  const cacheKey = ctx.tenantId;
  const nowTs = Date.now();
  const cached = dashboardCache.get(cacheKey);
  if (cached && cached.expiresAt > nowTs) {
    return cached.value;
  }

  const inflight = dashboardInflight.get(cacheKey);
  if (inflight) return inflight;

  const promise = buildDashboardFresh(ctx);
  dashboardInflight.set(cacheKey, promise);
  try {
    const value = await promise;
    dashboardCache.set(cacheKey, { expiresAt: nowTs + DASHBOARD_CACHE_TTL_MS, value });
    return value;
  } finally {
    dashboardInflight.delete(cacheKey);
  }
}

async function buildDashboardFresh(ctx: OperationalContext) {
  const contractIds = await scopedLeaseContractIds(ctx);
  const now = new Date();
  const renewalHorizon = new Date(now.getTime() + 45 * 86400000);

  if (contractIds.length === 0) {
    return {
      generatedAt: now.toISOString(),
      kpis: {
        activeContracts: 0,
        contractsAtRisk: 0,
        openExceptions: 0,
        criticalExceptions: 0,
        highExceptions: 0,
        overdueAmount: 0,
        uninvoicedStatements: 0,
        pendingExecutionApprovals: 0,
      },
      exceptions: [] as LeasingOperationalException[],
    };
  }

  const contracts = await prisma.leaseContract2.findMany({
    where: { id: { in: contractIds }, deletedAt: null },
    select: { id: true, contractNumber: true, status: true, endDate: true, lesseeId: true, monthlyRate: true },
  });

  const exceptions: LeasingOperationalException[] = [];

  const activeContracts = contracts.filter(contract => contract.status === 'ACTIVE');
  const activeContractIds = activeContracts.map(contract => contract.id);
  const lesseeIds = Array.from(new Set(contracts.map(contract => contract.lesseeId).filter(Boolean)));
  const [
    paymentContractRows,
    overdueRows,
    uninvoicedRows,
    paidWithoutRefRows,
    scopedInvoiceAnomalyRows,
    approvals,
  ] = await Promise.all([
    activeContractIds.length
      ? prisma.leasePayment2.findMany({
          where: { contractId: { in: activeContractIds } },
          select: { contractId: true },
          distinct: ['contractId'],
        })
      : Promise.resolve([]),
    overduePaymentSummary(contractIds, now),
    uninvoicedStatementSummary(contractIds),
    paidInvoiceWithoutReferenceSummary(contractIds),
    lesseeIds.length ? invoiceScopeAnomalySummary(lesseeIds, contractIds) : Promise.resolve([]),
    pendingLeasingApprovalExecutions(ctx.tenantId),
  ]);

  const contractsAtRisk = activeContracts.filter(contract => contract.endDate <= renewalHorizon);
  if (contractsAtRisk.length > 0) {
    const first = contractsAtRisk[0];
    exceptions.push(exception({
      id: 'contracts-at-risk',
      severity: 'medium',
      category: 'Contract readiness',
      title: `${contractsAtRisk.length} active contract${contractsAtRisk.length === 1 ? '' : 's'} ending within 45 days`,
      detail: `${first.contractNumber ?? first.id} ends in ${daysUntil(first.endDate, now)} day${daysUntil(first.endDate, now) === 1 ? '' : 's'}.`,
      count: contractsAtRisk.length,
      entityType: 'LeaseContract',
      entityId: first.id,
      actionHref: '/leasing/renewals',
      actionLabel: 'Review renewals',
    }));
  }

  const scheduledContractIds = new Set(paymentContractRows.map(payment => payment.contractId));
  const activeWithoutSchedule = activeContracts.filter(contract => !scheduledContractIds.has(contract.id));
  if (activeWithoutSchedule.length > 0) {
    const first = activeWithoutSchedule[0];
    exceptions.push(exception({
      id: 'active-contracts-without-schedule',
      severity: 'high',
      category: 'Billing readiness',
      title: `${activeWithoutSchedule.length} active contract${activeWithoutSchedule.length === 1 ? '' : 's'} without payment schedule`,
      detail: `${first.contractNumber ?? first.id} is active but has no lease payment rows.`,
      count: activeWithoutSchedule.length,
      amount: activeWithoutSchedule.reduce((sum, contract) => sum + amount(contract.monthlyRate), 0),
      entityType: 'LeaseContract',
      entityId: first.id,
      actionHref: '/leasing/contracts-v2',
      actionLabel: 'Open agreements',
    }));
  }

  const overduePayment = overdueRows[0];
  const overduePaymentCount = count(overduePayment?.count);
  const overduePaymentAmount = amount(overduePayment?.amount);
  if (overduePayment && overduePaymentCount > 0) {
    exceptions.push(exception({
      id: 'overdue-receivables',
      severity: 'critical',
      category: 'Collections',
      title: `${overduePaymentCount} overdue receivable${overduePaymentCount === 1 ? '' : 's'}`,
      detail: `${overduePayment.contractNumber ?? overduePayment.contractId} has an overdue payment due ${overduePayment.dueDate.toISOString().slice(0, 10)}.`,
      count: overduePaymentCount,
      amount: overduePaymentAmount,
      entityType: 'LeasePayment',
      entityId: overduePayment.id,
      actionHref: '/leasing/receivables',
      actionLabel: 'Open receivables',
    }));
  }

  const uninvoicedStatement = uninvoicedRows[0];
  const uninvoicedStatementCount = count(uninvoicedStatement?.count);
  if (uninvoicedStatement && uninvoicedStatementCount > 0) {
    exceptions.push(exception({
      id: 'confirmed-prebilling-without-invoice',
      severity: 'high',
      category: 'Billing execution',
      title: `${uninvoicedStatementCount} confirmed pre-billing statement${uninvoicedStatementCount === 1 ? '' : 's'} without invoice`,
      detail: `${uninvoicedStatement.statementNo ?? uninvoicedStatement.id} is confirmed for ${uninvoicedStatement.billingPeriod} but has no invoice marker.`,
      count: uninvoicedStatementCount,
      amount: amount(uninvoicedStatement.amount),
      entityType: 'LeasePreBillingStatement',
      entityId: uninvoicedStatement.id,
      actionHref: '/leasing/pre-billing',
      actionLabel: 'Convert to invoice',
    }));
  }

  const paidWithoutRef = paidWithoutRefRows[0];
  const paidWithoutRefCount = count(paidWithoutRef?.count);
  if (paidWithoutRef && paidWithoutRefCount > 0) {
    exceptions.push(exception({
      id: 'paid-invoice-without-payment-reference',
      severity: 'medium',
      category: 'Cash application',
      title: `${paidWithoutRefCount} paid invoice${paidWithoutRefCount === 1 ? '' : 's'} missing payment reference`,
      detail: `${paidWithoutRef.invoiceNo ?? paidWithoutRef.id} is marked PAID without a payment reference.`,
      count: paidWithoutRefCount,
      amount: amount(paidWithoutRef.amount),
      entityType: 'LeaseInvoice',
      entityId: paidWithoutRef.id,
      actionHref: '/leasing/invoices',
      actionLabel: 'Review invoices',
    }));
  }

  if (approvals.length > 0) {
    const first = approvals[0];
    exceptions.push(exception({
      id: 'approved-leasing-actions-not-executed',
      severity: 'critical',
      category: 'Approval execution',
      title: `${approvals.length} approved Leasing action${approvals.length === 1 ? '' : 's'} awaiting execution`,
      detail: `${first.action}: ${first.summary ?? first.id}`,
      count: approvals.length,
      entityType: 'AdminApprovalRequest',
      entityId: first.id,
      actionHref: '/admin/approvals',
      actionLabel: 'Execute approvals',
    }));
  }

  const scopedInvoiceAnomaly = scopedInvoiceAnomalyRows[0];
  const scopedInvoiceAnomalyCount = count(scopedInvoiceAnomaly?.count);
  if (scopedInvoiceAnomaly && scopedInvoiceAnomalyCount > 0) {
    exceptions.push(exception({
      id: 'invoice-scope-anomalies',
      severity: 'high',
      category: 'Tenant scope',
      title: `${scopedInvoiceAnomalyCount} invoice${scopedInvoiceAnomalyCount === 1 ? '' : 's'} missing tenant-scoped contract line`,
      detail: `${scopedInvoiceAnomaly.invoiceNo ?? scopedInvoiceAnomaly.id} belongs to ${scopedInvoiceAnomaly.lesseeName ?? scopedInvoiceAnomaly.lesseeId} but has no line tied to this tenant contract scope.`,
      count: scopedInvoiceAnomalyCount,
      entityType: 'LeaseInvoice',
      entityId: scopedInvoiceAnomaly.id,
      actionHref: '/leasing/invoices',
      actionLabel: 'Review scope',
    }));
  }

  const severityOrder: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  exceptions.sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity] || right.count - left.count);

  return {
    generatedAt: now.toISOString(),
    kpis: {
      activeContracts: activeContracts.length,
      contractsAtRisk: contractsAtRisk.length,
      openExceptions: exceptions.length,
      criticalExceptions: exceptions.filter(item => item.severity === 'critical').length,
      highExceptions: exceptions.filter(item => item.severity === 'high').length,
      overdueAmount: overduePaymentAmount,
      uninvoicedStatements: uninvoicedStatementCount,
      pendingExecutionApprovals: approvals.length,
    },
    exceptions,
  };
}

async function overduePaymentSummary(contractIds: string[], now: Date) {
  return prisma.$queryRawUnsafe<Array<{
    id: string;
    contractId: string;
    contractNumber: string | null;
    dueDate: Date;
    count: number;
    amount: string;
  }>>(
    `SELECT p.id::text AS id,
            p.contract_id::text AS "contractId",
            c.contract_number AS "contractNumber",
            p.due_date AS "dueDate",
            COUNT(*) OVER()::int AS count,
            COALESCE(SUM(COALESCE(p.total_amount, p.amount)) OVER(), 0)::text AS amount
       FROM lease_payments_v2 p
       LEFT JOIN lease_contracts_v2 c ON c.id::text = p.contract_id::text
      WHERE p.contract_id = ANY($1::text[])
        AND p.due_date < $2
        AND COALESCE(p.status, 'PENDING') NOT IN ('PAID', 'WAIVED')
      ORDER BY p.due_date ASC
      LIMIT 1`,
    contractIds,
    now,
  );
}

async function uninvoicedStatementSummary(contractIds: string[]) {
  return prisma.$queryRawUnsafe<Array<{
    id: string;
    statementNo: string | null;
    billingPeriod: string | null;
    count: number;
    amount: string;
  }>>(
    `SELECT s.id::text AS id,
            s.statement_no AS "statementNo",
            s.billing_period AS "billingPeriod",
            COUNT(*) OVER()::int AS count,
            COALESCE(SUM(s.total_amount) OVER(), 0)::text AS amount
       FROM lease_pre_billing_statements s
      WHERE s.contract_id = ANY($1::text[])
        AND s.status = 'CONFIRMED'
        AND NOT EXISTS (
          SELECT 1
            FROM lease_invoices i
           WHERE COALESCE(i.notes, '') LIKE '%' || ('pre-billing:' || COALESCE(s.statement_no, s.id::text)) || '%'
        )
      ORDER BY s.created_at DESC
      LIMIT 1`,
    contractIds,
  );
}

async function paidInvoiceWithoutReferenceSummary(contractIds: string[]) {
  return prisma.$queryRawUnsafe<Array<{
    id: string;
    invoiceNo: string | null;
    count: number;
    amount: string;
  }>>(
    `SELECT i.id::text AS id,
            i.invoice_no AS "invoiceNo",
            COUNT(*) OVER()::int AS count,
            COALESCE(SUM(i.total_amount) OVER(), 0)::text AS amount
       FROM lease_invoices i
      WHERE i.status = 'PAID'
        AND NULLIF(BTRIM(COALESCE(i.payment_ref, '')), '') IS NULL
        AND EXISTS (
          SELECT 1
            FROM lease_invoice_lines line
           WHERE line.invoice_id::text = i.id::text
             AND line.contract_id = ANY($1::text[])
        )
      ORDER BY i.due_date ASC
      LIMIT 1`,
    contractIds,
  );
}

async function invoiceScopeAnomalySummary(lesseeIds: string[], contractIds: string[]) {
  return prisma.$queryRawUnsafe<Array<{
    id: string;
    invoiceNo: string | null;
    lesseeId: string;
    lesseeName: string | null;
    count: number;
  }>>(
    `SELECT i.id::text AS id,
            i.invoice_no AS "invoiceNo",
            i.lessee_id::text AS "lesseeId",
            lessee.name AS "lesseeName",
            COUNT(*) OVER()::int AS count
       FROM lease_invoices i
       LEFT JOIN lessees lessee ON lessee.id::text = i.lessee_id::text AND lessee.deleted_at IS NULL
      WHERE i.lessee_id = ANY($1::text[])
        AND NOT EXISTS (
          SELECT 1
            FROM lease_invoice_lines line
           WHERE line.invoice_id::text = i.id::text
             AND line.contract_id = ANY($2::text[])
        )
      ORDER BY i.created_at DESC
      LIMIT 1`,
    lesseeIds,
    contractIds,
  );
}

async function pendingLeasingApprovalExecutions(tenantId: string) {
  await ensureAdminApprovalTables();
  return prisma.$queryRawUnsafe<Array<{ id: string; action: string; summary: string | null }>>(
    `SELECT id::text, action, summary
       FROM admin_approval_requests
      WHERE tenant_id = $1
        AND action LIKE 'leasing.%'
        AND status = 'APPROVED'
        AND COALESCE(execution_status, '') <> 'EXECUTED'
      ORDER BY created_at DESC
      LIMIT 20`,
    tenantId,
  ).catch(() => []);
}
