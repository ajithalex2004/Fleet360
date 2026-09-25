export const dynamic = 'force-dynamic';

/**
 * GET /api/files/{key}
 *
 * The only way stored files are served. Middleware routes every
 * /uploads/{key} request here (stored URLs keep that form), with identity
 * headers set from a verified staff session when there is one. The caller is
 * authorized against the file's owning record before any bytes are read
 * (src/lib/storage/file-access.ts).
 *
 * Responses are private and uncacheable, and served with a sandboxing CSP and
 * nosniff so an uploaded file can never run as a page on this origin.
 */
import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { normalizeStorageKey, readStoredFile } from '@/lib/storage';
import { authorizeFileAccess, type FileCaller } from '@/lib/storage/file-access';
import { requireLeasingPortal } from '@/lib/leasing-portal/auth';

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

const notFound = () =>
  NextResponse.json({ error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });

/**
 * Staff callers come from the identity headers middleware sets from a verified
 * session (`authz`); otherwise a leasing-portal session is checked.
 */
async function resolveCaller(
  req: NextRequest,
  authz: ReturnType<typeof requireAuthorizedTenant> | null,
): Promise<FileCaller> {
  if (authz) {
    const userId = req.headers.get('x-user-id');
    return authz.ok && userId ? { kind: 'staff', tenantId: authz.tenantId, userId } : { kind: 'anonymous' };
  }
  if (req.cookies.get('leasing-portal-session')) {
    const ctx = await requireLeasingPortal(req);
    if (!(ctx instanceof NextResponse)) {
      return { kind: 'leasing-portal', tenantId: ctx.tenantId, lesseeId: ctx.lesseeId };
    }
  }
  return { kind: 'anonymous' };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  const { key: parts } = await params;
  const key = normalizeStorageKey((parts ?? []).join('/'));
  if (!key) return notFound();

  // Staff identity headers exist only when middleware verified a session.
  const authz = req.headers.get('x-tenant-id') ? requireAuthorizedTenant(req) : null;
  const caller = await resolveCaller(req, authz);
  const decision = await authorizeFileAccess(key, caller);
  if (!decision.allowed) {
    return caller.kind === 'anonymous' && !key.startsWith('branding/')
      ? NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
      : notFound();
  }

  const contentType = CONTENT_TYPES[path.extname(key).toLowerCase()] ?? 'application/octet-stream';
  if (decision.imageOnly && !IMAGE_TYPES.has(contentType)) return notFound();

  const body = await readStoredFile(key);
  if (!body) return notFound();

  const fileName = path.basename(key).replace(/^[0-9a-f-]{36}-/, '');
  const inline = contentType === 'application/pdf' || IMAGE_TYPES.has(contentType);
  return new NextResponse(new Uint8Array(body), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(body.length),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${fileName}"`,
      // Branding is public; everything else depends on the caller.
      'Cache-Control': decision.category === 'branding' ? 'public, max-age=300' : 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
