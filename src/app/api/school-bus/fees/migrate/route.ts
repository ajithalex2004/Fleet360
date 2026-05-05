/**
 * POST /api/school-bus/fees/migrate
 *
 * One-time, non-destructive migration:
 *   school_bus_fees → finance_invoices (module = 'SCHOOL_BUS')
 *
 * Safe to run multiple times — uses invoice_number as the idempotency key.
 * Existing finance_invoices with the same invoice_number are skipped.
 *
 * Mapping:
 *   school_bus_fees.invoice_no        → finance_invoices.invoice_number
 *   school_bus_fees.student_name      → finance_invoices.client_name
 *   school_bus_fees.parent_email      → finance_invoices.client_email
 *   school_bus_fees.parent_phone      → finance_invoices.client_phone
 *   school_bus_fees.total_amount      → finance_invoices.total_amount
 *   school_bus_fees.net_amount        → finance_invoices.subtotal
 *   school_bus_fees.vat_amount        → finance_invoices.vat_amount
 *   school_bus_fees.vat_rate          → finance_invoices.vat_rate
 *   school_bus_fees.discount_amount   → finance_invoices.discount_amount
 *   school_bus_fees.status            → finance_invoices.payment_status
 *   school_bus_fees.paid_amount       → finance_invoices.paid_amount
 *   school_bus_fees.due_date          → finance_invoices.due_date
 *   school_bus_fees.allocation_id     → finance_invoices.reference_id
 *   'SCHOOL_BUS_ALLOCATION'           → finance_invoices.reference_type
 *   'SCHOOL_BUS'                      → finance_invoices.module
 *   'TRANSPORT_EDU'                   → finance_invoices.service_type
 */
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type Row = Record<string, unknown>;

function toNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'object' && v !== null && 'toNumber' in v) return (v as { toNumber(): number }).toNumber();
  return Number(v);
}

// Map school_bus_fees status → finance_invoices payment_status
function mapStatus(s: string): string {
  const m: Record<string, string> = {
    UNPAID:    'SENT',
    PAID:      'PAID',
    PARTIAL:   'PARTIAL',
    OVERDUE:   'OVERDUE',
    WAIVED:    'CANCELLED',
    CANCELLED: 'CANCELLED',
  };
  return m[s] ?? 'DRAFT';
}

export async function POST() {
  try {
    // Check if school_bus_fees table exists
    const [tableCheck] = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'school_bus_fees'
      ) AS exists`
    ).catch(() => [{ exists: false }]);

    if (!tableCheck?.exists) {
      return NextResponse.json({
        ok: true, migrated: 0, skipped: 0,
        message: 'school_bus_fees table does not exist — nothing to migrate.',
      });
    }

    // Ensure finance_invoices exists (the GET call auto-creates it)
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS finance_invoices (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        invoice_number   TEXT NOT NULL UNIQUE,
        client_name      TEXT NOT NULL,
        client_email     TEXT,
        client_phone     TEXT,
        client_address   TEXT,
        service_type     TEXT NOT NULL DEFAULT 'GENERAL',
        module           TEXT NOT NULL DEFAULT 'GENERAL',
        description      TEXT,
        line_items       JSONB NOT NULL DEFAULT '[]',
        subtotal         NUMERIC(14,2) NOT NULL DEFAULT 0,
        discount_amount  NUMERIC(14,2) NOT NULL DEFAULT 0,
        vat_rate         NUMERIC(5,2)  NOT NULL DEFAULT 5,
        vat_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
        total_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
        paid_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
        currency         TEXT NOT NULL DEFAULT 'AED',
        issue_date       DATE NOT NULL DEFAULT CURRENT_DATE,
        due_date         DATE,
        payment_status   TEXT NOT NULL DEFAULT 'DRAFT',
        notes            TEXT,
        reference_id     UUID,
        reference_type   TEXT,
        created_by       TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at       TIMESTAMPTZ
      )
    `).catch(() => {});

    // Fetch all school_bus_fees
    const fees = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT * FROM school_bus_fees ORDER BY created_at ASC`
    ).catch(() => [] as Row[]);

    let migrated = 0;
    let skipped  = 0;

    for (const fee of fees) {
      const invoiceNo = String(fee.invoice_no ?? fee.id);

      // Check if already migrated
      const [existing] = await prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM finance_invoices WHERE invoice_number = $1`, invoiceNo,
      ).catch(() => [] as { id: string }[]);

      if (existing?.id) { skipped++; continue; }

      const netAmt   = toNum(fee.net_amount ?? fee.base_amount);
      const vatAmt   = toNum(fee.vat_amount);
      const totalAmt = toNum(fee.total_amount);
      const paidAmt  = toNum(fee.paid_amount);
      const discAmt  = toNum(fee.discount_amount);
      const vatRate  = toNum(fee.vat_rate);

      // Build description from school bus metadata
      const descParts = [
        fee.route_name   ? `Route: ${fee.route_name}` : null,
        fee.bus_mode     ? `Mode: ${String(fee.bus_mode).replace(/_/g,' ')}` : null,
        fee.period_label ? `Period: ${fee.period_label}` : null,
        fee.student_grade? `Grade: ${fee.student_grade}` : null,
      ].filter(Boolean).join(' · ');

      // Build a single line item representing the transport fee
      const lineItems = [{
        description: descParts || 'School Bus Transport Fee',
        qty: 1,
        unitPrice: netAmt + discAmt, // base before discount
      }];

      await prisma.$executeRawUnsafe(`
        INSERT INTO finance_invoices
          (invoice_number, client_name, client_email, client_phone,
           service_type, module, description,
           line_items, subtotal, discount_amount, vat_rate, vat_amount, total_amount,
           paid_amount, currency, issue_date, due_date, payment_status,
           notes, reference_id, reference_type, created_by, created_at, updated_at)
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
        ON CONFLICT (invoice_number) DO NOTHING
      `,
        invoiceNo,
        String(fee.student_name ?? 'Unknown Student'),
        fee.parent_email  ? String(fee.parent_email)  : null,
        fee.parent_phone  ? String(fee.parent_phone)  : null,
        'TRANSPORT_EDU',
        'SCHOOL_BUS',
        descParts || null,
        JSON.stringify(lineItems),
        netAmt + discAmt,   // subtotal = base amount before discount
        discAmt,
        vatRate,
        vatAmt,
        totalAmt,
        paidAmt,
        'AED',
        fee.created_at ? new Date(fee.created_at as string).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
        fee.due_date   ? new Date(fee.due_date as string).toISOString().slice(0, 10)   : null,
        mapStatus(String(fee.status ?? 'UNPAID')),
        fee.notes ? String(fee.notes) : null,
        fee.allocation_id ? String(fee.allocation_id) : null,
        'SCHOOL_BUS_ALLOCATION',
        'migration:school_bus_fees',
        fee.created_at ? new Date(fee.created_at as string).toISOString() : new Date().toISOString(),
        fee.updated_at ? new Date(fee.updated_at as string).toISOString() : new Date().toISOString(),
      );

      migrated++;
    }

    return NextResponse.json({
      ok: true,
      migrated,
      skipped,
      total: fees.length,
      message: `Migration complete. ${migrated} records migrated to finance_invoices (module=SCHOOL_BUS). ${skipped} already existed.`,
    });
  } catch (err) {
    console.error('[school-bus/fees/migrate POST]', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
