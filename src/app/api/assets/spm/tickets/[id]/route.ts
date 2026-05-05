import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureSpmSchema } from '@/lib/assets/spm-schema';
import { randomUUID } from 'crypto';

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

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureSpmSchema();
    const { id } = await params;

    const [ticketRows, checkRows] = await Promise.all([
      query(`
        SELECT t.*, c.interval_days, c.cycle_code
        FROM spm_tickets t
        LEFT JOIN spm_cycles c ON t.cycle_id = c.id
        WHERE t.id = $1 AND t.tenant_id = 'default'
        LIMIT 1
      `, id),
      query(`
        SELECT * FROM spm_ticket_checks
        WHERE ticket_id = $1 AND tenant_id = 'default'
        ORDER BY item_order ASC
      `, id),
    ]);

    if (ticketRows.length === 0) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    return NextResponse.json(ser({
      ...ticketRows[0],
      checklist: checkRows,
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

    const currentRows = await query(`SELECT * FROM spm_tickets WHERE id = $1 AND tenant_id = 'default' LIMIT 1`, id);
    if (currentRows.length === 0) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }
    const current = currentRows[0] as Row;

    const sets: string[] = ['updated_at = NOW()'];
    const vals: unknown[] = [];

    const addField = (col: string, val: unknown) => {
      vals.push(val);
      sets.push(`${col} = $${vals.length}`);
    };

    if (body.status !== undefined) {
      addField('status', body.status);

      if (body.status === 'IN_PROGRESS' && !current.started_at) {
        sets.push('started_at = NOW()');
      }

      if (body.status === 'COMPLETED') {
        sets.push('completed_at = NOW()');
      }
    }

    if (body.findings !== undefined) addField('findings', body.findings);
    if (body.resolution_notes !== undefined) addField('resolution_notes', body.resolution_notes);
    if (body.technician_notes !== undefined) addField('technician_notes', body.technician_notes);
    if (body.completion_photos !== undefined) addField('completion_photos', body.completion_photos);

    // User-linked assignment
    let newAssigneeUserId: string | null = null;
    let newAssigneeName: string | null = null;
    let newAssigneeEmail: string | null = null;

    if (body.assigned_to_user_id !== undefined) {
      newAssigneeUserId = body.assigned_to_user_id;
      if (newAssigneeUserId) {
        try {
          const u = await prisma.user.findUnique({
            where: { id: newAssigneeUserId },
            select: { firstName: true, lastName: true, username: true, email: true },
          });
          if (u) {
            newAssigneeName  = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username;
            newAssigneeEmail = u.email ?? null;
          }
        } catch { /* ignore */ }
      }
      addField('assigned_to_user_id', newAssigneeUserId);
      addField('assigned_to_email',   newAssigneeEmail);
      addField('assigned_to',         newAssigneeName ?? body.assigned_to ?? null);
    } else if (body.assigned_to !== undefined) {
      addField('assigned_to', body.assigned_to);
    }

    vals.push(id);
    const [row] = await query(`
      UPDATE spm_tickets SET ${sets.join(', ')}
      WHERE id = $${vals.length} AND tenant_id = 'default'
      RETURNING *
    `, ...vals);

    // Fire assignment notification if assignee changed and is a real user
    const prevUserId = current.assigned_to_user_id as string | null;
    if (
      newAssigneeUserId &&
      newAssigneeUserId !== prevUserId
    ) {
      const ticketCode = current.ticket_code as string;
      const cycleId    = current.cycle_id as string;
      await exec(`
        INSERT INTO spm_notifications (
          id, tenant_id, ticket_id, cycle_id,
          user_id, user_name, user_email,
          type, message, is_read, created_at
        ) VALUES (
          $1, 'default', $2, $3,
          $4, $5, $6,
          'TICKET_ASSIGNED',
          $7, FALSE, NOW()
        )
      `,
        randomUUID(),
        id,
        cycleId,
        newAssigneeUserId,
        newAssigneeName  ?? '',
        newAssigneeEmail ?? '',
        `You have been assigned to maintenance ticket ${ticketCode}.`,
      );
    }

    // If completing, update parent cycle's last_run_at and next_run_at
    if (body.status === 'COMPLETED') {
      const cycleId = current.cycle_id as string;
      const cycleRows = await query(`SELECT interval_days FROM spm_cycles WHERE id = $1 LIMIT 1`, cycleId);
      if (cycleRows.length > 0) {
        const intervalDays = Number((cycleRows[0] as Row).interval_days ?? 30);
        const d = new Date();
        d.setDate(d.getDate() + intervalDays);
        await exec(`
          UPDATE spm_cycles
          SET last_run_at = NOW(), next_run_at = $2, updated_at = NOW()
          WHERE id = $1
        `, cycleId, d.toISOString());
      }
    }

    return NextResponse.json(ser(row));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
