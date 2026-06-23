import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminPermission, resolveTenantBoundary } from '@/lib/admin-policy';
import { getCanonicalBillingAccount } from '@/lib/canonical-billing';

type Row = Record<string, unknown>;

function formatDate(v: unknown): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().split('T')[0];
  return String(v).split('T')[0];
}

function serializeRow(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date) {
      out[k] = v.toISOString();
      continue;
    }
    if (typeof v === 'bigint') {
      out[k] = Number(v);
      continue;
    }
    out[k] = v;
  }
  return out;
}

export async function GET(req: NextRequest) {
  const auth = await requireAdminPermission(req, 'view', 'billing');
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') ?? 'dashboard';
  const scopedTenantId = resolveTenantBoundary(auth.ctx, searchParams.get('tenantId'));
  if (scopedTenantId instanceof NextResponse) return scopedTenantId;
  const tenantId = type === 'tenant_billing'
    ? scopedTenantId
    : (auth.ctx.isSuperAdmin ? searchParams.get('tenantId') ?? '' : auth.ctx.tenantId);

  if (type === 'dashboard' && !auth.ctx.isSuperAdmin) {
    return NextResponse.json({ error: 'Platform billing dashboard requires super admin access' }, { status: 403 });
  }

  if (type === 'tenant_billing') {
    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required for type=tenant_billing' }, { status: 400 });
    }

    type TenantRow = { name: string };
    type SubRow = {
      module_code: string;
      status: string;
      plan_tier: string;
      billing_cycle: string;
      base_price: string | number;
      currency: string;
      next_billing_date: Date | string;
      last_billed_date: Date | string | null;
    };

    const [tenant] = await prisma.$queryRawUnsafe<TenantRow[]>(
      `SELECT name FROM tenants WHERE id = $1`,
      tenantId,
    ).catch(() => [] as TenantRow[]);

    const invoices = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT
         id, invoice_number, client_name, client_email,
         module_source, issue_date, due_date,
         subtotal, vat_amount, total_amount, paid_amount,
         currency, payment_status, notes, line_items_json,
         created_at, updated_at
       FROM finance_invoices
       WHERE tenant_id = $1
         AND invoice_number LIKE 'SUB-%'
         AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      tenantId,
    ).catch(() => [] as Row[]);

    const subscriptions = await prisma.$queryRawUnsafe<SubRow[]>(
      `SELECT module_code, status, plan_tier, billing_cycle, base_price,
              currency, next_billing_date, last_billed_date
         FROM tenant_module_subscriptions
        WHERE tenant_id = $1
        ORDER BY module_code`,
      tenantId,
    ).catch(() => [] as SubRow[]);

    const totalSpend = invoices.reduce((sum, inv) => sum + Number(inv.total_amount ?? 0), 0);
    const outstanding = invoices
      .filter(inv => inv.payment_status !== 'PAID')
      .reduce((sum, inv) => sum + Number(inv.total_amount ?? 0), 0);

    const canonicalBilling = await getCanonicalBillingAccount(tenantId);

    return NextResponse.json({
      tenant_id: tenantId,
      tenant_name: tenant?.name ?? null,
      canonical_billing: canonicalBilling,
      subscriptions: subscriptions.map(s => ({
        ...s,
        base_price: Number(s.base_price),
        next_billing_date: formatDate(s.next_billing_date),
        last_billed_date: formatDate(s.last_billed_date),
      })),
      invoices: invoices.map(serializeRow),
      summary: {
        total_invoices: invoices.length,
        total_spend: Math.round(totalSpend * 100) / 100,
        outstanding_amount: Math.round(outstanding * 100) / 100,
        paid_invoices: invoices.filter(i => i.payment_status === 'PAID').length,
        unpaid_invoices: invoices.filter(i => i.payment_status !== 'PAID').length,
      },
    });
  }

  try {
    type CanonicalSubscriptionRow = {
      id: string;
      tenant_id: string;
      tenant_name: string;
      tenant_code: string | null;
      module_code: string;
      plan_tier: string;
      billing_cycle: string;
      status: string;
      base_price: string | number;
      currency: string;
      next_billing_date: Date | string | null;
    };
    type MrrRow = {
      active_count: bigint;
      monthly_total: string | number;
      annual_as_monthly: string | number;
    };
    type RunRow = {
      id: string;
      run_date: Date;
      status: string;
      total_tenants: number | bigint;
      invoices_created: number | bigint;
      total_amount: string | number;
      completed_at: Date | null;
    };
    type RenewalRow = {
      id: string;
      tenant_id: string;
      module_code: string;
      plan_tier: string;
      billing_cycle: string;
      base_price: string | number;
      currency: string;
      next_billing_date: Date | string;
      tenant_name: string;
      tenant_code: string | null;
    };
    type OutstandingRow = {
      id: string;
      invoice_number: string;
      client_name: string;
      total_amount: string | number;
      payment_status: string;
      due_date: Date | string | null;
      issue_date: Date | string;
      module_source: string | null;
      tenant_id: string | null;
    };
    type StatusRow = { status: string; cnt: bigint };
    type ModuleBreakdownRow = {
      module_code: string;
      active_count: bigint;
      trial_count: bigint;
      suspended_count: bigint;
      cancelled_count: bigint;
      mrr_contribution: string | number;
    };
    type BillingModelRow = { billing_model: string; cnt: bigint };

    const [
      canonicalSubscriptions,
      mrrRows,
      recentRuns,
      upcomingRenewals,
      outstandingInvoices,
      statusBreakdown,
      byModuleRows,
      billingModelRows,
    ] = await Promise.all([
      prisma.$queryRawUnsafe<CanonicalSubscriptionRow[]>(
        `SELECT
           s.id::text,
           s.tenant_id,
           COALESCE(t.name, s.tenant_id) AS tenant_name,
           t.code AS tenant_code,
           s.module_code,
           s.plan_tier,
           s.billing_cycle,
           s.status,
           s.base_price,
           s.currency,
           s.next_billing_date
         FROM tenant_module_subscriptions s
         LEFT JOIN tenants t ON t.id = s.tenant_id
         ORDER BY s.created_at DESC`,
      ).catch(() => [] as CanonicalSubscriptionRow[]),
      prisma.$queryRawUnsafe<MrrRow[]>(
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('ACTIVE', 'TRIAL')) AS active_count,
           COALESCE(SUM(base_price) FILTER (
             WHERE status IN ('ACTIVE', 'TRIAL') AND billing_cycle = 'MONTHLY'
           ), 0) AS monthly_total,
           COALESCE(SUM(base_price / 12.0) FILTER (
             WHERE status IN ('ACTIVE', 'TRIAL') AND billing_cycle = 'ANNUAL'
           ), 0) AS annual_as_monthly
         FROM tenant_module_subscriptions`,
      ).catch(() => [{ active_count: BigInt(0), monthly_total: 0, annual_as_monthly: 0 }]),
      prisma.$queryRawUnsafe<RunRow[]>(
        `SELECT id, run_date, status, total_tenants, invoices_created, total_amount, completed_at
           FROM billing_runs
          ORDER BY created_at DESC
          LIMIT 5`,
      ).catch(() => [] as RunRow[]),
      prisma.$queryRawUnsafe<RenewalRow[]>(
        `SELECT
           s.id, s.tenant_id, s.module_code, s.plan_tier, s.billing_cycle,
           s.base_price, s.currency, s.next_billing_date,
           COALESCE(t.name, s.tenant_id) AS tenant_name,
           t.code AS tenant_code
         FROM tenant_module_subscriptions s
         LEFT JOIN tenants t ON t.id = s.tenant_id
         WHERE s.status = 'ACTIVE'
           AND s.next_billing_date > CURRENT_DATE
           AND s.next_billing_date <= CURRENT_DATE + INTERVAL '7 days'
         ORDER BY s.next_billing_date ASC`,
      ).catch(() => [] as RenewalRow[]),
      prisma.$queryRawUnsafe<OutstandingRow[]>(
        `SELECT
           id, invoice_number, client_name, total_amount,
           payment_status, due_date, issue_date, module_source, tenant_id
         FROM finance_invoices
         WHERE invoice_number LIKE 'SUB-%'
           AND payment_status != 'PAID'
           AND deleted_at IS NULL
         ORDER BY due_date ASC NULLS LAST
         LIMIT 50`,
      ).catch(() => [] as OutstandingRow[]),
      prisma.$queryRawUnsafe<StatusRow[]>(
        `SELECT status, COUNT(*) AS cnt FROM tenant_module_subscriptions GROUP BY status`,
      ).catch(() => [] as StatusRow[]),
      prisma.$queryRawUnsafe<ModuleBreakdownRow[]>(
        `SELECT
           module_code,
           COUNT(*) FILTER (WHERE status = 'ACTIVE') AS active_count,
           COUNT(*) FILTER (WHERE status = 'TRIAL') AS trial_count,
           COUNT(*) FILTER (WHERE status = 'SUSPENDED') AS suspended_count,
           COUNT(*) FILTER (WHERE status = 'CANCELLED') AS cancelled_count,
           COALESCE(SUM(
             CASE
               WHEN status IN ('ACTIVE', 'TRIAL') AND billing_cycle = 'ANNUAL' THEN base_price / 12.0
               WHEN status IN ('ACTIVE', 'TRIAL') THEN base_price
               ELSE 0
             END
           ), 0) AS mrr_contribution
         FROM tenant_module_subscriptions
         GROUP BY module_code
         ORDER BY module_code`,
      ).catch(() => [] as ModuleBreakdownRow[]),
      prisma.$queryRawUnsafe<BillingModelRow[]>(
        `SELECT billing_model, COUNT(*) AS cnt
           FROM tenant_billing_accounts
          GROUP BY billing_model`,
      ).catch(() => [] as BillingModelRow[]),
    ]);

    const rawActiveCount = Number(mrrRows[0]?.active_count ?? 0);
    const mrr = Math.round((Number(mrrRows[0]?.monthly_total ?? 0) + Number(mrrRows[0]?.annual_as_monthly ?? 0)) * 100) / 100;
    const arr = Math.round(mrr * 12 * 100) / 100;
    const activeCount = canonicalSubscriptions.filter(subscription => (
      subscription.status === 'ACTIVE' || subscription.status === 'TRIAL'
    )).length;

    const rawStatusCounts: Record<string, number> = {};
    for (const s of statusBreakdown) rawStatusCounts[s.status] = Number(s.cnt);

    const modelBreakdown = billingModelRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.billing_model] = Number(row.cnt);
      return acc;
    }, {});

    const outstandingTotal = outstandingInvoices.reduce(
      (sum, inv) => sum + Number(inv.total_amount ?? 0),
      0,
    );
    const overdueTotal = outstandingInvoices
      .filter(inv => {
        const due = formatDate(inv.due_date);
        return due && due < new Date().toISOString().split('T')[0];
      })
      .reduce((sum, inv) => sum + Number(inv.total_amount ?? 0), 0);

    const reconciliationIssues = [
      ...(rawActiveCount !== activeCount ? [`Active count mismatch: overview=${rawActiveCount}, rows=${activeCount}`] : []),
    ];

    return NextResponse.json({
      overview: {
        active_subscriptions: activeCount,
        mrr,
        arr,
        status_breakdown: rawStatusCounts,
        canonical_mrr: mrr,
        canonical_arr: arr,
        billing_model_breakdown: modelBreakdown,
      },
      canonical_subscriptions: canonicalSubscriptions.map(subscription => ({
        id: subscription.id,
        tenant_id: subscription.tenant_id,
        tenant_name: subscription.tenant_name,
        tenant_code: subscription.tenant_code,
        module_code: subscription.module_code,
        plan_tier: subscription.plan_tier,
        billing_cycle: subscription.billing_cycle,
        status: subscription.status,
        base_price: Number(subscription.base_price ?? 0),
        currency: subscription.currency,
        next_billing_date: formatDate(subscription.next_billing_date),
      })),
      reconciliation: {
        source_of_truth: 'tenant_module_subscriptions',
        status: reconciliationIssues.length ? 'DRIFT' : 'OK',
        issues: reconciliationIssues,
        raw: {
          active_subscriptions: rawActiveCount,
          mrr,
          subscription_rows: canonicalSubscriptions.length,
        },
        canonical: {
          active_subscriptions: activeCount,
          mrr,
          subscription_rows: canonicalSubscriptions.length,
        },
        synced_at: new Date().toISOString(),
      },
      by_module: byModuleRows.map(m => ({
        module_code: m.module_code,
        active_count: Number(m.active_count),
        trial_count: Number(m.trial_count),
        suspended_count: Number(m.suspended_count),
        cancelled_count: Number(m.cancelled_count),
        mrr_contribution: Math.round(Number(m.mrr_contribution ?? 0) * 100) / 100,
      })),
      recent_billing_runs: recentRuns.map(r => ({
        id: r.id,
        run_date: formatDate(r.run_date),
        status: r.status,
        total_tenants: Number(r.total_tenants),
        invoices_created: Number(r.invoices_created),
        total_amount: Number(r.total_amount),
        completed_at: r.completed_at ? r.completed_at.toISOString() : null,
      })),
      upcoming_renewals: upcomingRenewals.map(r => ({
        ...r,
        base_price: Number(r.base_price),
        next_billing_date: formatDate(r.next_billing_date),
      })),
      outstanding_invoices: {
        total_outstanding: Math.round(outstandingTotal * 100) / 100,
        total_overdue: Math.round(overdueTotal * 100) / 100,
        count: outstandingInvoices.length,
        invoices: outstandingInvoices.map(inv => ({
          ...inv,
          total_amount: Number(inv.total_amount),
          due_date: formatDate(inv.due_date),
          issue_date: formatDate(inv.issue_date),
        })),
      },
    });
  } catch (err) {
    console.error('[billing/dashboard GET]', err);
    return NextResponse.json({ error: 'Failed to load billing dashboard', detail: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { action } = body as { action?: string };

  if (!action) {
    return NextResponse.json({
      error: 'No action specified. Use POST /api/billing/auto-invoice for billing runs.',
      hint: 'Available actions via /api/billing/auto-invoice: run_billing, preview',
    }, { status: 400 });
  }

  if (action === 'run_billing' || action === 'preview') {
    return NextResponse.json({
      error: `Action "${action}" must be posted to /api/billing/auto-invoice`,
      redirect: '/api/billing/auto-invoice',
    }, { status: 307 });
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
}
