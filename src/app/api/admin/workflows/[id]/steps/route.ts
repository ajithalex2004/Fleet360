export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { listSteps, createStep } from '@/lib/workflow-db';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { checkWorkflowAccess } from '@/lib/admin-scope';
import { withAuditedAction } from '@/lib/audited-action';
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: _req.headers, nextUrl: _req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await checkWorkflowAccess(_req.headers, tenantId, params.id, 'read');
  if (denied) return denied;

  try {
    const steps = await listSteps(params.id);
    return NextResponse.json(steps);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

async function handlePOST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const denied = await checkWorkflowAccess(req.headers, tenantId, params.id, 'write');
  if (denied) return denied;

  try {
    const body = await req.json();
    const id = await createStep(params.id, body);
    return NextResponse.json({ id }, { status: 201 });
    } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const POST = withAuditedAction(handlePOST);
