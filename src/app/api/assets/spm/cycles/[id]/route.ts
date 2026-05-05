import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureSpmSchema } from '@/lib/assets/spm-schema';

type Row = Record<string, unknown>;
const query = <T = Row>(sql: string, ...v: unknown[]) =>
  prisma.$queryRawUnsafe<T[]>(sql, ...v).catch(() => [] as T[]);
const exec = (sql: string, ...v: unknown[]) =>
  prisma.$executeRawUnsafe(sql, ...v).catch(() => 0);

function ser<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_, val) =>
    typeof val === 'bigint' ? Number(val) : val instanceof Date ? val.toISOString() : val
  ));
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureSpmSchema();
    const { id } = await params;

    const [cycleRows, ticketRows, templateRows] = await Promise.all([
      query(`
        SELECT *,
          ROUND(EXTRACT(EPOCH FROM (next_run_at - NOW()))/86400)::int AS days_remaining
        FROM spm_cycles
        WHERE id = $1 AND tenant_id = 'default'
        LIMIT 1
      `, id),
      query(`
        SELECT * FROM spm_tickets
        WHERE cycle_id = $1 AND tenant_id = 'default'
        ORDER BY scheduled_date DESC
        LIMIT 5
      `, id),
      query(`
        SELECT * FROM spm_checklist_templates
        WHERE cycle_id = $1 AND tenant_id = 'default'
        ORDER BY item_order ASC
      `, id),
    ]);

    if (cycleRows.length === 0) {
      return NextResponse.json({ error: 'Cycle not found' }, { status: 404 });
    }

    return NextResponse.json(ser({
      ...cycleRows[0],
      recent_tickets: ticketRows,
      checklist_templates: templateRows,
    }));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureSpmSchema();
    const { id } = await params;
    const body = await req.json();

    // Check current state to handle status → ACTIVE recalculation
    const currentRows = await query(`SELECT * FROM spm_cycles WHERE id = $1 AND tenant_id = 'default' LIMIT 1`, id);
    if (currentRows.length === 0) {
      return NextResponse.json({ error: 'Cycle not found' }, { status: 404 });
    }
    const current = currentRows[0] as Row;

    const sets: string[] = ['updated_at = NOW()'];
    const vals: unknown[] = [];

    const addField = (col: string, val: unknown) => {
      vals.push(val);
      sets.push(`${col} = $${vals.length}`);
    };

    if (body.name !== undefined) addField('name', body.name);
    if (body.description !== undefined) addField('description', body.description);
    if (body.maintenance_type !== undefined) addField('maintenance_type', body.maintenance_type);
    if (body.interval_days !== undefined) addField('interval_days', body.interval_days);
    if (body.first_run_at !== undefined) addField('first_run_at', body.first_run_at);
    if (body.priority !== undefined) addField('priority', body.priority);
    if (body.assigned_to !== undefined) addField('assigned_to', body.assigned_to);
    if (body.estimated_duration_mins !== undefined) addField('estimated_duration_mins', body.estimated_duration_mins);
    if (body.notes !== undefined) addField('notes', body.notes);

    if (body.status !== undefined) {
      addField('status', body.status);
      // If activating and next_run_at is null, recalculate
      if (body.status === 'ACTIVE' && !current.next_run_at) {
        const intervalDays = body.interval_days ?? Number(current.interval_days ?? 30);
        const d = new Date();
        d.setDate(d.getDate() + intervalDays);
        addField('next_run_at', d.toISOString());
      }
    }

    if (body.next_run_at !== undefined) addField('next_run_at', body.next_run_at);

    vals.push(id);
    const [row] = await query(`
      UPDATE spm_cycles SET ${sets.join(', ')}
      WHERE id = $${vals.length} AND tenant_id = 'default'
      RETURNING *,
        ROUND(EXTRACT(EPOCH FROM (next_run_at - NOW()))/86400)::int AS days_remaining
    `, ...vals);

    return NextResponse.json(ser(row));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureSpmSchema();
    const { id } = await params;

    await exec(`
      UPDATE spm_cycles SET status = 'ARCHIVED', updated_at = NOW()
      WHERE id = $1 AND tenant_id = 'default'
    `, id);

    return NextResponse.json({ success: true, message: 'Cycle archived' });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
