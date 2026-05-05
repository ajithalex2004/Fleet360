import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const docs = await prisma.$queryRawUnsafe(
      `SELECT * FROM customer_documents WHERE customer_id = '${params.id}' ORDER BY created_at DESC`
    );
    return NextResponse.json(docs);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    if (!body.docName?.trim()) return NextResponse.json({ error: 'Document name is required' }, { status: 400 });
    const id  = randomUUID();
    const now = new Date().toISOString();
    await prisma.$executeRawUnsafe(`
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
    const rows = await prisma.$queryRawUnsafe(`SELECT * FROM customer_documents WHERE id = '${id}'`);
    return NextResponse.json((rows as any[])[0], { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed to add document' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { searchParams } = new URL(req.url);
    const docId = searchParams.get('docId');
    if (!docId) return NextResponse.json({ error: 'docId required' }, { status: 400 });
    await prisma.$executeRawUnsafe(`DELETE FROM customer_documents WHERE id = '${docId}' AND customer_id = '${params.id}'`);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Failed' }, { status: 500 });
  }
}
