export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { duplicateWorkflow } from '@/lib/workflow-db';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { checkWorkflowAccess, workflowRoute } from '@/lib/admin-scope';
import { isSuperAdmin } from '@/lib/admin-access';
import { withAuditedAction } from '@/lib/audited-action';
async function handlePOST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const authz = requireAuthorizedTenant({ headers: _req.headers, nextUrl: _req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  // Tenant admins may copy their own workflows or a platform template; the
  // copy always belongs to their tenant.
  const denied = await checkWorkflowAccess(_req.headers, tenantId, params.id, 'read');
  if (denied) return denied;

  try {
    const newId = await duplicateWorkflow(params.id, isSuperAdmin(_req.headers) ? null : tenantId);
    return NextResponse.json({ id: newId });
    } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const POST = withAuditedAction(workflowRoute(handlePOST));
