import { NextRequest, NextResponse } from 'next/server';
import { getStorage } from '@/lib/storage';
import { listCarrierDocuments, upsertCarrierDocument } from '@/lib/logistics/domain';
import { logisticsErrorResponse } from '@/lib/logistics/api-context';

function requestContext(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id') ?? req.nextUrl.searchParams.get('tenantId') ?? '';
  const userId = req.headers.get('x-user-id') ?? '';
  const role = req.headers.get('x-user-role') ?? '';
  const isSuperAdmin = role === 'SUPER_ADMIN';
  if (!tenantId) return null;
  return { tenantId, userId, role, isSuperAdmin };
}

function resolveTenant(req: NextRequest, ctx: NonNullable<ReturnType<typeof requestContext>>, bodyTenantId?: string | null) {
  const requestedTenantId = bodyTenantId ?? req.nextUrl.searchParams.get('tenantId');
  if (requestedTenantId && requestedTenantId !== ctx.tenantId && !ctx.isSuperAdmin) return null;
  return requestedTenantId && ctx.isSuperAdmin ? requestedTenantId : ctx.tenantId;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Tenant context is required' }, { status: 401 });
    const tenantId = resolveTenant(req, ctx);
    if (!tenantId) return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });

    const documents = await listCarrierDocuments({
      tenantId,
      carrierId: id,
      status: req.nextUrl.searchParams.get('status'),
    });
    return NextResponse.json({ documents });
  } catch (error) {
    console.error('[logistics/carriers/[id]/documents GET]', error);
    return logisticsErrorResponse(error, 'Failed to fetch carrier documents');
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Tenant context is required' }, { status: 401 });

    const contentType = req.headers.get('content-type') ?? '';
    let tenantId: string | null = null;
    let documentType = '';
    let documentName = '';
    let documentUrl = '';
    let storageKey: string | null = null;
    let fileName: string | null = null;
    let mimeType: string | null = null;
    let fileSize: number | null = null;
    let issueDate: string | null = null;
    let expiryDate: string | null = null;
    let status: string | null = null;
    let metadata: Record<string, unknown> = {};

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      tenantId = resolveTenant(req, ctx, String(form.get('tenantId') ?? '') || null);
      documentType = String(form.get('documentType') ?? '').trim();
      documentName = String(form.get('documentName') ?? '').trim();
      issueDate = String(form.get('issueDate') ?? '').trim() || null;
      expiryDate = String(form.get('expiryDate') ?? '').trim() || null;
      status = String(form.get('status') ?? '').trim() || null;
      const file = form.get('file');
      if (file instanceof File && file.size > 0) {
        const stored = await getStorage().upload({
          buffer: Buffer.from(await file.arrayBuffer()),
          originalName: file.name,
          mimeType: file.type || 'application/octet-stream',
          prefix: `logistics/carriers/${id}`,
        });
        documentUrl = stored.url;
        storageKey = stored.key;
        fileName = stored.originalName;
        mimeType = stored.mimeType;
        fileSize = stored.size;
        documentName = documentName || stored.originalName;
      } else {
        documentUrl = String(form.get('documentUrl') ?? '').trim();
      }
    } else {
      const body = await req.json().catch(() => ({})) as {
        tenantId?: string;
        documentType?: string;
        documentName?: string;
        documentUrl?: string;
        issueDate?: string;
        expiryDate?: string;
        status?: string;
        metadata?: Record<string, unknown>;
      };
      tenantId = resolveTenant(req, ctx, body.tenantId ?? null);
      documentType = String(body.documentType ?? '').trim();
      documentName = String(body.documentName ?? '').trim();
      documentUrl = String(body.documentUrl ?? '').trim();
      issueDate = body.issueDate ?? null;
      expiryDate = body.expiryDate ?? null;
      status = body.status ?? null;
      metadata = body.metadata ?? {};
    }

    if (!tenantId) return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });
    if (!documentType) return NextResponse.json({ error: 'documentType is required' }, { status: 400 });
    if (!documentName) return NextResponse.json({ error: 'documentName is required' }, { status: 400 });
    if (!documentUrl) return NextResponse.json({ error: 'Upload a file or provide documentUrl' }, { status: 400 });

    const document = await upsertCarrierDocument({
      tenantId,
      carrierId: id,
      documentType,
      documentName,
      documentUrl,
      storageKey,
      fileName,
      mimeType,
      fileSize,
      issueDate,
      expiryDate,
      status,
      metadata,
      actorUserId: ctx.userId || 'carrier-document-api',
    });

    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    console.error('[logistics/carriers/[id]/documents POST]', error);
    return logisticsErrorResponse(error, 'Failed to upload carrier document');
  }
}
