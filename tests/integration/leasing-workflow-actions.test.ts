import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { PATCH } from '@/app/api/leasing/approval-steps/route';

function patchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/leasing/approval-steps', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Leasing workflow action buttons API', () => {
  let stepId = '';
  let rejectedStepId = '';

  beforeAll(async () => {
    const step = await prisma.leaseApprovalStep.create({
      data: {
        entityType: 'QUOTATION',
        entityId: `qt-${Date.now()}`,
        stepName: 'Internal Approval',
        stepOrder: 1,
        approverRole: 'TENANT_ADMIN',
        status: 'PENDING',
      },
    });
    stepId = step.id;
    const rejectedStep = await prisma.leaseApprovalStep.create({
      data: {
        entityType: 'CONTRACT',
        entityId: `lc-${Date.now()}`,
        stepName: 'Credit Approval',
        stepOrder: 2,
        approverRole: 'TENANT_ADMIN',
        status: 'PENDING',
      },
    });
    rejectedStepId = rejectedStep.id;
  }, 120_000);

  afterAll(async () => {
    await prisma.leaseApprovalStep.deleteMany({ where: { id: { in: [stepId, rejectedStepId].filter(Boolean) } } }).catch(() => {});
  }, 120_000);

  it('approves and rejects pending workflow steps, then prevents duplicate action', async () => {
    const approve = await PATCH(patchRequest({
      id: stepId,
      action: 'APPROVE',
      approverName: 'Workflow Test',
      comments: 'Approved from integration test',
    }));
    expect(approve.status).toBe(200);
    const approved = await prisma.leaseApprovalStep.findUnique({ where: { id: stepId } });
    expect(approved).toMatchObject({ id: stepId, status: 'APPROVED', approverName: 'Workflow Test' });
    expect(approved?.actionAt).toBeTruthy();

    const duplicate = await PATCH(patchRequest({
      id: stepId,
      action: 'REJECT',
    }));
    expect(duplicate.status).toBe(409);

    const reject = await PATCH(patchRequest({
      id: rejectedStepId,
      action: 'REJECT',
      approverName: 'Workflow Test',
      comments: 'Rejected from integration test',
    }));
    expect(reject.status).toBe(200);
    const rejected = await prisma.leaseApprovalStep.findUnique({ where: { id: rejectedStepId } });
    expect(rejected).toMatchObject({ id: rejectedStepId, status: 'REJECTED', approverName: 'Workflow Test' });
  }, 120_000);
});
