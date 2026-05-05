/**
 * Tax Engine API — /api/finance/tax
 * Manages UAE VAT categories, FTA audit trail, Input/Output tax tracking
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const INIT_CATEGORIES = `
  CREATE TABLE IF NOT EXISTS finance_tax_categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    code        TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    rate        NUMERIC(5,2) NOT NULL DEFAULT 0,
    description TEXT,
    is_default  BOOLEAN DEFAULT FALSE,
    is_active   BOOLEAN DEFAULT TRUE,
    fta_code    TEXT
  );
`;

const INIT_AUDIT = `
  CREATE TABLE IF NOT EXISTS finance_vat_audit_logs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    action       TEXT NOT NULL,
    entity_type  TEXT,
    entity_id    TEXT,
    performed_by TEXT,
    details      JSONB,
    ip_address   TEXT,
    notes        TEXT
  );
`;

const DEFAULT_CATEGORIES = [
  { code: 'STANDARD',     name: 'Standard Rate',    rate: 5.00,  description: 'Standard UAE VAT at 5%',                    fta_code: '1a', is_default: true  },
  { code: 'ZERO',         name: 'Zero-Rated',       rate: 0.00,  description: 'Inter-emirate transport, exports, medicines', fta_code: '1b', is_default: false },
  { code: 'EXEMPT',       name: 'Exempt',            rate: 0.00,  description: 'Bare land, residential properties, local transport (some conditions)', fta_code: '1c', is_default: false },
  { code: 'OUT_OF_SCOPE', name: 'Out of Scope',      rate: 0.00,  description: 'Outside UAE VAT scope entirely',             fta_code: 'OOS', is_default: false },
];

type TaxRow = Record<string, unknown>;

async function ensureDefaults() {
  const [{ count }] = await prisma.$queryRawUnsafe<{ count: string }[]>(
    `SELECT COUNT(*)::text as count FROM finance_tax_categories`
  ).catch(() => [{ count: '0' }]);

  if (parseInt(count) === 0) {
    for (const cat of DEFAULT_CATEGORIES) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO finance_tax_categories (code,name,rate,description,fta_code,is_default)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (code) DO NOTHING`,
        cat.code, cat.name, cat.rate, cat.description, cat.fta_code, cat.is_default
      ).catch(() => {});
    }
  }
}

export async function GET(req: NextRequest) {
  await prisma.$executeRawUnsafe(INIT_CATEGORIES).catch(() => {});
  await prisma.$executeRawUnsafe(INIT_AUDIT).catch(() => {});
  await ensureDefaults();

  const sp = req.nextUrl.searchParams;
  const type = sp.get('type'); // categories | audit | summary

  if (type === 'audit') {
    const rows = await prisma.$queryRawUnsafe<TaxRow[]>(
      `SELECT * FROM finance_vat_audit_logs ORDER BY created_at DESC LIMIT 100`
    ).catch(() => []);
    return NextResponse.json({ data: rows });
  }

  if (type === 'summary') {
    const year    = sp.get('year')    ?? new Date().getFullYear().toString();
    const quarter = sp.get('quarter') ?? Math.ceil((new Date().getMonth() + 1) / 3).toString();
    const q = parseInt(quarter);
    const y = parseInt(year);
    const startMonth = (q - 1) * 3 + 1;
    const endMonth   = q * 3;
    const startDate  = `${y}-${String(startMonth).padStart(2,'0')}-01`;
    const endDateObj = new Date(y, endMonth, 0);
    const endDate    = endDateObj.toISOString().slice(0, 10);

    // Output VAT (from finance_invoices)
    const [outputRow] = await prisma.$queryRawUnsafe<{ total: string; count: string }[]>(
      `SELECT COALESCE(SUM(vat_amount),0)::text as total, COUNT(*)::text as count
         FROM finance_invoices WHERE deleted_at IS NULL
           AND payment_status NOT IN ('DRAFT','CANCELLED')
           AND issue_date BETWEEN $1 AND $2`,
      startDate, endDate
    ).catch(() => [{ total: '0', count: '0' }]);

    // Output VAT from logistics
    const [logRow] = await prisma.$queryRawUnsafe<{ total: string }[]>(
      `SELECT COALESCE(SUM(total_amount * 0.05 / 1.05),0)::text as total
         FROM logistics_bookings WHERE deleted_at IS NULL
           AND status IN ('DELIVERED','POD_SUBMITTED','CLOSED')
           AND created_at::date BETWEEN $1 AND $2`,
      startDate, endDate
    ).catch(() => [{ total: '0' }]);

    // Output VAT from rental invoices
    const [racRow] = await prisma.$queryRawUnsafe<{ total: string }[]>(
      `SELECT COALESCE(SUM(total_amount * 0.05 / 1.05),0)::text as total
         FROM rental_invoices WHERE deleted_at IS NULL
           AND created_at::date BETWEEN $1 AND $2`,
      startDate, endDate
    ).catch(() => [{ total: '0' }]);

    // Input VAT from fuel logs
    const [fuelRow] = await prisma.$queryRawUnsafe<{ total: string }[]>(
      `SELECT COALESCE(SUM(total_cost * 0.05 / 1.05),0)::text as total
         FROM fuel_logs WHERE created_at::date BETWEEN $1 AND $2`,
      startDate, endDate
    ).catch(() => [{ total: '0' }]);

    // Input VAT from approved maintenance
    const [mainRow] = await prisma.$queryRawUnsafe<{ total: string }[]>(
      `SELECT COALESCE(SUM(total_cost * 0.05 / 1.05),0)::text as total
         FROM maintenance_requests WHERE deleted_at IS NULL
           AND status IN ('COMPLETED')
           AND created_at::date BETWEEN $1 AND $2`,
      startDate, endDate
    ).catch(() => [{ total: '0' }]);

    const outputVat = parseFloat(outputRow?.total ?? '0')
                    + parseFloat(logRow?.total   ?? '0')
                    + parseFloat(racRow?.total   ?? '0');
    const inputVat  = parseFloat(fuelRow?.total ?? '0')
                    + parseFloat(mainRow?.total ?? '0');
    const netVat    = outputVat - inputVat;

    // Category breakdown
    const breakdown = await prisma.$queryRawUnsafe<{ code: string; name: string; rate: string }[]>(
      `SELECT code, name, rate::text FROM finance_tax_categories WHERE is_active = TRUE ORDER BY rate DESC`
    ).catch(() => []);

    return NextResponse.json({
      period: { year: y, quarter: q, startDate, endDate },
      output: { vat: Math.round(outputVat * 100) / 100, invoices: parseInt(outputRow?.count ?? '0') },
      input:  { vat: Math.round(inputVat  * 100) / 100 },
      net:    { vat: Math.round(netVat    * 100) / 100, payable: netVat > 0 },
      categories: breakdown,
    });
  }

  // Default: return categories
  const categories = await prisma.$queryRawUnsafe<TaxRow[]>(
    `SELECT * FROM finance_tax_categories ORDER BY rate DESC, code`
  ).catch(() => []);
  return NextResponse.json({ data: categories });
}

export async function POST(req: NextRequest) {
  await prisma.$executeRawUnsafe(INIT_CATEGORIES).catch(() => {});
  const body = await req.json();

  if (body.type === 'audit_log') {
    await prisma.$executeRawUnsafe(
      `INSERT INTO finance_vat_audit_logs (action, entity_type, entity_id, performed_by, details, notes)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
      body.action, body.entityType ?? null, body.entityId ?? null,
      body.performedBy ?? null, JSON.stringify(body.details ?? {}), body.notes ?? null
    ).catch(() => {});
    return NextResponse.json({ ok: true }, { status: 201 });
  }

  // Create or update tax category
  const [row] = await prisma.$queryRawUnsafe<TaxRow[]>(
    `INSERT INTO finance_tax_categories (code, name, rate, description, fta_code, is_default, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (code) DO UPDATE SET name=$2, rate=$3, description=$4, fta_code=$5, is_default=$6, is_active=$7, updated_at=NOW()
     RETURNING *`,
    body.code, body.name, body.rate ?? 0, body.description ?? null,
    body.ftaCode ?? null, body.isDefault ?? false, body.isActive ?? true,
  ).catch(() => []);

  if (!row) return NextResponse.json({ error: 'Failed to save tax category' }, { status: 500 });
  return NextResponse.json(row, { status: 201 });
}
