/**
 * Tax Engine API — /api/finance/tax
 * Manages UAE VAT categories, FTA audit trail, Input/Output tax tracking
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureOperationalTenantColumn, recordOperationalChange, requireOperationalContext } from '@/lib/cross-module-governance';

const GLOBAL_TENANT = '__global__';

const INIT_CATEGORIES = `
  CREATE TABLE IF NOT EXISTS finance_tax_categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    code        TEXT NOT NULL,
    name        TEXT NOT NULL,
    rate        NUMERIC(5,2) NOT NULL DEFAULT 0,
    description TEXT,
    is_default  BOOLEAN DEFAULT FALSE,
    is_active   BOOLEAN DEFAULT TRUE,
    fta_code    TEXT,
    tenant_id   TEXT
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
    notes        TEXT,
    tenant_id    TEXT
  );
`;

const DEFAULT_CATEGORIES = [
  { code: 'STANDARD', name: 'Standard Rate', rate: 5.00, description: 'Standard UAE VAT at 5%', fta_code: '1a', is_default: true },
  { code: 'ZERO', name: 'Zero-Rated', rate: 0.00, description: 'Inter-emirate transport, exports, medicines', fta_code: '1b', is_default: false },
  { code: 'EXEMPT', name: 'Exempt', rate: 0.00, description: 'Bare land, residential properties, local transport (some conditions)', fta_code: '1c', is_default: false },
  { code: 'OUT_OF_SCOPE', name: 'Out of Scope', rate: 0.00, description: 'Outside UAE VAT scope entirely', fta_code: 'OOS', is_default: false },
];

type TaxRow = Record<string, unknown>;

async function ensureTaxSchema() {
  await prisma.$executeRawUnsafe(INIT_CATEGORIES).catch(() => {});
  await prisma.$executeRawUnsafe(INIT_AUDIT).catch(() => {});
  await ensureOperationalTenantColumn('finance_tax_categories').catch(() => {});
  await ensureOperationalTenantColumn('finance_vat_audit_logs').catch(() => {});
  await prisma.$executeRawUnsafe(
    `UPDATE finance_tax_categories SET tenant_id = $1 WHERE tenant_id IS NULL`,
    GLOBAL_TENANT,
  ).catch(() => {});
  await prisma.$executeRawUnsafe(`ALTER TABLE finance_tax_categories DROP CONSTRAINT IF EXISTS finance_tax_categories_code_key`).catch(() => {});
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_tax_categories_tenant_code
     ON finance_tax_categories (tenant_id, code)`,
  ).catch(() => {});
}

async function ensureDefaults() {
  const [{ count }] = await prisma.$queryRawUnsafe<{ count: string }[]>(
    `SELECT COUNT(*)::text as count FROM finance_tax_categories WHERE tenant_id = $1`,
    GLOBAL_TENANT,
  ).catch(() => [{ count: '0' }]);

  if (parseInt(count, 10) === 0) {
    for (const cat of DEFAULT_CATEGORIES) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO finance_tax_categories (code,name,rate,description,fta_code,is_default,tenant_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (tenant_id, code) DO NOTHING`,
        cat.code, cat.name, cat.rate, cat.description, cat.fta_code, cat.is_default, GLOBAL_TENANT,
      ).catch(() => {});
    }
  }
}

export async function GET(req: NextRequest) {
  await ensureTaxSchema();
  await ensureDefaults();

  const ctx = requireOperationalContext(req, 'finance', {
    requestedTenantId: req.nextUrl.searchParams.get('tenantId'),
  });
  if (ctx instanceof NextResponse) return ctx;

  const sp = req.nextUrl.searchParams;
  const type = sp.get('type');

  if (type === 'audit') {
    const rows = await prisma.$queryRawUnsafe<TaxRow[]>(
      `SELECT * FROM finance_vat_audit_logs
       WHERE tenant_id::text = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      ctx.tenantId,
    ).catch(() => []);
    return NextResponse.json({ data: rows });
  }

  if (type === 'summary') {
    const year = sp.get('year') ?? new Date().getFullYear().toString();
    const quarter = sp.get('quarter') ?? Math.ceil((new Date().getMonth() + 1) / 3).toString();
    const q = parseInt(quarter, 10);
    const y = parseInt(year, 10);
    const startMonth = (q - 1) * 3 + 1;
    const endMonth = q * 3;
    const startDate = `${y}-${String(startMonth).padStart(2, '0')}-01`;
    const endDateObj = new Date(y, endMonth, 0);
    const endDate = endDateObj.toISOString().slice(0, 10);

    const [outputRow] = await prisma.$queryRawUnsafe<{ total: string; count: string }[]>(
      `SELECT COALESCE(SUM(vat_amount),0)::text as total, COUNT(*)::text as count
         FROM finance_invoices WHERE deleted_at IS NULL
           AND tenant_id::text = $3
           AND payment_status NOT IN ('DRAFT','CANCELLED')
           AND issue_date BETWEEN $1 AND $2`,
      startDate, endDate, ctx.tenantId,
    ).catch(() => [{ total: '0', count: '0' }]);

    const [logRow] = await prisma.$queryRawUnsafe<{ total: string }[]>(
      `SELECT COALESCE(SUM(total_amount * 0.05 / 1.05),0)::text as total
         FROM logistics_bookings WHERE deleted_at IS NULL
           AND tenant_id::text = $3
           AND status IN ('DELIVERED','POD_SUBMITTED','CLOSED')
           AND created_at::date BETWEEN $1 AND $2`,
      startDate, endDate, ctx.tenantId,
    ).catch(() => [{ total: '0' }]);

    const [racRow] = await prisma.$queryRawUnsafe<{ total: string }[]>(
      `SELECT COALESCE(SUM(total_amount * 0.05 / 1.05),0)::text as total
         FROM rental_invoices WHERE deleted_at IS NULL
           AND tenant_id::text = $3
           AND created_at::date BETWEEN $1 AND $2`,
      startDate, endDate, ctx.tenantId,
    ).catch(() => [{ total: '0' }]);

    const [fuelRow] = await prisma.$queryRawUnsafe<{ total: string }[]>(
      `SELECT COALESCE(SUM(total_cost * 0.05 / 1.05),0)::text as total
         FROM fuel_logs WHERE tenant_id::text = $3
           AND created_at::date BETWEEN $1 AND $2`,
      startDate, endDate, ctx.tenantId,
    ).catch(() => [{ total: '0' }]);

    const [mainRow] = await prisma.$queryRawUnsafe<{ total: string }[]>(
      `SELECT COALESCE(SUM(total_cost * 0.05 / 1.05),0)::text as total
         FROM maintenance_requests WHERE deleted_at IS NULL
           AND tenant_id::text = $3
           AND status IN ('COMPLETED')
           AND created_at::date BETWEEN $1 AND $2`,
      startDate, endDate, ctx.tenantId,
    ).catch(() => [{ total: '0' }]);

    const outputVat = parseFloat(outputRow?.total ?? '0')
      + parseFloat(logRow?.total ?? '0')
      + parseFloat(racRow?.total ?? '0');
    const inputVat = parseFloat(fuelRow?.total ?? '0')
      + parseFloat(mainRow?.total ?? '0');
    const netVat = outputVat - inputVat;

    const breakdown = await prisma.$queryRawUnsafe<{ code: string; name: string; rate: string }[]>(
      `SELECT DISTINCT ON (code) code, name, rate::text
         FROM finance_tax_categories
        WHERE is_active = TRUE
          AND tenant_id IN ($1, $2)
        ORDER BY code, CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END, rate DESC`,
      ctx.tenantId,
      GLOBAL_TENANT,
    ).catch(() => []);

    return NextResponse.json({
      period: { year: y, quarter: q, startDate, endDate },
      output: { vat: Math.round(outputVat * 100) / 100, invoices: parseInt(outputRow?.count ?? '0', 10) },
      input: { vat: Math.round(inputVat * 100) / 100 },
      net: { vat: Math.round(netVat * 100) / 100, payable: netVat > 0 },
      categories: breakdown,
    });
  }

  const categories = await prisma.$queryRawUnsafe<TaxRow[]>(
    `SELECT DISTINCT ON (code) *
       FROM finance_tax_categories
      WHERE tenant_id IN ($1, $2)
      ORDER BY code, CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END, rate DESC`,
    ctx.tenantId,
    GLOBAL_TENANT,
  ).catch(() => []);
  return NextResponse.json({ data: categories });
}

export async function POST(req: NextRequest) {
  await ensureTaxSchema();
  await ensureDefaults();

  const ctx = requireOperationalContext(req, 'finance', { write: true });
  if (ctx instanceof NextResponse) return ctx;
  const body = await req.json();

  if (body.type === 'audit_log') {
    await prisma.$executeRawUnsafe(
      `INSERT INTO finance_vat_audit_logs (action, entity_type, entity_id, performed_by, details, notes, tenant_id)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
      body.action,
      body.entityType ?? null,
      body.entityId ?? null,
      body.performedBy ?? ctx.userId,
      JSON.stringify(body.details ?? {}),
      body.notes ?? null,
      ctx.tenantId,
    ).catch(() => {});
    return NextResponse.json({ ok: true }, { status: 201 });
  }

  const scopeTenant = body.scope === 'global' && ctx.isSuperAdmin ? GLOBAL_TENANT : ctx.tenantId;
  const [before] = await prisma.$queryRawUnsafe<TaxRow[]>(
    `SELECT * FROM finance_tax_categories WHERE tenant_id = $1 AND code = $2 LIMIT 1`,
    scopeTenant,
    body.code,
  ).catch(() => []);

  const [row] = await prisma.$queryRawUnsafe<TaxRow[]>(
    `INSERT INTO finance_tax_categories (code, name, rate, description, fta_code, is_default, is_active, tenant_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (tenant_id, code)
     DO UPDATE SET name=$2, rate=$3, description=$4, fta_code=$5, is_default=$6, is_active=$7, updated_at=NOW()
     RETURNING *`,
    body.code,
    body.name,
    body.rate ?? 0,
    body.description ?? null,
    body.ftaCode ?? null,
    body.isDefault ?? false,
    body.isActive ?? true,
    scopeTenant,
  ).catch(() => []);

  if (!row) return NextResponse.json({ error: 'Failed to save tax category' }, { status: 500 });

  await recordOperationalChange({
    req,
    ctx,
    entityType: 'FinanceTaxCategory',
    entityId: String(row.id ?? ''),
    action: before ? 'UPDATE' : 'CREATE',
    before,
    after: row,
    summary: `${before ? 'Updated' : 'Created'} tax category ${String(row.code ?? body.code)}.`,
    riskSeverity: 'medium',
  });

  return NextResponse.json(row, { status: 201 });
}
