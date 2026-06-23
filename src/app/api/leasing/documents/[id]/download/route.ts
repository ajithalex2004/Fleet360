import path from 'node:path';
import { promises as fs } from 'node:fs';
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

const PUBLIC_ROOT = path.join(process.cwd(), 'public');

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const doc = await prisma.leaseDocument.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        docName: true,
        fileName: true,
        fileUrl: true,
        mimeType: true,
      },
    });

    if (!doc?.fileUrl) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    if (!doc.fileUrl.startsWith('/uploads/')) {
      return NextResponse.json({ error: 'Unsupported file location' }, { status: 400 });
    }

    const relativePath = doc.fileUrl.replace(/^\/+/, '');
    const filePath = path.join(PUBLIC_ROOT, relativePath);
    if (!filePath.startsWith(PUBLIC_ROOT)) {
      return NextResponse.json({ error: 'Invalid file path' }, { status: 400 });
    }

    const buffer = await fs.readFile(filePath);
    const filename = doc.fileName || `${doc.docName || 'document'}`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': doc.mimeType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
        'Cache-Control': 'private, max-age=60',
      },
    });
  } catch (error) {
    console.error('GET /api/leasing/documents/[id]/download error:', error);
    return NextResponse.json({ error: 'Failed to download document' }, { status: 500 });
  }
}
