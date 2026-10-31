/**
 * Gated agent actions: live-data changes that go through the governance gate.
 *
 * Three batch agents used to change operational data directly — create work
 * orders (predictive-maintenance), raise a live incident's severity
 * (incident-triage) and offer dispatch jobs to drivers (dispatch-optimiser).
 * None of them consulted the tenant's AI policy, so the autonomy ceiling, the
 * per-agent kill switch and the budget circuit breaker did not apply to them,
 * although L4 (act without approval) is documented as off by default.
 *
 * Each of those actions is now a proposal submitted here:
 *   - the tenant has disabled the agent, tripped the circuit breaker or set
 *     the ceiling to L0 → BLOCKED, nothing happens;
 *   - the tenant allows L4 and the action is under its AED threshold →
 *     EXECUTED now (the explicit opt-in for, e.g., emergency auto-dispatch);
 *   - otherwise (the default, ceiling L3) → QUEUED in agent_approvals, and
 *     the action runs only when a reviewer approves it.
 *
 * Executors re-check that the action still applies when they run (the queue
 * can be hours old): a vehicle that already has an open predictive work
 * order, an incident already at or above the proposed severity, a job no
 * longer waiting for a driver — each returns `stale` and changes nothing.
 *
 * Approving one of these runs its executor (PolicyService.reviewApprovalItem).
 * Besides the three gated actions above, three queued-for-approval actions
 * have executors: SUSPEND_DRIVER (compliance), SCHEDULE_PM_SLOT
 * (preventive-maintenance) and LINK_TRIPS (vehicle-reuse). Any other action
 * type is recorded as APPROVED_MANUAL — approved, carried out by hand.
 */
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import type { ActionProposal } from './index';
import { policyService } from './index';

export const GATED_ACTION_TYPES = [
  'CREATE_PREDICTIVE_WORK_ORDER',
  'ESCALATE_INCIDENT_SEVERITY',
  'OFFER_DISPATCH_JOB',
  'SUSPEND_DRIVER',
  'SCHEDULE_PM_SLOT',
  'LINK_TRIPS',
] as const;
export type GatedActionType = (typeof GATED_ACTION_TYPES)[number];

export function isGatedAction(actionType: string): actionType is GatedActionType {
  return (GATED_ACTION_TYPES as readonly string[]).includes(actionType);
}

export type ExecutionResult =
  | { ok: true; detail: Record<string, unknown> }
  | { ok: false; stale: true; reason: string };

export type GateOutcome =
  | { outcome: 'EXECUTED'; result: ExecutionResult }
  | { outcome: 'QUEUED'; approvalId: string }
  | { outcome: 'ALREADY_QUEUED'; approvalId: string }
  | { outcome: 'BLOCKED'; reason: string };

export interface GatedProposal extends Omit<ActionProposal, 'actionType' | 'payload'> {
  actionType: GatedActionType;
  payload: Record<string, unknown>;
}

// ── Executors ────────────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<string, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
const DISPATCHABLE_STATUSES = ['PENDING', 'SEARCHING', 'RETRYING'];
/** A driver holding a job in one of these states is busy. */
const DRIVER_BUSY_STATUSES = ['OFFERED', 'ACCEPTED', 'IN_PROGRESS'];
/** Driver statuses the optimiser considers available (dispatch-optimiser/agent.ts). */
const DRIVER_AVAILABLE_STATUSES = ['ACTIVE', 'AVAILABLE', 'ON_SHIFT'];
const OPEN_WO_STATUSES = ['OPEN', 'IN_PROGRESS', 'PENDING_PARTS'];

/** Driver statuses that already keep a driver out of dispatch. */
const DRIVER_BLOCKED_STATUSES = ['SUSPENDED', 'INACTIVE'];
/**
 * Fleet360's operational zone (as bus-ops/validate-assignment.ts DEFAULT_TZ):
 * PM slots carry a local date and time. Asia/Dubai has no DST, so a fixed
 * offset is exact.
 */
const OPERATIONAL_UTC_OFFSET = '+04:00';

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> =>
  (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * Next tenant-local fleet work order number, under a per-tenant lock held to
 * the end of the transaction: wo_number was COUNT(*)+1 with no lock, so
 * concurrent creators in a tenant could take the same number. COUNT(*) runs
 * under RLS, so numbers are tenant-local (as the Fleet Work Orders API
 * allocates them); wo_number has no global unique constraint.
 */
async function lockAndNextWorkOrderNumber(tenantId: string): Promise<string> {
  await prisma.$executeRawUnsafe(
    `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
    `fleet-work-order-number:${tenantId}`,
  );
  const [{ count }] = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*) AS count FROM fleet_work_orders`,
  );
  return 'FWO-' + String(Number(count) + 1).padStart(6, '0');
}

async function createPredictiveWorkOrder(tenantId: string, p: Record<string, unknown>): Promise<ExecutionResult> {
  const vehicleId = str(p.vehicleId);
  if (!vehicleId) throw new Error('CREATE_PREDICTIVE_WORK_ORDER payload is missing vehicleId');

  // Number allocation and the open-order check under one per-tenant lock.
  const woNumber = await lockAndNextWorkOrderNumber(tenantId);
  const open = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id::text FROM fleet_work_orders
      WHERE vehicle_id::text = $1 AND requested_by = 'Predictive Maintenance Agent'
        AND status = ANY($2::text[])
      LIMIT 1`,
    vehicleId,
    OPEN_WO_STATUSES,
  );
  if (open.length > 0) {
    return { ok: false, stale: true, reason: `Vehicle already has an open predictive work order (${open[0].id}).` };
  }

  const [{ id }] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO fleet_work_orders (
       wo_number, vehicle_id, description, status, priority, wo_type,
       requested_by, tenant_id, created_at, updated_at
     ) VALUES ($1, $2::uuid, $3, 'OPEN', $4, 'PREVENTIVE', 'Predictive Maintenance Agent', $5, NOW(), NOW())
     RETURNING id::text`,
    woNumber,
    vehicleId,
    str(p.description) || 'Predictive maintenance work order',
    str(p.priority) || 'HIGH',
    tenantId,
  );
  await prisma.$executeRawUnsafe(
    `UPDATE fleet_risk_scores SET auto_work_order_id = $1::uuid WHERE vehicle_id = $2`,
    id,
    vehicleId,
  );
  return { ok: true, detail: { workOrderId: id, woNumber } };
}

async function escalateIncidentSeverity(_tenantId: string, p: Record<string, unknown>): Promise<ExecutionResult> {
  const incidentId = str(p.incidentId);
  const toSeverity = str(p.toSeverity).toUpperCase();
  if (!incidentId || !SEVERITY_RANK[toSeverity]) {
    throw new Error('ESCALATE_INCIDENT_SEVERITY payload needs incidentId and a valid toSeverity');
  }
  const rows = await prisma.$queryRawUnsafe<Array<{ severity: string | null }>>(
    `SELECT severity FROM operations.incidents WHERE id::text = $1 FOR UPDATE`,
    incidentId,
  );
  if (rows.length === 0) return { ok: false, stale: true, reason: 'Incident no longer exists.' };
  const current = (rows[0].severity ?? '').toUpperCase();
  if ((SEVERITY_RANK[current] ?? 0) >= SEVERITY_RANK[toSeverity]) {
    return { ok: false, stale: true, reason: `Incident is already ${current || 'unknown'}; nothing to escalate.` };
  }
  await prisma.$executeRawUnsafe(
    `UPDATE operations.incidents SET severity = $1, updated_at = NOW() WHERE id::text = $2`,
    toSeverity,
    incidentId,
  );
  await prisma.$executeRawUnsafe(
    `UPDATE incident_triage_assessments SET status = 'ESCALATED', updated_at = NOW() WHERE incident_id::text = $1`,
    incidentId,
  );
  return { ok: true, detail: { incidentId, from: current, to: toSeverity } };
}

async function offerDispatchJob(_tenantId: string, p: Record<string, unknown>): Promise<ExecutionResult> {
  const jobId = str(p.jobId);
  const driverId = str(p.driverId);
  const vehicleId = str(p.vehicleId);
  if (!jobId || !driverId || !vehicleId) {
    throw new Error('OFFER_DISPATCH_JOB payload needs jobId, driverId and vehicleId');
  }
  // A queued offer can be hours old: the proposed driver may since have
  // taken another job, gone off shift or been removed. Lock the driver row
  // so two approvals cannot hand the same driver two jobs.
  const driver = await prisma.$queryRawUnsafe<Array<{ status: string | null }>>(
    `SELECT status FROM drivers WHERE id::text = $1 AND deleted_at IS NULL FOR UPDATE`,
    driverId,
  );
  if (driver.length === 0) return { ok: false, stale: true, reason: 'Proposed driver no longer exists.' };
  const driverStatus = (driver[0].status ?? '').toUpperCase();
  if (driverStatus && !DRIVER_AVAILABLE_STATUSES.includes(driverStatus)) {
    return { ok: false, stale: true, reason: `Proposed driver is ${driverStatus}, not available.` };
  }
  const busy = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id::text FROM dispatch_jobs
      WHERE assigned_driver_id::text = $1 AND id <> $2::uuid AND status = ANY($3::text[])
      LIMIT 1`,
    driverId,
    jobId,
    DRIVER_BUSY_STATUSES,
  );
  if (busy.length > 0) {
    return { ok: false, stale: true, reason: `Proposed driver already holds job ${busy[0].id}.` };
  }

  // Guarded on the job still waiting for a driver: approved late, a job
  // someone else already offered or that was cancelled is left alone.
  const updated = await prisma.$queryRawUnsafe<Array<{ current_attempt: number }>>(
    `UPDATE dispatch_jobs
        SET status = 'OFFERED', assigned_driver_id = $1, assigned_vehicle_id = $2,
            dispatch_score = $3, current_attempt = current_attempt + 1, updated_at = NOW()
      WHERE id = $4::uuid AND status = ANY($5::text[])
      RETURNING current_attempt`,
    driverId,
    vehicleId,
    num(p.score),
    jobId,
    DISPATCHABLE_STATUSES,
  );
  if (updated.length === 0) {
    return { ok: false, stale: true, reason: 'Job is no longer waiting for a driver.' };
  }
  await prisma.$executeRawUnsafe(
    `INSERT INTO dispatch_attempts (
       dispatch_job_id, attempt_number, driver_id, vehicle_id,
       score, distance_km, eta_minutes, offered_at, score_breakdown
     ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, NOW(), $8::jsonb)`,
    jobId,
    updated[0].current_attempt,
    driverId,
    vehicleId,
    num(p.score),
    num(p.distanceKm),
    num(p.etaMinutes),
    JSON.stringify(p.factors ?? {}),
  );
  await prisma.$executeRawUnsafe(
    `UPDATE dispatch_optimiser_recommendations SET status = 'APPLIED', applied_at = NOW(), updated_at = NOW()
      WHERE job_id::text = $1`,
    jobId,
  );
  return { ok: true, detail: { jobId, driverId, vehicleId, attempt: updated[0].current_attempt } };
}

/** Compliance: a driver failed the pre-dispatch readiness gate. Block them from dispatch. */
async function suspendDriver(_tenantId: string, p: Record<string, unknown>): Promise<ExecutionResult> {
  const readiness = obj(p.readiness);
  const driverId = str(readiness.driverId) || str(p.driverId);
  if (!driverId) throw new Error('SUSPEND_DRIVER payload is missing readiness.driverId');

  const rows = await prisma.$queryRawUnsafe<Array<{ status: string | null }>>(
    `SELECT status FROM drivers WHERE id::text = $1 AND deleted_at IS NULL FOR UPDATE`,
    driverId,
  );
  if (rows.length === 0) return { ok: false, stale: true, reason: 'Driver no longer exists.' };
  const current = (rows[0].status ?? '').toUpperCase();
  if (DRIVER_BLOCKED_STATUSES.includes(current)) {
    return { ok: false, stale: true, reason: `Driver is already ${current}.` };
  }
  // dispatch-optimiser skips SUSPENDED drivers, and OFFER_DISPATCH_JOB only
  // offers to available ones, so this takes the driver out of dispatch.
  await prisma.$executeRawUnsafe(
    `UPDATE drivers SET status = 'SUSPENDED', updated_at = NOW() WHERE id::text = $1`,
    driverId,
  );
  return { ok: true, detail: { driverId, from: current || null, to: 'SUSPENDED' } };
}

/** Preventive maintenance: book the recommended service slot as a scheduled work order. */
async function schedulePmSlot(tenantId: string, p: Record<string, unknown>): Promise<ExecutionResult> {
  const vehicleId = str(p.vehicleId);
  const slot = obj(p.slot);
  const slotDate = str(slot.slotDate);
  const startTime = str(slot.startTime) || '09:00';
  if (!vehicleId || !/^\d{4}-\d{2}-\d{2}$/.test(slotDate) || !/^\d{2}:\d{2}$/.test(startTime)) {
    throw new Error('SCHEDULE_PM_SLOT payload needs vehicleId and slot.slotDate (YYYY-MM-DD) / slot.startTime (HH:MM)');
  }
  const scheduledAt = new Date(`${slotDate}T${startTime}:00${OPERATIONAL_UTC_OFFSET}`);
  if (Number.isNaN(scheduledAt.getTime())) {
    throw new Error(`SCHEDULE_PM_SLOT slot is not a valid date: ${slotDate} ${startTime}`);
  }
  if (scheduledAt.getTime() < Date.now()) {
    return { ok: false, stale: true, reason: `The recommended slot (${slotDate} ${startTime}) has passed; re-run the agent for a new one.` };
  }
  // fleet_work_orders.vehicle_id is UUID, but vehicles.id also holds legacy
  // non-UUID ids: say so instead of failing the approval on the cast.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(vehicleId)) {
    return { ok: false, stale: true, reason: `Vehicle id '${vehicleId}' is not a UUID, so a fleet work order can't reference it; schedule this one by hand.` };
  }

  // Number allocation and the open-order check under one per-tenant lock.
  const woNumber = await lockAndNextWorkOrderNumber(tenantId);
  const open = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id::text FROM fleet_work_orders
      WHERE vehicle_id::text = $1 AND requested_by = 'Preventive Maintenance Agent'
        AND status = ANY($2::text[])
      LIMIT 1`,
    vehicleId,
    OPEN_WO_STATUSES,
  );
  if (open.length > 0) {
    return { ok: false, stale: true, reason: `Vehicle already has an open preventive work order (${open[0].id}).` };
  }

  const threshold = str(p.serviceThreshold);
  const [{ id }] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO fleet_work_orders (
       wo_number, vehicle_id, description, status, priority, wo_type, scheduled_date,
       requested_by, tenant_id, created_at, updated_at
     ) VALUES ($1, $2::uuid, $3, 'OPEN', 'MEDIUM', 'PREVENTIVE', $4::timestamptz,
               'Preventive Maintenance Agent', $5, NOW(), NOW())
     RETURNING id::text`,
    woNumber,
    vehicleId,
    threshold ? `Scheduled preventive maintenance: ${threshold}` : 'Scheduled preventive maintenance',
    scheduledAt.toISOString(),
    tenantId,
  );
  return { ok: true, detail: { workOrderId: id, woNumber, scheduledDate: scheduledAt.toISOString() } };
}

/** Vehicle reuse: run trip B on the vehicle that runs trip A (chained trips). */
async function linkTrips(_tenantId: string, p: Record<string, unknown>): Promise<ExecutionResult> {
  const r = obj(p.result);
  const tripAId = str(r.tripAId);
  const tripBId = str(r.tripBId);
  const vehicleId = str(r.vehicleId);
  const driverId = str(r.driverId) || null;
  if (!tripAId || !tripBId || !vehicleId) {
    throw new Error('LINK_TRIPS payload needs result.tripAId, result.tripBId and result.vehicleId');
  }

  const tripA = await prisma.$queryRawUnsafe<Array<{ vehicle_id: string | null; status: string | null }>>(
    `SELECT vehicle_id, status FROM trip_schedules WHERE id = $1 AND deleted_at IS NULL`,
    tripAId,
  );
  if (tripA.length === 0) return { ok: false, stale: true, reason: 'The first trip no longer exists.' };
  if ((tripA[0].status ?? '').toUpperCase() === 'CANCELLED') {
    return { ok: false, stale: true, reason: 'The first trip was cancelled.' };
  }
  if (tripA[0].vehicle_id !== vehicleId) {
    return { ok: false, stale: true, reason: 'The first trip no longer runs on the proposed vehicle.' };
  }

  // Guarded on trip B still waiting for a vehicle: approved late, a trip
  // someone has since resourced is left alone. A driver is set only if trip
  // B has none.
  const updated = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `UPDATE trip_schedules
        SET vehicle_id = $1, driver_id = COALESCE(driver_id, $2), updated_at = NOW()
      WHERE id = $3 AND deleted_at IS NULL AND vehicle_id IS NULL
        AND COALESCE(status, 'SCHEDULED') = 'SCHEDULED'
      RETURNING id`,
    vehicleId,
    driverId,
    tripBId,
  );
  if (updated.length === 0) {
    return { ok: false, stale: true, reason: 'The second trip is no longer scheduled without a vehicle.' };
  }
  return { ok: true, detail: { tripAId, tripBId, vehicleId, driverId } };
}

const EXECUTORS: Record<GatedActionType, (tenantId: string, payload: Record<string, unknown>) => Promise<ExecutionResult>> = {
  CREATE_PREDICTIVE_WORK_ORDER: createPredictiveWorkOrder,
  ESCALATE_INCIDENT_SEVERITY: escalateIncidentSeverity,
  OFFER_DISPATCH_JOB: offerDispatchJob,
  SUSPEND_DRIVER: suspendDriver,
  SCHEDULE_PM_SLOT: schedulePmSlot,
  LINK_TRIPS: linkTrips,
};

/**
 * Run a gated action. Throws on real errors; returns `stale` when it no
 * longer applies. Always in a tenant transaction: it joins the caller's
 * (the approval route, an agent already in scope) or opens one, so the
 * row locks hold until the writes commit and the writes commit together.
 */
export function executeGatedAction(
  tenantId: string,
  actionType: GatedActionType,
  payload: Record<string, unknown>,
): Promise<ExecutionResult> {
  return withTenantRls(prisma, tenantId, () => EXECUTORS[actionType](tenantId, payload));
}

// ── The gate ─────────────────────────────────────────────────────────────────

/**
 * Submit an agent's live-data change to the tenant's governance policy.
 * Never changes data unless the policy grants L4 for this action.
 */
export async function submitGatedAction(tenantId: string, proposal: GatedProposal): Promise<GateOutcome> {
  // The agents would act on their own, so they request L4; the policy
  // demotes that to the tenant's ceiling (L3 by default → approval queue).
  const decision = await policyService.evaluateActionAutonomy(tenantId, {
    ...proposal,
    requestedAutonomy: 'L4',
  });

  if (decision.grantedAutonomy === 'L0') {
    return { outcome: 'BLOCKED', reason: decision.demotionReason ?? 'Tenant AI policy allows read-only agents.' };
  }

  if (decision.autoExecutable) {
    return { outcome: 'EXECUTED', result: await executeGatedAction(tenantId, proposal.actionType, proposal.payload) };
  }

  // One pending proposal per agent / action / entity: a batch agent that
  // runs every few minutes must not flood the queue with duplicates.
  const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id::text FROM agent_approvals
      WHERE tenant_id = $1 AND agent_id = $2 AND action_type = $3 AND entity_id = $4 AND status = 'PENDING'
      LIMIT 1`,
    tenantId,
    proposal.agentId,
    proposal.actionType,
    proposal.entityId,
  );
  if (existing.length > 0) {
    // Keep the pending item current: a later run may propose a different
    // driver, severity or description, and the approver must see — and
    // approving must apply — the agent's latest proposal, not its first.
    await prisma.$executeRawUnsafe(
      `UPDATE agent_approvals SET title = $2, description = $3, proposed_payload = $4::jsonb
        WHERE id = $1::uuid AND status = 'PENDING'`,
      existing[0].id,
      proposal.title,
      proposal.description,
      JSON.stringify(proposal.payload),
    );
    return { outcome: 'ALREADY_QUEUED', approvalId: existing[0].id };
  }

  const item = await policyService.createApprovalItem(tenantId, proposal, 'L3');
  return { outcome: 'QUEUED', approvalId: item.id };
}
