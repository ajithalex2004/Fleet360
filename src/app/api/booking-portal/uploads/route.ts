export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/booking-portal/uploads
 * DELETE /api/booking-portal/uploads?key=...
 *
 * Cloud-storage multipart upload route for Booking Portal intake attachments:
 *   - Logistics (`domain=logistics`):
 *       commercial-invoice | packing-list | msds | customs-permit
 *       (PDF, PNG, JPEG, WebP, DOCX, XLSX, DOC, XLS, CSV, TXT — up to 15 MB)
 *   - School Bus (`domain=school-bus`):
 *       student-photo        (PNG, JPEG, WebP, GIF — up to 5 MB)
 *       parent-emirates-id   (PDF, PNG, JPEG, WebP — up to 10 MB)
 *       medical-certificate  (PDF, PNG, JPEG, WebP — up to 10 MB)
 *
 * Files are persisted through Fleet360's configured object storage adapter
 * (`getStorage()` — AWS S3 / Cloudflare R2 / MinIO when `STORAGE_BACKEND=s3`,
 * or local volume fallback) under:
 *   `booking-portal/{tenantId}/{domain}/{docType}/{uuid}-{safeName}`
 *
 * Reads are authorized exclusively through `/api/files/{key}` and
 * `authorizeFileAccess` (`src/lib/storage/file-access.ts`), strictly enforcing
 * tenant ownership and `imageOnly` for `student-photo`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
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
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ ok: false, error: authz.error }, { status: authz.status });
  }
  const { tenantId, userId } = authz;

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

  const domainRules = DOC_RULES[rawDomain];
  const rule = domainRules[rawDocType];
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
    const prefix = `booking-portal/${tenantId}/${rawDomain}/${rawDocType}`;
    const stored = await storage.upload({
      buffer,
      originalName: file.name,
      mimeType: file.type || 'application/octet-stream',
      prefix,
    });

    void logAudit({
      tenantId,
      userId: userId ?? undefined,
      entityType: 'BookingAttachment',
      entityName: stored.key,
      action: 'CREATE',
      details: `Uploaded ${rule.label} (${file.name}, ${stored.size} bytes) to ${storage.backend} storage`,
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
    captureException(err, { context: 'booking-portal.uploads.post', extra: { tenantId, rawDomain, rawDocType } });
    return NextResponse.json({ ok: false, error: 'Failed to upload document to storage' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ ok: false, error: authz.error }, { status: authz.status });
  }
  const { tenantId, userId } = authz;

  const rawKey = req.nextUrl.searchParams.get('key') ?? '';
  const safeKey = normalizeStorageKey(rawKey);
  const requiredPrefix = `booking-portal/${tenantId}/`;

  if (!safeKey || !safeKey.startsWith(requiredPrefix)) {
    return NextResponse.json({ ok: false, error: 'Attachment not found' }, { status: 404 });
  }

  try {
    const storage = getStorage();
    await storage.delete(safeKey);

    void logAudit({
      tenantId,
      userId: userId ?? undefined,
      entityType: 'BookingAttachment',
      entityName: safeKey,
      action: 'DELETE',
      details: `Removed booking intake attachment ${safeKey}`,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    captureException(err, { context: 'booking-portal.uploads.delete', extra: { tenantId, safeKey } });
    return NextResponse.json({ ok: false, error: 'Failed to remove attachment' }, { status: 500 });
  }
}
