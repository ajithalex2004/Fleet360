/**
 * Credit Note individual operations — status lifecycle
 * DRAFT → ISSUED → APPLIED | REFUNDED | VOIDED
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const INIT = `
  CREATE TABLE IF NOT EXISTS finance_credit_notes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    deleted_at          TIMESTAMPTZ,
    cn_number           TEXT UNIQUE NOT NULL,
    original_invoice_id TEXT,
    original_invoice_no TEXT,
    client_name         TEXT NOT NULL,
    client_email        TEXT,
    module              TEXT,
    reason_code         TEXT NOT NULL,
    reason_detail       TEXT,
    line_items          JSONB,
    subtotal            NUMERIC(15,2) NOT NULL,
    vat_amount          NUMERIC(15,2) DEFAULT 0,
    total_amount        NUMERIC(15,2) NOT NULL,
    currency            TEXT DEFAULT 'AED',
    issue_date          DATE NOT NULL,
    status              TEXT DEFAULT 'DRAFT',
    applied_amount      NUMERIC(15,2) DEFAULT 0,
    refunded_at         TIMESTAMPTZ,
    refund_method       TEXT,
    issued_by           TEXT,
    approved_by         TEXT,
    notes               TEXT
  );
`;

type CnRow = Record<string, unknown>;

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  await prisma.$executeRawUnsafe(INIT).catch(() => {});
  const [row] = await prisma.$queryRawUnsafe<CnRow[]>(
    `SELECT * FROM finance_credit_notes WHERE id=$1 AND deleted_at IS NULL`, params.id
  ).catch(() => [] as CnRow[]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const { action } = body;
  const now = new Date().toISOString();

  let sql = '';
  let sqlParams: unknown[] = [];

  switch (action) {
    case 'issue':
      sql = `UPDATE finance_credit_notes SET status='ISSUED', issued_by=$2, updated_at=$3 WHERE id=$1 RETURNING *`;
      sqlParams = [params.id, body.issuedBy ?? 'Finance', now];
      break;
    case 'apply':
      sql = `UPDATE finance_credit_notes SET status='APPLIED', applied_amount=$2, updated_at=$3, notes=COALESCE($4,notes) WHERE id=$1 RETURNING *`;
      sqlParams = [params.id, body.appliedAmount, now, body.notes ?? null];
      break;
    case 'refund':
      sql = `UPDATE finance_credit_notes SET status='REFUNDED', refunded_at=$2, refund_method=$3, updated_at=$4, notes=COALESCE($5,notes) WHERE id=$1 RETURNING *`;
      sqlParams = [params.id, now, body.refundMethod ?? 'Bank Transfer', now, body.notes ?? null];
      break;
    case 'void':
      sql = `UPDATE finance_credit_notes SET status='VOIDED', updated_at=$2, notes=COALESCE($3,notes) WHERE id=$1 RETURNING *`;
      sqlParams = [params.id, now, body.notes ?? null];
      break;
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  const [row] = await prisma.$queryRawUnsafe<CnRow[]>(sql, ...sqlParams).catch(() => [] as CnRow[]);
  if (!row) return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  return NextResponse.json(row);
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  await prisma.$executeRawUnsafe(
    `UPDATE finance_credit_notes SET deleted_at=NOW() WHERE id=$1`, params.id
  ).catch(() => {});
  return NextResponse.json({ ok: true });
}
