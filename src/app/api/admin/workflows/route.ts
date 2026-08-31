export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { listWorkflows, createWorkflow } from '@/lib/workflow-db';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
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
      tenantId:      searchParams.get('tenantId')      ?? undefined,
    });
    return NextResponse.json(workflows);
  } catch (e) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const body = await req.json();
    const { name, module, procedure, description, serviceTypeId, tenantId, scopeId } = body;
    if (!name || !module || !procedure) {
      return NextResponse.json({ error: 'name, module and procedure are required' }, { status: 400 });
    }
    const id = await createWorkflow({
      name, module, procedure, description,
      serviceTypeId: serviceTypeId ?? null,
      tenantId:      tenantId ?? null,
      scopeId:       scopeId ?? null,
    });
    return NextResponse.json({ id }, { status: 201 });
    } catch (e) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
