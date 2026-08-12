/**
 * Automated Payment Reminder Schedules — /api/finance/reminder-schedules
 * Defines when reminders fire (X days before due, Y days after due).
 * A separate /api/finance/reminder-schedules/run endpoint processes due reminders.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// finance_reminder_schedules and finance_reminder_log are created + seeded by
// migration 20260810000003_finance_reference_data_seed — no runtime DDL needed.

export async function GET(req: NextRequest) {
  const p           = req.nextUrl.searchParams;
  const include_log = p.get('include_log') === 'true';
  const schedule_id = p.get('schedule_id');

  if (schedule_id && include_log) {
    const logs = await prisma.$queryRawUnsafe(
      `SELECT * FROM finance_reminder_log WHERE schedule_id = $1::uuid ORDER BY sent_at DESC LIMIT 100`,
      schedule_id
    ) as Record<string, unknown>[];
    return NextResponse.json({ logs });
  }

  const schedules = await prisma.$queryRawUnsafe(
    `SELECT * FROM finance_reminder_schedules ORDER BY trigger_type, trigger_days`
  ) as Record<string, unknown>[];

  // Stats per schedule
  const stats = await prisma.$queryRawUnsafe(`
    SELECT schedule_id::text,
           COUNT(*)                                      AS total_sent,
           COUNT(*) FILTER (WHERE status = 'SENT')      AS delivered,
           COUNT(*) FILTER (WHERE status = 'FAILED')    AS failed,
           MAX(sent_at)                                  AS last_run
    FROM finance_reminder_log
    GROUP BY schedule_id
  `).catch(() => []) as Record<string, unknown>[];

  const statsMap: Record<string, Record<string, unknown>> = {};
  stats.forEach(s => { statsMap[String(s.schedule_id)] = s; });

  return NextResponse.json({
    schedules: schedules.map(s => {
      const id = s.id instanceof Buffer ? s.id.toString('hex') : String(s.id ?? '');
      return { ...s, id, stats: statsMap[id] ?? { total_sent: 0, delivered: 0, failed: 0 } };
    }),
  });
}

export async function POST(req: NextRequest) {
  const b = await req.json();

  if (b.action === 'run') {
    // ── Process all active schedules against overdue/upcoming invoices ─────
    const schedules = await prisma.$queryRawUnsafe(
      `SELECT * FROM finance_reminder_schedules WHERE is_active = TRUE`
    ) as Record<string, unknown>[];

    let totalFired = 0;
    const results: { schedule: string; fired: number; invoices: string[] }[] = [];

    for (const sch of schedules) {
      const schId      = sch.id instanceof Buffer ? sch.id.toString('hex') : String(sch.id);
      const days       = Number(sch.trigger_days);
      const trigType   = String(sch.trigger_type);

      let dateCond = '';
      if      (trigType === 'BEFORE_DUE') dateCond = `AND due_date = CURRENT_DATE + INTERVAL '${days} days'`;
      else if (trigType === 'ON_DUE')     dateCond = `AND due_date = CURRENT_DATE`;
      else /* AFTER_DUE */                dateCond = `AND due_date = CURRENT_DATE - INTERVAL '${days} days'`;

      let moduleWhere = '';
      if (sch.module_filter) moduleWhere += ` AND module = '${String(sch.module_filter).replace(/'/g,"''")}'`;
      if (sch.branch_filter) moduleWhere += ` AND branch = '${String(sch.branch_filter).replace(/'/g,"''")}'`;

      const due_invoices = await prisma.$queryRawUnsafe(`
        SELECT id, invoice_number, client_name, client_email, total_amount, paid_amount, due_date
        FROM finance_invoices
        WHERE deleted_at IS NULL
          AND payment_status NOT IN ('PAID','CANCELLED')
          ${dateCond}
          ${moduleWhere}
      `).catch(() => []) as Record<string, unknown>[];

      const firedInvoices: string[] = [];

      for (const inv of due_invoices) {
        const invId  = inv.id instanceof Buffer ? inv.id.toString('hex') : String(inv.id);
        const invNo  = String(inv.invoice_number);
        const amount = (Number(inv.total_amount) - Number(inv.paid_amount)).toLocaleString('en-AE', { minimumFractionDigits: 2 });
        const dueD   = inv.due_date ? new Date(String(inv.due_date)).toLocaleDateString('en-GB') : '—';

        // De-dup: skip if already sent for same schedule + invoice today
        const already = await prisma.$queryRawUnsafe(`
          SELECT 1 FROM finance_reminder_log
          WHERE schedule_id = $1::uuid AND invoice_id = $2 AND sent_at::date = CURRENT_DATE
          LIMIT 1
        `, schId, invId).catch(() => []) as unknown[];

        if (already.length) continue;

        const body = String(sch.template_body)
          .replace(/\{client_name\}/g, String(inv.client_name))
          .replace(/\{invoice_no\}/g,  invNo)
          .replace(/\{amount\}/g,      `AED ${amount}`)
          .replace(/\{due_date\}/g,    dueD);

        const subject = String(sch.template_subject)
          .replace(/\{invoice_no\}/g, invNo)
          .replace(/\{client_name\}/g, String(inv.client_name));

        // In production: send email/SMS/WhatsApp here.
        // For now: log as SENT (simulated delivery)
        await prisma.$executeRawUnsafe(`
          INSERT INTO finance_reminder_log
            (schedule_id, invoice_id, invoice_no, client_name, client_email, channel, subject, body, status)
          VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, 'SENT')
        `,
          schId, invId, invNo,
          String(inv.client_name), inv.client_email ?? null,
          String(sch.channel), subject, body
        );

        firedInvoices.push(invNo);
        totalFired++;
      }

      if (firedInvoices.length) {
        results.push({ schedule: String(sch.name), fired: firedInvoices.length, invoices: firedInvoices });
      }
    }

    return NextResponse.json({ totalFired, results });
  }

  // ── Create new schedule ───────────────────────────────────────────────────
  const rows = await prisma.$queryRawUnsafe(`
    INSERT INTO finance_reminder_schedules
      (name, trigger_type, trigger_days, channel, template_subject, template_body, module_filter, branch_filter)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING *
  `,
    b.name, b.trigger_type ?? 'AFTER_DUE', b.trigger_days ?? 7,
    b.channel ?? 'EMAIL', b.template_subject, b.template_body,
    b.module_filter ?? null, b.branch_filter ?? null
  ) as Record<string, unknown>[];

  return NextResponse.json(rows[0], { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const b = await req.json();
  const { id } = b;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  if ('is_active' in b) {
    await prisma.$executeRawUnsafe(
      `UPDATE finance_reminder_schedules SET is_active = $2, updated_at = NOW() WHERE id = $1::uuid`,
      id, b.is_active
    );
  }

  const allowed = ['name','trigger_type','trigger_days','channel','template_subject','template_body','module_filter','branch_filter'];
  const updates: string[] = [];
  const vals: unknown[]   = [id];
  let pi = 2;
  for (const key of allowed) {
    if (key in b) { updates.push(`${key} = $${pi++}`); vals.push(b[key]); }
  }
  if (updates.length) {
    updates.push('updated_at = NOW()');
    await prisma.$executeRawUnsafe(
      `UPDATE finance_reminder_schedules SET ${updates.join(', ')} WHERE id = $1::uuid`,
      ...vals
    );
  }

  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM finance_reminder_schedules WHERE id = $1::uuid`, id
  ) as Record<string, unknown>[];
  return NextResponse.json(rows[0]);
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  await prisma.$executeRawUnsafe(`DELETE FROM finance_reminder_schedules WHERE id = $1::uuid`, id);
  return NextResponse.json({ ok: true });
}
