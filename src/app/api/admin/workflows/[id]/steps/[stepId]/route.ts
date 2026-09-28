export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { updateStep, deleteStep } from '@/lib/workflow-db';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { checkWorkflowStepAccess } from '@/lib/admin-scope';
import { withAuditedAction } from '@/lib/audited-action';
async function handlePUT(req: NextRequest, props: { params: Promise<{ stepId: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await checkWorkflowStepAccess(req.headers, tenantId, params.stepId);
  if (denied) return denied;

  try {
    const body = await req.json();
    await updateStep(params.stepId, body);
    return NextResponse.json({ success: true });
    } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

async function handleDELETE(_req: NextRequest, props: { params: Promise<{ stepId: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: _req.headers, nextUrl: _req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await checkWorkflowStepAccess(_req.headers, tenantId, params.stepId);
  if (denied) return denied;

  try {
    await deleteStep(params.stepId);
    return NextResponse.json({ success: true });
    } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const PUT = withAuditedAction(handlePUT);
export const DELETE = withAuditedAction(handleDELETE);
