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
 */
import { prisma } from '@/lib/prisma';
import type { ActionProposal } from './index';
import { policyService } from './index';

export const GATED_ACTION_TYPES = [
  'CREATE_PREDICTIVE_WORK_ORDER',
  'ESCALATE_INCIDENT_SEVERITY',
  'OFFER_DISPATCH_JOB',
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
const OPEN_WO_STATUSES = ['OPEN', 'IN_PROGRESS', 'PENDING_PARTS'];

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

async function createPredictiveWorkOrder(tenantId: string, p: Record<string, unknown>): Promise<ExecutionResult> {
  const vehicleId = str(p.vehicleId);
  if (!vehicleId) throw new Error('CREATE_PREDICTIVE_WORK_ORDER payload is missing vehicleId');

  // Number allocation and the open-order check under one per-tenant lock:
  // wo_number was COUNT(*)+1 with no lock, so concurrent creators collided.
  await prisma.$executeRawUnsafe(
    `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
    `fleet-work-order-number:${tenantId}`,
  );
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

  const [{ count }] = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*) AS count FROM fleet_work_orders`,
  );
  const woNumber = 'FWO-' + String(Number(count) + 1).padStart(6, '0');
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

const EXECUTORS: Record<GatedActionType, (tenantId: string, payload: Record<string, unknown>) => Promise<ExecutionResult>> = {
  CREATE_PREDICTIVE_WORK_ORDER: createPredictiveWorkOrder,
  ESCALATE_INCIDENT_SEVERITY: escalateIncidentSeverity,
  OFFER_DISPATCH_JOB: offerDispatchJob,
};

/** Run a gated action. Throws on real errors; returns `stale` when it no longer applies. */
export function executeGatedAction(
  tenantId: string,
  actionType: GatedActionType,
  payload: Record<string, unknown>,
): Promise<ExecutionResult> {
  return EXECUTORS[actionType](tenantId, payload);
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
  if (existing.length > 0) return { outcome: 'ALREADY_QUEUED', approvalId: existing[0].id };

  const item = await policyService.createApprovalItem(tenantId, proposal, 'L3');
  return { outcome: 'QUEUED', approvalId: item.id };
}
