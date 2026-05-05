/**
 * Period Locks API — /api/finance/period-locks
 * Financial year & accounting period management with hard/soft locks
 * Locked periods prevent new journal entry posting
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const INIT_PERIODS = `
  CREATE TABLE IF NOT EXISTS finance_periods (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    fiscal_year     INTEGER NOT NULL,
    period_number   INTEGER NOT NULL,        -- 1-12 for monthly, 13 for year-end adj
    period_name     TEXT NOT NULL,           -- e.g. "Jan 2025", "Year-End Adjustments"
    period_from     DATE NOT NULL,
    period_to       DATE NOT NULL,
    status          TEXT DEFAULT 'OPEN',     -- OPEN | SOFT_CLOSED | LOCKED | YEAR_END
    locked_at       TIMESTAMPTZ,
    locked_by       TEXT,
    unlock_reason   TEXT,
    notes           TEXT,
    UNIQUE(fiscal_year, period_number)
  );
`;

const INIT_FY = `
  CREATE TABLE IF NOT EXISTS finance_fiscal_years (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    fiscal_year     INTEGER UNIQUE NOT NULL,
    year_start      DATE NOT NULL,
    year_end        DATE NOT NULL,
    status          TEXT DEFAULT 'OPEN',     -- OPEN | YEAR_END_CLOSING | CLOSED
    closed_at       TIMESTAMPTZ,
    closing_je_id   TEXT,                    -- Reference to closing journal entry
    retained_earnings_opening NUMERIC(15,2) DEFAULT 0,
    notes           TEXT
  );
`;

function makePeriodsForYear(year: number): { number: number; name: string; from: string; to: string }[] {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const periods = months.map((m, i) => {
    const mo = i + 1;
    const from = `${year}-${String(mo).padStart(2,'0')}-01`;
    const lastDay = new Date(year, mo, 0).getDate();
    const to = `${year}-${String(mo).padStart(2,'0')}-${lastDay}`;
    return { number: mo, name: `${m} ${year}`, from, to };
  });
  periods.push({ number: 13, name: `Year-End Adjustments ${year}`, from: `${year}-12-31`, to: `${year}-12-31` });
  return periods;
}

export async function GET(req: NextRequest) {
  await prisma.$executeRawUnsafe(INIT_PERIODS).catch(()=>{});
  await prisma.$executeRawUnsafe(INIT_FY).catch(()=>{});

  const sp   = req.nextUrl.searchParams;
  const year = sp.get('year');
  const type = sp.get('type') ?? 'periods';

  if (type === 'fiscal_years') {
    const rows = await prisma.$queryRawUnsafe<Record<string,unknown>[]>(
      `SELECT fy.*,
         COUNT(p.id)::text as period_count,
         SUM(CASE WHEN p.status='LOCKED' THEN 1 ELSE 0 END)::text as locked_periods
       FROM finance_fiscal_years fy
       LEFT JOIN finance_periods p ON p.fiscal_year = fy.fiscal_year
       GROUP BY fy.id ORDER BY fy.fiscal_year DESC`
    ).catch(()=>[]);
    return NextResponse.json({ data: rows });
  }

  // Check if period is locked (used by journal entries API)
  if (type === 'check') {
    const date = sp.get('date');
    if (!date) return NextResponse.json({ locked: false });
    const [period] = await prisma.$queryRawUnsafe<{status:string; period_name:string}[]>(
      `SELECT status, period_name FROM finance_periods WHERE period_from <= $1 AND period_to >= $1`, date
    ).catch(()=>[]);
    return NextResponse.json({
      locked: period?.status === 'LOCKED' || period?.status === 'YEAR_END',
      status: period?.status,
      periodName: period?.period_name,
    });
  }

  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  if (year) { where += ` AND fiscal_year = $1`; params.push(parseInt(year)); }

  const rows = await prisma.$queryRawUnsafe<Record<string,unknown>[]>(
    `SELECT * FROM finance_periods ${where} ORDER BY fiscal_year DESC, period_number ASC`, ...params
  ).catch(()=>[]);
  return NextResponse.json({ data: rows });
}

export async function POST(req: NextRequest) {
  await prisma.$executeRawUnsafe(INIT_PERIODS).catch(()=>{});
  await prisma.$executeRawUnsafe(INIT_FY).catch(()=>{});

  const body = await req.json();

  if (body.action === 'setup_year') {
    // Create fiscal year + all 13 periods
    const { year, notes } = body;
    const periods = makePeriodsForYear(year);

    // Create fiscal year
    await prisma.$executeRawUnsafe(
      `INSERT INTO finance_fiscal_years (fiscal_year, year_start, year_end, notes)
       VALUES ($1,$2,$3,$4) ON CONFLICT (fiscal_year) DO NOTHING`,
      year, `${year}-01-01`, `${year}-12-31`, notes ?? null
    ).catch(()=>{});

    // Create periods
    for (const p of periods) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO finance_periods (fiscal_year, period_number, period_name, period_from, period_to)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (fiscal_year, period_number) DO NOTHING`,
        year, p.number, p.name, p.from, p.to
      ).catch(()=>{});
    }

    return NextResponse.json({ ok: true, year, periodsCreated: periods.length });
  }

  if (body.action === 'lock_period') {
    const { periodId, lockedBy, notes } = body;
    const [row] = await prisma.$queryRawUnsafe<Record<string,unknown>[]>(
      `UPDATE finance_periods SET status='LOCKED', locked_at=NOW(), locked_by=$2, notes=COALESCE($3,notes), updated_at=NOW()
       WHERE id=$1 RETURNING *`, periodId, lockedBy ?? 'System', notes ?? null
    ).catch(()=>[]);
    return NextResponse.json(row ?? {});
  }

  if (body.action === 'soft_close_period') {
    const [row] = await prisma.$queryRawUnsafe<Record<string,unknown>[]>(
      `UPDATE finance_periods SET status='SOFT_CLOSED', updated_at=NOW() WHERE id=$1 RETURNING *`, body.periodId
    ).catch(()=>[]);
    return NextResponse.json(row ?? {});
  }

  if (body.action === 'unlock_period') {
    const { periodId, unlockReason } = body;
    const [row] = await prisma.$queryRawUnsafe<Record<string,unknown>[]>(
      `UPDATE finance_periods SET status='OPEN', locked_at=NULL, unlock_reason=$2, updated_at=NOW()
       WHERE id=$1 RETURNING *`, periodId, unlockReason ?? 'Manually unlocked'
    ).catch(()=>[]);
    return NextResponse.json(row ?? {});
  }

  if (body.action === 'lock_all_periods') {
    // Lock all open/soft-closed periods for a fiscal year
    const { year } = body;
    await prisma.$executeRawUnsafe(
      `UPDATE finance_periods SET status='LOCKED', locked_at=NOW(), locked_by='System', updated_at=NOW()
       WHERE fiscal_year=$1 AND status IN ('OPEN','SOFT_CLOSED')`, year
    ).catch(()=>{});
    return NextResponse.json({ ok: true });
  }

  if (body.action === 'close_fiscal_year') {
    const { year } = body;
    // Lock all periods + close fiscal year
    await prisma.$executeRawUnsafe(
      `UPDATE finance_periods SET status='YEAR_END', locked_at=NOW(), updated_at=NOW() WHERE fiscal_year=$1`, year
    ).catch(()=>{});
    const [row] = await prisma.$queryRawUnsafe<Record<string,unknown>[]>(
      `UPDATE finance_fiscal_years SET status='CLOSED', closed_at=NOW(), updated_at=NOW()
       WHERE fiscal_year=$1 RETURNING *`, year
    ).catch(()=>[]);
    return NextResponse.json(row ?? {});
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
