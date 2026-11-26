export const dynamic = 'force-dynamic';

/**
 * POST /api/service-tickets/[id]/attachments
 *
 * Multipart form-data with one or more `file` fields (photos: PNG, JPEG,
 * WebP, GIF; up to 10 MB each, 6 per request). Stored under
 * service-tickets/{tenantId}/{ticketId}/… and appended to the request's
 * attachments (src/lib/service-tickets/photos.ts); file-access lets only
 * that tenant's staff read photos the request lists.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import { photoFilesFrom, saveTicketPhotos } from '@/lib/service-tickets/photos';

export const runtime = 'nodejs';

interface RouteParams { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: RouteParams) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId, userId } = authz;
  const { id } = await params;

  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ ok: false, error: 'Expected multipart form data' }, { status: 400 }); }

  try {
    const result = await saveTicketPhotos({ tenantId, ticketId: id, files: photoFilesFrom(form), uploadedBy: userId ?? null });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    void logAudit({
      tenantId, userId: userId ?? undefined, entityType: 'ServiceTicket', entityId: id,
      entityName: result.readableId ?? id, action: 'UPDATE', details: `Attached ${result.attachments.length} photo(s)`,
    });
    return NextResponse.json({ ok: true, attachments: result.attachments }, { status: 201 });
  } catch (err) {
    captureException(err, { context: 'service-tickets.attachments.upload' });
    return NextResponse.json({ ok: false, error: 'Failed to store the photos' }, { status: 500 });
  }
}
