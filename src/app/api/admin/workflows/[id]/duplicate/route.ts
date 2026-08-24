import { NextResponse } from 'next/server';
import { duplicateWorkflow } from '@/lib/workflow-db';

import { requireAuthorizedTenant } from '@/lib/tenant-context';
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
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
