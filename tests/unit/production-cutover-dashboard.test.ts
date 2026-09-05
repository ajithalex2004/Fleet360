/**
 * Phase 10: Production Cutover, Dashboard & Live Verification Test Suite
 * ------------------------------------------------------------------------
 * Verifies live telemetry aggregation, executive dashboard ROI calculations,
 * Human-in-the-Loop review queue API, multi-tenant policy configuration API,
 * on-demand ground-truth benchmark evaluation API, and end-to-end system cohesion.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { aiDashboardService } from '@/lib/agents/dashboard';
import { policyService } from '@/lib/agents/governance';
import { GET as getDashboard } from '@/app/api/agents/dashboard/route';
import { GET as getApprovals, POST as postApprovals } from '@/app/api/agents/approvals/route';
import { GET as getPolicy, PUT as putPolicy } from '@/app/api/agents/policy/route';
import { GET as getEval, POST as postEval } from '@/app/api/agents/eval/route';
import { NextRequest } from 'next/server';

describe('Phase 10: Production Cutover, Dashboard & Live Verification', () => {
  const tenantId = 'tenant-cutover-qa-01';

  beforeEach(async () => {
    // Ensure clean default policy for testing
    await policyService.updateTenantPolicy(tenantId, {
      maxAutonomyLevel: 'L3_HUMAN_CONFIRMATION',
      dailyBudgetAed: 150.0,
      monthlyBudgetAed: 3500.0,
      requireHumanApprovalThresholdAed: 250.0,
      disabledAgents: [],
      circuitBreakerTriggered: false,
    });
  });

  describe('1. AI Dashboard Service & ROI Metrics Aggregation', () => {
    it('aggregates executive ROI summary, routing matrix stats, and quality scores', async () => {
      const data = await aiDashboardService.getTenantDashboard(tenantId);

      expect(data.tenantId).toBe(tenantId);
      expect(data.roiSummary).toBeDefined();
      expect(data.roiSummary.totalCostAed).toBeGreaterThanOrEqual(0);
      expect(data.roiSummary.totalAvoidedCostAed).toBeGreaterThanOrEqual(0);
      expect(data.roiSummary.roiMultiplier).toBeGreaterThanOrEqual(1.0);
      expect(data.roiSummary.matrixCacheHitRatePct).toBeGreaterThanOrEqual(0);

      expect(data.capabilityBreakdown).toHaveLength(3);
      expect(data.capabilityBreakdown.map((c) => c.tier)).toContain('ECONOMY_TEXT');
      expect(data.capabilityBreakdown.map((c) => c.tier)).toContain('STANDARD_REASONING');
      expect(data.capabilityBreakdown.map((c) => c.tier)).toContain('VISION_FAST');

      expect(data.approvalSummary).toBeDefined();
      expect(data.policy).toBeDefined();
      expect(data.policy.dailyBudgetAed).toBe(150.0);

      expect(data.evaluationQuality).toBeDefined();
      expect(data.evaluationQuality.latestDecisionQualityScore).toBeGreaterThanOrEqual(0.90);
      expect(data.evaluationQuality.overallStatus).toBe('OPTIMAL');
    });
  });

  describe('2. Executive Dashboard API (/api/agents/dashboard)', () => {
    it('returns 200 OK with live telemetry for authorized tenant', async () => {
      const req = new NextRequest('http://localhost/api/agents/dashboard', {
        headers: { 'x-tenant-id': tenantId },
      });

      const res = await getDashboard(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(json.data.tenantId).toBe(tenantId);
      expect(json.data.roiSummary).toBeDefined();
    });

    it('rejects unauthorized requests without tenant context', async () => {
      const req = new NextRequest('http://localhost/api/agents/dashboard');
      const res = await getDashboard(req);
      const json = await res.json();

      expect(res.status).toBe(401);
      expect(json.error).toBeDefined();
    });
  });

  describe('3. Human-in-the-Loop Review Queue API (/api/agents/approvals)', () => {
    it('creates, lists, and approves an action proposal through the review queue API', async () => {
      // 1. Propose high-exposure action exceeding threshold
      const proposal = await policyService.evaluateActionProposal(tenantId, {
        agentId: 'finance-anomaly',
        entityType: 'VENDOR_INVOICE',
        entityId: 'inv-cutover-999',
        actionType: 'DISPUTE_INVOICE',
        title: 'Dispute Overcharged Invoice',
        description: 'Dispute AED 850 overcharge with parts supplier',
        financialImpactAed: 850.0,
      });

      expect(proposal.requiresApprovalQueue).toBe(true);

      const approvalItem = await policyService.createApprovalItem(tenantId, {
        agentId: 'finance-anomaly',
        entityType: 'VENDOR_INVOICE',
        entityId: 'inv-cutover-999',
        actionType: 'DISPUTE_INVOICE',
        title: 'Dispute Overcharged Invoice',
        description: 'Dispute AED 850 overcharge with parts supplier',
        financialImpactAed: 850.0,
        requestedAutonomy: 'L4_FULL_AUTONOMOUS',
      });

      // 2. GET /api/agents/approvals
      const getReq = new NextRequest('http://localhost/api/agents/approvals', {
        headers: { 'x-tenant-id': tenantId },
      });
      const getRes = await getApprovals(getReq);
      const getJson = await getRes.json();

      expect(getRes.status).toBe(200);
      expect(getJson.ok).toBe(true);
      expect(getJson.count).toBeGreaterThanOrEqual(1);

      // 3. POST /api/agents/approvals (Approve)
      const postReq = new NextRequest('http://localhost/api/agents/approvals', {
        method: 'POST',
        headers: {
          'x-tenant-id': tenantId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          approvalId: approvalItem.id,
          decision: 'APPROVED',
          reviewerId: 'operations_director_01',
          notes: 'Approved after supplier verification',
        }),
      });

      const postRes = await postApprovals(postReq);
      const postJson = await postRes.json();

      expect(postRes.status).toBe(200);
      expect(postJson.ok).toBe(true);
      expect(postJson.data.status).toBe('APPROVED');
      expect(postJson.data.reviewedBy).toBe('operations_director_01');
    });
  });

  describe('4. Tenant AI Policy & Circuit Breaker API (/api/agents/policy)', () => {
    it('retrieves and updates tenant governance policy and budget quotas', async () => {
      // 1. GET current policy
      const getReq = new NextRequest('http://localhost/api/agents/policy', {
        headers: { 'x-tenant-id': tenantId },
      });
      const getRes = await getPolicy(getReq);
      const getJson = await getRes.json();

      expect(getRes.status).toBe(200);
      expect(getJson.ok).toBe(true);
      expect(getJson.data.tenantId).toBe(tenantId);

      // 2. PUT updated policy
      const putReq = new NextRequest('http://localhost/api/agents/policy', {
        method: 'PUT',
        headers: {
          'x-tenant-id': tenantId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          dailyBudgetAed: 225.0,
          requireHumanApprovalThresholdAed: 500.0,
          disabledAgents: ['driver-coaching'],
        }),
      });

      const putRes = await putPolicy(putReq);
      const putJson = await putRes.json();

      expect(putRes.status).toBe(200);
      expect(putJson.ok).toBe(true);
      expect(putJson.data.dailyBudgetAed).toBe(225.0);
      expect(putJson.data.requireHumanApprovalThresholdAed).toBe(500.0);
      expect(putJson.data.disabledAgents).toContain('driver-coaching');
    });
  });

  describe('5. AI Quality Evaluation API (/api/agents/eval)', () => {
    it('executes on-demand ground-truth benchmark and persists evaluation metric', async () => {
      // 1. POST /api/agents/eval (Trigger benchmark)
      const postReq = new NextRequest('http://localhost/api/agents/eval', {
        method: 'POST',
        headers: { 'x-tenant-id': tenantId },
      });

      const postRes = await postEval(postReq);
      const postJson = await postRes.json();

      expect(postRes.status).toBe(200);
      expect(postJson.ok).toBe(true);
      expect(postJson.benchmarkResult).toBeDefined();
      expect(postJson.benchmarkResult.passed).toBe(true);
      expect(postJson.benchmarkResult.metrics.decisionQualityScore).toBeGreaterThanOrEqual(0.95);

      // 2. GET /api/agents/eval (List historical metrics)
      const getReq = new NextRequest('http://localhost/api/agents/eval', {
        headers: { 'x-tenant-id': tenantId },
      });

      const getRes = await getEval(getReq);
      const getJson = await getRes.json();

      expect(getRes.status).toBe(200);
      expect(getJson.ok).toBe(true);
      expect(getJson.count).toBeGreaterThanOrEqual(1);
    });
  });
});
