export const dynamic = 'force-dynamic';

/**
 * GET    /api/service-tickets/tasks         — list work order sub-tasks & technician Gantt activities
 * POST   /api/service-tickets/tasks         — create sub-task or non-job activity
 * PATCH  /api/service-tickets/tasks         — update task status/schedule (id in body)
 * DELETE /api/service-tickets/tasks?id=...  — remove task
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withAuditedAction } from '@/lib/audited-action';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import { WorkforceError } from '@/lib/service-tickets/workforce-db';
import { createWorkTask, deleteWorkTask, listWorkTasks, updateWorkTask } from '@/lib/service-tickets/dispatch-db';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;

  const ticketId = req.nextUrl.searchParams.get('ticketId') || undefined;
  const visitId = req.nextUrl.searchParams.get('visitId') || undefined;
  const technicianId = req.nextUrl.searchParams.get('technicianId') || undefined;
  const startIso = req.nextUrl.searchParams.get('start') || undefined;
  const endIso = req.nextUrl.searchParams.get('end') || undefined;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const tasks = await listWorkTasks(tx, tenantId, { ticketId, visitId, technicianId, startIso, endIso });
      return NextResponse.json({ ok: true, tasks });
    } catch (err) {
      if (err instanceof WorkforceError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      }
      captureException(err, { context: 'fsm.tasks.list', tags: { tenantId } });
      return NextResponse.json({ ok: false, error: 'Failed to load tasks.' }, { status: 500 });
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
      const task = await createWorkTask(tx, tenantId, body);
      void logAudit({
        tenantId,
        userId: userId ?? undefined,
        userRole: platformRole || undefined,
        entityType: 'FsmWorkTask',
        entityId: task.id,
        entityName: task.title,
        action: 'CREATE',
        details: `Created ${task.taskCategory} task "${task.title}"`,
      });
      return NextResponse.json({ ok: true, task }, { status: 201 });
    } catch (err) {
      if (err instanceof WorkforceError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      }
      captureException(err, { context: 'fsm.tasks.create', tags: { tenantId } });
      return NextResponse.json({ ok: false, error: 'Failed to create task.' }, { status: 500 });
    }
  });
}

async function handlePATCH(req: NextRequest) {
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
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) return NextResponse.json({ ok: false, error: 'Task id is required.' }, { status: 400 });

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      const task = await updateWorkTask(tx, tenantId, id, body);
      void logAudit({
        tenantId,
        userId: userId ?? undefined,
        userRole: platformRole || undefined,
        entityType: 'FsmWorkTask',
        entityId: task.id,
        entityName: task.title,
        action: 'UPDATE',
        details: `Updated task "${task.title}" (${task.status})`,
      });
      return NextResponse.json({ ok: true, task });
    } catch (err) {
      if (err instanceof WorkforceError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      }
      captureException(err, { context: 'fsm.tasks.update', tags: { tenantId, id } });
      return NextResponse.json({ ok: false, error: 'Failed to update task.' }, { status: 500 });
    }
  });
}

async function handleDELETE(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId, userId } = authz;
  const platformRole = req.headers.get('x-user-role') || '';
  const id = req.nextUrl.searchParams.get('id') || '';
  if (!id) return NextResponse.json({ ok: false, error: 'id query parameter is required.' }, { status: 400 });

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
      await deleteWorkTask(tx, tenantId, id);
      void logAudit({
        tenantId,
        userId: userId ?? undefined,
        userRole: platformRole || undefined,
        entityType: 'FsmWorkTask',
        entityId: id,
        action: 'DELETE',
        details: `Deleted task ${id}`,
      });
      return NextResponse.json({ ok: true });
    } catch (err) {
      if (err instanceof WorkforceError) {
        return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
      }
      captureException(err, { context: 'fsm.tasks.delete', tags: { tenantId, id } });
      return NextResponse.json({ ok: false, error: 'Failed to delete task.' }, { status: 500 });
    }
  });
}

export const POST = withAuditedAction(handlePOST);
export const PATCH = withAuditedAction(handlePATCH);
export const DELETE = withAuditedAction(handleDELETE);
