export const dynamic = 'force-dynamic';

/**
 * GET   /api/service-tickets/checklists/runs — list checklist runs by ticketId or visitId
 * POST  /api/service-tickets/checklists/runs — instantiate or submit a checklist run (idempotent)
 * PATCH /api/service-tickets/checklists/runs — update checklist responses & evaluate pass/fail
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { captureException } from '@/lib/sentry';
import { WorkforceError } from '@/lib/service-tickets/workforce-db';
import { listChecklistRuns, saveChecklistRun } from '@/lib/service-tickets/dispatch-db';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;

  const ticketId = req.nextUrl.searchParams.get('ticketId') || undefined;
  const visitId = req.nextUrl.searchParams.get('visitId') || undefined;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const runs = await listChecklistRuns(tx, tenantId, { ticketId, visitId });
      return NextResponse.json({ ok: true, runs });
    } catch (err) {
      if (err instanceof WorkforceError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      }
      captureException(err, { context: 'fsm.checklists.runs.list', tags: { tenantId } });
      return NextResponse.json({ ok: false, error: 'Failed to load checklist runs.' }, { status: 500 });
    }
  });
}

async function handleSave(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;

  let body: Record<string, unknown>;
  try {
    body = stripTenantOwnershipFields(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const run = await saveChecklistRun(tx, tenantId, body);
      return NextResponse.json({ ok: true, run }, { status: body.id ? 200 : 201 });
    } catch (err) {
      if (err instanceof WorkforceError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      }
      captureException(err, { context: 'fsm.checklists.runs.save', tags: { tenantId } });
      return NextResponse.json({ ok: false, error: 'Failed to save checklist.' }, { status: 500 });
    }
  });
}

export const POST = withAuditedAction(handleSave);
export const PATCH = withAuditedAction(handleSave);
