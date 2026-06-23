import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireOperationalContext } from '@/lib/cross-module-governance';
import { ensureLeaseContractTenantColumn } from '@/lib/leasing-governance';

export const dynamic = 'force-dynamic';

let tenantColumnReady: Promise<void> | null = null;

function ensureAnalyticsTenantColumn() {
  if (!tenantColumnReady) {
    tenantColumnReady = ensureLeaseContractTenantColumn().catch((error) => {
      tenantColumnReady = null;
      throw error;
    });
  }
  return tenantColumnReady;
}

function numberValue(value: unknown) {
  return Number(value ?? 0);
}

function roundPct(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

type KpiRow = {
  totalContracts: number;
  activeContracts: number;
  monthlyRevenue: number;
  portfolioValue: number;
};

type PaymentKpiRow = {
  totalPayments: number;
  paidPayments: number;
  overdueAmount: number;
};

type RevenueMonthRow = {
  month: string;
  amount: number;
};

type StatusRow = {
  status: string;
  count: number;
};

type BillingRow = {
  fines: number;
  fuel: number;
  mileageOverage: number;
};

type PortfolioRow = {
  totalLessees: number;
  corporateLessees: number;
};

type UtilisationRow = {
  activeVehicleMonths: number;
  totalVehicleMonths: number;
  fleetSize: number;
};

type TopContractRow = {
  contractId: string;
  contractNumber: string | null;
  revenue: number;
  exposure: number;
  netContribution: number;
};

const EMPTY_RESPONSE = {
  kpis: {
    activeContracts: 0,
    totalContracts: 0,
    monthlyRevenue: 0,
    portfolioValue: 0,
    overdueAmount: 0,
    collectionRate: 0,
    totalUnbilled: 0,
    expiringPolicies: 0,
    renewalsPending: 0,
    totalLessees: 0,
    corporateLessees: 0,
    utilisationPct: 0,
    activeVehicleMonths: 0,
    totalVehicleMonths: 0,
    fleetSize: 0,
  },
  charts: {
    revenueByMonth: {},
    contractsByStatus: {},
    pendingBillingBreakdown: { fines: 0, fuel: 0, mileageOverage: 0 },
  },
  topContracts: [],
};

function analyticsResponse(body: unknown, startMs: number) {
  return NextResponse.json(body, {
    headers: {
      'Cache-Control': 'private, max-age=15, stale-while-revalidate=45',
      'Server-Timing': `leasing-analytics;dur=${Math.round(performance.now() - startMs)}`,
    },
  });
}

export async function GET(req: NextRequest) {
  const startMs = performance.now();
  try {
    const ctx = requireOperationalContext(req, 'leasing', {
      requestedTenantId: req.nextUrl.searchParams.get('tenantId'),
    });
    if (ctx instanceof NextResponse) return ctx;

    await ensureAnalyticsTenantColumn();

    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const last6Months = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const tenantFilter = `
      FROM lease_contracts_v2 c
      WHERE c.tenant_id::text = $1
        AND c.deleted_at IS NULL
    `;

    const [
      kpiRows,
      paymentRows,
      revenueRows,
      statusRows,
      billingRows,
      insuranceRows,
      renewalRows,
      portfolioRows,
      utilisationRows,
      topContractRows,
    ] = await Promise.all([
      prisma.$queryRawUnsafe<KpiRow[]>(
        `SELECT
            COUNT(*)::int AS "totalContracts",
            COUNT(*) FILTER (WHERE c.status = 'ACTIVE')::int AS "activeContracts",
            COALESCE(SUM(c.monthly_rate) FILTER (WHERE c.status = 'ACTIVE'), 0)::float AS "monthlyRevenue",
            COALESCE(SUM(COALESCE(c.total_contract_value, 0)) FILTER (WHERE c.status = 'ACTIVE'), 0)::float AS "portfolioValue"
           ${tenantFilter}`,
        ctx.tenantId,
      ),
      prisma.$queryRawUnsafe<PaymentKpiRow[]>(
        `SELECT
            COUNT(*)::int AS "totalPayments",
            COUNT(*) FILTER (WHERE p.status = 'PAID')::int AS "paidPayments",
            COALESCE(SUM(COALESCE(p.total_amount, p.amount)) FILTER (WHERE p.status = 'OVERDUE'), 0)::float AS "overdueAmount"
           FROM lease_payments_v2 p
           JOIN lease_contracts_v2 c ON c.id::text = p.contract_id::text
          WHERE c.tenant_id::text = $1
            AND c.deleted_at IS NULL`,
        ctx.tenantId,
      ),
      prisma.$queryRawUnsafe<RevenueMonthRow[]>(
        `SELECT
            TO_CHAR(DATE_TRUNC('month', p.paid_date), 'YYYY-MM') AS month,
            COALESCE(SUM(COALESCE(p.total_amount, p.amount)), 0)::float AS amount
           FROM lease_payments_v2 p
           JOIN lease_contracts_v2 c ON c.id::text = p.contract_id::text
          WHERE c.tenant_id::text = $1
            AND c.deleted_at IS NULL
            AND p.status = 'PAID'
            AND p.paid_date IS NOT NULL
            AND p.paid_date >= $2
          GROUP BY DATE_TRUNC('month', p.paid_date)
          ORDER BY DATE_TRUNC('month', p.paid_date)`,
        ctx.tenantId,
        last6Months,
      ),
      prisma.$queryRawUnsafe<StatusRow[]>(
        `SELECT
            COALESCE(c.status, 'UNKNOWN') AS status,
            COUNT(*)::int AS count
           ${tenantFilter}
          GROUP BY COALESCE(c.status, 'UNKNOWN')
          ORDER BY COALESCE(c.status, 'UNKNOWN')`,
        ctx.tenantId,
      ),
      prisma.$queryRawUnsafe<BillingRow[]>(
        `WITH scoped_contracts AS (
            SELECT c.id::text AS id
              FROM lease_contracts_v2 c
             WHERE c.tenant_id::text = $1
               AND c.deleted_at IS NULL
          )
          SELECT
            (
              SELECT COALESCE(SUM(COALESCE(f.final_amount, f.fine_amount, 0)), 0)::float
                FROM lease_traffic_fines f
                JOIN scoped_contracts c ON c.id = f.contract_id::text
               WHERE f.billing_status = 'PENDING'
            ) AS fines,
            (
              SELECT COALESCE(SUM(COALESCE(fl.total_cost, 0)), 0)::float
                FROM lease_fuel_logs fl
                JOIN scoped_contracts c ON c.id = fl.contract_id::text
               WHERE fl.billing_status = 'PENDING'
            ) AS fuel,
            (
              SELECT COALESCE(SUM(COALESCE(o.overage_amount, 0)), 0)::float
                FROM lease_mileage_overages o
                JOIN scoped_contracts c ON c.id = o.contract_id::text
               WHERE o.status = 'PENDING'
            ) AS "mileageOverage"`,
        ctx.tenantId,
      ),
      prisma.$queryRawUnsafe<Array<{ expiringPolicies: number }>>(
        `SELECT COUNT(*)::int AS "expiringPolicies"
           FROM lease_insurance_policies p
           JOIN lease_contracts_v2 c ON c.id::text = p.contract_id::text
          WHERE c.tenant_id::text = $1
            AND c.deleted_at IS NULL
            AND p.deleted_at IS NULL
            AND p.expiry_date >= $2
            AND p.expiry_date <= ($2::timestamptz + INTERVAL '30 days')`,
        ctx.tenantId,
        now,
      ),
      prisma.$queryRawUnsafe<Array<{ renewalsPending: number }>>(
        `SELECT COUNT(*)::int AS "renewalsPending"
           FROM lease_renewals r
           JOIN lease_contracts_v2 c ON c.id::text = r.original_contract_id::text
          WHERE c.tenant_id::text = $1
            AND c.deleted_at IS NULL
            AND r.status IN ('PROPOSED', 'SENT_TO_CUSTOMER')`,
        ctx.tenantId,
      ),
      prisma.$queryRawUnsafe<PortfolioRow[]>(
        `SELECT
            COUNT(DISTINCT l.id)::int AS "totalLessees",
            COUNT(DISTINCT l.id) FILTER (WHERE l.type = 'corporate')::int AS "corporateLessees"
           FROM lease_contracts_v2 c
           JOIN lessees l ON l.id::text = c.lessee_id::text
          WHERE c.tenant_id::text = $1
            AND c.deleted_at IS NULL
            AND l.deleted_at IS NULL`,
        ctx.tenantId,
      ),
      prisma.$queryRawUnsafe<UtilisationRow[]>(
        `WITH months AS (
            SELECT GENERATE_SERIES(
              DATE_TRUNC('month', $2::timestamptz),
              DATE_TRUNC('month', $3::timestamptz),
              INTERVAL '1 month'
            ) AS month_start
          ),
          scoped_vehicles AS (
            SELECT
              cv.id,
              cv.status AS vehicle_status,
              c.status AS contract_status,
              c.start_date,
              c.end_date
            FROM lease_contract_vehicles cv
            JOIN lease_contracts_v2 c ON c.id::text = cv.contract_id::text
            WHERE c.tenant_id::text = $1
              AND c.deleted_at IS NULL
          )
          SELECT
            COUNT(*) FILTER (
              WHERE sv.start_date <= (m.month_start + INTERVAL '1 month' - INTERVAL '1 second')
                AND sv.end_date >= m.month_start
                AND sv.vehicle_status = 'ACTIVE'
                AND sv.contract_status = 'ACTIVE'
            )::int AS "activeVehicleMonths",
            COUNT(*) FILTER (
              WHERE sv.start_date <= (m.month_start + INTERVAL '1 month' - INTERVAL '1 second')
                AND sv.end_date >= m.month_start
            )::int AS "totalVehicleMonths",
            COUNT(DISTINCT sv.id)::int AS "fleetSize"
          FROM scoped_vehicles sv
          CROSS JOIN months m`,
        ctx.tenantId,
        last6Months,
        now,
      ),
      prisma.$queryRawUnsafe<TopContractRow[]>(
        `WITH scoped_contracts AS (
            SELECT
              c.id::text AS "contractId",
              c.contract_number AS "contractNumber"
            FROM lease_contracts_v2 c
            WHERE c.tenant_id::text = $1
              AND c.deleted_at IS NULL
              AND c.status = 'ACTIVE'
          ),
          revenue AS (
            SELECT
              p.contract_id::text AS "contractId",
              COALESCE(SUM(COALESCE(p.total_amount, p.amount)), 0)::float AS revenue
            FROM lease_payments_v2 p
            JOIN scoped_contracts c ON c."contractId" = p.contract_id::text
            WHERE p.status = 'PAID'
              AND p.paid_date IS NOT NULL
              AND p.paid_date >= $2
            GROUP BY p.contract_id::text
          ),
          exposure_lines AS (
            SELECT o.contract_id::text AS "contractId", COALESCE(o.overage_amount, 0)::float AS amount
              FROM lease_mileage_overages o
              JOIN scoped_contracts c ON c."contractId" = o.contract_id::text
             WHERE o.status = 'PENDING'
            UNION ALL
            SELECT f.contract_id::text AS "contractId", COALESCE(f.final_amount, f.fine_amount, 0)::float AS amount
              FROM lease_traffic_fines f
              JOIN scoped_contracts c ON c."contractId" = f.contract_id::text
             WHERE f.billing_status = 'PENDING'
            UNION ALL
            SELECT fl.contract_id::text AS "contractId", COALESCE(fl.total_cost, 0)::float AS amount
              FROM lease_fuel_logs fl
              JOIN scoped_contracts c ON c."contractId" = fl.contract_id::text
             WHERE fl.billing_status = 'PENDING'
          ),
          exposure AS (
            SELECT "contractId", COALESCE(SUM(amount), 0)::float AS exposure
              FROM exposure_lines
             GROUP BY "contractId"
          )
          SELECT
            c."contractId",
            c."contractNumber",
            COALESCE(r.revenue, 0)::float AS revenue,
            COALESCE(e.exposure, 0)::float AS exposure,
            (COALESCE(r.revenue, 0) - COALESCE(e.exposure, 0))::float AS "netContribution"
          FROM scoped_contracts c
          LEFT JOIN revenue r ON r."contractId" = c."contractId"
          LEFT JOIN exposure e ON e."contractId" = c."contractId"
          ORDER BY "netContribution" DESC
          LIMIT 5`,
        ctx.tenantId,
        startOfYear,
      ),
    ]);

    const kpis = kpiRows[0] ?? EMPTY_RESPONSE.kpis;
    if (numberValue(kpis.totalContracts) === 0) {
      return analyticsResponse(EMPTY_RESPONSE, startMs);
    }

    const payments = paymentRows[0] ?? { totalPayments: 0, paidPayments: 0, overdueAmount: 0 };
    const billing = billingRows[0] ?? { fines: 0, fuel: 0, mileageOverage: 0 };
    const portfolio = portfolioRows[0] ?? { totalLessees: 0, corporateLessees: 0 };
    const utilisation = utilisationRows[0] ?? { activeVehicleMonths: 0, totalVehicleMonths: 0, fleetSize: 0 };
    const activeVehicleMonths = numberValue(utilisation.activeVehicleMonths);
    const totalVehicleMonths = numberValue(utilisation.totalVehicleMonths);

    const revenueByMonth = Object.fromEntries(
      revenueRows.map((row) => [row.month, numberValue(row.amount)]),
    );
    const contractsByStatus = Object.fromEntries(
      statusRows.map((row) => [row.status, numberValue(row.count)]),
    );
    const pendingBillingBreakdown = {
      fines: numberValue(billing.fines),
      fuel: numberValue(billing.fuel),
      mileageOverage: numberValue(billing.mileageOverage),
    };

    return analyticsResponse({
      kpis: {
        activeContracts: numberValue(kpis.activeContracts),
        totalContracts: numberValue(kpis.totalContracts),
        monthlyRevenue: numberValue(kpis.monthlyRevenue),
        portfolioValue: numberValue(kpis.portfolioValue),
        overdueAmount: numberValue(payments.overdueAmount),
        collectionRate: roundPct(numberValue(payments.paidPayments), numberValue(payments.totalPayments)),
        totalUnbilled: pendingBillingBreakdown.fines + pendingBillingBreakdown.fuel + pendingBillingBreakdown.mileageOverage,
        expiringPolicies: numberValue(insuranceRows[0]?.expiringPolicies),
        renewalsPending: numberValue(renewalRows[0]?.renewalsPending),
        totalLessees: numberValue(portfolio.totalLessees),
        corporateLessees: numberValue(portfolio.corporateLessees),
        utilisationPct: totalVehicleMonths > 0
          ? Math.round((activeVehicleMonths / totalVehicleMonths) * 1000) / 10
          : 0,
        activeVehicleMonths,
        totalVehicleMonths,
        fleetSize: numberValue(utilisation.fleetSize),
      },
      charts: {
        revenueByMonth,
        contractsByStatus,
        pendingBillingBreakdown,
      },
      topContracts: topContractRows.map((row) => ({
        contractId: row.contractId,
        contractNumber: row.contractNumber,
        revenue: numberValue(row.revenue),
        exposure: numberValue(row.exposure),
        netContribution: numberValue(row.netContribution),
      })),
    }, startMs);
  } catch (e) {
    console.error('[leasing.analytics]', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
