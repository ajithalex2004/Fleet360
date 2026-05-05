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

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  try {
    await ensureSpmSchema();
    const body = await req.json().catch(() => ({}));
    const triggeredBy: string = body.triggered_by ?? 'MANUAL';

    // Step 1: Fetch all ACTIVE cycles where next_run_at <= NOW() or next_run_at IS NULL
    const dueCycles = await query<Row>(`
      SELECT * FROM spm_cycles
      WHERE tenant_id = 'default'
        AND status = 'ACTIVE'
        AND (next_run_at <= NOW() OR next_run_at IS NULL)
      ORDER BY next_run_at ASC NULLS FIRST
    `);

    // Count PAUSED cycles for audit log
    const pausedRes = await query<{ count: bigint }>(`
      SELECT COUNT(*) AS count FROM spm_cycles
      WHERE tenant_id = 'default' AND status = 'PAUSED'
    `);
    const cyclesSkipped = Number(pausedRes[0]?.count ?? 0);

    // Get current ticket count for code generation base
    const ticketCountRes = await query<{ count: bigint }>(`SELECT COUNT(*) AS count FROM spm_tickets WHERE tenant_id = 'default'`);
    let ticketSeqBase = Number(ticketCountRes[0]?.count ?? 0);

    let ticketsGenerated = 0;
    const summaryItems: Array<{ cycle_code: string; ticket_code: string; action: string }> = [];

    // Step 2: Process each due cycle
    for (const cycle of dueCycles) {
      const cycleId = cycle.id as string;
      const cycleCode = cycle.cycle_code as string;
      const cycleName = cycle.name as string;
      const intervalDays = Number(cycle.interval_days ?? 30);

      // Generate ticket code
      ticketSeqBase += 1;
      const ticketCode = `SRT-${String(ticketSeqBase).padStart(4, '0')}`;

      // Attempt idempotent insert (ON CONFLICT on cycle_id + DATE(scheduled_date) DO NOTHING)
      const inserted = await exec(`
        INSERT INTO spm_tickets (
          tenant_id, ticket_code, cycle_id, cycle_name,
          asset_id, asset_name, asset_no, asset_category, asset_location, asset_domain,
          maintenance_type, triggered_by, status, priority,
          assigned_to, assigned_to_user_id, assigned_to_email,
          scheduled_date, created_at, updated_at
        ) VALUES (
          'default', $1, $2, $3,
          $4, $5, $6, $7, $8, $9,
          $10, $11, 'OPEN', $12,
          $13, $14, $15,
          NOW(), NOW(), NOW()
        )
        ON CONFLICT (cycle_id, (DATE(scheduled_date))) DO NOTHING
      `,
        ticketCode,
        cycleId,
        cycleName,
        cycle.asset_id ?? null,
        cycle.asset_name ?? null,
        cycle.asset_no ?? null,
        cycle.asset_category ?? null,
        cycle.asset_location ?? null,
        cycle.asset_domain ?? null,
        cycle.maintenance_type ?? 'PREVENTIVE',
        triggeredBy,
        cycle.priority ?? 'MEDIUM',
        cycle.assigned_to ?? null,
        cycle.assigned_to_user_id ?? null,
        cycle.assigned_to_email ?? null,
      );

      if (Number(inserted) > 0) {
        ticketsGenerated += 1;

        // Fetch the newly inserted ticket id
        const newTicketRows = await query<Row>(`
          SELECT id FROM spm_tickets
          WHERE cycle_id = $1 AND ticket_code = $2 AND tenant_id = 'default'
          LIMIT 1
        `, cycleId, ticketCode);

        if (newTicketRows.length > 0) {
          const ticketId = newTicketRows[0].id as string;

          // Copy checklist templates to spm_ticket_checks
          const templates = await query<Row>(`
            SELECT * FROM spm_checklist_templates
            WHERE cycle_id = $1 AND tenant_id = 'default'
            ORDER BY item_order ASC
          `, cycleId);

          for (const tpl of templates) {
            await exec(`
              INSERT INTO spm_ticket_checks (
                tenant_id, ticket_id, template_id, item_order, description,
                is_mandatory, is_checked
              ) VALUES ('default', $1, $2, $3, $4, $5, FALSE)
            `,
              ticketId,
              tpl.id ?? null,
              tpl.item_order ?? 0,
              tpl.description,
              tpl.is_mandatory ?? true,
            );
          }

          // Create assignment notification if cycle has a linked user
          if (cycle.assigned_to_user_id) {
            await exec(`
              INSERT INTO spm_notifications (
                id, tenant_id, ticket_id, cycle_id,
                user_id, user_name, user_email,
                type, message, is_read, created_at
              ) VALUES (
                gen_random_uuid(), 'default', $1, $2,
                $3, $4, $5,
                'TICKET_ASSIGNED',
                $6, FALSE, NOW()
              )
            `,
              ticketId,
              cycleId,
              cycle.assigned_to_user_id,
              cycle.assigned_to  ?? '',
              cycle.assigned_to_email ?? '',
              `New maintenance ticket ${ticketCode} has been assigned to you for ${cycleName}.`,
            );
          }
        }

        summaryItems.push({ cycle_code: cycleCode, ticket_code: ticketCode, action: 'TICKET_CREATED' });
      } else {
        // Conflict — ticket already exists for today
        summaryItems.push({ cycle_code: cycleCode, ticket_code: ticketCode, action: 'SKIPPED_CONFLICT' });
        ticketSeqBase -= 1; // rollback sequence increment since no insert happened
      }

      // Step 2c: Update cycle last_run_at + next_run_at regardless of ticket insert outcome
      const d = new Date();
      d.setDate(d.getDate() + intervalDays);
      await exec(`
        UPDATE spm_cycles
        SET last_run_at = NOW(), next_run_at = $2, updated_at = NOW()
        WHERE id = $1
      `, cycleId, d.toISOString());
    }

    const durationMs = Date.now() - startTime;

    // Step 3: Log to spm_audit_logs
    const auditRows = await query<Row>(`
      INSERT INTO spm_audit_logs (
        tenant_id, triggered_by, cycles_checked, tickets_generated,
        cycles_skipped, run_duration_ms, summary, run_at
      ) VALUES (
        'default', $1, $2, $3, $4, $5, $6::jsonb, NOW()
      ) RETURNING id
    `,
      triggeredBy,
      dueCycles.length,
      ticketsGenerated,
      cyclesSkipped,
      durationMs,
      JSON.stringify(summaryItems),
    );

    const auditLogId = auditRows[0]?.id ?? null;

    return NextResponse.json(ser({
      tickets_generated: ticketsGenerated,
      cycles_checked: dueCycles.length,
      cycles_skipped: cyclesSkipped,
      audit_log_id: auditLogId,
      duration_ms: durationMs,
      summary: summaryItems,
    }));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
