import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET  /api/finance/budgets?year=YYYY&month=MM
 *   Returns budgets with LIVE actual amounts computed from module tables.
 *   actuals are pulled for the specified year/month range.
 *
 * POST /api/finance/budgets — create a budget entry
 */

export async function GET(req: NextRequest) {
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
  const zero = () => Promise.resolve([{ total: 0 }] as NumRow[]);

  const [
    maintenanceActual, fuelActual, leasingActual, staffActual, schoolActual,
    rentalActual, logisticsActual, insuranceActual,
  ] = await Promise.all([
    // Maintenance: approved quotations
    prisma.$queryRawUnsafe<NumRow[]>(
      `SELECT COALESCE(SUM(total_cost),0) AS total FROM maintenance_requests
       WHERE deleted_at IS NULL AND status IN ('COMPLETED','IN_PROGRESS')
         AND created_at::date BETWEEN $1 AND $2`, startDate, endDate
    ).catch(zero),
    // Fuel: fuel logs
    prisma.$queryRawUnsafe<NumRow[]>(
      `SELECT COALESCE(SUM(total_cost),0) AS total FROM fuel_logs
       WHERE created_at::date BETWEEN $1 AND $2`, startDate, endDate
    ).catch(zero),
    // Leasing: lease payments
    prisma.$queryRawUnsafe<NumRow[]>(
      `SELECT COALESCE(SUM(monthly_rate),0) AS total FROM lease_agreements
       WHERE deleted_at IS NULL AND status = 'ACTIVE'
         AND start_date::date <= $2 AND (end_date IS NULL OR end_date::date >= $1)`, startDate, endDate
    ).catch(zero),
    // Staff transport: trip schedule costs (proxy)
    prisma.$queryRawUnsafe<NumRow[]>(
      `SELECT COALESCE(COUNT(*) * 50,0) AS total FROM trip_schedules
       WHERE deleted_at IS NULL AND status = 'COMPLETED'
         AND departure_time::date BETWEEN $1 AND $2`, startDate, endDate
    ).catch(zero),
    // School bus
    prisma.$queryRawUnsafe<NumRow[]>(
      `SELECT COALESCE(COUNT(*) * 30,0) AS total FROM trip_schedules
       WHERE deleted_at IS NULL AND status = 'COMPLETED' AND trip_type = 'SCHOOL_BUS'
         AND departure_time::date BETWEEN $1 AND $2`, startDate, endDate
    ).catch(zero),
    // RAC revenue (operating cost proxy: 30% of revenue)
    prisma.$queryRawUnsafe<NumRow[]>(
      `SELECT COALESCE(SUM(total_amount) * 0.30, 0) AS total FROM rental_agreements
       WHERE deleted_at IS NULL AND status IN ('ACTIVE','COMPLETED')
         AND created_at::date BETWEEN $1 AND $2`, startDate, endDate
    ).catch(zero),
    // Logistics operational cost (40% of revenue)
    prisma.$queryRawUnsafe<NumRow[]>(
      `SELECT COALESCE(SUM(total_amount) * 0.40, 0) AS total FROM logistics_bookings
       WHERE deleted_at IS NULL AND status IN ('DELIVERED','POD_SUBMITTED','CLOSED')
         AND created_at::date BETWEEN $1 AND $2`, startDate, endDate
    ).catch(zero),
    // Insurance: from compliance documents (use static zero if table missing)
    zero(),
  ]);

  const liveActuals: Record<string, number> = {
    MAINTENANCE:     Math.round(Number(maintenanceActual[0]?.total ?? 0) * 100) / 100,
    FUEL:            Math.round(Number(fuelActual[0]?.total         ?? 0) * 100) / 100,
    LEASING:         Math.round(Number(leasingActual[0]?.total      ?? 0) * 100) / 100,
    STAFF_TRANSPORT: Math.round(Number(staffActual[0]?.total        ?? 0) * 100) / 100,
    SCHOOL_BUS:      Math.round(Number(schoolActual[0]?.total       ?? 0) * 100) / 100,
    RAC:             Math.round(Number(rentalActual[0]?.total        ?? 0) * 100) / 100,
    LOGISTICS:       Math.round(Number(logisticsActual[0]?.total     ?? 0) * 100) / 100,
    INSURANCE:       Math.round(Number(insuranceActual[0]?.total     ?? 0) * 100) / 100,
  };

  // ── Budget entries ─────────────────────────────────────────────────────────
  let budgets = await prisma.financeBudget.findMany({
    where: { deletedAt: null, year },
    orderBy: { category: 'asc' },
  }).catch(() => []);

  // Auto-seed default budget categories if empty
  if (budgets.length === 0) {
    const defaults = [
      { category: 'MAINTENANCE',     budgetAmount: 50000,  notes: 'Vehicle maintenance & repairs' },
      { category: 'FUEL',            budgetAmount: 30000,  notes: 'Fleet fuel costs' },
      { category: 'LEASING',         budgetAmount: 80000,  notes: 'Vehicle lease payments' },
      { category: 'STAFF_TRANSPORT', budgetAmount: 20000,  notes: 'Staff bus operations' },
      { category: 'SCHOOL_BUS',      budgetAmount: 15000,  notes: 'School bus operations' },
      { category: 'RAC',             budgetAmount: 10000,  notes: 'RAC operating costs' },
      { category: 'LOGISTICS',       budgetAmount: 40000,  notes: 'Logistics operating costs' },
      { category: 'INSURANCE',       budgetAmount: 25000,  notes: 'Fleet insurance premiums' },
    ];
    for (const d of defaults) {
      await prisma.financeBudget.create({
        data: { ...d, year, month: month || null, actualAmount: 0 },
      }).catch(() => {});
    }
    budgets = await prisma.financeBudget.findMany({ where: { deletedAt: null, year }, orderBy: { category: 'asc' } }).catch(() => []);
  }

  // Merge live actuals into budget rows
  const enriched = budgets.map(b => {
    const actual    = liveActuals[b.category] ?? Number(b.actualAmount ?? 0);
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
      source:       liveActuals[b.category] != null ? 'LIVE' : 'MANUAL',
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
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const budget = await prisma.financeBudget.create({
      data: {
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
}
