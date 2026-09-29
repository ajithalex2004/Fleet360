export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { spmSql } from '@/lib/assets/spm-sql';
import { sqlCast } from '@/lib/assets/sql-cast';
import { ensureSpmSchema } from '@/lib/assets/spm-schema';
import { randomUUID } from 'crypto';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
type Row = Record<string, unknown>;

function ser<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_, val) =>
    typeof val === 'bigint' ? Number(val) : val instanceof Date ? val.toISOString() : val
  ));
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authz = requireAuthorizedTenant({ headers: _req.headers, nextUrl: _req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  const { query } = spmSql(tenantId);

  try {
    await ensureSpmSchema();
    const { id } = await params;

    const [ticketRows, checkRows] = await Promise.all([
      query(`
        SELECT t.*, c.interval_days, c.cycle_code
        FROM spm_tickets t
        LEFT JOIN spm_cycles c ON t.cycle_id = c.id
        WHERE t.id::text = $1 AND t.tenant_id = $tenant
        LIMIT 1
      `, id),
      query(`
        SELECT * FROM spm_ticket_checks
        WHERE ticket_id::text = $1 AND tenant_id = $tenant
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

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  const { query, exec } = spmSql(tenantId);

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        await ensureSpmSchema();
        const { id } = await params;
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);

        const currentRows = await query(`SELECT * FROM spm_tickets WHERE id::text = $1 AND tenant_id = $tenant LIMIT 1`, id);
        if (currentRows.length === 0) {
          return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
        }
        const current = currentRows[0] as Row;

        const sets: string[] = ['updated_at = NOW()'];
        const vals: unknown[] = [];

        const addField = (col: string, val: unknown) => {
          vals.push(val);
          sets.push(`${col} = $${vals.length}${sqlCast('spm_tickets', col)}`);
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
              const u = await tx.user.findUnique({
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
          WHERE id::text = $${vals.length} AND tenant_id = $tenant
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
              $1::uuid, $tenant, $2::uuid, $3::uuid,
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
          const cycleRows = await query(`SELECT interval_days FROM spm_cycles WHERE id::text = $1 LIMIT 1`, cycleId);
          if (cycleRows.length > 0) {
            const intervalDays = Number((cycleRows[0] as Row).interval_days ?? 30);
            const d = new Date();
            d.setDate(d.getDate() + intervalDays);
            await exec(`
              UPDATE spm_cycles
              SET last_run_at = NOW(), next_run_at = $2::timestamptz, updated_at = NOW()
              WHERE id::text = $1
            `, cycleId, d.toISOString());
          }
        }

        return NextResponse.json(ser(row));
      } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
      }
  });
}

