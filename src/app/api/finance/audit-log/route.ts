/**
 * Finance Audit Log API — /api/finance/audit-log
 * Comprehensive immutable audit trail for all finance module actions
 * Covers: JE posting, approvals, period locks, CT filings, bank reconciliation, asset disposals
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

const INIT_AUDIT = `
  CREATE TABLE IF NOT EXISTS finance_audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    module          TEXT NOT NULL,        -- JE | COA | FIXED_ASSETS | PERIOD | CT | BANK_RECON | EXPENSE | INVOICE | PDC | CREDIT_NOTE
    action          TEXT NOT NULL,        -- CREATED | POSTED | APPROVED | REJECTED | VOIDED | REVERSED | LOCKED | FILED | DISPOSED
    entity_type     TEXT NOT NULL,
    entity_id       TEXT NOT NULL,
    entity_ref      TEXT,                 -- human-readable (JE number, asset no, etc.)
    performed_by    TEXT NOT NULL,
    ip_address      TEXT,
    old_values      JSONB,
    new_values      JSONB,
    description     TEXT NOT NULL,
    amount          NUMERIC(15,2),
    metadata        JSONB
  );
`;

const INIT_AUDIT_IDX = `CREATE INDEX IF NOT EXISTS finance_audit_log_module_idx ON finance_audit_log(module, created_at DESC)`;
const INIT_AUDIT_IDX2 = `CREATE INDEX IF NOT EXISTS finance_audit_log_entity_idx ON finance_audit_log(entity_type, entity_id)`;

export async function GET(req: NextRequest) {
  await prisma.$executeRawUnsafe(INIT_AUDIT).catch(()=>{});
  await prisma.$executeRawUnsafe(INIT_AUDIT_IDX).catch(()=>{});
  await prisma.$executeRawUnsafe(INIT_AUDIT_IDX2).catch(()=>{});

  const sp        = req.nextUrl.searchParams;
  const module_   = sp.get('module');
  const action    = sp.get('action');
  const entityId  = sp.get('entityId');
  const from      = sp.get('from');
  const to        = sp.get('to');
  const search    = sp.get('search');
  const limit     = parseInt(sp.get('limit') ?? '100');
  const offset    = parseInt(sp.get('offset') ?? '0');

  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  let pi = 1;

  if (module_)  { where += ` AND module = $${pi++}`;                params.push(module_); }
  if (action)   { where += ` AND action = $${pi++}`;                params.push(action); }
  if (entityId) { where += ` AND entity_id = $${pi++}`;             params.push(entityId); }
  if (from)     { where += ` AND created_at >= $${pi++}`;           params.push(from); }
  if (to)       { where += ` AND created_at < ($${pi++}::date + interval '1 day')`; params.push(to); }
  if (search)   { where += ` AND (description ILIKE $${pi} OR entity_ref ILIKE $${pi} OR performed_by ILIKE $${pi})`; params.push(`%${search}%`); pi++; }

  const [rows, [countRow]] = await Promise.all([
    prisma.$queryRawUnsafe<Record<string,unknown>[]>(
      `SELECT * FROM finance_audit_log ${where} ORDER BY created_at DESC LIMIT $${pi} OFFSET $${pi+1}`,
      ...params, limit, offset
    ).catch(()=>[]),
    prisma.$queryRawUnsafe<{count:string}[]>(
      `SELECT COUNT(*)::text as count FROM finance_audit_log ${where}`, ...params
    ).catch(()=>[{count:'0'}]),
  ]);

  // Module breakdown counts
  const moduleCounts = await prisma.$queryRawUnsafe<{module:string; count:string}[]>(
    `SELECT module, COUNT(*)::text as count FROM finance_audit_log GROUP BY module ORDER BY count DESC`
  ).catch(()=>[]);

  return NextResponse.json({
    data: rows,
    total: parseInt(countRow?.count ?? '0'),
    limit, offset,
    moduleCounts,
  });
}

export async function POST(req: NextRequest) {
  await prisma.$executeRawUnsafe(INIT_AUDIT).catch(()=>{});

  const body = await req.json();
  const { module: mod, action, entityType, entityId, entityRef, performedBy, description, amount, oldValues, newValues, metadata, ipAddress } = body;

  if (!mod || !action || !entityType || !entityId || !performedBy || !description) {
    return NextResponse.json({ error: 'Missing required fields: module, action, entityType, entityId, performedBy, description' }, { status: 400 });
  }

  const [row] = await prisma.$queryRawUnsafe<Record<string,unknown>[]>(
    `INSERT INTO finance_audit_log
       (module, action, entity_type, entity_id, entity_ref, performed_by, ip_address, description, amount, old_values, new_values, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    mod, action, entityType, entityId, entityRef ?? null, performedBy,
    ipAddress ?? null, description, amount ?? null,
    oldValues ? JSON.stringify(oldValues) : null,
    newValues ? JSON.stringify(newValues) : null,
    metadata  ? JSON.stringify(metadata)  : null,
  ).catch(()=>[]);

  return NextResponse.json(row ?? {}, { status: 201 });
}
