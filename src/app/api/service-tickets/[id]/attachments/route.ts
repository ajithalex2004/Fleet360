export const dynamic = 'force-dynamic';

/**
 * POST /api/service-tickets/[id]/attachments
 *
 * Multipart form-data with one or more `file` fields (photos: PNG, JPEG,
 * WebP, GIF; up to 10 MB each, 6 per request). Files are stored under
 * service-tickets/{tenantId}/{ticketId}/… and appended to the request's
 * attachments; src/lib/storage/file-access.ts lets only staff of that tenant
 * read them, and only while the request lists them.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { getStorage } from '@/lib/storage';
import { fileContentProblem } from '@/lib/storage/file-type';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 6;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RouteParams { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: RouteParams) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId, userId } = authz;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ ok: false, error: 'Invalid request id' }, { status: 400 });

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ ok: false, error: 'Expected multipart form data' }, { status: 400 }); }
  const files = form.getAll('file').filter((f): f is File => typeof f === 'object' && f !== null && 'arrayBuffer' in f);
  if (files.length === 0) return NextResponse.json({ ok: false, error: 'No photo attached' }, { status: 400 });
  if (files.length > MAX_FILES) return NextResponse.json({ ok: false, error: `Attach at most ${MAX_FILES} photos` }, { status: 400 });

  // The request must exist in the caller's tenant before any bytes are stored.
  const [ticket] = await withTenantRls(prisma, tenantId, (tx) =>
    tx.$queryRawUnsafe<Array<{ id: string; readable_id: string | null }>>(
      `SELECT id::text, readable_id FROM service_tickets WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
      id, tenantId,
    ),
  ).catch(() => []);
  if (!ticket) return NextResponse.json({ ok: false, error: 'Service request not found' }, { status: 404 });

  try {
    const storage = getStorage();
    const added: Array<{
      id: string; type: 'PHOTO'; fileName: string; url: string; size: number; mimeType: string;
      uploadedAt: string; uploadedBy: string | null;
    }> = [];
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ ok: false, error: `${file.name} is larger than 10 MB` }, { status: 400 });
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const problem = fileContentProblem(file.name, buffer, ['png', 'jpeg', 'webp', 'gif']);
      if (problem) return NextResponse.json({ ok: false, error: `${file.name}: ${problem}` }, { status: 400 });
      const stored = await storage.upload({
        buffer, originalName: file.name, mimeType: file.type || 'image/jpeg',
        prefix: `service-tickets/${tenantId}/${id}`,
      });
      added.push({
        id: crypto.randomUUID(), type: 'PHOTO', fileName: file.name, url: stored.url, size: stored.size,
        mimeType: stored.mimeType, uploadedAt: new Date().toISOString(), uploadedBy: userId ?? null,
      });
    }

    await withTenantRls(prisma, tenantId, (tx) =>
      tx.$executeRawUnsafe(
        `UPDATE service_tickets
            SET attachments = COALESCE(attachments, '[]'::jsonb) || $3::jsonb, updated_at = NOW()
          WHERE id = $1::uuid AND tenant_id = $2`,
        id, tenantId, JSON.stringify(added),
      ),
    );
    void logAudit({
      tenantId, userId: userId ?? undefined, entityType: 'ServiceTicket', entityId: id,
      entityName: ticket.readable_id ?? id, action: 'UPDATE', details: `Attached ${added.length} photo(s)`,
    });
    return NextResponse.json({ ok: true, attachments: added }, { status: 201 });
  } catch (err) {
    captureException(err, { context: 'service-tickets.attachments.upload' });
    return NextResponse.json({ ok: false, error: 'Failed to store the photos' }, { status: 500 });
  }
}
