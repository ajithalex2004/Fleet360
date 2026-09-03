export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { executeFleetExpirySweep, type VehicleComplianceRecord } from '@/lib/fleet/expiry-grounding-engine';
import { raiseAlert } from '@/lib/alerts/raise';
import { sendEmail } from '@/services/email/emailService';
import { captureException } from '@/lib/sentry';

/**
 * GET /api/fleet/documents/sweep
 * Returns the current fleet compliance health matrix and grounded vehicles (dry run).
 */
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const sp = req.nextUrl.searchParams;
  const gracePeriod = parseInt(sp.get('mulkiyaGracePeriodDays') ?? '30', 10);

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const summary = await executeFleetExpirySweep(tx, tenantId, {
        mulkiyaGracePeriodDays: gracePeriod,
        dryRun: true,
      });

      return NextResponse.json(summary);
    } catch (err) {
      console.error('[fleet-documents-sweep] GET failed:', err);
      return NextResponse.json(
        { error: 'Failed to evaluate fleet document compliance' },
        { status: 500 }
      );
    }
  });
}

/**
 * POST /api/fleet/documents/sweep
 * Triggers an active fleet-wide expiry sweep and auto-grounds non-compliant assets in DB.
 */
export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant(req);
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  let gracePeriod = 30;
  try {
    const body = await req.json();
    if (typeof body.mulkiyaGracePeriodDays === 'number') {
      gracePeriod = body.mulkiyaGracePeriodDays;
    }
  } catch {
    // Fallback to default 30 days
  }

  let summary;
  try {
    summary = await withTenantRls(prisma, tenantId, (tx) =>
      executeFleetExpirySweep(tx, tenantId, {
        mulkiyaGracePeriodDays: gracePeriod,
        dryRun: false,
      }),
    );
  } catch (err) {
    console.error('[fleet-documents-sweep] POST failed:', err);
    return NextResponse.json(
      { error: 'Failed to execute fleet expiry sweep' },
      { status: 500 }
    );
  }

  // Notifications run after the RLS transaction has committed — grounding a
  // vehicle used to be a silent status flip with no alert and no email, so a
  // dispatcher could plan a route around a vehicle that had already been
  // pulled from service. Both an in-app Alert and a staff email fire here;
  // best-effort, and deliberately outside withTenantRls so neither the
  // outbox insert nor the SMTP round-trip shares a connection with (and
  // risks poisoning) the sweep's own transaction.
  await notifyGroundingChanges(tenantId, summary.vehicleRecords).catch((err) => {
    captureException(err, { context: 'fleet.expiry-sweep.notify', tags: { tenantId } });
  });

  return NextResponse.json({
    success: true,
    summary,
    message: `Sweep completed. ${summary.newlyGroundedCount} vehicle(s) grounded, ${summary.newlyRestoredCount} restored.`,
  });
}

async function notifyGroundingChanges(tenantId: string, vehicleRecords: VehicleComplianceRecord[]): Promise<void> {
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
