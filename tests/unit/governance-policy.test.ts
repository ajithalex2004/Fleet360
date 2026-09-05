import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PolicyService, policyService } from '@/lib/agents/governance';
import { dispatch } from '@/lib/agents/orchestrator';
import { AgentEvent } from '@/lib/agents/types';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    $queryRawUnsafe: vi.fn(),
  },
}));

vi.mock('@/lib/agents/schema', () => ({
  ensureAgentSchema: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/agents/registry', () => ({
  getAgent: vi.fn().mockResolvedValue({
    id: 'test-agent',
    name: 'Test Agent',
    run: vi.fn().mockResolvedValue({
      agentId: 'test-agent',
      tenantId: 'tenant-101',
      eventType: 'manual.trigger',
      status: 'COMPLETED',
      durationMs: 10,
      itemsProcessed: 1,
      actionsCreated: 1,
      output: { success: true },
    }),
  }),
}));

describe('Phase 8: Multi-Tenant Policy, Autonomy Levels & Human-in-the-Loop Governance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Policy Resolution & Defaults', () => {
    it('returns standard default policy for an unconfigured tenant', async () => {
      const { prisma } = await import('@/lib/prisma');
      (prisma.$queryRawUnsafe as any).mockResolvedValueOnce([]); // No row found

      const policy = await policyService.getTenantPolicy('tenant-new');
      expect(policy.tenantId).toBe('tenant-new');
      expect(policy.maxAutonomyLevel).toBe('L3');
      expect(policy.dailyBudgetAed).toBe(200.0);
      expect(policy.monthlyBudgetAed).toBe(5000.0);
      expect(policy.requireHumanApprovalThresholdAed).toBe(500.0);
      expect(policy.disabledAgents).toEqual([]);
      expect(policy.circuitBreakerTriggered).toBe(false);
    });

    it('updates tenant policy correctly', async () => {
      const { prisma } = await import('@/lib/prisma');
      (prisma.$queryRawUnsafe as any).mockResolvedValueOnce([]); // default baseline

      const updated = await policyService.updateTenantPolicy('tenant-dxb', {
        maxAutonomyLevel: 'L4',
        dailyBudgetAed: 1000.0,
        requireHumanApprovalThresholdAed: 1500.0,
        disabledAgents: ['incident-triage'],
      });

      expect(updated.maxAutonomyLevel).toBe('L4');
      expect(updated.dailyBudgetAed).toBe(1000.0);
      expect(updated.requireHumanApprovalThresholdAed).toBe(1500.0);
      expect(updated.disabledAgents).toContain('incident-triage');
      expect(prisma.$executeRawUnsafe).toHaveBeenCalled();
    });
  });

  describe('Autonomy Level Hierarchy & Demotion Logic', () => {
    it('rejects action if agent is disabled in tenant policy', async () => {
      const decision = await policyService.evaluateActionAutonomy('tenant-1', {
        agentId: 'driver-coach',
        entityType: 'DRIVER',
        entityId: 'drv-9',
        actionType: 'SEND_COACHING_PLAN',
        title: 'Weekly Coaching',
        description: 'Send coaching plan',
        requestedAutonomy: 'L2',
      }, {
        tenantId: 'tenant-1',
        maxAutonomyLevel: 'L3',
        dailyBudgetAed: 200,
        monthlyBudgetAed: 5000,
        requireHumanApprovalThresholdAed: 500,
        disabledAgents: ['driver-coach'],
        circuitBreakerTriggered: false,
      });

      expect(decision.grantedAutonomy).toBe('L0');
      expect(decision.wasDemoted).toBe(true);
      expect(decision.demotionReason).toContain("Agent 'driver-coach' is disabled by tenant policy");
    });

    it('demotes L4 requested action to L3 review queue when financial exposure exceeds threshold', async () => {
      const decision = await policyService.evaluateActionAutonomy('tenant-1', {
        agentId: 'finance-anomaly',
        entityType: 'INVOICE',
        entityId: 'inv-888',
        actionType: 'AUTO_REMEDIATE_INVOICE',
        title: 'Invoice Dispute',
        description: 'Deduct overcharged rate card variance',
        financialImpactAed: 2400.0, // Exceeds 500 AED threshold
        requestedAutonomy: 'L4',
      }, {
        tenantId: 'tenant-1',
        maxAutonomyLevel: 'L4',
        dailyBudgetAed: 500,
        monthlyBudgetAed: 10000,
        requireHumanApprovalThresholdAed: 500.0,
        disabledAgents: [],
        circuitBreakerTriggered: false,
      });

      expect(decision.grantedAutonomy).toBe('L3');
      expect(decision.wasDemoted).toBe(true);
      expect(decision.requiresApprovalQueue).toBe(true);
      expect(decision.autoExecutable).toBe(false);
      expect(decision.demotionReason).toContain('exceeds autonomous threshold');
    });

    it('allows L4 autonomous execution when financial exposure is below threshold', async () => {
      const decision = await policyService.evaluateActionAutonomy('tenant-1', {
        agentId: 'dispatch-optimiser',
        entityType: 'JOB',
        entityId: 'job-101',
        actionType: 'COMMIT_DISPATCH',
        title: 'Auto Dispatch Assignment',
        description: 'Assign nearest available courier',
        financialImpactAed: 45.0, // Below 500 AED threshold
        requestedAutonomy: 'L4',
      }, {
        tenantId: 'tenant-1',
        maxAutonomyLevel: 'L4',
        dailyBudgetAed: 500,
        monthlyBudgetAed: 10000,
        requireHumanApprovalThresholdAed: 500.0,
        disabledAgents: [],
        circuitBreakerTriggered: false,
      });

      expect(decision.grantedAutonomy).toBe('L4');
      expect(decision.wasDemoted).toBe(false);
      expect(decision.requiresApprovalQueue).toBe(false);
      expect(decision.autoExecutable).toBe(true);
    });
  });

  describe('Budget Quota & Circuit Breaker', () => {
    it('blocks execution and trips circuit breaker when daily spend exceeds limit', async () => {
      const { prisma } = await import('@/lib/prisma');
      const service = new PolicyService();

      // Mock getTenantPolicy
      vi.spyOn(service, 'getTenantPolicy').mockResolvedValueOnce({
        tenantId: 'tenant-budget-test',
        maxAutonomyLevel: 'L3',
        dailyBudgetAed: 100.0,
        monthlyBudgetAed: 2000.0,
        requireHumanApprovalThresholdAed: 500.0,
        disabledAgents: [],
        circuitBreakerTriggered: false,
      });

      // Mock today's spend = 105 AED (over 100 AED cap)
      (prisma.$queryRawUnsafe as any).mockResolvedValueOnce([{ todayCostAed: 105.0 }]);

      const quota = await service.checkBudgetQuota('tenant-budget-test', 1.0);
      expect(quota.allowed).toBe(false);
      expect(quota.reason).toContain('Daily budget exceeded');
    });
  });

  describe('Human-in-the-Loop Review Queue', () => {
    it('creates, retrieves, and approves approval items', async () => {
      const { prisma } = await import('@/lib/prisma');
      const service = new PolicyService();

      (prisma.$queryRawUnsafe as any)
        .mockResolvedValueOnce([{ id: 'mock-uuid-1' }]) // For gen_random_uuid
        .mockResolvedValueOnce([
          {
            id: 'mock-uuid-1',
            tenantId: 'tenant-test',
            agentId: 'finance-anomaly',
            entityType: 'INVOICE',
            entityId: 'inv-123',
            actionType: 'REVISE_PO',
            title: 'Overcharge Correction',
            description: 'Apply 350 AED credit',
            financialImpactAed: 350.0,
            proposedPayload: { discount: 350 },
            status: 'PENDING',
            requestedAutonomy: 'L3',
            createdAt: new Date().toISOString(),
          },
        ]) // For getPendingApprovals
        .mockResolvedValueOnce([
          {
            id: 'mock-uuid-1',
            tenantId: 'tenant-test',
            agentId: 'finance-anomaly',
            entityType: 'INVOICE',
            entityId: 'inv-123',
            actionType: 'REVISE_PO',
            title: 'Overcharge Correction',
            description: 'Apply 350 AED credit',
            financialImpactAed: 350.0,
            proposedPayload: { discount: 350 },
            status: 'APPROVED',
            requestedAutonomy: 'L3',
            reviewedBy: 'user-cfo-1',
            reviewedAt: new Date().toISOString(),
            reviewNotes: 'Verified with vendor',
            createdAt: new Date().toISOString(),
          },
        ]); // For reviewApprovalItem

      const item = await service.createApprovalItem({
        agentId: 'finance-anomaly',
        entityType: 'INVOICE',
        entityId: 'inv-123',
        actionType: 'REVISE_PO',
        title: 'Overcharge Correction',
        description: 'Apply 350 AED credit',
        financialImpactAed: 350.0,
        payload: { discount: 350 },
      }, 'tenant-test');

      expect(item.id).toBeDefined();
      expect(item.status).toBe('PENDING');

      const pendingList = await service.getPendingApprovals('tenant-test');
      expect(pendingList.length).toBe(1);
      expect(pendingList[0].actionType).toBe('REVISE_PO');

      const approved = await service.reviewApprovalItem('mock-uuid-1', 'user-cfo-1', 'APPROVED', 'Verified with vendor');
      expect(approved.status).toBe('APPROVED');
      expect(approved.reviewedBy).toBe('user-cfo-1');
    });
  });

  describe('Orchestrator Policy Guard Integration', () => {
    it('blocks dispatch when agent is disabled by tenant policy', async () => {
      vi.spyOn(policyService, 'checkBudgetQuota').mockResolvedValueOnce({ allowed: true });
      vi.spyOn(policyService, 'getTenantPolicy').mockResolvedValueOnce({
        tenantId: 'tenant-locked',
        maxAutonomyLevel: 'L3',
        dailyBudgetAed: 200,
        monthlyBudgetAed: 5000,
        requireHumanApprovalThresholdAed: 500,
        disabledAgents: ['dispatch-optimiser'],
        circuitBreakerTriggered: false,
      });

      const event: AgentEvent = {
        agent_id: 'dispatch-optimiser',
        tenant_id: 'tenant-locked',
        event_type: 'dispatch.job_created',
      };

      const result = await dispatch(event);
      expect(result.status).toBe('FAILED');
      expect(result.error).toContain("Agent 'dispatch-optimiser' is disabled by tenant policy");
    });
  });
});
