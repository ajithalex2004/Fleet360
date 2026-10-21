export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma }       from '@/lib/prisma';
import {
    approvesEstimate, autoApproveRule, checkApprover, statusKey, ESTIMATION_APPROVED, PENDING_ESTIMATION_APPROVAL,
} from '@/lib/maintenance/approval-rules';
import { callerRoleCodes, loadApprovalRules } from '@/lib/maintenance/approval-rules-db';
import { approvalAmount } from '@/lib/maintenance/estimate-decision';
import { approvalInProgress, withApprovalStart } from '@/lib/workflow/approvals';
import { hasTenantWorkflow } from '@/lib/workflow-db';
import { runAsTenant } from '@/lib/rls-scope';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import {
  publishMaintenanceApproved,
  publishMaintenanceRejected,
  publishQuotationRequested,
  publishQuotationReceived,
  publishEstimationApproved,
  publishWorkOrderCreated,
  publishWorkOrderStarted,
  publishRepairCompleted,
  publishWorkOrderCompleted,
  publishMaintenanceClosed,
} from '@/lib/maintenance/publish-event';

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
    const params = await props.params;

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            const req = await tx.maintenanceRequest.findFirst({
                where: { tenantId, id: params.id, deletedAt: null },
                include: {
                    Vehicle: true,
                    Garage: true,
                    Driver: true,
                    quotations: true,
                    WorkOrder: true,
                    attachments: true,
                    comments: true,
                    histories: true,
                },
            });

            if (!req) {
                return NextResponse.json({ error: 'Request not found' }, { status: 404 });
            }

            return NextResponse.json(JSON.parse(JSON.stringify(req)));
        } catch (e) {
            console.error('Failed to fetch maintenance request:', e);
            return NextResponse.json({ error: 'Failed to fetch request' }, { status: 500 });
        }
  });
}


export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
    const params = await props.params;

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

    // Approval workflow (Admin > Workflows, Maintenance > Estimate Approval):
    // while one is deciding the estimate, the request's status is the
    // workflow's to change; a company with a workflow sends each estimate
    // submitted for approval through it instead of the approval rules.
    const body = await request.json();
    if (body.status !== undefined && statusKey(body.status) !== statusKey(PENDING_ESTIMATION_APPROVAL)) {
        const busy = await approvalInProgress(tenantId, 'maintenance_estimate', params.id);
        if (busy) return busy;
    }
    const workflowDefined = body.status !== undefined
        && await runAsTenant(tenantId, () => hasTenantWorkflow(tenantId, 'MAINTENANCE', 'ESTIMATE_APPROVAL'));
    let startWorkflow = false;

  const response = await withTenantRls(prisma, tenantId, async (tx) => {
    try {

            const before = await tx.maintenanceRequest.findFirst({
                where: { tenantId, id: params.id, deletedAt: null },
                select: { status: true, estimatedCost: true },
            });
            if (!before) {
                return NextResponse.json({ error: 'Request not found' }, { status: 404 });
            }

            const data: Record<string, unknown> = {};
            if (body.vehicleId !== undefined) data.vehicleId = body.vehicleId;
            if (body.vehicle_id !== undefined) data.vehicleId = body.vehicle_id;
            if (body.driverId !== undefined) data.driverId = body.driverId;
            if (body.driver_id !== undefined) data.driverId = body.driver_id;
            if (body.description !== undefined) data.description = body.description;
            if (body.status !== undefined) data.status = body.status;
            if (body.priority !== undefined) data.priority = body.priority;
            if (body.maintenanceType !== undefined) data.maintenanceType = body.maintenanceType;
            if (body.maintenance_type !== undefined) data.maintenanceType = body.maintenance_type;
            if (body.workOrderNo !== undefined) data.workOrderNo = body.workOrderNo;
            if (body.work_order_no !== undefined) data.workOrderNo = body.work_order_no;
            if (body.odometer !== undefined) data.odometer = body.odometer ? BigInt(body.odometer) : null;
            if (body.garageId !== undefined) data.garageId = body.garageId;
            if (body.garage_id !== undefined) data.garageId = body.garage_id;
            if (body.estimatedCost !== undefined) data.estimatedCost = body.estimatedCost;
            if (body.actualCost !== undefined) data.actualCost = body.actualCost;
            if (body.actualPartsCost !== undefined) data.actualPartsCost = body.actualPartsCost;
            if (body.actualLaborCost !== undefined) data.actualLaborCost = body.actualLaborCost;
            if (body.actualOtherCost !== undefined) data.actualOtherCost = body.actualOtherCost;
            if (body.requestDate !== undefined) data.requestDate = body.requestDate ? new Date(body.requestDate) : null;
            if (body.expectedEndDate !== undefined) data.expectedEndDate = body.expectedEndDate ? new Date(body.expectedEndDate) : null;
            if (body.completionDate !== undefined) data.completionDate = body.completionDate ? new Date(body.completionDate) : null;
            if (body.maintenanceJobs !== undefined) data.maintenanceJobs = body.maintenanceJobs;
            if (body.maintenance_jobs !== undefined) data.maintenanceJobs = body.maintenance_jobs;
            if (body.estimateApproval !== undefined) data.estimateApproval = body.estimateApproval;
            if (body.candidateGarageIds !== undefined) data.candidateGarageIds = body.candidateGarageIds;

            // ── Estimate approval rules (src/lib/maintenance/approval-rules.ts) ──
            // Approving an estimate (moving from before approval to
            // Estimation Approved or any later status) needs a role the
            // tenant's rule for its amount names; submitting one inside an
            // auto-approve band approves it straight away. The amount is
            // the stored one (approvalAmount), which the body can raise but
            // not lower. No rule for the amount: unchanged.
            let ruleNote: string | null = null;
            if (typeof data.status === 'string' && statusKey(data.status) !== statusKey(before.status)) {
                // A cost sent with the change can only raise it (an estimate
                // being submitted), never lower what is stored.
                const stored = await approvalAmount(tx, tenantId, params.id, body.selectedQuotationId);
                const sent = body.estimatedCost == null || body.estimatedCost === '' ? NaN : Number(body.estimatedCost);
                const cost = Number.isFinite(sent) ? Math.max(sent, stored ?? sent) : stored;
                if (approvesEstimate(before.status, data.status)) {
                    // A company with an approval workflow approves estimates
                    // through it (submit for approval, then the Approvals Inbox).
                    if (workflowDefined && cost != null) {
                        return NextResponse.json({
                            error: 'This estimate needs approval through the company\'s approval workflow: submit it for approval and decide it from the Approvals Inbox',
                        }, { status: 409 });
                    }
                    const rules = await loadApprovalRules(tx, tenantId);
                    const check = checkApprover(rules, cost, await callerRoleCodes(tx, tenantId, authz.userId, authz.role));
                    if (!check.ok) return NextResponse.json({ error: check.error, rule: check.rule.name }, { status: 403 });
                    if (check.rule) ruleNote = `Approved under rule "${check.rule.name}"`;
                } else if (statusKey(data.status) === statusKey(PENDING_ESTIMATION_APPROVAL)) {
                    const auto = workflowDefined ? null : autoApproveRule(await loadApprovalRules(tx, tenantId), cost);
                    startWorkflow = workflowDefined;
                    if (auto) {
                        data.status = ESTIMATION_APPROVED;
                        ruleNote = `Auto-approved under rule "${auto.name}"`;
                    }
                }
            }

            const updated = await tx.maintenanceRequest.update({
                where: { id: params.id },
                data,
                include: {
                    Vehicle: true,
                    Garage: true,
                    Driver: true,
                    quotations: true,
                    WorkOrder: true,
                    attachments: true,
                    comments: true,
                    histories: true,
                },
            });

            // ── Status-history audit trail ─────────────────────────────────────
            // The frontend sends a `history` snapshot array with each status
            // change, but MaintenanceRequest has no `history` column — persist
            // the transition as a real StatusHistory row instead of dropping it.
            if (typeof data.status === 'string' && data.status !== before.status) {
                const lastEntry = Array.isArray(body.history) && body.history.length > 0
                    ? body.history[body.history.length - 1]
                    : undefined;
                await tx.statusHistory.create({
                    data: {
                        tenantId,
                        maintenanceRequestId: params.id,
                        status: data.status,
                        date: new Date(),
                        note: ruleNote ?? (typeof body.historyNote === 'string' ? body.historyNote : lastEntry?.note) ?? null,
                        actor: (typeof lastEntry?.actor === 'string' ? lastEntry.actor : null) ?? authz.userId ?? 'system',
                    },
                });
            }

            // ── Attachment reconciliation ──────────────────────────────────────
            // The frontend sends the full desired attachment list; match by `url`
            // (client-generated ids aren't real DB ids) and diff against what's
            // already persisted so re-submitting the same list is a no-op.
            if (Array.isArray(body.attachments)) {
                const existingAttachments = await tx.attachment.findMany({
                    where: { tenantId, maintenanceRequestId: params.id, deletedAt: null },
                });
                const incomingUrls = new Set(
                    body.attachments.map((a: any) => a?.url).filter((u: unknown) => typeof u === 'string' && u.length > 0)
                );
                const existingUrls = new Set(existingAttachments.map(a => a.url).filter(Boolean));

                const toRemove = existingAttachments.filter(a => a.url && !incomingUrls.has(a.url));
                for (const att of toRemove) {
                    await tx.attachment.update({ where: { id: att.id }, data: { deletedAt: new Date() } });
                }

                const toAdd = body.attachments.filter((a: any) => typeof a?.url === 'string' && a.url.length > 0 && !existingUrls.has(a.url));
                for (const att of toAdd) {
                    await tx.attachment.create({
                        data: {
                            tenantId,
                            maintenanceRequestId: params.id,
                            type: att.type ?? null,
                            fileName: att.fileName ?? null,
                            url: att.url,
                        },
                    });
                }
            }

            // ── Publish domain events via outbox (Phase D lifecycle) ──────────────
            // Awaited, in this transaction: the status change and its event
            // commit together or not at all (transactional outbox). These were
            // fire-and-forget with .catch: the insert raced the commit and,
            // landing after it, failed with "transaction closed" and was
            // dropped — the change committed with no event.
            const newStatus = (updated as any).status as string | undefined;
            if (newStatus) {
                const req  = updated as any;
                const now  = new Date().toISOString();
                const base = {
                    requestId:  params.id,
                    vehicleId:  req.vehicleId       ?? '',
                    tenantId,
                    garageId:   req.garageId         ?? null,
                    garageName: req.Garage?.name      ?? null,
                };

                switch (newStatus) {
                    case 'APPROVED':
                        await publishMaintenanceApproved(params.id, tenantId, {
                            ...base, approvedBy: req.approvedBy ?? null, approvedAt: now,
                        });
                        break;

                    case 'REJECTED':
                        await publishMaintenanceRejected(params.id, tenantId, {
                            ...base, rejectedBy: req.rejectedBy ?? null, rejectedAt: now,
                            reason: req.rejectionReason ?? null,
                        });
                        break;

                    case 'QUOTATION_REQUESTED':
                        await publishQuotationRequested(params.id, tenantId, {
                            ...base, requestedAt: now,
                        });
                        break;

                    case 'QUOTATION_RECEIVED': {
                        const qid = req.quotations?.[0]?.id ?? params.id;
                        await publishQuotationReceived(qid, tenantId, {
                            ...base,
                            quotationId:  qid,
                            amount:       Number(req.estimatedCost ?? 0),
                            currency:     'AED',
                            receivedAt:   now,
                        });
                        break;
                    }

                    case 'ESTIMATION_APPROVED':
                        await publishEstimationApproved(params.id, tenantId, {
                            ...base,
                            estimatedCost: Number(req.estimatedCost ?? 0),
                            currency:      'AED',
                            approvedBy:    req.approvedBy ?? null,
                            approvedAt:    now,
                        });
                        break;

                    case 'WORK_ORDER_CREATED':
                        await publishWorkOrderCreated(params.id, tenantId, {
                            ...base,
                            workOrderId:  req.WorkOrder?.id   ?? params.id,
                            workOrderNo:  req.workOrderNo      ?? null,
                            createdAt:    now,
                        });
                        break;

                    case 'IN_PROGRESS':
                        await publishWorkOrderStarted(params.id, tenantId, {
                            ...base,
                            workOrderId: req.WorkOrder?.id ?? null,
                            startedAt:   now,
                        });
                        break;

                    case 'REPAIR_COMPLETED':
                        await publishRepairCompleted(params.id, tenantId, {
                            requestId:     params.id,
                            vehicleId:     req.vehicleId       ?? '',
                            tenantId,
                            requestNumber: req.workOrderNo     ?? null,
                            garageId:      req.garageId        ?? null,
                            garageName:    req.Garage?.name    ?? null,
                            occurredAt:    now,
                        });
                        break;

                    // INVOICE_SUBMITTED → Finance (AP payable + JE) + Fleet (vehicle available)
                    case 'INVOICE_SUBMITTED':
                        await publishWorkOrderCompleted(params.id, tenantId, {
                            requestId:          params.id,
                            vehicleId:          req.vehicleId          ?? '',
                            requestType:        req.maintenanceType     ?? 'SERVICE',
                            invoiceSubmittedAt: now,
                            totalCost:          Number(req.actualCost ?? req.estimatedCost ?? 0),
                            estimatedCost:      req.estimatedCost != null ? Number(req.estimatedCost) : null,
                            currency:           'AED',
                            garageId:           req.garageId            ?? null,
                            garageName:         req.Garage?.name         ?? null,
                            requestNumber:      req.workOrderNo          ?? null,
                            tenantId,
                        });
                        break;

                    // CLOSED → audit trail, analytics
                    case 'CLOSED':
                        await publishMaintenanceClosed(params.id, tenantId, {
                            requestId:     params.id,
                            vehicleId:     req.vehicleId          ?? '',
                            requestType:   req.maintenanceType     ?? 'SERVICE',
                            completedAt:   (req.completionDate ? new Date(req.completionDate).toISOString() : now),
                            totalCost:     Number(req.actualCost ?? req.estimatedCost ?? 0) || null,
                            currency:      'AED',
                            garageId:      req.garageId            ?? null,
                            garageName:    req.Garage?.name         ?? null,
                            requestNumber: req.workOrderNo          ?? null,
                        });
                        break;

                    default:
                        // No event for this status transition
                        break;
                }
            }

            return NextResponse.json(JSON.parse(JSON.stringify(updated)));
        } catch (e) {
            console.error('Failed to update maintenance request:', e);
            return NextResponse.json({ error: 'Internal Server Error', details: String(e) }, { status: 500 });
        }
  });
    return startWorkflow
        ? withApprovalStart(response, { headers: request.headers, tenantId, referenceType: 'maintenance_estimate', referenceId: params.id })
        : response;
}


export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
    const params = await props.params;

    const authz = requireAuthorizedTenant({ headers: request.headers, nextUrl: request.nextUrl });
    if (!authz.ok) {
      return NextResponse.json({ error: authz.error }, { status: authz.status });
    }
    const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
            await tx.maintenanceRequest.update({
                where: { id: params.id },
                data: { deletedAt: new Date() },
            });
            return NextResponse.json({ success: true });
            } catch (e) {
            console.error('Failed to delete maintenance request:', e);
            return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
        }
  });
}

