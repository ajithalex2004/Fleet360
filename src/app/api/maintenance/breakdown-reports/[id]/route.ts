export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { publishRecoveryCompleted } from '@/lib/maintenance/publish-event';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
// ── GET /api/maintenance/breakdown-reports/[id] ───────────────────────────────

export async function GET(
    _request: NextRequest,
    props: { params: Promise<{ id: string }> },
) {
    const params = await props.params;

    const authz = requireAuthorizedTenant({ headers: _request.headers, nextUrl: _request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const report = await tx.breakdownReport.findUnique({
                where: { id: params.id },
                include: {
                    MaintenanceRequest: true,
                },
            });

            if (!report || report.deletedAt) {
                return NextResponse.json({ error: 'Breakdown report not found' }, { status: 404 });
            }

            return NextResponse.json(JSON.parse(JSON.stringify(report)));
        } catch (e) {
            console.error('Failed to fetch breakdown report:', e);
            return NextResponse.json(
                { error: 'Internal Server Error', details: String(e) },
                { status: 500 },
            );
        }
  });
}


// ── PATCH /api/maintenance/breakdown-reports/[id] ─────────────────────────────
// Handles generic status updates (RECOVERY_COMPLETED → AT_WORKSHOP → RESOLVED)
// and field patches (recoveryNotes, recoveryCompletedAt, etc.)
//
// Status transitions allowed here:
//   RECOVERY_DISPATCHED → RECOVERY_COMPLETED
//   RECOVERY_COMPLETED  → AT_WORKSHOP
//   AT_WORKSHOP         → RESOLVED

export async function PATCH(
    request: NextRequest,
    props: { params: Promise<{ id: string }> },
) {
    const params = await props.params;

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const { id } = params;
            const body   = await request.json();

            const existing = await tx.breakdownReport.findUnique({ where: { id } });
            if (!existing || existing.deletedAt) {
                return NextResponse.json({ error: 'Breakdown report not found' }, { status: 404 });
            }

            const newStatus: string | undefined = body.status;

            // Validate allowed transitions
            const TRANSITIONS: Record<string, string[]> = {
                REPORTED:             ['RECOVERY_DISPATCHED'],
                RECOVERY_DISPATCHED:  ['RECOVERY_COMPLETED'],
                RECOVERY_COMPLETED:   ['AT_WORKSHOP'],
                AT_WORKSHOP:          ['RESOLVED'],
            };

            if (newStatus && newStatus !== existing.status) {
                const allowed = TRANSITIONS[existing.status] ?? [];
                if (!allowed.includes(newStatus)) {
                    return NextResponse.json(
                        { error: `Transition ${existing.status} → ${newStatus} is not allowed` },
                        { status: 422 },
                    );
                }
            }

            const now = new Date();

            // Build data patch — only pick known writable fields from body
            const data: Record<string, unknown> = {};
            if (newStatus)                 data.status = newStatus;
            if (body.recoveryNotes         !== undefined) data.recoveryNotes = body.recoveryNotes;
            if (body.recoveryCompletedAt   !== undefined) data.recoveryCompletedAt = new Date(body.recoveryCompletedAt);
            if (body.driverNotes           !== undefined) data.driverNotes = body.driverNotes;
            if (body.location              !== undefined) data.location = body.location;
            if (body.severity              !== undefined) data.severity = body.severity;

            // Auto-stamp recoveryCompletedAt when transitioning to RECOVERY_COMPLETED
            if (newStatus === 'RECOVERY_COMPLETED' && !data.recoveryCompletedAt) {
                data.recoveryCompletedAt = now;
            }

            const updated = await tx.breakdownReport.update({
                where: { id },
                data,
                include: {
                    MaintenanceRequest: {
                        select: { id: true, status: true, workOrderNo: true },
                    },
                },
            });

            // Publish RecoveryCompleted when vehicle reaches workshop
            if (newStatus === 'RECOVERY_COMPLETED') {
                publishRecoveryCompleted(id, updated.tenantId, {
                    reportId:             id,
                    vehicleId:            updated.vehicleId ?? '',
                    tenantId:             updated.tenantId,
                    maintenanceRequestId: updated.maintenanceRequestId,
                    completedAt:          now.toISOString(),
                }).catch(err => console.warn('[maintenance] recovery_completed publish failed:', err));
            }

            return NextResponse.json(JSON.parse(JSON.stringify(updated)));
        } catch (e) {
            console.error('Failed to update breakdown report:', e);
            return NextResponse.json(
                { error: 'Internal Server Error', details: String(e) },
                { status: 500 },
            );
        }
  });
}

