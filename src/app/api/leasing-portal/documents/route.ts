/**
 * GET  /api/leasing-portal/documents — list documents visible to the
 *      lessee: their own LESSEE-entity documents plus documents on any
 *      of their own contracts.
 * POST /api/leasing-portal/documents — lessee uploads a document against
 *      their own lessee record or one of their own contracts. Reuses the
 *      same storage abstraction (getStorage()) as the staff upload route.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireLeasingPortal } from '@/lib/leasing-portal/auth';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { getStorage } from '@/lib/storage';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const ALLOWED_MIME_PREFIXES = ['image/', 'application/pdf', 'text/plain'];

export async function GET(req: NextRequest) {
  const ctx = await requireLeasingPortal(req);
  if (ctx instanceof NextResponse) return ctx;

  const contracts = await prisma.leaseContract2.findMany({
    where: { tenantId: ctx.tenantId, lesseeId: ctx.lesseeId },
    select: { id: true },
  });
  const contractIds = contracts.map(c => c.id);

  const documents = await prisma.leaseDocument.findMany({
    where: {
      tenantId: ctx.tenantId,
      OR: [
        { entityType: 'LESSEE', entityId: ctx.lesseeId },
        ...(contractIds.length > 0 ? [{ entityType: 'CONTRACT', entityId: { in: contractIds } }] : []),
      ],
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(documents);
}

const metadataSchema = z.object({
  entityType: z.enum(['LESSEE', 'CONTRACT']),
  entityId: z.string().uuid('entityId must be a UUID'),
  docType: z.enum(['TRADE_LICENSE', 'EMIRATES_ID', 'PASSPORT', 'OTHER']),
  docName: z.string().min(1, 'docName is required'),
  notes: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const ctx = await requireLeasingPortal(req);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'No file uploaded. Send multipart form-data with a "file" field.' },
        { status: 400 },
      );
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: `File too large. Max ${MAX_FILE_BYTES} bytes.` }, { status: 413 });
    }
    const mimeType = file.type || 'application/octet-stream';
    if (!ALLOWED_MIME_PREFIXES.some(p => mimeType.startsWith(p))) {
      return NextResponse.json({ error: `Unsupported file type: ${mimeType}.` }, { status: 415 });
    }

    const meta = {
      entityType: String(form.get('entityType') ?? ''),
      entityId: String(form.get('entityId') ?? ''),
      docType: String(form.get('docType') ?? 'OTHER'),
      docName: String(form.get('docName') ?? file.name),
      notes: form.get('notes') ? String(form.get('notes')) : undefined,
    };
    const parsed = metadataSchema.safeParse(meta);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.issues.map(i => i.message) },
        { status: 400 },
      );
    }

    // Ownership check — a lessee may only upload against their own lessee
    // record or one of their own contracts. This is the boundary that
    // matters: nothing above scopes entityId by itself.
    if (parsed.data.entityType === 'LESSEE') {
      if (parsed.data.entityId !== ctx.lesseeId) {
        return NextResponse.json({ error: 'Not your lessee record' }, { status: 403 });
      }
    } else {
      const owned = await prisma.leaseContract2.findFirst({
        where: { id: parsed.data.entityId, tenantId: ctx.tenantId, lesseeId: ctx.lesseeId },
        select: { id: true },
      });
      if (!owned) {
        return NextResponse.json({ error: 'Not your contract' }, { status: 403 });
      }
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const storage = getStorage();
    const stored = await storage.upload({
      buffer,
      originalName: file.name,
      mimeType,
      prefix: `leasing-portal/${parsed.data.entityType.toLowerCase()}/${parsed.data.entityId}`,
    });

    const doc = await withTenantRls(prisma, ctx.tenantId, async (tx) =>
      tx.leaseDocument.create({
        data: {
          entityType: parsed.data.entityType,
          entityId: parsed.data.entityId,
          docType: parsed.data.docType,
          docName: parsed.data.docName,
          fileName: stored.originalName,
          fileUrl: stored.url,
          fileSize: stored.size,
          mimeType: stored.mimeType,
          status: 'ACTIVE',
          uploadedBy: `lessee-portal:${ctx.userId}`,
          notes: parsed.data.notes ?? null,
          tenantId: ctx.tenantId,
        },
      }),
    );

    return NextResponse.json({ document: doc }, { status: 201 });
  } catch (e) {
    console.error('[leasing-portal/documents]', e);
    return NextResponse.json({ error: 'Failed to upload document' }, { status: 500 });
  }
}
