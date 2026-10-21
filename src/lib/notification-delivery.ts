/**
 * Deliver a rule-based notification now, in the event's tenant.
 *
 * NotificationDispatchConsumer and AlertEngineConsumer used to write
 * NotificationLog rows with status 'Pending' for a "channel worker" to
 * send. No such worker exists, so none of those notifications was ever
 * delivered. A worker could not have done it either: NotificationLog has no
 * tenant, and the rows held role names (FLEET_MANAGER, ADMIN) that only the
 * event's tenant can resolve to people.
 *
 * Here the recipient is resolved in the tenant and the message is sent
 * through the platform email sender, which records the outcome in
 * NotificationLog (Sent / MockSent / Failed). What cannot be sent is
 * recorded as such instead of waiting forever:
 *   - Unsupported  — a channel with no sender here (SMS, WhatsApp, …)
 *   - Undeliverable — a recipient that resolves to no address
 *
 * Never throws: a delivery failure is recorded, not retried, so a retry of
 * the event cannot email the recipients who already got it.
 */
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { sendServerEmail } from '@/lib/notifications';
import { getRoleHolders } from '@/lib/workflow-db';

/** Rule recipient types that name a tenant role, and the role's code. */
const ROLE_RECIPIENTS: Record<string, string> = {
  FLEET_MANAGER: 'FLEET_MANAGER',
  ADMIN: 'TENANT_ADMIN',
};

const EMAIL_RE = /^[^\s@"'{}<>]+@[^\s@"'{}<>]+\.[^\s@"'{}<>]+$/;

/** Email addresses for one rule recipient: `{"email":…}`, an address, or a role. */
export async function resolveRecipient(tenantId: string, recipient: string): Promise<string[]> {
  const r = recipient.trim();
  // JSON first: `{"email":"a@b.c"}` would otherwise pass as an address.
  if (r.startsWith('{')) {
    try {
      const parsed = JSON.parse(r) as { email?: unknown };
      if (typeof parsed?.email === 'string' && EMAIL_RE.test(parsed.email.trim())) return [parsed.email.trim().toLowerCase()];
    } catch { /* not JSON */ }
    return [];
  }
  if (EMAIL_RE.test(r)) return [r.toLowerCase()];
  const role = ROLE_RECIPIENTS[r.toUpperCase()];
  if (role) return (await getRoleHolders(tenantId, role)).map((h) => h.email);
  return [];
}

export type DeliveryOutcome = 'Sent' | 'Failed' | 'Unsupported' | 'Undeliverable';

async function record(recipient: string, channel: string, subject: string, body: string, triggerReason: string, status: string) {
  await prisma.notificationLog.create({
    data: { id: randomUUID(), recipient, type: channel, subject, body, triggerReason, status },
  }).catch((e) => console.error('[notification-delivery] could not record outcome:', e));
}

export async function deliverNotification(args: {
  tenantId: string;
  channel: string;
  recipient: string;
  subject: string;
  body: string;
  triggerReason: string;
}): Promise<DeliveryOutcome[]> {
  const { tenantId, channel, recipient, subject, body, triggerReason } = args;

  if (channel.trim().toUpperCase() !== 'EMAIL') {
    await record(recipient, channel, subject, body, triggerReason, 'Unsupported');
    return ['Unsupported'];
  }

  let addresses: string[];
  try {
    addresses = await resolveRecipient(tenantId, recipient);
  } catch (e) {
    console.error(`[notification-delivery] could not resolve ${recipient}:`, e);
    await record(recipient, channel, subject, body, triggerReason, 'Failed');
    return ['Failed'];
  }
  if (addresses.length === 0) {
    await record(recipient, channel, subject, body, triggerReason, 'Undeliverable');
    return ['Undeliverable'];
  }

  const outcomes: DeliveryOutcome[] = [];
  for (const address of addresses) {
    // sendServerEmail records its own NotificationLog row and never throws.
    outcomes.push((await sendServerEmail(address, subject, body, triggerReason)) ? 'Sent' : 'Failed');
  }
  return outcomes;
}
