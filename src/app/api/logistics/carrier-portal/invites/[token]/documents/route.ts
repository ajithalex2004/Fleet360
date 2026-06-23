import { NextRequest, NextResponse } from 'next/server';
import { getStorage } from '@/lib/storage';
import { resolveCarrierPortalInvite, upsertCarrierDocument } from '@/lib/logistics/domain';
import { logisticsErrorResponse } from '@/lib/logistics/api-context';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const resolved = await resolveCarrierPortalInvite(token);
    if (!resolved || !resolved.rfq) {
      return NextResponse.json({ error: 'Invite is invalid, expired, or no longer visible' }, { status: 404 });
    }

    const contentType = req.headers.get('content-type') ?? '';
    let documentType = '';
    let documentName = '';
    let documentUrl = '';
    let storageKey: string | null = null;
    let fileName: string | null = null;
    let mimeType: string | null = null;
    let fileSize: number | null = null;
    let issueDate: string | null = null;
    let expiryDate: string | null = null;
    let metadata: Record<string, unknown> = {};

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      documentType = String(form.get('documentType') ?? '').trim();
      documentName = String(form.get('documentName') ?? '').trim();
      issueDate = String(form.get('issueDate') ?? '').trim() || null;
      expiryDate = String(form.get('expiryDate') ?? '').trim() || null;
      metadata = {
        rfqId: resolved.invite.rfqId,
        inviteId: resolved.invite.id,
        portalUpload: true,
      };

      const file = form.get('file');
      if (file instanceof File && file.size > 0) {
        const stored = await getStorage().upload({
          buffer: Buffer.from(await file.arrayBuffer()),
          originalName: file.name,
          mimeType: file.type || 'application/octet-stream',
          prefix: `logistics/carrier-portal/${resolved.invite.carrierId}`,
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
        documentType?: string;
        documentName?: string;
        documentUrl?: string;
        issueDate?: string | null;
        expiryDate?: string | null;
        metadata?: Record<string, unknown>;
      };
      documentType = String(body.documentType ?? '').trim();
      documentName = String(body.documentName ?? '').trim();
      documentUrl = String(body.documentUrl ?? '').trim();
      issueDate = body.issueDate ?? null;
      expiryDate = body.expiryDate ?? null;
      metadata = {
        ...(body.metadata ?? {}),
        rfqId: resolved.invite.rfqId,
        inviteId: resolved.invite.id,
        portalUpload: true,
      };
    }

    if (!documentType) return NextResponse.json({ error: 'documentType is required' }, { status: 400 });
    if (!documentName) return NextResponse.json({ error: 'documentName is required' }, { status: 400 });
    if (!documentUrl) return NextResponse.json({ error: 'Upload a file or provide documentUrl' }, { status: 400 });

    const document = await upsertCarrierDocument({
      tenantId: resolved.invite.tenantId,
      carrierId: resolved.invite.carrierId,
      documentType,
      documentName,
      documentUrl,
      storageKey,
      fileName,
      mimeType,
      fileSize,
      issueDate,
      expiryDate,
      status: 'PENDING_REVIEW',
      metadata,
      actorUserId: `carrier-portal:${resolved.invite.carrierId}`,
    });

    const refreshed = await resolveCarrierPortalInvite(token);
    return NextResponse.json({ document, ...refreshed }, { status: 201 });
  } catch (error) {
    console.error('[logistics/carrier-portal/invites/[token]/documents POST]', error);
    return logisticsErrorResponse(error, 'Failed to upload carrier document');
  }
}
