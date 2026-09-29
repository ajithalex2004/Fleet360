export const dynamic = 'force-dynamic';

/**
 * Period Locks API — /api/finance/period-locks
 * Financial year & accounting period management with hard/soft locks
 * Locked periods prevent new journal entry posting
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
// Tables come from migrations (the last: 20261005090000_finance_tenant_tables).
// A request runs no DDL: the runtime role may not create tables, and the
// failed statement aborted the request's transaction, so every query after
// it failed too.

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

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      const sp   = req.nextUrl.searchParams;
      const year = sp.get('year');
      const type = sp.get('type') ?? 'periods';

      if (type === 'fiscal_years') {
        const rows = await tx.$queryRawUnsafe<Record<string,unknown>[]>(
          `SELECT fy.*,
             COUNT(p.id)::text as period_count,
             SUM(CASE WHEN p.status='LOCKED' THEN 1 ELSE 0 END)::text as locked_periods
           FROM finance_fiscal_years fy
           LEFT JOIN finance_periods p ON p.fiscal_year = fy.fiscal_year AND p.tenant_id = fy.tenant_id
           WHERE fy.tenant_id = $1
           GROUP BY fy.id ORDER BY fy.fiscal_year DESC`,
          tenantId,
        ).catch(()=>[]);
        return NextResponse.json({ data: rows });
      }

      // Check if period is locked (used by journal entries API)
      if (type === 'check') {
        const date = sp.get('date');
        if (!date) return NextResponse.json({ locked: false });
        const [period] = await tx.$queryRawUnsafe<{status:string; period_name:string}[]>(
          `SELECT status, period_name FROM finance_periods
            WHERE tenant_id = $2 AND period_from <= $1::date AND period_to >= $1::date`, date, tenantId
        ).catch(()=>[]);
        return NextResponse.json({
          locked: period?.status === 'LOCKED' || period?.status === 'YEAR_END',
          status: period?.status,
          periodName: period?.period_name,
        });
      }

      let where = 'WHERE tenant_id = $1';
      const params: unknown[] = [tenantId];
      if (year) { where += ` AND fiscal_year = $2`; params.push(parseInt(year)); }

      const rows = await tx.$queryRawUnsafe<Record<string,unknown>[]>(
        `SELECT * FROM finance_periods ${where} ORDER BY fiscal_year DESC, period_number ASC`, ...params
      ).catch(()=>[]);
      return NextResponse.json({ data: rows });
  });
}

export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {

      const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);

      if (body.action === 'setup_year') {
        // Create fiscal year + all 13 periods
        const { year, notes } = body;
        const periods = makePeriodsForYear(year);

        // Create fiscal year
        await tx.$executeRawUnsafe(
          `INSERT INTO finance_fiscal_years (fiscal_year, year_start, year_end, notes, tenant_id)
           VALUES ($1,$2::date,$3::date,$4,$5) ON CONFLICT (tenant_id, fiscal_year) DO NOTHING`,
          year, `${year}-01-01`, `${year}-12-31`, notes ?? null, tenantId
        ).catch(()=>{});

        // Create periods
        for (const p of periods) {
          await tx.$executeRawUnsafe(
            `INSERT INTO finance_periods (fiscal_year, period_number, period_name, period_from, period_to, tenant_id)
             VALUES ($1,$2,$3,$4::date,$5::date,$6) ON CONFLICT (tenant_id, fiscal_year, period_number) DO NOTHING`,
            year, p.number, p.name, p.from, p.to, tenantId
          ).catch(()=>{});
        }

        return NextResponse.json({ ok: true, year, periodsCreated: periods.length });
      }

      if (body.action === 'lock_period') {
        const { periodId, lockedBy, notes } = body;
        const [row] = await tx.$queryRawUnsafe<Record<string,unknown>[]>(
          `UPDATE finance_periods SET status='LOCKED', locked_at=NOW(), locked_by=$2, notes=COALESCE($3,notes), updated_at=NOW()
           WHERE id::text=$1 AND tenant_id=$4 RETURNING *`, periodId, lockedBy ?? 'System', notes ?? null, tenantId
        ).catch(()=>[]);
        return NextResponse.json(row ?? {});
      }

      if (body.action === 'soft_close_period') {
        const [row] = await tx.$queryRawUnsafe<Record<string,unknown>[]>(
          `UPDATE finance_periods SET status='SOFT_CLOSED', updated_at=NOW() WHERE id::text=$1 AND tenant_id=$2 RETURNING *`, body.periodId, tenantId
        ).catch(()=>[]);
        return NextResponse.json(row ?? {});
      }

      if (body.action === 'unlock_period') {
        const { periodId, unlockReason } = body;
        const [row] = await tx.$queryRawUnsafe<Record<string,unknown>[]>(
          `UPDATE finance_periods SET status='OPEN', locked_at=NULL, unlock_reason=$2, updated_at=NOW()
           WHERE id::text=$1 AND tenant_id=$3 RETURNING *`, periodId, unlockReason ?? 'Manually unlocked', tenantId
        ).catch(()=>[]);
        return NextResponse.json(row ?? {});
      }

      if (body.action === 'lock_all_periods') {
        // Lock all open/soft-closed periods for a fiscal year
        const { year } = body;
        await tx.$executeRawUnsafe(
          `UPDATE finance_periods SET status='LOCKED', locked_at=NOW(), locked_by='System', updated_at=NOW()
           WHERE tenant_id=$2 AND fiscal_year=$1 AND status IN ('OPEN','SOFT_CLOSED')`, year, tenantId
        ).catch(()=>{});
        return NextResponse.json({ ok: true });
      }

      if (body.action === 'close_fiscal_year') {
        const { year } = body;
        // Lock all periods + close fiscal year
        await tx.$executeRawUnsafe(
          `UPDATE finance_periods SET status='YEAR_END', locked_at=NOW(), updated_at=NOW() WHERE tenant_id=$2 AND fiscal_year=$1`, year, tenantId
        ).catch(()=>{});
        const [row] = await tx.$queryRawUnsafe<Record<string,unknown>[]>(
          `UPDATE finance_fiscal_years SET status='CLOSED', closed_at=NOW(), updated_at=NOW()
           WHERE tenant_id=$2 AND fiscal_year=$1 RETURNING *`, year, tenantId
        ).catch(()=>[]);
        return NextResponse.json(row ?? {});
      }

      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  });
}

