export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/customer-portal/transport/uploads
 * DELETE /api/customer-portal/transport/uploads?key=...
 *
 * Customer-portal-authenticated cloud-storage upload route for Transport
 * request attachments:
 *   - Logistics (`domain=logistics`):
 *       commercial-invoice | packing-list | msds | customs-permit
 *       (PDF, PNG, JPEG, WebP, DOCX, XLSX, DOC, XLS, CSV, TXT — up to 15 MB)
 *   - School Bus (`domain=school-bus`):
 *       student-photo        (PNG, JPEG, WebP, GIF — up to 5 MB)
 *       parent-emirates-id   (PDF, PNG, JPEG, WebP — up to 10 MB)
 *       medical-certificate  (PDF, PNG, JPEG, WebP — up to 10 MB)
 *
 * Persists via Fleet360's storage adapter (`getStorage()` — S3/R2/MinIO when
 * `STORAGE_BACKEND=s3`, or local fallback) under:
 *   `customer-portal/{tenantId}/{customerId}/{domain}/{docType}/{uuid}-{safeName}`
 *
 * Reads are authorized exclusively via `/api/files/{key}` +
 * `authorizeFileAccess` for that customer's portal users and owning tenant staff.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireCustomerPortal } from '@/lib/customer-portal/session';
import { getStorage, normalizeStorageKey } from '@/lib/storage';
import { fileContentProblem, IMAGE_KINDS, type FileKind } from '@/lib/storage/file-type';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

const DOC_RULES: Record<
  'logistics' | 'school-bus',
  Record<string, { maxBytes: number; allowedKinds: readonly FileKind[]; label: string }>
> = {
  logistics: {
    'commercial-invoice': {
      maxBytes: 15 * 1024 * 1024,
      allowedKinds: ['pdf', 'png', 'jpeg', 'webp', 'ooxml', 'ole', 'text'],
      label: 'Commercial Invoice',
    },
    'packing-list': {
      maxBytes: 15 * 1024 * 1024,
      allowedKinds: ['pdf', 'png', 'jpeg', 'webp', 'ooxml', 'ole', 'text'],
      label: 'Packing List / Manifest',
    },
    msds: {
      maxBytes: 15 * 1024 * 1024,
      allowedKinds: ['pdf', 'png', 'jpeg', 'webp', 'ooxml', 'ole', 'text'],
      label: 'MSDS / Dangerous Goods Declaration',
    },
    'customs-permit': {
      maxBytes: 15 * 1024 * 1024,
      allowedKinds: ['pdf', 'png', 'jpeg', 'webp', 'ooxml', 'ole', 'text'],
      label: 'BOL Instructions / Customs Permit',
    },
  },
  'school-bus': {
    'student-photo': {
      maxBytes: 5 * 1024 * 1024,
      allowedKinds: IMAGE_KINDS,
      label: 'Student Passport Photo',
    },
    'parent-emirates-id': {
      maxBytes: 10 * 1024 * 1024,
      allowedKinds: ['pdf', 'png', 'jpeg', 'webp'],
      label: 'Parent Emirates ID Copy',
    },
    'medical-certificate': {
      maxBytes: 10 * 1024 * 1024,
      allowedKinds: ['pdf', 'png', 'jpeg', 'webp'],
      label: 'Medical / Allergy Action Plan',
    },
  },
};

export async function POST(req: NextRequest) {
  const ctx = await requireCustomerPortal(req, { portal: 'TRANSPORT', roles: ['ADMIN', 'REQUESTER'] });
  if (ctx instanceof NextResponse) return ctx;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'Expected multipart/form-data payload' }, { status: 400 });
  }

  const rawDomain = String(formData.get('domain') ?? '').trim().toLowerCase();
  const rawDocType = String(formData.get('docType') ?? '').trim().toLowerCase();
  const fileEntry = formData.get('file');

  if (rawDomain !== 'logistics' && rawDomain !== 'school-bus') {
    return NextResponse.json({ ok: false, error: 'Invalid upload domain' }, { status: 400 });
  }

  const rule = DOC_RULES[rawDomain][rawDocType];
  if (!rule) {
    return NextResponse.json({ ok: false, error: `Unsupported document type "${rawDocType}" for ${rawDomain}` }, { status: 400 });
  }

  if (!fileEntry || typeof fileEntry === 'string' || typeof fileEntry.arrayBuffer !== 'function') {
    return NextResponse.json({ ok: false, error: 'A file upload is required' }, { status: 400 });
  }

  const file = fileEntry;
  if (file.size === 0) {
    return NextResponse.json({ ok: false, error: 'Uploaded file is empty' }, { status: 400 });
  }
  if (file.size > rule.maxBytes) {
    const maxMb = Math.round(rule.maxBytes / (1024 * 1024));
    return NextResponse.json({ ok: false, error: `${rule.label} exceeds the ${maxMb} MB limit` }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const contentProblem = fileContentProblem(file.name, buffer, rule.allowedKinds);
  if (contentProblem) {
    return NextResponse.json({ ok: false, error: contentProblem }, { status: 400 });
  }

  try {
    const storage = getStorage();
    const prefix = `customer-portal/${ctx.tenantId}/${ctx.customerId}/${rawDomain}/${rawDocType}`;
    const stored = await storage.upload({
      buffer,
      originalName: file.name,
      mimeType: file.type || 'application/octet-stream',
      prefix,
    });

    void logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.user.id,
      entityType: 'CustomerTransportAttachment',
      entityName: stored.key,
      action: 'CREATE',
      details: `Customer ${ctx.customerId} uploaded ${rule.label} (${file.name}, ${stored.size} bytes) to ${storage.backend} storage`,
    });

    return NextResponse.json(
      {
        ok: true,
        file: {
          url: stored.url,
          key: stored.key,
          originalName: stored.originalName,
          mimeType: stored.mimeType,
          size: stored.size,
          domain: rawDomain,
          docType: rawDocType,
          label: rule.label,
          backend: storage.backend,
          uploadedAt: new Date().toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (err) {
    captureException(err, {
      context: 'customer-portal.transport.uploads.post',
      extra: { tenantId: ctx.tenantId, customerId: ctx.customerId, rawDomain, rawDocType },
    });
    return NextResponse.json({ ok: false, error: 'Failed to upload document to storage' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const ctx = await requireCustomerPortal(req, { portal: 'TRANSPORT', roles: ['ADMIN', 'REQUESTER'] });
  if (ctx instanceof NextResponse) return ctx;

  const rawKey = req.nextUrl.searchParams.get('key') ?? '';
  const safeKey = normalizeStorageKey(rawKey);
  const requiredPrefix = `customer-portal/${ctx.tenantId}/${ctx.customerId}/`;

  if (!safeKey || !safeKey.startsWith(requiredPrefix)) {
    return NextResponse.json({ ok: false, error: 'Attachment not found' }, { status: 404 });
  }

  try {
    const storage = getStorage();
    await storage.delete(safeKey);

    void logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.user.id,
      entityType: 'CustomerTransportAttachment',
      entityName: safeKey,
      action: 'DELETE',
      details: `Customer ${ctx.customerId} removed transport attachment ${safeKey}`,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    captureException(err, {
      context: 'customer-portal.transport.uploads.delete',
      extra: { tenantId: ctx.tenantId, customerId: ctx.customerId, safeKey },
    });
    return NextResponse.json({ ok: false, error: 'Failed to remove attachment' }, { status: 500 });
  }
}
