export const dynamic = 'force-dynamic';

/**
 * GET  /api/service-tickets/automation/sweep — dry-run preview for the tenant
 * POST /api/service-tickets/automation/sweep — execute FSM automation sweep
 *      (auto-closure after quiet period + periodic reminders) for the tenant
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { runTicketAutomationSweep } from '@/lib/service-tickets/automation-engine';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

const ALLOWED_SWEEP_ROLES = new Set([
  'SUPER_ADMIN',
  'TENANT_ADMIN',
  'OPERATIONS_MANAGER',
  'FLEET_MANAGER',
  'OPERATIONS',
]);

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId, userId } = authz;

  return withTenantRls(prisma, tenantId, async () => {
    try {
      const report = await runTicketAutomationSweep(tenantId, {
        dryRun: true,
        actorId: userId ?? 'user:preview',
      });
      return NextResponse.json({ ok: true, report });
    } catch (err) {
      captureException(err, { context: 'service-tickets.automation.preview', tags: { tenantId } });
      return NextResponse.json({ ok: false, error: 'Failed to preview automation sweep' }, { status: 500 });
    }
  });
}

async function handlePOST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId, userId } = authz;

  const userRole = (req.headers.get('x-user-role') || '').trim().toUpperCase();
  if (userRole && !ALLOWED_SWEEP_ROLES.has(userRole)) {
    return NextResponse.json(
      { ok: false, error: 'Only administrators or operations managers can execute automation sweeps.' },
      { status: 403 },
    );
  }

  const dryRun = req.nextUrl.searchParams.get('dryRun') === 'true';

  return withTenantRls(prisma, tenantId, async () => {
    try {
      const report = await runTicketAutomationSweep(tenantId, {
        dryRun,
        actorId: userId ?? 'user:manual-sweep',
      });
      return NextResponse.json({ ok: true, report });
    } catch (err) {
      captureException(err, { context: 'service-tickets.automation.sweep', tags: { tenantId } });
      return NextResponse.json({ ok: false, error: 'Failed to execute automation sweep' }, { status: 500 });
    }
  });
}

export const POST = withAuditedAction(handlePOST);
