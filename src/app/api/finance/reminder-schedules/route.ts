/**
 * Automated Payment Reminder Schedules — /api/finance/reminder-schedules
 * Defines when reminders fire (X days before due, Y days after due).
 * A separate /api/finance/reminder-schedules/run endpoint processes due reminders.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

async function bootstrap() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS finance_reminder_schedules (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name            TEXT NOT NULL,
      trigger_type    TEXT NOT NULL DEFAULT 'AFTER_DUE',
      trigger_days    INTEGER NOT NULL DEFAULT 7,
      channel         TEXT NOT NULL DEFAULT 'EMAIL',
      template_subject TEXT NOT NULL DEFAULT 'Payment Reminder',
      template_body   TEXT NOT NULL,
      is_active       BOOLEAN NOT NULL DEFAULT TRUE,
      module_filter   TEXT,
      branch_filter   TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS finance_reminder_log (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      schedule_id     UUID REFERENCES finance_reminder_schedules(id) ON DELETE SET NULL,
      invoice_id      TEXT NOT NULL,
      invoice_no      TEXT NOT NULL,
      client_name     TEXT NOT NULL,
      client_email    TEXT,
      channel         TEXT NOT NULL,
      subject         TEXT,
      body            TEXT,
      status          TEXT NOT NULL DEFAULT 'SENT',
      error_message   TEXT,
      sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Seed default schedules if none exist
  const cnt = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) AS c FROM finance_reminder_schedules`
  ) as { c: bigint | number }[];
  if (Number(cnt[0].c) === 0) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO finance_reminder_schedules
        (name, trigger_type, trigger_days, channel, template_subject, template_body)
      VALUES
        ('7-Day Pre-Due Reminder', 'BEFORE_DUE', 7, 'EMAIL',
         'Payment Due in 7 Days — Invoice {invoice_no}',
         'Dear {client_name},\n\nThis is a friendly reminder that invoice {invoice_no} for AED {amount} is due on {due_date}.\n\nPlease arrange payment at your earliest convenience.\n\nRegards,\nFinance Team'),
        ('Due Date Reminder',      'ON_DUE',     0, 'EMAIL',
         'Invoice {invoice_no} Due Today',
         'Dear {client_name},\n\nInvoice {invoice_no} for AED {amount} is due today.\n\nPlease process payment to avoid any service interruption.\n\nRegards,\nFinance Team'),
        ('7-Day Overdue Notice',   'AFTER_DUE',  7, 'EMAIL',
         'OVERDUE: Invoice {invoice_no} — 7 Days Past Due',
         'Dear {client_name},\n\nInvoice {invoice_no} for AED {amount} is now 7 days overdue.\n\nPlease settle the outstanding balance immediately or contact us to discuss payment arrangements.\n\nRegards,\nFinance Team'),
        ('30-Day Final Notice',    'AFTER_DUE',  30, 'EMAIL',
         'FINAL NOTICE: Invoice {invoice_no} — 30 Days Overdue',
         'Dear {client_name},\n\nThis is a final notice for invoice {invoice_no} for AED {amount}, now 30 days overdue.\n\nFurther delay may result in service suspension and legal action.\n\nRegards,\nFinance Team'),
        ('WhatsApp 3-Day Nudge',   'AFTER_DUE',  3, 'WHATSAPP',
         'Payment Overdue',
         'Hi {client_name}, your invoice {invoice_no} for AED {amount} is overdue by 3 days. Please make payment to avoid disruption.')
    `);
  }
}

export async function GET(req: NextRequest) {
  await bootstrap();
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
  await bootstrap();
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
  await bootstrap();
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
  await bootstrap();
  const { id } = await req.json();
  await prisma.$executeRawUnsafe(`DELETE FROM finance_reminder_schedules WHERE id = $1::uuid`, id);
  return NextResponse.json({ ok: true });
}
