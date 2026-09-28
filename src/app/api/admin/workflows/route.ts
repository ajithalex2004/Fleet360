export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { listWorkflows, createWorkflow } from '@/lib/workflow-db';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { isSuperAdmin } from '@/lib/admin-access';
import { withAuditedAction } from '@/lib/audited-action';

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const { searchParams } = new URL(req.url);
    const workflows = await listWorkflows({
      module:        searchParams.get('module')        ?? undefined,
      // Phase 2 — canonical filters; the Workflow + Approval tabs use
      // serviceTypeId/tenantId so they only see workflows for the picked
      // service. Legacy (NULL serviceTypeId) rows are filtered client-side
      // by the tab via a procedure-key fallback.
      serviceTypeId: searchParams.get('serviceTypeId') ?? undefined,
      // Tenant admins only see their own tenant's workflows.
      tenantId:      isSuperAdmin(req.headers)
        ? searchParams.get('tenantId') ?? undefined
        : tenantId,
    });
    return NextResponse.json(workflows);
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e, 'Internal Error') }, { status: 500 });
  }
}

async function handlePOST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const body = await req.json();
    const { name, module, procedure, description, serviceTypeId, scopeId } = body;
    // A tenant admin's workflow always belongs to their tenant; only a
    // platform admin may choose the tenant or create a platform template.
    const ownerTenantId: string | null = isSuperAdmin(req.headers)
      ? (body.tenantId ?? null)
      : tenantId;
    if (!name || !module || !procedure) {
      return NextResponse.json({ error: 'name, module and procedure are required' }, { status: 400 });
    }
    const id = await createWorkflow({
      name, module, procedure, description,
      serviceTypeId: serviceTypeId ?? null,
      tenantId:      ownerTenantId,
      scopeId:       scopeId ?? null,
    });
    return NextResponse.json({ id }, { status: 201 });
    } catch (e) {
    return NextResponse.json({ error: errorMessage(e, 'Internal Error') }, { status: 500 });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const POST = withAuditedAction(handlePOST);
