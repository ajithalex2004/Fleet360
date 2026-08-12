/**
 * Maintenance domain event contracts.
 *
 * Event types:
 *   maintenance.completed                  — request fully closed
 *   maintenance.repair_completed           — garage marks repair done; triggers QC
 *   maintenance.quality_inspection_started — QC inspector begins review
 *   maintenance.inspection_failed          — QC failed; vehicle returned to garage
 *   maintenance.vehicle_ready_for_service  — QC passed; vehicle cleared for redeployment
 */

// ── Existing ──────────────────────────────────────────────────────────────────

export const MAINTENANCE_COMPLETED = 'maintenance.completed' as const;

export interface MaintenanceCompletedPayload {
  requestId:     string;
  vehicleId:     string;
  requestType:   string;
  completedAt:   string;
  totalCost:     number | null;
  currency:      string;
  garageId:      string | null;
  garageName:    string | null;
  requestNumber: string | null;
}

// ── Invoice / Finance handoff ─────────────────────────────────────────────────

export const MAINTENANCE_WORK_ORDER_COMPLETED = 'maintenance.work_order_completed' as const;

/**
 * Fired when a maintenance request transitions to INVOICE_SUBMITTED status —
 * i.e. the garage has submitted their invoice and the final cost is known.
 * This is the authoritative trigger for Finance to create the AP payable + JE.
 */
export interface MaintenanceWorkOrderCompletedPayload {
  requestId:           string;
  vehicleId:           string;
  requestType:         string;   // maintenanceType
  invoiceSubmittedAt:  string;   // ISO 8601
  totalCost:           number;   // actualCost (or estimatedCost fallback)
  estimatedCost:       number | null;
  currency:            string;
  garageId:            string | null;
  garageName:          string | null;
  requestNumber:       string | null;
  tenantId:            string;
}

// ── QC workflow events ────────────────────────────────────────────────────────

export const MAINTENANCE_REPAIR_COMPLETED  = 'maintenance.repair_completed'          as const;
export const MAINTENANCE_QC_STARTED        = 'maintenance.quality_inspection_started' as const;
export const MAINTENANCE_INSPECTION_FAILED = 'maintenance.inspection_failed'          as const;
export const MAINTENANCE_VEHICLE_READY     = 'maintenance.vehicle_ready_for_service'  as const;

/** Shared payload for QC workflow transition events. */
export interface MaintenanceQCEventPayload {
  requestId:     string;
  vehicleId:     string;
  requestNumber: string | null;
  garageId:      string | null;
  garageName:    string | null;
  tenantId:      string;
  occurredAt:    string;  // ISO 8601
}

// ── Phase D — full lifecycle events ──────────────────────────────────────────

export const MAINTENANCE_REQUESTED           = 'maintenance.requested'             as const;
export const MAINTENANCE_APPROVED            = 'maintenance.approved'              as const;
export const MAINTENANCE_REJECTED            = 'maintenance.rejected'              as const;
export const MAINTENANCE_QUOTATION_REQUESTED = 'maintenance.quotation_requested'   as const;
export const MAINTENANCE_QUOTATION_RECEIVED  = 'maintenance.quotation_received'    as const;
export const MAINTENANCE_ESTIMATION_APPROVED = 'maintenance.estimation_approved'   as const;
export const MAINTENANCE_WORK_ORDER_CREATED  = 'maintenance.work_order_created'    as const;
export const MAINTENANCE_WORK_ORDER_STARTED  = 'maintenance.work_order_started'    as const;
export const MAINTENANCE_PM_TRIGGERED        = 'maintenance.pm_schedule_triggered' as const;
export const MAINTENANCE_WARRANTY_CLAIMED    = 'maintenance.warranty_claim_raised' as const;

/** A new maintenance request has been submitted. */
export interface MaintenanceRequestedPayload {
  requestId:       string;
  vehicleId:       string;
  tenantId:        string;
  maintenanceType: string;
  priority:        string;
  description:     string | null;
  requestDate:     string;        // ISO 8601
  requestedBy:     string | null; // userId / actor
}

/** Fleet manager approved the maintenance request. */
export interface MaintenanceApprovedPayload {
  requestId:  string;
  vehicleId:  string;
  tenantId:   string;
  approvedBy: string | null;
  approvedAt: string;
  garageId:   string | null;
  garageName: string | null;
}

/** Fleet manager rejected the maintenance request. */
export interface MaintenanceRejectedPayload {
  requestId:  string;
  vehicleId:  string;
  tenantId:   string;
  rejectedBy: string | null;
  rejectedAt: string;
  reason:     string | null;
}

/** Fleet manager sent the request to a garage for quotation. */
export interface QuotationRequestedPayload {
  requestId:   string;
  vehicleId:   string;
  tenantId:    string;
  garageId:    string | null;
  garageName:  string | null;
  requestedAt: string;
}

/** Garage submitted a quotation — awaiting cost approval. */
export interface QuotationReceivedPayload {
  requestId:   string;
  vehicleId:   string;
  tenantId:    string;
  quotationId: string;
  garageId:    string | null;
  garageName:  string | null;
  amount:      number;
  currency:    string;
  receivedAt:  string;
}

/**
 * Fleet manager approved the cost estimate.
 * Finance consumer creates a DRAFT AP accrual at this point.
 */
export interface EstimationApprovedPayload {
  requestId:     string;
  vehicleId:     string;
  tenantId:      string;
  estimatedCost: number;
  currency:      string;
  approvedBy:    string | null;
  approvedAt:    string;
  garageId:      string | null;
  garageName:    string | null;
}

/** A work order has been created for this request. */
export interface WorkOrderCreatedPayload {
  requestId:     string;
  vehicleId:     string;
  tenantId:      string;
  workOrderId:   string;
  workOrderNo:   string | null;
  garageId:      string | null;
  garageName:    string | null;
  createdAt:     string;
}

/** Garage has started work on the vehicle. */
export interface WorkOrderStartedPayload {
  requestId:   string;
  vehicleId:   string;
  tenantId:    string;
  workOrderId: string | null;
  startedAt:   string;
  garageId:    string | null;
  garageName:  string | null;
}

/**
 * PM engine triggered a maintenance request for one or more vehicles.
 * Carries aggregate info — one event per plan execution.
 */
export interface PMScheduleTriggeredPayload {
  planId:      string;
  planName:    string;
  tenantId:    string;
  vehicleIds:  string[];
  requestIds:  string[];
  triggeredAt: string;
}

/** A warranty claim has been raised against a vehicle warranty. */
export interface WarrantyClaimRaisedPayload {
  claimId:       string;
  warrantyId:    string;
  requestId:     string | null;
  vehicleId:     string;
  tenantId:      string;
  claimedAmount: number | null;
  currency:      string;
  description:   string | null;
  claimDate:     string | null;
}

// ── Phase E — Breakdown events ────────────────────────────────────────────────

export const MAINTENANCE_BREAKDOWN_REPORTED  = 'maintenance.breakdown_reported'   as const;
export const MAINTENANCE_RECOVERY_DISPATCHED = 'maintenance.recovery_dispatched'  as const;
export const MAINTENANCE_RECOVERY_COMPLETED  = 'maintenance.recovery_completed'   as const;

/** A driver has reported a vehicle breakdown. */
export interface BreakdownReportedPayload {
  reportId:             string;
  reportNo:             string | null;
  vehicleId:            string;
  driverId:             string | null;
  tenantId:             string;
  breakdownType:        string;
  severity:             string;
  location:             string | null;
  reportedAt:           string;  // ISO 8601
  /** Auto-created BREAKDOWN maintenance request */
  maintenanceRequestId: string | null;
}

/** A recovery vehicle has been dispatched to an active breakdown. */
export interface RecoveryDispatchedPayload {
  reportId:           string;
  vehicleId:          string;
  tenantId:           string;
  recoveryVehicleId:  string | null;
  recoveryDriverId:   string | null;
  estimatedArrivalAt: string | null;  // ISO 8601
  dispatchedAt:       string;         // ISO 8601
}

/** Recovery is complete — breakdown vehicle is now at the workshop. */
export interface RecoveryCompletedPayload {
  reportId:             string;
  vehicleId:            string;
  tenantId:             string;
  maintenanceRequestId: string | null;
  completedAt:          string;  // ISO 8601
}
