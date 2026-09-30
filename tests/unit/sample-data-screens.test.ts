/**
 * tests/unit/sample-data-screens.test.ts
 *
 * Screens that still show built-in example figures say so, and Driver
 * Feedback now files a real maintenance request.
 *  - every screen listed below renders the Preview banner; once a screen
 *    reads from the API, drop the banner and remove it from this list
 *  - driver reports: the request body, and reading a report back
 *  - maintenance requests refuse a vehicle that isn't the tenant's
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('next/server', async () => await import('next/server.js'));

const rec = vi.hoisted(() => ({ vehicle: null as null | { id: string }, creates: [] as Array<Record<string, unknown>> }));
const tx = vi.hoisted(() => ({
  vehicle: { findFirst: async () => rec.vehicle },
  maintenanceRequest: {
    create: async ({ data }: { data: Record<string, unknown> }) => { rec.creates.push(data); return { id: 'mr-1', ...data }; },
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: tx }));
vi.mock('@/lib/rls', () => ({ withTenantRls: async (_p: unknown, _t: string, fn: (t: unknown) => unknown) => fn(tx) }));
vi.mock('@/lib/sentry', () => ({ captureException: () => {}, captureMessage: () => {} }));

import { NextRequest } from 'next/server';
import { driverReportRequest, parseDriverReport } from '@/lib/maintenance/driver-report';
import { POST as createRequest } from '@/app/api/maintenance-requests/route';

const PREVIEW_SCREENS = [
  'maintenance/sla',
  'maintenance/schedule',
  'maintenance/garage-assignments',
  'maintenance/garage-performance',
  'maintenance/approvals/rules',
  'maintenance/predictive-alerts',
  'school-bus/analytics',
  'ai-platform/predictive',
];

describe('screens with example figures', () => {
  it.each(PREVIEW_SCREENS)('%s shows the Preview banner', (screen) => {
    const src = readFileSync(join(process.cwd(), 'src/app/(app)', screen, 'page.tsx'), 'utf8');
    expect(src).toMatch(/import PreviewBanner from '@\/components\/PreviewBanner'/);
    expect(src).toMatch(/<PreviewBanner[\s/]/);
  });
});

describe('driver reports', () => {
  const form = { vehicleId: 'v1', issue: '  Grinding noise when braking ', severity: 'High' as const, category: 'Brakes' };

  it('become corrective maintenance requests the screen can read back', () => {
    const built = driverReportRequest(form);
    expect(built).toEqual({
      ok: true,
      body: {
        vehicleId: 'v1',
        description: 'Driver report — Brakes (High): Grinding noise when braking',
        maintenanceType: 'CORRECTIVE',
        priority: 'HIGH',
        status: 'Requested',
        maintenanceJobs: ['Brakes'],
      },
    });
    if (!built.ok) throw new Error('unreachable');
    expect(parseDriverReport(built.body.description as string)).toEqual({ category: 'Brakes', severity: 'High', issue: 'Grinding noise when braking' });
  });

  it('need a vehicle and a description', () => {
    expect(driverReportRequest({ ...form, vehicleId: '' }).ok).toBe(false);
    expect(driverReportRequest({ ...form, issue: '  ' }).ok).toBe(false);
  });

  it('are told apart from other requests', () => {
    expect(parseDriverReport('10k service')).toBeNull();
    expect(parseDriverReport(null)).toBeNull();
  });
});

describe('maintenance request API', () => {
  const headers = { 'x-tenant-id': 'tenant-a', 'x-user-id': 'u1', 'x-user-role': 'TENANT_ADMIN', 'content-type': 'application/json' };
  const post = (body: unknown) => createRequest(new NextRequest('http://localhost/api/maintenance-requests', { method: 'POST', headers, body: JSON.stringify(body) }));
  beforeEach(() => { rec.vehicle = null; rec.creates = []; });

  it("refuses a vehicle that isn't the tenant's", async () => {
    const res = await post({ vehicleId: 'v-other', description: 'x' });
    expect(res.status).toBe(404);
    expect(rec.creates).toHaveLength(0);
  });

  it("files the request under the session tenant, whatever the body says", async () => {
    rec.vehicle = { id: 'v1' };
    const res = await post({ vehicleId: 'v1', description: 'x', tenantId: 'tenant-b' });
    expect(res.status).toBe(201);
    expect(rec.creates[0]).toMatchObject({ tenantId: 'tenant-a', vehicleId: 'v1' });
  });
});
