/**
 * tests/unit/jobs-run-claims-route.test.ts
 *
 * POST /api/jobs/run claims every run before the handler starts
 * (architecture audit A8): a run it does not win is skipped, a claim that
 * cannot be written runs nothing, and the outcome is recorded on the claim.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const runs = vi.hoisted(() => ({
  claimRun: vi.fn(),
  finishRun: vi.fn(async () => undefined),
  handler: vi.fn(),
}));
vi.mock('@/lib/jobs/job-runs', () => ({
  claimRun: runs.claimRun,
  finishRun: runs.finishRun,
  leaseSecondsFor: (s?: number) => Math.max((s ?? 300) * 2, 600),
}));
vi.mock('@/lib/jobs/registry', () => {
  const def = { name: 'dunning-sweep', description: 'test', handler: runs.handler, maxDurationSec: 120 };
  return {
    JOB_REGISTRY: [def],
    JOB_MAP: new Map([['dunning-sweep', def]]),
    isJobAuthorized: async () => true,
    verifyJobAuthorization: async () => ({ authorized: true, tenantId: null, userId: 'system:cron' }),
  };
});

import { POST } from '@/app/api/jobs/run/route';

const post = (qs: string) => POST(new NextRequest(`http://localhost/api/jobs/run?${qs}`, { method: 'POST', body: '{}' }));

beforeEach(() => { runs.claimRun.mockReset(); runs.finishRun.mockClear(); runs.handler.mockReset(); });

describe('POST /api/jobs/run', () => {
  it('claims the scheduled occurrence, runs the job and records success', async () => {
    runs.claimRun.mockResolvedValue({ claimed: true, runId: 'run-1' });
    runs.handler.mockResolvedValue({ status: 'ok', summary: '3 notices queued' });
    const res = await post('job=dunning-sweep&occurrence=2026-10-08T02:00Z');
    expect(res.status).toBe(200);
    expect(runs.claimRun).toHaveBeenCalledWith(expect.objectContaining({
      jobName: 'dunning-sweep', scope: '*', occurrence: '2026-10-08T02:00Z', trigger: 'scheduler', leaseSeconds: 600,
    }));
    expect(runs.finishRun).toHaveBeenCalledWith('run-1', expect.objectContaining({ status: 'SUCCEEDED', summary: '3 notices queued' }));
    expect(await res.json()).toMatchObject({ runId: 'run-1', status: 'ok' });
  });

  it('gives a manual run its own occurrence', async () => {
    runs.claimRun.mockResolvedValue({ claimed: true, runId: 'run-2' });
    runs.handler.mockResolvedValue({ status: 'ok', summary: '' });
    await post('job=dunning-sweep');
    expect(runs.claimRun.mock.calls[0][0]).toMatchObject({ trigger: 'manual', occurrence: expect.stringMatching(/^manual:/) });
  });

  it('skips without running when another replica or run holds the job', async () => {
    runs.claimRun.mockResolvedValue({ claimed: false, reason: 'running', runId: 'run-0' });
    const res = await post('job=dunning-sweep&occurrence=2026-10-08T02:00Z');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'skipped', summary: expect.stringContaining('still in progress') });
    expect(runs.handler).not.toHaveBeenCalled();
    expect(runs.finishRun).not.toHaveBeenCalled();
  });

  it('runs nothing when the claim cannot be written', async () => {
    runs.claimRun.mockRejectedValue(new Error('database unavailable'));
    const res = await post('job=dunning-sweep&occurrence=2026-10-08T02:00Z');
    expect(res.status).toBe(503);
    expect(runs.handler).not.toHaveBeenCalled();
  });

  it('records a failure when the job throws or reports an error', async () => {
    runs.claimRun.mockResolvedValue({ claimed: true, runId: 'run-3' });
    runs.handler.mockRejectedValue(new Error('boom'));
    expect((await post('job=dunning-sweep')).status).toBe(500);
    expect(runs.finishRun).toHaveBeenCalledWith('run-3', expect.objectContaining({ status: 'FAILED', error: expect.stringContaining('boom') }));

    runs.finishRun.mockClear();
    runs.claimRun.mockResolvedValue({ claimed: true, runId: 'run-4' });
    runs.handler.mockReset().mockResolvedValue({ status: 'error', summary: 'partial failure' });
    await post('job=dunning-sweep');
    expect(runs.finishRun).toHaveBeenCalledWith('run-4', expect.objectContaining({ status: 'FAILED', summary: 'partial failure' }));
  });
});
