/**
 * Type-safe publish helpers for all Maintenance domain events.
 *
 * Each helper wraps getEventBus().publish() with the correct eventType constant,
 * aggregateType, and sourceModule so call-sites only provide the business payload.
 *
 * All helpers are fire-and-forget by default (.catch is the caller's responsibility)
 * but can be awaited when the caller needs the eventId.
 *
 * Usage:
 *   import { publishMaintenanceRequested } from '@/lib/maintenance/publish-event';
 *   await publishMaintenanceRequested('req-123', tenantId, { ... }).catch(console.warn);
 */

import { getEventBus }  from '@/events/event-bus';
import {
  MAINTENANCE_REQUESTED,
  MAINTENANCE_APPROVED,
  MAINTENANCE_REJECTED,
  MAINTENANCE_QUOTATION_REQUESTED,
  MAINTENANCE_QUOTATION_RECEIVED,
  MAINTENANCE_ESTIMATION_APPROVED,
  MAINTENANCE_WORK_ORDER_CREATED,
  MAINTENANCE_WORK_ORDER_STARTED,
  MAINTENANCE_REPAIR_COMPLETED,
  MAINTENANCE_QC_STARTED,
  MAINTENANCE_INSPECTION_FAILED,
  MAINTENANCE_VEHICLE_READY,
  MAINTENANCE_WORK_ORDER_COMPLETED,
  MAINTENANCE_COMPLETED,
  MAINTENANCE_PM_TRIGGERED,
  MAINTENANCE_WARRANTY_CLAIMED,
  // Phase E
  MAINTENANCE_BREAKDOWN_REPORTED,
  MAINTENANCE_RECOVERY_DISPATCHED,
  MAINTENANCE_RECOVERY_COMPLETED,
} from '@/events/contracts/maintenance.events';
import type {
  MaintenanceRequestedPayload,
  MaintenanceApprovedPayload,
  MaintenanceRejectedPayload,
  QuotationRequestedPayload,
  QuotationReceivedPayload,
  EstimationApprovedPayload,
  WorkOrderCreatedPayload,
  WorkOrderStartedPayload,
  MaintenanceQCEventPayload,
  MaintenanceWorkOrderCompletedPayload,
  MaintenanceCompletedPayload,
  PMScheduleTriggeredPayload,
  WarrantyClaimRaisedPayload,
  // Phase E
  BreakdownReportedPayload,
  RecoveryDispatchedPayload,
  RecoveryCompletedPayload,
} from '@/events/contracts/maintenance.events';

// ── Shared opts ───────────────────────────────────────────────────────────────

interface PublishOpts {
  actor?:         string | null;
  correlationId?: string | null;
  causationId?:   string | null;
}

// ── Private helper ────────────────────────────────────────────────────────────

function pub<T>(
  eventType:     string,
  aggregateType: string,
  aggregateId:   string,
  tenantId:      string,
  payload:       T,
  opts?:         PublishOpts,
): Promise<{ eventId: string }> {
  return getEventBus().publish<T>({
    eventType,
    aggregateType,
    aggregateId,
    sourceModule:  'maintenance',
    tenantId,
    actor:         opts?.actor         ?? null,
    correlationId: opts?.correlationId ?? null,
    causationId:   opts?.causationId   ?? null,
    payload,
  });
}

// Shorthand for the common MaintenanceRequest aggregate type
const MR = 'MaintenanceRequest';

// ── Lifecycle publishers ──────────────────────────────────────────────────────

export function publishMaintenanceRequested(
  requestId: string,
  tenantId:  string,
  payload:   MaintenanceRequestedPayload,
  opts?:     PublishOpts,
) { return pub(MAINTENANCE_REQUESTED, MR, requestId, tenantId, payload, opts); }

export function publishMaintenanceApproved(
  requestId: string,
  tenantId:  string,
  payload:   MaintenanceApprovedPayload,
  opts?:     PublishOpts,
) { return pub(MAINTENANCE_APPROVED, MR, requestId, tenantId, payload, opts); }

export function publishMaintenanceRejected(
  requestId: string,
  tenantId:  string,
  payload:   MaintenanceRejectedPayload,
  opts?:     PublishOpts,
) { return pub(MAINTENANCE_REJECTED, MR, requestId, tenantId, payload, opts); }

export function publishQuotationRequested(
  requestId: string,
  tenantId:  string,
  payload:   QuotationRequestedPayload,
  opts?:     PublishOpts,
) { return pub(MAINTENANCE_QUOTATION_REQUESTED, MR, requestId, tenantId, payload, opts); }

export function publishQuotationReceived(
  requestId: string,
  tenantId:  string,
  payload:   QuotationReceivedPayload,
  opts?:     PublishOpts,
) { return pub(MAINTENANCE_QUOTATION_RECEIVED, MR, requestId, tenantId, payload, opts); }

export function publishEstimationApproved(
  requestId: string,
  tenantId:  string,
  payload:   EstimationApprovedPayload,
  opts?:     PublishOpts,
) { return pub(MAINTENANCE_ESTIMATION_APPROVED, MR, requestId, tenantId, payload, opts); }

export function publishWorkOrderCreated(
  requestId: string,
  tenantId:  string,
  payload:   WorkOrderCreatedPayload,
  opts?:     PublishOpts,
) { return pub(MAINTENANCE_WORK_ORDER_CREATED, MR, requestId, tenantId, payload, opts); }

export function publishWorkOrderStarted(
  requestId: string,
  tenantId:  string,
  payload:   WorkOrderStartedPayload,
  opts?:     PublishOpts,
) { return pub(MAINTENANCE_WORK_ORDER_STARTED, MR, requestId, tenantId, payload, opts); }

export function publishRepairCompleted(
  requestId: string,
  tenantId:  string,
  payload:   MaintenanceQCEventPayload,
  opts?:     PublishOpts,
) { return pub(MAINTENANCE_REPAIR_COMPLETED, MR, requestId, tenantId, payload, opts); }

export function publishQCStarted(
  requestId: string,
  tenantId:  string,
  payload:   MaintenanceQCEventPayload,
  opts?:     PublishOpts,
) { return pub(MAINTENANCE_QC_STARTED, MR, requestId, tenantId, payload, opts); }

export function publishInspectionFailed(
  requestId: string,
  tenantId:  string,
  payload:   MaintenanceQCEventPayload,
  opts?:     PublishOpts,
) { return pub(MAINTENANCE_INSPECTION_FAILED, MR, requestId, tenantId, payload, opts); }

export function publishInspectionPassed(
  requestId: string,
  tenantId:  string,
  payload:   MaintenanceQCEventPayload,
  opts?:     PublishOpts,
) { return pub(MAINTENANCE_VEHICLE_READY, MR, requestId, tenantId, payload, opts); }

export function publishWorkOrderCompleted(
  requestId: string,
  tenantId:  string,
  payload:   MaintenanceWorkOrderCompletedPayload,
  opts?:     PublishOpts,
) { return pub(MAINTENANCE_WORK_ORDER_COMPLETED, MR, requestId, tenantId, payload, opts); }

export function publishMaintenanceClosed(
  requestId: string,
  tenantId:  string,
  payload:   MaintenanceCompletedPayload,
  opts?:     PublishOpts,
) { return pub(MAINTENANCE_COMPLETED, MR, requestId, tenantId, payload, opts); }

export function publishPMScheduleTriggered(
  planId:   string,
  tenantId: string,
  payload:  PMScheduleTriggeredPayload,
  opts?:    PublishOpts,
) { return pub(MAINTENANCE_PM_TRIGGERED, 'MaintenancePlan', planId, tenantId, payload, opts); }

export function publishWarrantyClaimRaised(
  claimId:  string,
  tenantId: string,
  payload:  WarrantyClaimRaisedPayload,
  opts?:    PublishOpts,
) { return pub(MAINTENANCE_WARRANTY_CLAIMED, 'WarrantyClaim', claimId, tenantId, payload, opts); }

// ── Phase E — Breakdown publishers ───────────────────────────────────────────

const BR = 'BreakdownReport';

export function publishBreakdownReported(
  reportId: string,
  tenantId: string,
  payload:  BreakdownReportedPayload,
  opts?:    PublishOpts,
) { return pub(MAINTENANCE_BREAKDOWN_REPORTED, BR, reportId, tenantId, payload, opts); }

export function publishRecoveryDispatched(
  reportId: string,
  tenantId: string,
  payload:  RecoveryDispatchedPayload,
  opts?:    PublishOpts,
) { return pub(MAINTENANCE_RECOVERY_DISPATCHED, BR, reportId, tenantId, payload, opts); }

export function publishRecoveryCompleted(
  reportId: string,
  tenantId: string,
  payload:  RecoveryCompletedPayload,
  opts?:    PublishOpts,
) { return pub(MAINTENANCE_RECOVERY_COMPLETED, BR, reportId, tenantId, payload, opts); }
