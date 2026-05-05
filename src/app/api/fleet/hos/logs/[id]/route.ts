import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureHosSchema } from '@/lib/fleet/hos-schema';

type Row = Record<string, unknown>;

const query = <T = Row>(sql: string, ...v: unknown[]) =>
  prisma.$queryRawUnsafe<T[]>(sql, ...v).catch(() => [] as T[]);

function ser<T>(v: T): T {
  return JSON.parse(
    JSON.stringify(v, (_, val) =>
      typeof val === 'bigint'
        ? Number(val)
        : val instanceof Date
          ? val.toISOString()
          : val,
    ),
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  await ensureHosSchema();
  try {
    const { id } = params;

    const rows = await query<Row>(
      `SELECT *,
         CASE
           WHEN ended_at IS NULL THEN EXTRACT(EPOCH FROM (NOW() - started_at)) / 60
           ELSE duration_mins
         END AS computed_duration_mins
       FROM hos_logs
       WHERE id = $1`,
      id,
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Log entry not found' }, { status: 404 });
    }

    return NextResponse.json(ser(rows[0]));
  } catch (error) {
    console.error('Error fetching HoS log:', error);
    return NextResponse.json({ error: 'Failed to fetch HoS log' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  await ensureHosSchema();
  try {
    const { id } = params;
    const body = await req.json();

    // Fetch existing record
    const existing = await query<Row>(
      `SELECT * FROM hos_logs WHERE id = $1`,
      id,
    );

    if (existing.length === 0) {
      return NextResponse.json({ error: 'Log entry not found' }, { status: 404 });
    }

    const log = existing[0];

    if (log.ended_at !== null) {
      return NextResponse.json(
        { error: 'Log entry is already closed' },
        { status: 400 },
      );
    }

    const endedAt = body.ended_at ?? new Date().toISOString();
    const startedAt = new Date(log.started_at as string);
    const endedAtDate = new Date(endedAt);
    const durationMins = Math.round(
      (endedAtDate.getTime() - startedAt.getTime()) / 60000,
    );

    const sets: string[] = [];
    const values: unknown[] = [];

    sets.push(`ended_at = $${values.push(endedAt) + 0}`);
    sets.push(`duration_mins = $${values.push(durationMins) + 0}`);
    sets.push(`updated_at = $${values.push(new Date().toISOString()) + 0}`);

    if (body.notes !== undefined) {
      sets.push(`notes = $${values.push(body.notes) + 0}`);
    }
    if (body.location !== undefined) {
      sets.push(`location = $${values.push(body.location) + 0}`);
    }

    values.push(id);

    const rows = await query<Row>(
      `UPDATE hos_logs
       SET ${sets.join(', ')}
       WHERE id = $${values.length}
       RETURNING *`,
      ...values,
    );

    return NextResponse.json(ser(rows[0]));
  } catch (error) {
    console.error('Error closing HoS log:', error);
    return NextResponse.json({ error: 'Failed to close HoS log' }, { status: 500 });
  }
}
