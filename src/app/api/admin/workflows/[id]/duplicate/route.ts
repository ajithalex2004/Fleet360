import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { duplicateWorkflow } from '@/lib/workflow-db';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant({ headers: _req.headers, nextUrl: _req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const newId = await duplicateWorkflow(params.id);
    return NextResponse.json({ id: newId });
    } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
