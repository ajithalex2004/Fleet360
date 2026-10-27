/**
 * Fleet360 Multi-Tenant AI Governance, Autonomy & Approval Engine
 * -----------------------------------------------------------------
 * Manages tenant AI policies, L0-L4 autonomy level resolution, daily/monthly
 * AED cost budgeting with circuit breakers, and the Human-in-the-Loop (HITL)
 * review queue.
 */

import { prisma } from '@/lib/prisma';
import { AgentAutonomyLevel, AgentId } from '../types';
import { ensureAgentSchema } from '../schema';

export interface TenantPolicy {
  tenantId: string;
  maxAutonomyLevel: AgentAutonomyLevel;
  dailyBudgetAed: number;
  monthlyBudgetAed: number;
  requireHumanApprovalThresholdAed: number;
  disabledAgents: string[];
  circuitBreakerTriggered: boolean;
}

/** The TenantPolicy fields updateTenantPolicy accepts. */
export const TENANT_POLICY_FIELDS = [
  'maxAutonomyLevel',
  'dailyBudgetAed',
  'monthlyBudgetAed',
  'requireHumanApprovalThresholdAed',
  'disabledAgents',
  'circuitBreakerTriggered',
] as const satisfies ReadonlyArray<Exclude<keyof TenantPolicy, 'tenantId'>>;

export interface ActionProposal {
  agentId: AgentId | string;
  entityType: string;
  entityId: string;
  actionType: string;
  title: string;
  description: string;
  financialImpactAed?: number;
  payload?: Record<string, unknown>;
  requestedAutonomy?: AgentAutonomyLevel;
}

export interface AutonomyDecision {
  grantedAutonomy: AgentAutonomyLevel;
  wasDemoted: boolean;
  demotionReason?: string;
  requiresApprovalQueue: boolean;
  autoExecutable: boolean;
}

export interface ApprovalItem {
  id: string;
  tenantId: string;
  agentId: string;
  entityType: string;
  entityId: string;
  actionType: string;
  title: string;
  description: string;
  financialImpactAed: number;
  proposedPayload: Record<string, unknown>;
  status: 'PENDING' | 'APPROVED' | 'APPROVED_MANUAL' | 'REJECTED' | 'EXPIRED';
  requestedAutonomy: AgentAutonomyLevel;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  reviewNotes?: string | null;
  createdAt: string;
}

// Row shape for the `tenant_ai_policies` SELECT in getTenantPolicy below
// (camelCase via SQL aliases).
interface TenantPolicyRow {
  tenantId: string;
  maxAutonomyLevel: AgentAutonomyLevel | null;
  dailyBudgetAed: number | null;
  monthlyBudgetAed: number | null;
  requireHumanApprovalThresholdAed: number | null;
  disabledAgents: unknown;
  circuitBreakerTriggered: boolean | null;
}

// Row shape for the `agent_roi_metrics` daily-spend SELECT in checkBudgetQuota.
interface SpendRow {
  todayCostAed: number;
  monthCostAed: number;
}

// Row shape for the `gen_random_uuid()` SELECT in createApprovalItem.
interface GenUuidRow {
  id: string;
}

// Row shape for the `agent_approvals` SELECTs in getPendingApprovals and
// reviewApprovalItem below (camelCase via SQL aliases).
interface ApprovalItemRow {
  id: string;
  tenantId: string;
  agentId: string;
  entityType: string;
  entityId: string;
  actionType: string;
  title: string;
  description: string;
  financialImpactAed: number;
  proposedPayload: unknown;
  status: 'PENDING' | 'APPROVED' | 'APPROVED_MANUAL' | 'REJECTED' | 'EXPIRED';
  requestedAutonomy: AgentAutonomyLevel;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  createdAt: string;
}

const AUTONOMY_RANKS: Record<AgentAutonomyLevel, number> = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
  L4: 4,
};

const DEFAULT_POLICY: Omit<TenantPolicy, 'tenantId'> = {
  maxAutonomyLevel: 'L3',
  dailyBudgetAed: 200.0,
  monthlyBudgetAed: 5000.0,
  requireHumanApprovalThresholdAed: 500.0,
  disabledAgents: [],
  circuitBreakerTriggered: false,
};

export class PolicyService {
  /**
   * Retrieve tenant policy with automatic defaults fallback.
   */
  async getTenantPolicy(tenantId: string): Promise<TenantPolicy> {
    await ensureAgentSchema();
    const cleanTenant = tenantId?.trim() || 'default';

    try {
      const rows = await prisma.$queryRawUnsafe<TenantPolicyRow[]>(
        `SELECT
           tenant_id AS "tenantId",
           max_autonomy_level AS "maxAutonomyLevel",
           daily_budget_aed::float8 AS "dailyBudgetAed",
           monthly_budget_aed::float8 AS "monthlyBudgetAed",
           require_human_approval_threshold_aed::float8 AS "requireHumanApprovalThresholdAed",
           disabled_agents AS "disabledAgents",
           circuit_breaker_triggered AS "circuitBreakerTriggered"
         FROM tenant_ai_policies
         WHERE tenant_id = $1 LIMIT 1`,
        cleanTenant,
      );

      if (rows && rows.length > 0) {
        const r = rows[0];
        return {
          tenantId: cleanTenant,
          maxAutonomyLevel: r.maxAutonomyLevel ?? 'L3',
          dailyBudgetAed: r.dailyBudgetAed ?? 200.0,
          monthlyBudgetAed: r.monthlyBudgetAed ?? 5000.0,
          requireHumanApprovalThresholdAed: r.requireHumanApprovalThresholdAed ?? 500.0,
          disabledAgents: Array.isArray(r.disabledAgents) ? r.disabledAgents : [],
          circuitBreakerTriggered: Boolean(r.circuitBreakerTriggered),
        };
      }
    } catch {
      // Fallback on transient DB error
    }

    return {
      tenantId: cleanTenant,
      ...DEFAULT_POLICY,
    };
  }

  /**
   * Update or upsert tenant policy.
   */
  async updateTenantPolicy(
    tenantId: string,
    updates: Partial<Omit<TenantPolicy, 'tenantId'>>,
  ): Promise<TenantPolicy> {
    await ensureAgentSchema();
    const current = await this.getTenantPolicy(tenantId);
    // Only the policy fields are taken from `updates`, and tenantId always
    // comes from the argument: a stray tenantId in `updates` (e.g. a request
    // body) must never retarget the upsert at another tenant's row.
    const updated: TenantPolicy = { ...current, tenantId };
    for (const key of TENANT_POLICY_FIELDS) {
      if (updates[key] !== undefined) (updated as unknown as Record<string, unknown>)[key] = updates[key];
    }

    await prisma.$executeRawUnsafe(
      `INSERT INTO tenant_ai_policies (
         tenant_id, max_autonomy_level, daily_budget_aed, monthly_budget_aed,
         require_human_approval_threshold_aed, disabled_agents, circuit_breaker_triggered, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,NOW())
       ON CONFLICT (tenant_id) DO UPDATE SET
         max_autonomy_level = EXCLUDED.max_autonomy_level,
         daily_budget_aed = EXCLUDED.daily_budget_aed,
         monthly_budget_aed = EXCLUDED.monthly_budget_aed,
         require_human_approval_threshold_aed = EXCLUDED.require_human_approval_threshold_aed,
         disabled_agents = EXCLUDED.disabled_agents,
         circuit_breaker_triggered = EXCLUDED.circuit_breaker_triggered,
         updated_at = NOW()`,
      updated.tenantId,
      updated.maxAutonomyLevel,
      updated.dailyBudgetAed,
      updated.monthlyBudgetAed,
      updated.requireHumanApprovalThresholdAed,
      JSON.stringify(updated.disabledAgents),
      updated.circuitBreakerTriggered,
    );

    return updated;
  }

  /**
   * Evaluates requested action autonomy against tenant policy and financial thresholds.
   */
  async evaluateActionAutonomy(
    tenantId: string,
    proposal: ActionProposal,
    customPolicy?: TenantPolicy,
  ): Promise<AutonomyDecision> {
    const policy = customPolicy ?? (await this.getTenantPolicy(tenantId));
    const requested = proposal.requestedAutonomy ?? 'L3';
    const reqRank = AUTONOMY_RANKS[requested] ?? 3;
    const maxRank = AUTONOMY_RANKS[policy.maxAutonomyLevel] ?? 3;

    // 1. Check if agent is explicitly disabled for tenant
    if (policy.disabledAgents.includes(proposal.agentId)) {
      return {
        grantedAutonomy: 'L0',
        wasDemoted: true,
        demotionReason: `Agent '${proposal.agentId}' is disabled by tenant policy.`,
        requiresApprovalQueue: false,
        autoExecutable: false,
      };
    }

    // 2. Check if circuit breaker is active
    if (policy.circuitBreakerTriggered) {
      return {
        grantedAutonomy: 'L0',
        wasDemoted: true,
        demotionReason: 'Tenant AI circuit breaker is currently triggered due to budget breach.',
        requiresApprovalQueue: false,
        autoExecutable: false,
      };
    }

    // 3. Demote if requested level exceeds tenant max autonomy ceiling
    if (reqRank > maxRank) {
      const granted = policy.maxAutonomyLevel;
      return {
        grantedAutonomy: granted,
        wasDemoted: true,
        demotionReason: `Requested autonomy ${requested} exceeds tenant policy ceiling of ${granted}.`,
        requiresApprovalQueue: granted === 'L3',
        autoExecutable: granted === 'L4',
      };
    }

    // 4. L4 Autonomous Execution Threshold Check
    if (requested === 'L4') {
      const impactAed = proposal.financialImpactAed ?? 0;
      if (impactAed > policy.requireHumanApprovalThresholdAed) {
        return {
          grantedAutonomy: 'L3',
          wasDemoted: true,
          demotionReason: `Financial impact of ${impactAed.toFixed(2)} AED exceeds autonomous threshold of ${policy.requireHumanApprovalThresholdAed.toFixed(2)} AED. Demoted to L3 review queue.`,
          requiresApprovalQueue: true,
          autoExecutable: false,
        };
      }
      return {
        grantedAutonomy: 'L4',
        wasDemoted: false,
        requiresApprovalQueue: false,
        autoExecutable: true,
      };
    }

    // 5. Standard L0-L3 resolutions
    return {
      grantedAutonomy: requested,
      wasDemoted: false,
      requiresApprovalQueue: requested === 'L3',
      autoExecutable: false,
    };
  }

  /**
   * Alias for evaluateActionAutonomy
   */
  async evaluateActionProposal(
    tenantId: string,
    proposal: ActionProposal,
  ): Promise<AutonomyDecision> {
    return this.evaluateActionAutonomy(tenantId, proposal);
  }

  /**
   * Verifies tenant budget quota before executing an agent run.
   *
   * The daily and monthly caps are worked out from recorded spend
   * (agent_roi_metrics) on every call, so they lift by themselves when the
   * day or month rolls over. Nothing is persisted when a cap is hit: the
   * breaker used to be written to tenant_ai_policies and never cleared, so
   * one over-budget day locked a tenant out for good.
   *
   * circuitBreakerTriggered is now only a manual kill switch, set and
   * cleared by a tenant admin through PUT /api/agents/policy.
   *
   * If spend can't be read the run is refused: a budget control that lets
   * everything through whenever its query fails is not a control.
   */
  async checkBudgetQuota(
    tenantId: string,
    estimatedCostAed = 0.05,
  ): Promise<{ allowed: boolean; reason?: string }> {
    const policy = await this.getTenantPolicy(tenantId);

    if (policy.circuitBreakerTriggered) {
      return {
        allowed: false,
        reason: 'AI agents are switched off for this tenant (circuit breaker). A tenant admin can switch them back on in the AI policy.',
      };
    }

    let spend: SpendRow;
    try {
      const rows = await prisma.$queryRawUnsafe<SpendRow[]>(
        `SELECT COALESCE(SUM(total_cost_aed) FILTER (WHERE period_date = CURRENT_DATE), 0)::float8 AS "todayCostAed",
                COALESCE(SUM(total_cost_aed), 0)::float8 AS "monthCostAed"
         FROM agent_roi_metrics
         WHERE tenant_id = $1
           AND period_date >= date_trunc('month', CURRENT_DATE)::date
           AND period_date <= CURRENT_DATE`,
        policy.tenantId,
      );
      spend = {
        todayCostAed: Number(rows?.[0]?.todayCostAed ?? 0),
        monthCostAed: Number(rows?.[0]?.monthCostAed ?? 0),
      };
    } catch (err) {
      console.error('[governance] Budget check failed; refusing the run:', err);
      return {
        allowed: false,
        reason: 'The AI budget could not be checked, so the run was not started. Try again shortly.',
      };
    }

    if (spend.todayCostAed + estimatedCostAed > policy.dailyBudgetAed) {
      return {
        allowed: false,
        reason: `Daily budget exceeded: today's spend (${spend.todayCostAed.toFixed(2)} AED) reached the cap (${policy.dailyBudgetAed.toFixed(2)} AED). Agents resume tomorrow.`,
      };
    }
    if (spend.monthCostAed + estimatedCostAed > policy.monthlyBudgetAed) {
      return {
        allowed: false,
        reason: `Monthly budget exceeded: this month's spend (${spend.monthCostAed.toFixed(2)} AED) reached the cap (${policy.monthlyBudgetAed.toFixed(2)} AED). Agents resume next month.`,
      };
    }

    return { allowed: true };
  }

  /**
   * Create an approval item in the Human-in-the-Loop review queue.
   */
  async createApprovalItem(
    arg1: ActionProposal | string,
    arg2: string | ActionProposal,
    requestedAutonomy: AgentAutonomyLevel = 'L3',
  ): Promise<ApprovalItem> {
    await ensureAgentSchema();
    let proposal: ActionProposal;
    let tenantId: string;

    if (typeof arg1 === 'string') {
      tenantId = arg1;
      proposal = arg2 as ActionProposal;
    } else {
      proposal = arg1;
      tenantId = arg2 as string;
    }

    const cleanTenant = (typeof tenantId === 'string' && tenantId.trim()) ? tenantId.trim() : 'default';

    // One PENDING item per tenant/agent/action/entity
    // (idx_agent_approvals_pending_dedup): a batch agent re-proposing the same
    // action refreshes the pending item — the approver must see, and
    // approving must apply, the latest proposal — instead of queueing a
    // duplicate on every run.
    const rows = await prisma.$queryRawUnsafe<GenUuidRow[]>(
      `INSERT INTO agent_approvals (
         tenant_id, agent_id, entity_type, entity_id,
         action_type, title, description, financial_impact_aed,
         proposed_payload, status, requested_autonomy, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'PENDING',$10,NOW())
       ON CONFLICT (tenant_id, agent_id, action_type, entity_id) WHERE status = 'PENDING'
       DO UPDATE SET
         title                = EXCLUDED.title,
         description          = EXCLUDED.description,
         financial_impact_aed = EXCLUDED.financial_impact_aed,
         proposed_payload     = EXCLUDED.proposed_payload,
         requested_autonomy   = EXCLUDED.requested_autonomy
       RETURNING id::text AS id`,
      cleanTenant,
      proposal.agentId,
      proposal.entityType,
      proposal.entityId,
      proposal.actionType,
      proposal.title,
      proposal.description,
      proposal.financialImpactAed ?? 0,
      JSON.stringify(proposal.payload ?? {}),
      requestedAutonomy,
    );
    const id = rows[0]?.id;
    if (!id) throw new Error('createApprovalItem: insert returned no id');

    return {
      id,
      tenantId: cleanTenant,
      agentId: proposal.agentId,
      entityType: proposal.entityType,
      entityId: proposal.entityId,
      actionType: proposal.actionType,
      title: proposal.title,
      description: proposal.description,
      financialImpactAed: proposal.financialImpactAed ?? 0,
      proposedPayload: proposal.payload ?? {},
      status: 'PENDING',
      requestedAutonomy,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Fetch all pending approval items for a tenant.
   */
  async getPendingApprovals(tenantId: string, agentId?: string): Promise<ApprovalItem[]> {
    await ensureAgentSchema();
    const cleanTenant = tenantId?.trim() || 'default';

    const sql = agentId
      ? `SELECT id::text, tenant_id AS "tenantId", agent_id AS "agentId", entity_type AS "entityType",
                entity_id AS "entityId", action_type AS "actionType", title, description,
                financial_impact_aed::float8 AS "financialImpactAed", proposed_payload AS "proposedPayload",
                status, requested_autonomy AS "requestedAutonomy", reviewed_by AS "reviewedBy",
                reviewed_at::text AS "reviewedAt", review_notes AS "reviewNotes", created_at::text AS "createdAt"
         FROM agent_approvals
         WHERE tenant_id = $1 AND status = 'PENDING' AND agent_id = $2
         ORDER BY financial_impact_aed DESC, created_at DESC`
      : `SELECT id::text, tenant_id AS "tenantId", agent_id AS "agentId", entity_type AS "entityType",
                entity_id AS "entityId", action_type AS "actionType", title, description,
                financial_impact_aed::float8 AS "financialImpactAed", proposed_payload AS "proposedPayload",
                status, requested_autonomy AS "requestedAutonomy", reviewed_by AS "reviewedBy",
                reviewed_at::text AS "reviewedAt", review_notes AS "reviewNotes", created_at::text AS "createdAt"
         FROM agent_approvals
         WHERE tenant_id = $1 AND status = 'PENDING'
         ORDER BY financial_impact_aed DESC, created_at DESC`;

    const rows = agentId
      ? await prisma.$queryRawUnsafe<ApprovalItemRow[]>(sql, cleanTenant, agentId)
      : await prisma.$queryRawUnsafe<ApprovalItemRow[]>(sql, cleanTenant);

    return rows.map((r) => ({
      ...r,
      financialImpactAed: Number(r.financialImpactAed || 0),
      proposedPayload: (r.proposedPayload ?? {}) as Record<string, unknown>,
    }));
  }

  /**
   * Human review action: Approve or Reject an approval item.
   *
   * Only a PENDING item can be decided (a second click, or two reviewers at
   * once, used to re-decide it), and with `tenantId` only an item of that
   * tenant. Approving a gated agent action (gated-actions.ts) runs it here,
   * in the caller's transaction: if it fails the decision rolls back with
   * it; if it no longer applies (the queue can be hours old) the item is
   * marked EXPIRED with the reason and nothing is changed.
   */
  async reviewApprovalItem(
    approvalId: string,
    reviewerId: string,
    decision: 'APPROVED' | 'REJECTED',
    notes?: string,
    tenantId?: string,
  ): Promise<ApprovalItem & { execution?: Record<string, unknown> }> {
    await ensureAgentSchema();

    const updated = await prisma.$executeRawUnsafe(
      `UPDATE agent_approvals
       SET status = $1, reviewed_by = $2, reviewed_at = NOW(), review_notes = $3
       WHERE id = $4::uuid AND status = 'PENDING' AND ($5::text IS NULL OR tenant_id = $5)`,
      decision,
      reviewerId,
      notes ?? null,
      approvalId,
      tenantId ?? null,
    );
    if (!updated) {
      throw new ApprovalNotPendingError(approvalId);
    }

    let item = await this.loadApprovalItem(approvalId);

    let execution: Record<string, unknown> | undefined;
    if (decision === 'APPROVED') {
      const { isGatedAction, executeGatedAction } = await import('./gated-actions');
      if (isGatedAction(item.actionType)) {
        const result = await executeGatedAction(item.tenantId, item.actionType, item.proposedPayload);
        if (result.ok) {
          execution = { executed: true, ...result.detail };
        } else {
          await prisma.$executeRawUnsafe(
            `UPDATE agent_approvals SET status = 'EXPIRED',
                    review_notes = concat_ws(' | ', review_notes, $2::text)
              WHERE id = $1::uuid`,
            approvalId,
            `Not applied: ${result.reason}`,
          );
          item = await this.loadApprovalItem(approvalId);
          execution = { executed: false, reason: result.reason };
        }
      } else {
        // No executor exists for this action type: approving it changes
        // nothing in the system. Record that honestly (APPROVED_MANUAL) and
        // tell the reviewer, rather than showing APPROVED as if it ran.
        await prisma.$executeRawUnsafe(
          `UPDATE agent_approvals SET status = 'APPROVED_MANUAL',
                  review_notes = concat_ws(' | ', review_notes, $2::text)
            WHERE id = $1::uuid`,
          approvalId,
          'No automatic executor; carry out manually',
        );
        item = await this.loadApprovalItem(approvalId);
        execution = {
          executed: false,
          manual: true,
          reason: `'${item.actionType}' has no automatic executor. The approval is recorded; carry the action out manually.`,
        };
      }
    }

    return execution ? { ...item, execution } : item;
  }

  private async loadApprovalItem(approvalId: string): Promise<ApprovalItem> {
    const rows = await prisma.$queryRawUnsafe<ApprovalItemRow[]>(
      `SELECT id::text, tenant_id AS "tenantId", agent_id AS "agentId", entity_type AS "entityType",
              entity_id AS "entityId", action_type AS "actionType", title, description,
              financial_impact_aed::float8 AS "financialImpactAed", proposed_payload AS "proposedPayload",
              status, requested_autonomy AS "requestedAutonomy", reviewed_by AS "reviewedBy",
              reviewed_at::text AS "reviewedAt", review_notes AS "reviewNotes", created_at::text AS "createdAt"
       FROM agent_approvals
       WHERE id = $1::uuid LIMIT 1`,
      approvalId,
    );

    if (!rows || rows.length === 0) {
      throw new Error(`Approval item '${approvalId}' not found.`);
    }

    const r = rows[0];
    return {
      ...r,
      financialImpactAed: Number(r.financialImpactAed || 0),
      proposedPayload: (r.proposedPayload ?? {}) as Record<string, unknown>,
    };
  }
}

/** The approval item is missing, already decided, or belongs to another tenant. */
export class ApprovalNotPendingError extends Error {
  constructor(readonly approvalId: string) {
    super(`Approval item '${approvalId}' is not pending (already decided, or not found).`);
    this.name = 'ApprovalNotPendingError';
  }
}

/** Global Shared Policy Service Singleton */
export const policyService = new PolicyService();
