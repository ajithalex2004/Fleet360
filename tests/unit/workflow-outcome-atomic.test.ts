/**
 * An approval's outcome is applied in the same transaction that ends it.
 *
 * completeInstance used to mark the instance APPROVED / REJECTED, then apply
 * the outcome to the module's record in a try/catch that only logged. When
 * the apply failed the caller got a success, the record stayed in its old
 * state, and a retry was refused as "already APPROVED".
 *
 * Now the decision runs in one tenant transaction, a failed apply throws
 * WorkflowOutcomeError (rolling everything back), and side effects — the
 * subject's after-hook, approver emails — run only after the commit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const st = vi.hoisted(() => ({
  events: [] as string[],
  inTx: false,
  applyFails: false,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $executeRawUnsafe: async (q: string) => {
      st.events.push(`${st.inTx ? 'tx' : 'auto'}:${q.replace(/\s+/g, ' ').trim().slice(0, 40)}`);
      return 1;
    },
    $queryRawUnsafe: async (q: string) => {
      if (q.includes('FROM "WorkflowInstance" WHERE id=')) {
        return [{ id: 'wi1', workflowId: 'wf1', referenceType: 'thing', referenceId: 'r1', referenceNumber: 'R-1',
          initiatedByEmail: 'a@x', initiatedByName: null, status: 'IN_PROGRESS', contextJson: {} }];
      }
      return []; // no further level waiting: the approval completes
    },
  },
}));
vi.mock('@/lib/rls', () => ({
  withPlatformAdmin: async (_p: unknown, fn: (tx: unknown) => unknown) => fn({}),
  withTenantRls: async (_p: unknown, _t: string, fn: (tx: unknown) => Promise<unknown>) => {
    st.inTx = true;
    st.events.push('BEGIN');
    try {
      const r = await fn({});
      st.events.push('COMMIT');
      return r;
    } catch (e) {
      st.events.push('ROLLBACK');
      throw e;
    } finally {
      st.inTx = false;
    }
  },
}));
vi.mock('@/lib/workflow/subjects', () => ({
  applyWorkflowOutcomeInTx: async () => {
    st.events.push(`${st.inTx ? 'tx' : 'auto'}:apply`);
    if (st.applyFails) throw new Error('estimate changed since it was submitted');
    return async () => { st.events.push(`${st.inTx ? 'tx' : 'auto'}:after-hook`); };
  },
}));

import { advanceWorkflow, WorkflowOutcomeError, OutcomeConflictError } from '@/lib/workflow-db';

beforeEach(() => {
  st.events.length = 0;
  st.inTx = false;
  st.applyFails = false;
});

describe('ending an approval', () => {
  it('ends it and applies the outcome in one transaction, then runs the after-hook', async () => {
    const r = await advanceWorkflow('tenant-a', 'wi1', 1, 'AUTO', 'ok', 'system');
    expect(r.status).toBe('APPROVED');
    const commit = st.events.indexOf('COMMIT');
    expect(st.events.indexOf('tx:apply')).toBeGreaterThan(-1);
    expect(st.events.indexOf('tx:apply')).toBeLessThan(commit);
    expect(st.events.some((e) => e.startsWith('tx:UPDATE "WorkflowInstance"'))).toBe(true);
    // After the commit, outside the transaction.
    expect(st.events.indexOf('auto:after-hook')).toBeGreaterThan(commit);
  });

  it('rolls the whole decision back and throws when the outcome cannot be applied', async () => {
    st.applyFails = true;
    const err = await advanceWorkflow('tenant-a', 'wi1', 1, 'AUTO', 'ok', 'system').catch((e) => e);
    expect(err).toBeInstanceOf(WorkflowOutcomeError);
    expect((err as Error).message).toContain('estimate changed since it was submitted');
    expect(st.events).toContain('ROLLBACK');
    expect(st.events).not.toContain('COMMIT');
    expect(st.events.some((e) => e.includes('after-hook'))).toBe(false);
  });

  it('shows the client only user-safe outcome text', () => {
    const internal = new WorkflowOutcomeError('APPROVED', 'refund', 'r1', new Error('relation "finance_payables" column "x" does not exist'));
    expect(internal.publicMessage).not.toContain('finance_payables');
    expect(internal.publicMessage).toContain('Nothing was changed');
    const conflict = new WorkflowOutcomeError('APPROVED', 'estimate', 'e1', new OutcomeConflictError('the estimate changed since it was submitted'));
    expect(conflict.publicMessage).toContain('the estimate changed since it was submitted');
  });
});
