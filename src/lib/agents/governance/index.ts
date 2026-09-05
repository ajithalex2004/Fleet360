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
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  requestedAutonomy: AgentAutonomyLevel;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  reviewNotes?: string | null;
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
      const rows = await prisma.$queryRawUnsafe<any[]>(
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
  async updateTenantPolicy(tenantId: string, updates: Partial<TenantPolicy>): Promise<TenantPolicy> {
    await ensureAgentSchema();
    const current = await this.getTenantPolicy(tenantId);
    const updated: TenantPolicy = { ...current, ...updates };

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
   * Verifies tenant budget quota before executing an agent run.
   */
  async checkBudgetQuota(
    tenantId: string,
    estimatedCostAed = 0.05,
  ): Promise<{ allowed: boolean; reason?: string }> {
    const policy = await this.getTenantPolicy(tenantId);

    if (policy.circuitBreakerTriggered) {
      return {
        allowed: false,
        reason: 'Circuit breaker triggered: tenant daily/monthly AI budget cap reached.',
      };
    }

    try {
      // Check today's aggregated cost from agent_roi_metrics
      const rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT COALESCE(SUM(total_cost_aed), 0)::float8 AS "todayCostAed"
         FROM agent_roi_metrics
         WHERE tenant_id = $1 AND period_date = CURRENT_DATE`,
        policy.tenantId,
      );

      const todayCost = rows?.[0]?.todayCostAed ?? 0;
      if (todayCost + estimatedCostAed > policy.dailyBudgetAed) {
        // Trigger circuit breaker automatically
        await this.updateTenantPolicy(tenantId, { circuitBreakerTriggered: true });
        return {
          allowed: false,
          reason: `Daily budget exceeded: today's spend (${todayCost.toFixed(2)} AED) reached cap (${policy.dailyBudgetAed.toFixed(2)} AED). Circuit breaker engaged.`,
        };
      }
    } catch {
      // Allow execution on metric query failure to avoid false-positive blocking
    }

    return { allowed: true };
  }

  /**
   * Create an approval item in the Human-in-the-Loop review queue.
   */
  async createApprovalItem(
    proposal: ActionProposal,
    tenantId: string,
    requestedAutonomy: AgentAutonomyLevel = 'L3',
  ): Promise<ApprovalItem> {
    await ensureAgentSchema();
    const cleanTenant = tenantId?.trim() || 'default';
    const id = (await prisma.$queryRawUnsafe<any[]>(`SELECT gen_random_uuid()::text AS id`))[0]?.id || `appr_${Date.now()}`;

    await prisma.$executeRawUnsafe(
      `INSERT INTO agent_approvals (
         id, tenant_id, agent_id, entity_type, entity_id,
         action_type, title, description, financial_impact_aed,
         proposed_payload, status, requested_autonomy, created_at
       ) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,'PENDING',$11,NOW())`,
      id,
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
      ? await prisma.$queryRawUnsafe<any[]>(sql, cleanTenant, agentId)
      : await prisma.$queryRawUnsafe<any[]>(sql, cleanTenant);

    return rows.map((r) => ({
      ...r,
      financialImpactAed: Number(r.financialImpactAed || 0),
      proposedPayload: r.proposedPayload ?? {},
    }));
  }

  /**
   * Human review action: Approve or Reject an approval item.
   */
  async reviewApprovalItem(
    approvalId: string,
    reviewerId: string,
    decision: 'APPROVED' | 'REJECTED',
    notes?: string,
  ): Promise<ApprovalItem> {
    await ensureAgentSchema();

    await prisma.$executeRawUnsafe(
      `UPDATE agent_approvals
       SET status = $1, reviewed_by = $2, reviewed_at = NOW(), review_notes = $3
       WHERE id = $4::uuid`,
      decision,
      reviewerId,
      notes ?? null,
      approvalId,
    );

    const rows = await prisma.$queryRawUnsafe<any[]>(
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
      proposedPayload: r.proposedPayload ?? {},
    };
  }
}

/** Global Shared Policy Service Singleton */
export const policyService = new PolicyService();
