export const dynamic = 'force-dynamic';

/**
 * GET  /api/service-tickets/service-reports — list signed Field Service Reports (FSR)
 * POST /api/service-tickets/service-reports — submit signed FSR with e-signatures & optional visit completion
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import { WorkforceError } from '@/lib/service-tickets/workforce-db';
import { createServiceReport, listServiceReports } from '@/lib/service-tickets/dispatch-db';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;

  const ticketId = req.nextUrl.searchParams.get('ticketId') || undefined;
  const visitId = req.nextUrl.searchParams.get('visitId') || undefined;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const reports = await listServiceReports(tx, tenantId, { ticketId, visitId });
      return NextResponse.json({ ok: true, reports });
    } catch (err) {
      if (err instanceof WorkforceError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      }
      captureException(err, { context: 'fsm.reports.list', tags: { tenantId } });
      return NextResponse.json({ ok: false, error: 'Failed to load service reports.' }, { status: 500 });
    }
  });
}

async function handlePOST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId, userId } = authz;
  const platformRole = req.headers.get('x-user-role') || '';

  let body: Record<string, unknown>;
  try {
    body = stripTenantOwnershipFields(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const report = await createServiceReport(tx, tenantId, userId ?? 'technician', body);
      void logAudit({
        tenantId,
        userId: userId ?? undefined,
        userRole: platformRole || undefined,
        entityType: 'FsmServiceReport',
        entityId: report.id,
        entityName: report.reportNumber,
        action: 'CREATE',
        details: `Submitted Field Service Report ${report.reportNumber} for ticket ${report.ticketReadableId ?? report.ticketId}`,
      });
      return NextResponse.json({ ok: true, report }, { status: 201 });
    } catch (err) {
      if (err instanceof WorkforceError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      }
      captureException(err, { context: 'fsm.reports.create', tags: { tenantId } });
      return NextResponse.json({ ok: false, error: 'Failed to submit service report.' }, { status: 500 });
    }
  });
}

export const POST = withAuditedAction(handlePOST);
