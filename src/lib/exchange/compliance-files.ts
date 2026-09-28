/**
 * Files behind transport partners' compliance documents (trade licence, VAT
 * certificate, permits, ...).
 *
 * They are stored under exchange/partner-compliance/{partnerId}/ and never
 * served by /api/files (its file-access rules refuse the prefix). Only two
 * routes stream them, each after its own check: the partner's members
 * (/api/exchange/partner/compliance/:docId/file) and the administrators of
 * the tenant reviewing the partner (/api/admin/exchange/onboarding/:id/
 * documents/:docId/file).
 */
import path from 'node:path';
import { NextResponse } from 'next/server';
import { fileContentProblem } from '@/lib/storage/file-type';
import { logAudit } from '@/lib/audit';
import { getStorage, normalizeStorageKey, readStoredFile, UPLOAD_URL_PREFIX } from '@/lib/storage';

export const MAX_COMPLIANCE_FILE_BYTES = 10 * 1024 * 1024;

/** Accepted by extension; the served Content-Type comes from this map, never from the client. */
const CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export const ACCEPTED_COMPLIANCE_FILES = Object.keys(CONTENT_TYPES).join(',');

export class ComplianceFileRejected extends Error {}

const prefixFor = (partnerId: string) => `exchange/partner-compliance/${partnerId}`;

/** Why `file` can't be accepted, or null. */
export function complianceFileProblem(file: { name: string; size: number }): string | null {
  if (file.size === 0) return 'The file is empty.';
  if (file.size > MAX_COMPLIANCE_FILE_BYTES) return 'The file is larger than 10 MB.';
  if (!CONTENT_TYPES[path.extname(file.name).toLowerCase()]) return 'Upload a PDF or an image (PNG, JPG, WEBP).';
  return null;
}

/**
 * Stores the file and returns the URL to record on the document, or throws
 * ComplianceFileRejected when its contents aren't a PDF or image matching
 * its extension.
 */
export async function storeComplianceFile(partnerId: string, file: File): Promise<string> {
  const ext = path.extname(file.name).toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());
  const problem = fileContentProblem(file.name, buffer, ['pdf', 'png', 'jpeg', 'webp']);
  if (problem) throw new ComplianceFileRejected(problem);
  const stored = await getStorage().upload({
    buffer,
    originalName: file.name,
    mimeType: CONTENT_TYPES[ext],
    prefix: prefixFor(partnerId),
  });
  return stored.url;
}

/**
 * Streams the file of a compliance document of `partnerId`, or 404 when the
 * document has no stored file (older documents recorded a placeholder URL)
 * or its URL points anywhere but that partner's folder. With `viewer`, the
 * access is recorded in the audit log.
 */
export async function complianceFileResponse(
  partnerId: string,
  fileUrl: string,
  viewer?: { userId: string; tenantId?: string | null; docId: string; as: 'partner' | 'reviewer' },
): Promise<NextResponse> {
  const notFound = () => NextResponse.json({ error: 'No file stored for this document' }, { status: 404 });
  if (!fileUrl.startsWith(UPLOAD_URL_PREFIX)) return notFound();
  const key = normalizeStorageKey(fileUrl.slice(UPLOAD_URL_PREFIX.length));
  if (!key || !key.startsWith(`${prefixFor(partnerId)}/`)) return notFound();
  const contentType = CONTENT_TYPES[path.extname(key).toLowerCase()];
  if (!contentType) return notFound();
  const body = await readStoredFile(key);
  if (!body) return notFound();
  if (viewer) {
    await logAudit({
      tenantId: viewer.tenantId ?? undefined,
      entityType: 'PartnerComplianceDoc',
      entityId: viewer.docId,
      action: 'VIEW',
      userId: viewer.userId,
      details: `${viewer.as === 'partner' ? 'Partner member' : 'Reviewer'} opened compliance file of partner ${partnerId}`,
    });
  }

  const fileName = path.basename(key).replace(/^[0-9a-f-]{36}-/, '');
  return new NextResponse(new Uint8Array(body), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(body.length),
      'Content-Disposition': `inline; filename="${fileName}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
