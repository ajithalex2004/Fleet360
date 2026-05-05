import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET  /api/finance/vat  — returns { summary, returns }
 *   summary: auto-computed from all module revenue tables for current/selected quarter
 *   returns: list of VAT return records
 *
 * POST /api/finance/vat  — create a new VAT return record
 */

function quarterRange(year: number, quarter: number) {
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth   = startMonth + 2;
  const start = `${year}-${String(startMonth).padStart(2,'0')}-01`;
  const endDate = new Date(year, endMonth, 0);
  const end = endDate.toISOString().split('T')[0];
  return { start, end };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const now = new Date();
  const year    = parseInt(searchParams.get('year')    ?? String(now.getFullYear()));
  const quarter = parseInt(searchParams.get('quarter') ?? String(Math.ceil((now.getMonth() + 1) / 3)));
  const { start, end } = quarterRange(year, quarter);

  // ── Auto-calculate VAT from module revenue tables ──────────────────────────
  type RevRow = { total: number | null };
  const zero = () => Promise.resolve([{ total: 0 }] as RevRow[]);

  const [
    logisticsRev, racRev, leasingRev, financeInvRev,
    logisticsTax, racTax, leasingTax, financeInvTax,
  ] = await Promise.all([
    // Standard-rated revenue (5% VAT applies)
    prisma.$queryRawUnsafe<RevRow[]>(
      `SELECT COALESCE(SUM(total_amount),0) AS total FROM logistics_bookings
       WHERE deleted_at IS NULL AND status IN ('DELIVERED','POD_SUBMITTED','CLOSED')
         AND created_at::date BETWEEN $1 AND $2`, start, end
    ).catch(zero),
    prisma.$queryRawUnsafe<RevRow[]>(
      `SELECT COALESCE(SUM(total_amount),0) AS total FROM rental_agreements
       WHERE deleted_at IS NULL AND status IN ('ACTIVE','COMPLETED')
         AND created_at::date BETWEEN $1 AND $2`, start, end
    ).catch(zero),
    prisma.$queryRawUnsafe<RevRow[]>(
      `SELECT COALESCE(SUM(monthly_rate),0) AS total FROM lease_agreements
       WHERE deleted_at IS NULL AND status IN ('ACTIVE','COMPLETED')
         AND created_at::date BETWEEN $1 AND $2`, start, end
    ).catch(zero),
    // Finance invoices VAT base (subtotal after discount)
    prisma.$queryRawUnsafe<RevRow[]>(
      `SELECT COALESCE(SUM(total_amount - vat_amount),0) AS total FROM finance_invoices
       WHERE deleted_at IS NULL AND payment_status NOT IN ('DRAFT','CANCELLED')
         AND issue_date BETWEEN $1 AND $2`, start, end
    ).catch(zero),

    // VAT collected
    prisma.$queryRawUnsafe<RevRow[]>(
      `SELECT COALESCE(SUM(total_amount * 0.05 / 1.05),0) AS total FROM logistics_bookings
       WHERE deleted_at IS NULL AND status IN ('DELIVERED','POD_SUBMITTED','CLOSED')
         AND created_at::date BETWEEN $1 AND $2`, start, end
    ).catch(zero),
    prisma.$queryRawUnsafe<RevRow[]>(
      `SELECT COALESCE(SUM(total_amount * 0.05 / 1.05),0) AS total FROM rental_agreements
       WHERE deleted_at IS NULL AND status IN ('ACTIVE','COMPLETED')
         AND created_at::date BETWEEN $1 AND $2`, start, end
    ).catch(zero),
    prisma.$queryRawUnsafe<RevRow[]>(
      `SELECT COALESCE(SUM(monthly_rate * 0.05),0) AS total FROM lease_agreements
       WHERE deleted_at IS NULL AND status IN ('ACTIVE','COMPLETED')
         AND created_at::date BETWEEN $1 AND $2`, start, end
    ).catch(zero),
    prisma.$queryRawUnsafe<RevRow[]>(
      `SELECT COALESCE(SUM(vat_amount),0) AS total FROM finance_invoices
       WHERE deleted_at IS NULL AND payment_status NOT IN ('DRAFT','CANCELLED')
         AND issue_date BETWEEN $1 AND $2`, start, end
    ).catch(zero),
  ]);

  const totalRevenue = [logisticsRev, racRev, leasingRev, financeInvRev]
    .reduce((sum, r) => sum + Number(r[0]?.total ?? 0), 0);
  const totalVatCollected = [logisticsTax, racTax, leasingTax, financeInvTax]
    .reduce((sum, r) => sum + Number(r[0]?.total ?? 0), 0);

  // Input VAT (from maintenance spend as proxy)
  type InputVatRow = { total: number | null };
  const [inputVatRow] = await prisma.$queryRawUnsafe<InputVatRow[]>(
    `SELECT COALESCE(SUM(total_cost),0) AS total FROM fuel_logs
     WHERE created_at::date BETWEEN $1 AND $2`, start, end
  ).catch(() => [{ total: 0 }]);
  const inputVat = Math.round(Number(inputVatRow?.total ?? 0) * 0.05 * 100) / 100;

  const netVat = Math.round((totalVatCollected - inputVat) * 100) / 100;

  const summary = {
    period: `Q${quarter} ${year}`,
    periodStart: start,
    periodEnd:   end,
    totalRevenue:      Math.round(totalRevenue * 100) / 100,
    totalVatCollected: Math.round(totalVatCollected * 100) / 100,
    inputVat,
    netVatPayable: Math.max(0, netVat),
    vatRefundable: netVat < 0 ? Math.abs(netVat) : 0,
    breakdown: {
      logistics: { revenue: Math.round(Number(logisticsRev[0]?.total ?? 0) * 100) / 100, vat: Math.round(Number(logisticsTax[0]?.total ?? 0) * 100) / 100 },
      rac:       { revenue: Math.round(Number(racRev[0]?.total      ?? 0) * 100) / 100, vat: Math.round(Number(racTax[0]?.total      ?? 0) * 100) / 100 },
      leasing:   { revenue: Math.round(Number(leasingRev[0]?.total  ?? 0) * 100) / 100, vat: Math.round(Number(leasingTax[0]?.total  ?? 0) * 100) / 100 },
      invoices:  { revenue: Math.round(Number(financeInvRev[0]?.total ?? 0) * 100) / 100, vat: Math.round(Number(financeInvTax[0]?.total ?? 0) * 100) / 100 },
    },
  };

  // ── VAT returns list ───────────────────────────────────────────────────────
  const returns = await prisma.vatReturn.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' },
  }).catch(() => []);

  return NextResponse.json({ summary, returns });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const vatReturn = await prisma.vatReturn.create({
      data: {
        periodStart:      new Date(body.periodStart),
        periodEnd:        new Date(body.periodEnd),
        totalSales:       body.totalSales       ?? 0,
        totalPurchases:   body.totalPurchases   ?? 0,
        outputTax:        body.outputTax        ?? 0,
        inputTax:         body.inputTax         ?? 0,
        netTax:           body.netTax           ?? 0,
        status:           body.status           ?? 'DRAFT',
        submissionDate:   body.submissionDate   ? new Date(body.submissionDate) : null,
        paymentDate:      body.paymentDate      ? new Date(body.paymentDate) : null,
        notes:            body.notes            ?? null,
      },
    });
    return NextResponse.json(vatReturn, { status: 201 });
  } catch (err) {
    console.error('[finance/vat POST]', err);
    return NextResponse.json({ error: 'Failed to create VAT return' }, { status: 500 });
  }
}
