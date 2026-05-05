import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const rowToCamel = (r: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [toCamel(k), v]));

export async function GET(_req: NextRequest) {
  try {
    const [monthlyRows, currentMonthRows] = await Promise.all([
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT
           DATE_TRUNC('month', fuel_date) AS month,
           SUM(liters) AS total_liters,
           SUM(total_cost) AS total_cost,
           AVG(cost_per_liter) AS avg_cost_per_liter,
           COUNT(*) AS transactions
         FROM fuel_logs
         GROUP BY DATE_TRUNC('month', fuel_date)
         ORDER BY month DESC
         LIMIT 12`,
      ),
      prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT
           SUM(liters) AS total_liters,
           SUM(total_cost) AS total_cost,
           AVG(cost_per_liter) AS avg_cost_per_liter,
           COUNT(*) AS transactions
         FROM fuel_logs
         WHERE DATE_TRUNC('month', fuel_date) = DATE_TRUNC('month', NOW())`,
      ),
    ]);

    return NextResponse.json({
      monthly: monthlyRows.map(rowToCamel),
      currentMonth: currentMonthRows.length > 0 ? rowToCamel(currentMonthRows[0]) : null,
    });
  } catch (error) {
    console.error('Error fetching fuel log summary:', error);
    return NextResponse.json({ error: 'Failed to fetch fuel log summary' }, { status: 500 });
  }
}
