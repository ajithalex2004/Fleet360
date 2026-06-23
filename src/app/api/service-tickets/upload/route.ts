/**
 * POST /api/service-tickets/upload
 *
 * Multipart form-data:
 *   file:      the file to upload
 *   typeCode:  attachment type code from the Attachment Master
 *              (e.g. 'INVOICE', 'IMAGE', 'WORK_ORDER')
 *
 * Validates the upload against the matching attachment_types row in the
 * Attachment Master:
 *   • allowed_mime_types — MIME whitelist (entries can be wildcards like
 *     'image/*')
 *   • max_file_size_mb   — hard size cap
 *
 * On success returns { url, fileName, type, size, mimeType } that the
 * client appends to its in-form attachment list. The actual ticket POST
 * carries the {type, fileName, url} array; nothing is persisted to a
 * ticket here — this route is just blob storage + validation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getStorage } from '@/lib/storage';
import { listAttachmentTypes } from '@/lib/data-masters/attachment-types';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

// 25 MB ceiling — same as the leasing uploader. Per-type caps from the
// Attachment Master can be lower; this is the absolute outer bound.
const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Match a MIME like 'image/png' against a whitelist entry, supporting
 *  wildcards ('image/*') and the empty whitelist ('any allowed'). */
function mimeAllowed(mime: string, whitelist: string[]): boolean {
  if (whitelist.length === 0) return true;
  return whitelist.some(w => {
    if (w === '*' || w === '*/*') return true;
    if (w.endsWith('/*')) return mime.startsWith(w.slice(0, -1));
    return mime.toLowerCase() === w.toLowerCase();
  });
}

export async function POST(req: NextRequest) {
  try {
    const tenantId = req.headers.get('x-tenant-id');
    const userId = req.headers.get('x-user-id');
    if (!tenantId || !userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }
    const typeCode = String(form.get('typeCode') ?? '').trim().toUpperCase();
    if (!typeCode) {
      return NextResponse.json({ error: 'typeCode is required' }, { status: 400 });
    }

    // Resolve the attachment-type config. Active rows only — admins can
    // disable a code without losing historical references.
    const types = await listAttachmentTypes(tenantId, { activeOnly: true });
    const cfg = types.find(t => t.code === typeCode);
    if (!cfg) {
      return NextResponse.json(
        { error: `Unknown or inactive attachment type "${typeCode}".` },
        { status: 400 },
      );
    }

    // Per-type size cap — falls back to the absolute ceiling.
    const cap = cfg.maxFileSizeMb != null
      ? Math.min(cfg.maxFileSizeMb * 1024 * 1024, MAX_FILE_BYTES)
      : MAX_FILE_BYTES;
    if (file.size > cap) {
      const mb = (cap / (1024 * 1024)).toFixed(1);
      return NextResponse.json(
        { error: `File exceeds the ${mb} MB cap for ${cfg.name}.` },
        { status: 400 },
      );
    }

    // MIME whitelist.
    const mime = file.type || 'application/octet-stream';
    if (!mimeAllowed(mime, cfg.allowedMimeTypes)) {
      return NextResponse.json(
        { error: `${cfg.name} doesn't accept ${mime}. Allowed: ${cfg.allowedMimeTypes.join(', ')}` },
        { status: 400 },
      );
    }

    // Persist via the storage abstraction (local fs in dev; S3 in prod
    // via STORAGE_BACKEND env var).
    const buffer = Buffer.from(await file.arrayBuffer());
    const storage = getStorage();
    const stored = await storage.upload({
      buffer,
      originalName: file.name,
      mimeType: mime,
      prefix: `service-tickets/${tenantId}`,
    });

    return NextResponse.json({
      url:      stored.url,
      fileName: stored.originalName,
      type:     typeCode,
      size:     stored.size,
      mimeType: stored.mimeType,
    });
  } catch (err) {
    console.error('[service-tickets/upload] error:', err);
    captureException(err, { context: 'service-tickets.upload' });
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
