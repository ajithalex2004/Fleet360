export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: _req.headers, nextUrl: _req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const docs = await tx.$queryRawUnsafe(
          `SELECT * FROM customer_documents WHERE customer_id = '${params.id}' ORDER BY created_at DESC`
        );
        return NextResponse.json(docs);
      } catch (e) {
        return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 });
      }
  });
}


export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);
        if (!body.docName?.trim()) return NextResponse.json({ error: 'Document name is required' }, { status: 400 });
        const id  = randomUUID();
        const now = new Date().toISOString();
        await tx.$executeRawUnsafe(`
          INSERT INTO customer_documents (id, created_at, customer_id, doc_name, doc_type, file_name, file_url, uploaded_by, notes)
          VALUES (
            '${id}', '${now}', '${params.id}',
            '${body.docName.replace(/'/g,"''")}',
            ${body.docType    ? `'${body.docType}'`                          : 'NULL'},
            ${body.fileName   ? `'${body.fileName.replace(/'/g,"''")}'`     : 'NULL'},
            ${body.fileUrl    ? `'${body.fileUrl.replace(/'/g,"''")}'`      : 'NULL'},
            ${body.uploadedBy ? `'${body.uploadedBy.replace(/'/g,"''")}'`   : 'NULL'},
            ${body.notes      ? `'${body.notes.replace(/'/g,"''")}'`        : 'NULL'}
          )
        `);
        const rows = await tx.$queryRawUnsafe(`SELECT * FROM customer_documents WHERE id = '${id}'`);
        return NextResponse.json((rows as any[])[0], { status: 201 });
        } catch (e) {
        return NextResponse.json({ error: e?.message ?? 'Failed to add document' }, { status: 500 });
      }
  });
}


export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const { searchParams } = new URL(req.url);
        const docId = searchParams.get('docId');
        if (!docId) return NextResponse.json({ error: 'docId required' }, { status: 400 });
        await tx.$executeRawUnsafe(`DELETE FROM customer_documents WHERE id = '${docId}' AND customer_id = '${params.id}'`);
        return NextResponse.json({ success: true });
        } catch (e) {
        return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 });
      }
  });
}

