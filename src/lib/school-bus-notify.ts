/**
 * Guardian-facing notifications for the school bus module.
 *
 * For each student:
 *   1. Try guardian1 (WhatsApp if a phone is known, and email if an
 *      address is known).
 *   2. If neither reached guardian1, try guardian2 the same way.
 *   3. Log to school_bus_guardian_notifications (parent timeline + audit).
 *
 * The wording is the tenant's email template for the event (Admin > Email
 * templates > School bus), in the tenant's language; WhatsApp gets the
 * same text as the email.
 *
 * Runs detached from the caller's transaction and never throws, so callers
 * in the trip flow can fire and forget it: an unawaited call made inside
 * withTenantRls would otherwise run its queries on that transaction after
 * it has committed.
 */
import 'server-only';
import { prisma } from '@/lib/prisma';
import { runAsTenant, runOutsideRlsScope } from '@/lib/rls-scope';
import { sendWhatsApp } from '@/lib/whatsapp';
import { sendEmail } from '@/lib/email';
import { captureException } from '@/lib/sentry';
import { loadEmailTemplate } from '@/lib/email-templates';

export type GuardianNotificationKind = 'DEPARTURE' | 'BOARDED' | 'ALIGHTED' | 'NO_SHOW' | 'INCIDENT';

export const GUARDIAN_TEMPLATE_KEY: Record<GuardianNotificationKind, string> = {
  DEPARTURE: 'school_bus.departure',
  BOARDED: 'school_bus.boarded',
  ALIGHTED: 'school_bus.dropped_off',
  NO_SHOW: 'school_bus.no_show',
  INCIDENT: 'school_bus.incident',
};

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

export interface GuardianNotice {
  studentId: string;
  stopName?: string | null;
  /** Local time for the message, formatted by the caller. */
  time?: string | null;
  /** What was logged (incidents). */
  details?: string | null;
}

interface ChannelResult { sent: boolean; reason?: string }

interface Message { subject: string; html: string; text: string }

interface PerGuardianResult {
  guardian: 'GUARDIAN_1' | 'GUARDIAN_2';
  whatsapp: ChannelResult | null;
  email: ChannelResult | null;
  reachedAtLeastOnce: boolean;
}

export interface NotifyGuardiansResult {
  studentId: string;
  ok: boolean;
  reachedGuardian1: boolean;
  reachedGuardian2: boolean;
  attempts: PerGuardianResult[];
}

async function tryGuardian(
  which: 'GUARDIAN_1' | 'GUARDIAN_2',
  phone: string | null, email: string | null,
  msg: Message,
): Promise<PerGuardianResult> {
  const result: PerGuardianResult = { guardian: which, whatsapp: null, email: null, reachedAtLeastOnce: false };
  if (phone) {
    const r = await sendWhatsApp({ to: phone, body: msg.text });
    result.whatsapp = { sent: r.sent, reason: r.reason };
    if (r.sent) result.reachedAtLeastOnce = true;
  }
  if (email) {
    const r = await sendEmail({ to: email, subject: msg.subject, html: msg.html, text: msg.text });
    result.email = { sent: r.sent, reason: r.reason };
    if (r.sent) result.reachedAtLeastOnce = true;
  }
  return result;
}

async function notifyOne(kind: GuardianNotificationKind, student: StudentForNotify, msg: Message): Promise<NotifyGuardiansResult> {
  const attempts: PerGuardianResult[] = [];
  const g1 = await tryGuardian('GUARDIAN_1', student.guardian1Phone, student.guardian1Email, msg);
  attempts.push(g1);

  // Escalate to guardian2 only if guardian1 wasn't reached.
  let g2: PerGuardianResult | null = null;
  if (!g1.reachedAtLeastOnce && (student.guardian2Phone || student.guardian2Email)) {
    g2 = await tryGuardian('GUARDIAN_2', student.guardian2Phone, student.guardian2Email, msg);
    attempts.push(g2);
  }

  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO school_bus_guardian_notifications
         (student_id, kind, subject, body, reached_guardian1, reached_guardian2,
          attempts_json, sent_at)
       VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::jsonb, NOW())`,
      student.studentId, kind, msg.subject, msg.text,
      g1.reachedAtLeastOnce, g2?.reachedAtLeastOnce ?? false,
      JSON.stringify(attempts),
    );
  } catch (err) {
    captureException(err, { context: 'school-bus.notifyGuardians.log', tags: { studentId: student.studentId, kind } });
  }

  return {
    studentId: student.studentId,
    ok: g1.reachedAtLeastOnce || (g2?.reachedAtLeastOnce ?? false),
    reachedGuardian1: g1.reachedAtLeastOnce,
    reachedGuardian2: g2?.reachedAtLeastOnce ?? false,
    attempts,
  };
}

/**
 * Notifies the guardians of each student in `notices` about one event.
 * `tenantId` is the tenant the students belong to (from the session or the
 * trip record, never request input).
 */
export function notifyGuardians(
  tenantId: string,
  kind: GuardianNotificationKind,
  notices: GuardianNotice[],
): Promise<NotifyGuardiansResult[]> {
  if (notices.length === 0) return Promise.resolve([]);
  return runOutsideRlsScope(() => runAsTenant(tenantId, async () => {
    const results: NotifyGuardiansResult[] = [];
    try {
      const template = await loadEmailTemplate({ tenantId, key: GUARDIAN_TEMPLATE_KEY[kind] });
      for (const notice of notices) {
        try {
          const student = await loadStudentForNotify(notice.studentId);
          if (!student) continue;
          const msg = template.render({
            values: {
              studentName: student.firstName ?? '',
              stopName: notice.stopName ?? '',
              time: notice.time ?? '',
              details: notice.details ?? '',
            },
          });
          results.push(await notifyOne(kind, student, msg));
        } catch (err) {
          captureException(err, { context: 'school-bus.notifyGuardians', tags: { studentId: notice.studentId, kind, tenantId } });
        }
      }
    } catch (err) {
      captureException(err, { context: 'school-bus.notifyGuardians.template', tags: { kind, tenantId } });
    }
    return results;
  }));
}

/** The student's name and guardian contacts (RLS scopes it to the current tenant). */
export async function loadStudentForNotify(studentId: string): Promise<StudentForNotify | null> {
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT id, student_code, first_name, last_name,
            guardian1_name, guardian1_phone, guardian1_email,
            guardian2_name, guardian2_phone, guardian2_email
     FROM school_bus_students WHERE id = $1::uuid AND deleted_at IS NULL`,
    studentId,
  );
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
