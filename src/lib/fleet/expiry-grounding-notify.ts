/**
 * Notification side-effects for the fleet expiry/grounding sweep.
 *
 * Extracted so both the UI-triggered route (single tenant, on demand) and
 * the cron job handler (all active tenants) fire the exact same in-app
 * alert + staff digest email, rather than drift apart as two copies.
 *
 * Callers must invoke this AFTER their own transaction/tx has committed —
 * raiseAlert()'s outbox insert and the SMTP round-trip both use their own
 * prisma client call, and doing that from inside an already-open
 * withTenantRls transaction risks sharing (and poisoning) its connection,
 * the same class of bug fixed earlier in ensureFleetSchema().
 */

import { prisma } from '@/lib/prisma';
import { raiseAlert } from '@/lib/alerts/raise';
import { sendEmail } from '@/services/email/emailService';
import { captureException } from '@/lib/sentry';
import type { VehicleComplianceRecord } from '@/lib/fleet/expiry-grounding-engine';

export async function notifyGroundingChanges(
  tenantId: string,
  vehicleRecords: VehicleComplianceRecord[],
): Promise<void> {
  const grounded = vehicleRecords.filter((v) => v.actionTaken === 'GROUNDED');
  const restored = vehicleRecords.filter((v) => v.actionTaken === 'UNGROUNDED');
  if (grounded.length === 0 && restored.length === 0) return;

  await Promise.all([
    ...grounded.map((v) =>
      raiseAlert({
        tenantId,
        code: 'VEHICLE_GROUNDED',
        sourceModule: 'fleet',
        subjectType: 'Vehicle',
        subjectId: v.vehicleId,
        title: `Vehicle auto-grounded: ${v.vehicleCode} (${v.licensePlate})`,
        description: v.actionReason,
        severity: 'CRITICAL',
        context: { vehicleCode: v.vehicleCode, licensePlate: v.licensePlate, makeModel: v.makeModel },
      }).catch((err) => captureException(err, { context: 'fleet.expiry-sweep.raiseAlert', tags: { vehicleId: v.vehicleId } })),
    ),
    ...restored.map((v) =>
      raiseAlert({
        tenantId,
        code: 'VEHICLE_RESTORED',
        sourceModule: 'fleet',
        subjectType: 'Vehicle',
        subjectId: v.vehicleId,
        title: `Vehicle restored to service: ${v.vehicleCode} (${v.licensePlate})`,
        description: v.actionReason,
        severity: 'LOW',
        context: { vehicleCode: v.vehicleCode, licensePlate: v.licensePlate, makeModel: v.makeModel },
      }).catch((err) => captureException(err, { context: 'fleet.expiry-sweep.raiseAlert', tags: { vehicleId: v.vehicleId } })),
    ),
  ]);

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { contactEmail: true, contactName: true, name: true },
  });
  if (!tenant?.contactEmail) return;

  const rows = [
    ...grounded.map((v) => `<li style="color:#dc2626"><strong>GROUNDED</strong> — ${v.vehicleCode} (${v.licensePlate}, ${v.makeModel}): ${v.actionReason}</li>`),
    ...restored.map((v) => `<li>Restored to service — ${v.vehicleCode} (${v.licensePlate}, ${v.makeModel})</li>`),
  ].join('');

  await sendEmail({
    to: [{ email: tenant.contactEmail, name: tenant.contactName ?? tenant.name }],
    subject: `Fleet compliance sweep: ${grounded.length} vehicle(s) grounded, ${restored.length} restored`,
    htmlBody: `<p>Dear ${tenant.contactName ?? tenant.name},</p>
      <p>The automated document-expiry sweep just changed the following vehicles' status:</p>
      <ul>${rows}</ul>
      <p>Grounded vehicles are no longer available for dispatch until their expired document is renewed.</p>
      <p>Best regards,<br/>Fleet360</p>`,
  }).catch((err) => captureException(err, { context: 'fleet.expiry-sweep.email', tags: { tenantId } }));
}
