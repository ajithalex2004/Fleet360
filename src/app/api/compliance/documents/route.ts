export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const documents = await tx.complianceDocument.findMany({
          where: { tenantId },
          orderBy: { createdAt: 'desc' },
        });
        return NextResponse.json({ documents, count: documents.length });
      } catch (e) {
        console.error('Error fetching documents:', e);
        return NextResponse.json({ error: 'Failed to fetch documents', documents: [] }, { status: 500 });
      }
  });
}


export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        const document = await tx.complianceDocument.create({ data: body });
        return NextResponse.json(document, { status: 201 });
        } catch (e) {
        console.error('Error creating document:', e);
        return NextResponse.json({ error: 'Failed to create document' }, { status: 500 });
      }
  });
}

