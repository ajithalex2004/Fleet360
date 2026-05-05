/**
 * Revenue Analysis API — /api/finance/revenue-analysis
 * Vehicle-level and Customer-level profitability from finance_invoices
 * + maintenance cost from maintenance module + depreciation from fixed_assets
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

async function bootstrap() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS vehicle_no TEXT
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`
    ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS contract_type TEXT
  `).catch(() => {});
  await prisma.$executeRawUnsafe(`
    ALTER TABLE finance_invoices ADD COLUMN IF NOT EXISTS branch TEXT DEFAULT 'Dubai'
  `).catch(() => {});
}

export async function GET(req: NextRequest) {
  await bootstrap();

  const p          = req.nextUrl.searchParams;
  const view       = p.get('view') ?? 'vehicle';  // vehicle | customer | branch
  const branch     = p.get('branch');
  const module_f   = p.get('module');
  const date_from  = p.get('date_from');
  const date_to    = p.get('date_to');
  const search     = p.get('search');

  let where = `WHERE deleted_at IS NULL AND payment_status NOT IN ('DRAFT','CANCELLED')`;
  const params: unknown[] = [];
  let idx = 1;

  if (branch)    { where += ` AND branch = $${idx++}`;                 params.push(branch); }
  if (module_f)  { where += ` AND module = $${idx++}`;                 params.push(module_f); }
  if (date_from) { where += ` AND issue_date >= $${idx++}`;            params.push(date_from); }
  if (date_to)   { where += ` AND issue_date <= $${idx++}`;            params.push(date_to); }
  if (search && view === 'vehicle')  {
    where += ` AND vehicle_no ILIKE $${idx}`;
    params.push(`%${search}%`); idx++;
  }
  if (search && view === 'customer') {
    where += ` AND client_name ILIKE $${idx}`;
    params.push(`%${search}%`); idx++;
  }

  // ── Vehicle Profitability ─────────────────────────────────────────────────
  if (view === 'vehicle') {
    const revenue = await prisma.$queryRawUnsafe(`
      SELECT
        COALESCE(vehicle_no, 'UNASSIGNED') AS vehicle_no,
        module,
        branch,
        COUNT(*)                           AS invoice_count,
        SUM(total_amount)                  AS gross_revenue,
        SUM(paid_amount)                   AS collected,
        SUM(total_amount - paid_amount)    AS outstanding,
        SUM(vat_amount)                    AS vat_collected,
        MIN(issue_date)                    AS first_invoice,
        MAX(issue_date)                    AS last_invoice
      FROM finance_invoices
      ${where}
      GROUP BY vehicle_no, module, branch
      ORDER BY gross_revenue DESC
      LIMIT 100
    `, ...params) as Record<string, unknown>[];

    // Maintenance costs per vehicle
    const maint_costs = await prisma.$queryRawUnsafe(`
      SELECT
        COALESCE(vehicle_registration, vehicle_id::text, 'UNKNOWN') AS vehicle_no,
        COALESCE(SUM(invoice_amount), 0) AS total_maint_cost,
        COUNT(*) AS maint_count
      FROM maintenance_invoices
      WHERE status NOT IN ('CANCELLED')
      GROUP BY vehicle_registration, vehicle_id
    `).catch(() => []) as Record<string, unknown>[];

    const maintMap: Record<string, { cost: number; count: number }> = {};
    maint_costs.forEach(m => {
      maintMap[String(m.vehicle_no)] = { cost: Number(m.total_maint_cost), count: Number(m.maint_count) };
    });

    // Depreciation per vehicle from fixed_assets
    const depreciation = await prisma.$queryRawUnsafe(`
      SELECT
        COALESCE(registration_no, asset_tag, asset_name) AS vehicle_no,
        COALESCE(SUM(accumulated_depreciation), 0)        AS total_depreciation
      FROM finance_fixed_assets
      WHERE category ILIKE '%vehicle%' OR category ILIKE '%fleet%' OR category ILIKE '%car%'
      GROUP BY registration_no, asset_tag, asset_name
    `).catch(() => []) as Record<string, unknown>[];

    const deprMap: Record<string, number> = {};
    depreciation.forEach(d => {
      deprMap[String(d.vehicle_no)] = Number(d.total_depreciation);
    });

    const vehicles = revenue.map(r => {
      const vno        = String(r.vehicle_no);
      const gross      = Number(r.gross_revenue ?? 0);
      const maint      = maintMap[vno]?.cost ?? 0;
      const depr       = deprMap[vno] ?? 0;
      const total_cost = maint + depr;
      const net_margin = gross - total_cost;
      const margin_pct = gross > 0 ? (net_margin / gross) * 100 : 0;
      return {
        vehicle_no:       vno,
        module:           r.module,
        branch:           r.branch,
        invoice_count:    Number(r.invoice_count),
        gross_revenue:    gross,
        collected:        Number(r.collected ?? 0),
        outstanding:      Number(r.outstanding ?? 0),
        vat_collected:    Number(r.vat_collected ?? 0),
        maint_cost:       maint,
        maint_count:      maintMap[vno]?.count ?? 0,
        depreciation:     depr,
        total_cost,
        net_margin,
        margin_pct:       Math.round(margin_pct * 10) / 10,
        first_invoice:    r.first_invoice,
        last_invoice:     r.last_invoice,
      };
    });

    const totals = vehicles.reduce((acc, v) => ({
      gross_revenue: acc.gross_revenue + v.gross_revenue,
      collected:     acc.collected     + v.collected,
      outstanding:   acc.outstanding   + v.outstanding,
      maint_cost:    acc.maint_cost    + v.maint_cost,
      depreciation:  acc.depreciation  + v.depreciation,
      net_margin:    acc.net_margin    + v.net_margin,
    }), { gross_revenue: 0, collected: 0, outstanding: 0, maint_cost: 0, depreciation: 0, net_margin: 0 });

    return NextResponse.json({ view, vehicles, totals });
  }

  // ── Customer Profitability (LTV) ──────────────────────────────────────────
  if (view === 'customer') {
    const customers = await prisma.$queryRawUnsafe(`
      SELECT
        client_name,
        client_email,
        COUNT(*)                                   AS invoice_count,
        SUM(total_amount)                          AS lifetime_revenue,
        SUM(paid_amount)                           AS total_paid,
        SUM(total_amount - paid_amount)            AS outstanding,
        AVG(total_amount)                          AS avg_invoice,
        MIN(issue_date)                            AS first_invoice,
        MAX(issue_date)                            AS last_invoice,
        (MAX(issue_date::date) - MIN(issue_date::date)) AS relationship_days,
        COUNT(DISTINCT module)                     AS modules_used,
        COUNT(DISTINCT vehicle_no)                 AS vehicles_rented,
        COUNT(DISTINCT branch)                     AS branches_used,
        STRING_AGG(DISTINCT module, ', ')          AS module_list
      FROM finance_invoices
      ${where}
      GROUP BY client_name, client_email
      ORDER BY lifetime_revenue DESC
      LIMIT 100
    `, ...params) as Record<string, unknown>[];

    return NextResponse.json({
      view,
      customers: customers.map(c => ({
        client_name:       c.client_name,
        client_email:      c.client_email,
        invoice_count:     Number(c.invoice_count),
        lifetime_revenue:  Number(c.lifetime_revenue ?? 0),
        total_paid:        Number(c.total_paid ?? 0),
        outstanding:       Number(c.outstanding ?? 0),
        avg_invoice:       Number(c.avg_invoice ?? 0),
        first_invoice:     c.first_invoice,
        last_invoice:      c.last_invoice,
        relationship_days: Number(c.relationship_days ?? 0),
        modules_used:      Number(c.modules_used),
        vehicles_rented:   Number(c.vehicles_rented),
        branches_used:     Number(c.branches_used),
        module_list:       c.module_list,
      })),
    });
  }

  // ── Branch Revenue Breakdown ──────────────────────────────────────────────
  const branches = await prisma.$queryRawUnsafe(`
    SELECT
      COALESCE(branch, 'Unassigned')   AS branch,
      module,
      COUNT(*)                          AS invoice_count,
      SUM(total_amount)                 AS gross_revenue,
      SUM(paid_amount)                  AS collected,
      SUM(vat_amount)                   AS vat_amount,
      COUNT(DISTINCT client_name)       AS customer_count
    FROM finance_invoices
    ${where}
    GROUP BY branch, module
    ORDER BY gross_revenue DESC
  `, ...params) as Record<string, unknown>[];

  return NextResponse.json({
    view: 'branch',
    branches: branches.map(b => ({
      branch:         b.branch,
      module:         b.module,
      invoice_count:  Number(b.invoice_count),
      gross_revenue:  Number(b.gross_revenue ?? 0),
      collected:      Number(b.collected ?? 0),
      vat_amount:     Number(b.vat_amount ?? 0),
      customer_count: Number(b.customer_count),
    })),
  });
}
