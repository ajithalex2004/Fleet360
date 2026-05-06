/**
 * Guardian-facing notifications for the school bus module.
 *
 * Wraps the platform whatsapp + email helpers with the school-bus
 * specific guardian-resolution + escalation pattern:
 *
 *   1. Try guardian1 (WhatsApp first if phone known, fall back to email).
 *   2. If guardian1 channel is "not_configured" / network errors, try
 *      guardian2 with the same channel preference.
 *   3. Best-effort — logs to school_bus_guardian_notifications and
 *      Sentry; never throws into the trip flow.
 *
 * Public events: DEPARTURE, ETA_5MIN, BOARDED, ALIGHTED, NO_SHOW,
 *                NO_PICKUP, INCIDENT, CUSTOM.
 */

import { prisma } from '@/lib/prisma';
import { sendWhatsApp } from '@/lib/whatsapp';
import { sendEmail } from '@/lib/email';
import { captureException } from '@/lib/sentry';

export type GuardianNotificationKind =
  | 'DEPARTURE'
  | 'ETA_5MIN'
  | 'BOARDED'
  | 'ALIGHTED'
  | 'NO_SHOW'
  | 'NO_PICKUP'
  | 'INCIDENT'
  | 'CUSTOM';

export interface StudentForNotify {
  studentId: string;
  studentCode: string | null;
  firstName: string | null;
  lastName: string | null;
  guardian1Name: string | null;
  guardian1Phone: string | null;
  guardian1Email: string | null;
  guardian2Name: string | null;
  guardian2Phone: string | null;
  guardian2Email: string | null;
}

export interface NotifyContext {
  routeName?: string | null;
  stopName?: string | null;
  driverName?: string | null;
  schoolName?: string | null;
  /** Local time string for the message body — caller formats. */
  whenLabel?: string | null;
  customMessage?: string | null;
  /** Free-text reason / details. */
  details?: string | null;
}

interface ChannelResult { sent: boolean; reason?: string }

/* ── Message templates (guardian language is EN-first; expand later) ─ */

function buildMessage(kind: GuardianNotificationKind, student: StudentForNotify, ctx: NotifyContext): { subject: string; body: string } {
  const name = student.firstName ?? `student ${student.studentCode ?? ''}`;
  const route = ctx.routeName ? ` (${ctx.routeName})` : '';
  switch (kind) {
    case 'DEPARTURE':
      return {
        subject: `🚌 Bus departed — ${name}`,
        body: `Hi, ${name}'s school bus${route} has just departed${ctx.schoolName ? ` from ${ctx.schoolName}` : ''}. We'll alert you as it nears your stop.`,
      };
    case 'ETA_5MIN':
      return {
        subject: `🚌 Bus arriving in ~5 min — ${name}`,
        body: `${name}'s school bus${route} is approximately 5 minutes from your stop${ctx.stopName ? ` (${ctx.stopName})` : ''}. Please head out shortly.`,
      };
    case 'BOARDED':
      return {
        subject: `✓ ${name} boarded`,
        body: `Confirmed: ${name} has boarded the bus${route}${ctx.whenLabel ? ` at ${ctx.whenLabel}` : ''}. Have a good day!`,
      };
    case 'ALIGHTED':
      return {
        subject: `✓ ${name} dropped off`,
        body: `Confirmed: ${name} has been dropped off${ctx.stopName ? ` at ${ctx.stopName}` : ''}${ctx.whenLabel ? ` at ${ctx.whenLabel}` : ''}.`,
      };
    case 'NO_SHOW':
      return {
        subject: `⚠ ${name} did NOT board today's bus`,
        body: `${name} did not board the school bus at the scheduled stop${ctx.stopName ? ` (${ctx.stopName})` : ''}${ctx.whenLabel ? ` at ${ctx.whenLabel}` : ''}. If this is unexpected, please contact the school transport office immediately.`,
      };
    case 'NO_PICKUP':
      return {
        subject: `⚠ Bus did not stop for ${name}`,
        body: `Our records show the bus passed your scheduled stop${ctx.stopName ? ` (${ctx.stopName})` : ''} without stopping. Please contact transport ops if ${name} has been left behind.`,
      };
    case 'INCIDENT':
      return {
        subject: `⚠ Bus incident — ${name}'s route`,
        body: `An incident has been logged on ${name}'s school bus route${route}. ${ctx.details ?? ''} School transport ops will be in touch with details.`,
      };
    case 'CUSTOM':
      return {
        subject: `Bus update — ${name}`,
        body: ctx.customMessage ?? '(empty message)',
      };
  }
}

/* ── Send to a specific guardian (WhatsApp first, email fallback) ─── */

interface PerGuardianResult {
  guardian: 'GUARDIAN_1' | 'GUARDIAN_2';
  whatsapp: ChannelResult | null;
  email: ChannelResult | null;
  reachedAtLeastOnce: boolean;
}

async function tryGuardian(
  which: 'GUARDIAN_1' | 'GUARDIAN_2',
  phone: string | null, email: string | null,
  msg: { subject: string; body: string },
): Promise<PerGuardianResult> {
  const result: PerGuardianResult = { guardian: which, whatsapp: null, email: null, reachedAtLeastOnce: false };
  if (phone) {
    const r = await sendWhatsApp({ to: phone, body: msg.body });
    result.whatsapp = { sent: r.sent, reason: r.reason };
    if (r.sent) result.reachedAtLeastOnce = true;
  }
  if (email) {
    const r = await sendEmail({ to: email, subject: msg.subject, text: msg.body });
    result.email = { sent: r.sent, reason: r.reason };
    if (r.sent) result.reachedAtLeastOnce = true;
  }
  return result;
}

/* ── Public: notify guardians with escalation + log ───────────────── */

export interface NotifyGuardiansResult {
  ok: boolean;
  reachedGuardian1: boolean;
  reachedGuardian2: boolean;
  attempts: PerGuardianResult[];
}

export async function notifyGuardians(
  kind: GuardianNotificationKind,
  student: StudentForNotify,
  ctx: NotifyContext = {},
): Promise<NotifyGuardiansResult> {
  const msg = buildMessage(kind, student, ctx);
  const attempts: PerGuardianResult[] = [];

  const g1 = await tryGuardian('GUARDIAN_1', student.guardian1Phone, student.guardian1Email, msg);
  attempts.push(g1);

  // Escalate to guardian2 only if guardian1 didn't reach (no phone/email or both failed).
  let g2: PerGuardianResult | null = null;
  if (!g1.reachedAtLeastOnce && (student.guardian2Phone || student.guardian2Email)) {
    g2 = await tryGuardian('GUARDIAN_2', student.guardian2Phone, student.guardian2Email, msg);
    attempts.push(g2);
  }

  // Persist to log for parent timeline + audit.
  try {
    await ensureGuardianNotificationsTable();
    await prisma.$executeRawUnsafe(
      `INSERT INTO school_bus_guardian_notifications
         (student_id, kind, subject, body, reached_guardian1, reached_guardian2,
          attempts_json, sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())`,
      student.studentId, kind, msg.subject, msg.body,
      g1.reachedAtLeastOnce, g2?.reachedAtLeastOnce ?? false,
      JSON.stringify(attempts),
    );
  } catch (err) {
    captureException(err, { context: 'school-bus.notifyGuardians.log', tags: { studentId: student.studentId, kind } });
  }

  return {
    ok: g1.reachedAtLeastOnce || (g2?.reachedAtLeastOnce ?? false),
    reachedGuardian1: g1.reachedAtLeastOnce,
    reachedGuardian2: g2?.reachedAtLeastOnce ?? false,
    attempts,
  };
}

/* ── Lazy table for the notification log ─────────────────────────── */

export async function ensureGuardianNotificationsTable(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS school_bus_guardian_notifications (
      id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
      student_id         UUID         NOT NULL,
      kind               TEXT         NOT NULL,
      subject            TEXT,
      body               TEXT,
      reached_guardian1  BOOLEAN      NOT NULL DEFAULT FALSE,
      reached_guardian2  BOOLEAN      NOT NULL DEFAULT FALSE,
      attempts_json      JSONB,
      sent_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS idx_school_bus_guardian_notif_student
     ON school_bus_guardian_notifications (student_id, sent_at DESC)`,
  );
}

/* ── Hydrate student from DB by studentId ─────────────────────────── */

export async function loadStudentForNotify(studentId: string): Promise<StudentForNotify | null> {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT id, student_code, first_name, last_name,
            guardian1_name, guardian1_phone, guardian1_email,
            guardian2_name, guardian2_phone, guardian2_email
     FROM school_bus_students WHERE id = $1::uuid AND deleted_at IS NULL`,
    studentId,
  ).catch(() => []);
  const r = rows[0];
  if (!r) return null;
  return {
    studentId: String(r.id),
    studentCode: (r.student_code as string) ?? null,
    firstName: (r.first_name as string) ?? null,
    lastName: (r.last_name as string) ?? null,
    guardian1Name: (r.guardian1_name as string) ?? null,
    guardian1Phone: (r.guardian1_phone as string) ?? null,
    guardian1Email: (r.guardian1_email as string) ?? null,
    guardian2Name: (r.guardian2_name as string) ?? null,
    guardian2Phone: (r.guardian2_phone as string) ?? null,
    guardian2Email: (r.guardian2_email as string) ?? null,
  };
}
