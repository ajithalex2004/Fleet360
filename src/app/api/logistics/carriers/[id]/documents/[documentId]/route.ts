import { NextRequest, NextResponse } from 'next/server';
import { archiveCarrierDocument, updateCarrierDocumentStatus } from '@/lib/logistics/domain';
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> },
) {
  try {
    const { id, documentId } = await params;
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Tenant context is required' }, { status: 401 });
    const body = await req.json().catch(() => ({})) as {
      tenantId?: string;
      status?: string;
      documentName?: string;
      documentType?: string;
      issueDate?: string;
      expiryDate?: string;
      metadata?: Record<string, unknown>;
    };
    const tenantId = resolveTenant(req, ctx, body.tenantId ?? null);
    if (!tenantId) return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });

    const document = await updateCarrierDocumentStatus({
      tenantId,
      carrierId: id,
      documentId,
      status: body.status ?? null,
      documentName: body.documentName ?? null,
      documentType: body.documentType ?? null,
      issueDate: body.issueDate ?? null,
      expiryDate: body.expiryDate ?? null,
      metadata: body.metadata ?? {},
      actorUserId: ctx.userId || 'carrier-document-review',
    });

    return NextResponse.json({ document });
  } catch (error) {
    console.error('[logistics/carriers/[id]/documents/[documentId] PATCH]', error);
    return logisticsErrorResponse(error, 'Failed to update carrier document');
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> },
) {
  try {
    const { id, documentId } = await params;
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Tenant context is required' }, { status: 401 });
    const tenantId = resolveTenant(req, ctx);
    if (!tenantId) return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });

    const document = await archiveCarrierDocument({
      tenantId,
      carrierId: id,
      documentId,
      actorUserId: ctx.userId || 'carrier-document-archive',
    });

    return NextResponse.json({ document, archived: true });
  } catch (error) {
    console.error('[logistics/carriers/[id]/documents/[documentId] DELETE]', error);
    return logisticsErrorResponse(error, 'Failed to archive carrier document');
  }
}
