/**
 * Collection Case — individual operations & dunning stage transitions
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type CaseRow = Record<string, unknown>;

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  const [row] = await prisma.$queryRawUnsafe<CaseRow[]>(
    `SELECT * FROM finance_collection_cases WHERE id=$1 AND deleted_at IS NULL`, params.id
  ).catch(() => [] as CaseRow[]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const { action } = body;
  const now    = new Date().toISOString();
  const today  = new Date().toISOString().slice(0, 10);

  // Get current case for timeline append
  const [current] = await prisma.$queryRawUnsafe<{timeline: unknown}[]>(
    `SELECT timeline FROM finance_collection_cases WHERE id=$1`, params.id
  ).catch(() => [] as {timeline: unknown}[]);

  const timeline: {date: string; action: string; by: string; note: string}[] =
    Array.isArray(current?.timeline) ? current.timeline : [];

  const addEvent = (act: string, note: string) =>
    [...timeline, { date: today, action: act, by: body.by ?? 'System', note }];

  let sql = '';
  let sqlParams: unknown[] = [];

  switch (action) {
    case 'contact':
      sql = `UPDATE finance_collection_cases SET status='CONTACTED', dunning_stage=$2, last_contact_date=$3, timeline=$4::jsonb, updated_at=$5, notes=COALESCE($6,notes) WHERE id=$1 RETURNING *`;
      sqlParams = [params.id, body.dunningStage ?? 'DUNNING_1', today, JSON.stringify(addEvent('CONTACTED', body.note ?? 'Client contacted')), now, body.notes ?? null];
      break;
    case 'promise':
      sql = `UPDATE finance_collection_cases SET status='PROMISED', promised_pay_date=$2, promised_amount=$3, dunning_stage=$4, timeline=$5::jsonb, updated_at=$6, notes=COALESCE($7,notes) WHERE id=$1 RETURNING *`;
      sqlParams = [params.id, body.promisedPayDate, body.promisedAmount ?? null, body.dunningStage ?? null, JSON.stringify(addEvent('PROMISE_RECEIVED', `Promise to pay AED ${body.promisedAmount} by ${body.promisedPayDate}`)), now, body.notes ?? null];
      break;
    case 'escalate':
      sql = `UPDATE finance_collection_cases SET status='ESCALATED', dunning_stage='FINAL_NOTICE', timeline=$2::jsonb, updated_at=$3, notes=COALESCE($4,notes) WHERE id=$1 RETURNING *`;
      sqlParams = [params.id, JSON.stringify(addEvent('ESCALATED', body.note ?? 'Escalated to final notice')), now, body.notes ?? null];
      break;
    case 'legal':
      sql = `UPDATE finance_collection_cases SET status='LEGAL', dunning_stage='LEGAL_NOTICE', timeline=$2::jsonb, updated_at=$3, notes=COALESCE($4,notes) WHERE id=$1 RETURNING *`;
      sqlParams = [params.id, JSON.stringify(addEvent('LEGAL_ACTION', body.note ?? 'Referred to legal team')), now, body.notes ?? null];
      break;
    case 'settle':
      sql = `UPDATE finance_collection_cases SET status='SETTLED', paid_amount=$2, outstanding_amount=0, timeline=$3::jsonb, updated_at=$4, notes=COALESCE($5,notes) WHERE id=$1 RETURNING *`;
      sqlParams = [params.id, body.paidAmount ?? 0, JSON.stringify(addEvent('SETTLED', `Settled with AED ${body.paidAmount}`)), now, body.notes ?? null];
      break;
    case 'write_off':
      sql = `UPDATE finance_collection_cases SET status='WRITTEN_OFF', timeline=$2::jsonb, updated_at=$3, notes=COALESCE($4,notes) WHERE id=$1 RETURNING *`;
      sqlParams = [params.id, JSON.stringify(addEvent('WRITTEN_OFF', body.note ?? 'Written off as bad debt')), now, body.notes ?? null];
      break;
    case 'close':
      sql = `UPDATE finance_collection_cases SET status='CLOSED', timeline=$2::jsonb, updated_at=$3 WHERE id=$1 RETURNING *`;
      sqlParams = [params.id, JSON.stringify(addEvent('CLOSED', body.note ?? 'Case closed')), now];
      break;
    case 'add_note':
      sql = `UPDATE finance_collection_cases SET timeline=$2::jsonb, updated_at=$3, notes=$4 WHERE id=$1 RETURNING *`;
      sqlParams = [params.id, JSON.stringify(addEvent('NOTE', body.note ?? '')), now, body.notes ?? null];
      break;
    default:
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  const [row] = await prisma.$queryRawUnsafe<CaseRow[]>(sql, ...sqlParams).catch(() => [] as CaseRow[]);
  if (!row) return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  return NextResponse.json(row);
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string } }) {
  await prisma.$executeRawUnsafe(
    `UPDATE finance_collection_cases SET deleted_at=NOW() WHERE id=$1`, params.id
  ).catch(() => {});
  return NextResponse.json({ ok: true });
}
