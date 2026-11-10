export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
/**
 * GET  /api/finance/budgets?year=YYYY&month=MM
 *   Returns budgets with LIVE actual amounts computed from module tables.
 *   actuals are pulled for the specified year/month range.
 *
 * POST /api/finance/budgets — create a budget entry
 */

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const { searchParams } = new URL(req.url);
      const now  = new Date();
      const year  = parseInt(searchParams.get('year')  ?? String(now.getFullYear()));
      const month = parseInt(searchParams.get('month') ?? '0'); // 0 = full year

      // Period window for actuals
      let startDate: string, endDate: string;
      if (month > 0 && month <= 12) {
        startDate = `${year}-${String(month).padStart(2,'0')}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        endDate = `${year}-${String(month).padStart(2,'0')}-${lastDay}`;
      } else {
        startDate = `${year}-01-01`;
        endDate   = `${year}-12-31`;
      }

      // ── Pull live actuals from module tables ───────────────────────────────────
      type NumRow = { total: number | null };
      type GroupRow = { key: string; total: number | null };
      const zero = () => Promise.resolve([{ total: 0 }] as NumRow[]);

      const [
        maintenanceActual, fuelActual, leasingActual, staffActual, schoolActual,
        rentalActual, logisticsActual, insuranceActual,
        payableActuals, invoiceRevenueByCentre,
      ] = await Promise.all([
        // Maintenance: approved quotations + maintenance payables
        tx.$queryRawUnsafe<NumRow[]>(
          `SELECT COALESCE(SUM(COALESCE(actual_cost, estimated_cost, 0)),0) AS total FROM maintenance_requests
           WHERE tenant_id = $3 AND deleted_at IS NULL AND status IN ('COMPLETED','IN_PROGRESS')
             AND created_at::date BETWEEN $1::date AND $2::date`, startDate, endDate, tenantId
        ).catch(zero),
        // Fuel: fuel logs
        tx.$queryRawUnsafe<NumRow[]>(
          `SELECT COALESCE(SUM(total_cost),0) AS total FROM fuel_logs
           WHERE tenant_id = $3 AND created_at::date BETWEEN $1::date AND $2::date`, startDate, endDate, tenantId
        ).catch(zero),
        // Leasing: lease payments
        tx.$queryRawUnsafe<NumRow[]>(
          `SELECT COALESCE(SUM(monthly_rate),0) AS total FROM lease_contracts_v2
           WHERE tenant_id = $3 AND deleted_at IS NULL AND status = 'ACTIVE'
             AND start_date::date <= $2::date AND (end_date IS NULL OR end_date::date >= $1::date)`, startDate, endDate, tenantId
        ).catch(zero),
        // Staff transport: trip schedule costs (proxy)
        tx.$queryRawUnsafe<NumRow[]>(
          `SELECT COALESCE(COUNT(*) * 50,0) AS total FROM trip_schedules
           WHERE tenant_id::text = $3 AND deleted_at IS NULL AND status = 'COMPLETED'
             AND departure_time::date BETWEEN $1::date AND $2::date`, startDate, endDate, tenantId
        ).catch(zero),
        // School bus: its trips live in school_bus_trips
        tx.$queryRawUnsafe<NumRow[]>(
          `SELECT COALESCE(COUNT(*) * 30,0) AS total FROM school_bus_trips
           WHERE tenant_id = $3 AND status = 'COMPLETED'
             AND scheduled_date BETWEEN $1::date AND $2::date`, startDate, endDate, tenantId
        ).catch(zero),
        // RAC revenue (operating cost proxy: 30% of revenue)
        tx.$queryRawUnsafe<NumRow[]>(
          `SELECT COALESCE(SUM(total_amount) * 0.30, 0) AS total FROM rental_agreements
           WHERE tenant_id = $3 AND status IN ('ACTIVE','COMPLETED')
             AND created_at::date BETWEEN $1::date AND $2::date`, startDate, endDate, tenantId
        ).catch(zero),
        // Logistics operational cost (40% of revenue)
        tx.$queryRawUnsafe<NumRow[]>(
          `SELECT COALESCE(SUM(customer_rate_amount) * 0.40, 0) AS total FROM logistics_shipment_orders
           WHERE tenant_id = $3 AND deleted_at IS NULL AND status IN ('DELIVERED','POD_SUBMITTED','CLOSED')
             AND created_at::date BETWEEN $1::date AND $2::date`, startDate, endDate, tenantId
        ).catch(zero),
        zero(),
        // AP Payables actuals by module / cost_centre
        tx.$queryRawUnsafe<GroupRow[]>(
          `SELECT COALESCE(module, cost_centre, 'GENERAL') AS key,
                  COALESCE(SUM(total_amount), 0) AS total
             FROM finance_payables
            WHERE tenant_id = $3 AND deleted_at IS NULL AND status NOT IN ('DRAFT','VOID')
              AND issue_date BETWEEN $1::date AND $2::date
            GROUP BY COALESCE(module, cost_centre, 'GENERAL')`,
          startDate, endDate, tenantId
        ).catch(() => [] as GroupRow[]),
        // Invoice revenue actuals matched on i.cost_centre = b.cost_centre OR ('PC-' || i.module) = b.cost_centre OR i.module = b.cost_centre
        tx.$queryRawUnsafe<GroupRow[]>(
          `SELECT COALESCE(i.cost_centre, i.module, 'GENERAL') AS key,
                  COALESCE(SUM(i.subtotal), 0) AS total
             FROM finance_invoices i
            WHERE i.tenant_id = $3 AND i.deleted_at IS NULL AND i.payment_status NOT IN ('DRAFT','CANCELLED','VOID')
              AND i.issue_date BETWEEN $1::date AND $2::date
            GROUP BY COALESCE(i.cost_centre, i.module, 'GENERAL')`,
          startDate, endDate, tenantId
        ).catch(() => [] as GroupRow[]),
      ]);

      const payableByModule: Record<string, number> = {};
      for (const p of payableActuals) {
        const k = String(p.key ?? 'GENERAL').toUpperCase();
        payableByModule[k] = (payableByModule[k] ?? 0) + Number(p.total ?? 0);
      }

      const revenueByCentre: Record<string, number> = {};
      for (const r of invoiceRevenueByCentre) {
        const k = String(r.key ?? 'GENERAL').toUpperCase();
        revenueByCentre[k] = (revenueByCentre[k] ?? 0) + Number(r.total ?? 0);
        revenueByCentre[`PC-${k}`] = (revenueByCentre[`PC-${k}`] ?? 0) + Number(r.total ?? 0);
      }

      const liveActuals: Record<string, number> = {
        MAINTENANCE:     Math.round((Number(maintenanceActual[0]?.total ?? 0) + (payableByModule['MAINTENANCE'] ?? 0)) * 100) / 100,
        FUEL:            Math.round((Number(fuelActual[0]?.total         ?? 0) + (payableByModule['FUEL'] ?? 0)) * 100) / 100,
        LEASING:         Math.round((Number(leasingActual[0]?.total      ?? 0) + (payableByModule['LEASING'] ?? 0) + (revenueByCentre['LEASING'] ?? 0)) * 100) / 100,
        STAFF_TRANSPORT: Math.round((Number(staffActual[0]?.total        ?? 0) + (payableByModule['STAFF_TRANSPORT'] ?? 0)) * 100) / 100,
        SCHOOL_BUS:      Math.round((Number(schoolActual[0]?.total       ?? 0) + (payableByModule['SCHOOL_BUS'] ?? 0)) * 100) / 100,
        RAC:             Math.round((Number(rentalActual[0]?.total        ?? 0) + (payableByModule['RAC'] ?? 0) + (revenueByCentre['RAC'] ?? 0)) * 100) / 100,
        LOGISTICS:       Math.round((Number(logisticsActual[0]?.total     ?? 0) + (payableByModule['LOGISTICS'] ?? 0) + (revenueByCentre['LOGISTICS'] ?? 0)) * 100) / 100,
        INSURANCE:       Math.round((Number(insuranceActual[0]?.total     ?? 0) + (payableByModule['INSURANCE'] ?? 0)) * 100) / 100,
      };

      // ── Budget entries ─────────────────────────────────────────────────────────
      const budgets = await tx.financeBudget.findMany({
        where: { year, tenantId },
        orderBy: { category: 'asc' },
      }).catch(() => []);

      // Merge live actuals into budget rows
      const enriched = budgets.map(b => {
        const catKey = String(b.category ?? '').toUpperCase();
        const actual =
          liveActuals[catKey] ??
          payableByModule[catKey] ??
          revenueByCentre[catKey] ??
          Number(b.actualAmount ?? 0);
        const budget    = Number(b.budgetAmount);
        const variance  = actual - budget;
        const variancePct = budget > 0 ? Math.round((variance / budget) * 100) : 0;
        return {
          id:           b.id,
          category:     b.category,
          year:         b.year,
          month:        b.month,
          budgetAmount: budget,
          actualAmount: actual,
          variance,
          variancePct,
          isOverBudget: variance > 0,
          utilizationPct: budget > 0 ? Math.min(100, Math.round((actual / budget) * 100)) : 0,
          notes:        b.notes,
          source:       (liveActuals[catKey] != null || payableByModule[catKey] != null || revenueByCentre[catKey] != null) ? 'LIVE' : 'MANUAL',
        };
      });

      const totalBudget = enriched.reduce((s, b) => s + b.budgetAmount, 0);
      const totalActual = enriched.reduce((s, b) => s + b.actualAmount, 0);

      return NextResponse.json({
        budgets: enriched,
        period: { year, month, startDate, endDate },
        summary: {
          totalBudget:    Math.round(totalBudget * 100) / 100,
          totalActual:    Math.round(totalActual * 100) / 100,
          totalVariance:  Math.round((totalActual - totalBudget) * 100) / 100,
          overBudgetCount: enriched.filter(b => b.isOverBudget).length,
        },
      });
  });
}


export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
      const budget = await tx.financeBudget.create({
        data: {
          tenantId,
          category:     body.category,
          year:         body.year ?? new Date().getFullYear(),
          month:        body.month ?? null,
          budgetAmount: body.budgetAmount ?? 0,
          actualAmount: 0,
          notes:        body.notes ?? null,
        },
      });
      return NextResponse.json(budget, { status: 201 });
    } catch (err) {
      console.error('[finance/budgets POST]', err);
      return NextResponse.json({ error: 'Failed to create budget' }, { status: 500 });
    }
  });
}
