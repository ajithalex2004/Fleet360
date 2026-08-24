/**
 * POST /api/finance/budgets/seed?year=YYYY
 *
 * One-time setup: inserts the 8 default budget categories for a given year
 * if that year has no budget rows yet.  Safe to call repeatedly — skips
 * silently when rows already exist.
 *
 * Unlike VAT categories and CoA (which are static reference data), budget
 * rows are year-scoped and tenant-scoped, so they cannot live in a migration.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
const DEFAULT_BUDGETS = [
  { category: 'MAINTENANCE',     budgetAmount: 50000,  notes: 'Vehicle maintenance & repairs' },
  { category: 'FUEL',            budgetAmount: 30000,  notes: 'Fleet fuel costs'               },
  { category: 'LEASING',         budgetAmount: 80000,  notes: 'Vehicle lease payments'         },
  { category: 'STAFF_TRANSPORT', budgetAmount: 20000,  notes: 'Staff bus operations'           },
  { category: 'SCHOOL_BUS',      budgetAmount: 15000,  notes: 'School bus operations'          },
  { category: 'RAC',             budgetAmount: 10000,  notes: 'RAC operating costs'            },
  { category: 'LOGISTICS',       budgetAmount: 40000,  notes: 'Logistics operating costs'      },
  { category: 'INSURANCE',       budgetAmount: 25000,  notes: 'Fleet insurance premiums'       },
];

export async function POST(req: NextRequest) {
  const year = parseInt(
    req.nextUrl.searchParams.get('year') ?? String(new Date().getFullYear())
  );

  const existing = await prisma.financeBudget.count({ where: { year } }).catch(() => -1);

  if (existing > 0) {
    return NextResponse.json(
      { ok: true, seeded: 0, message: `Budget rows for ${year} already exist (${existing} rows)` }
    );
  }

  let seeded = 0;
  for (const d of DEFAULT_BUDGETS) {
    await prisma.financeBudget.create({
      data: { ...d, year, month: null, actualAmount: 0 },
    }).catch(() => {});
    seeded++;
  }

  return NextResponse.json({ ok: true, seeded, year }, { status: 201 });
}
