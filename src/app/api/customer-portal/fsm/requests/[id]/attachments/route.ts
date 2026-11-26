export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/customer-portal/fsm/requests/[id]/attachments
 * Photos on one of the signed-in customer's own requests (ADMIN or
 * REQUESTER). Same limits and storage as the staff upload.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireCustomerPortal } from '@/lib/customer-portal/session';
import { photoFilesFrom, saveTicketPhotos } from '@/lib/service-tickets/photos';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

interface RouteParams { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: RouteParams) {
  const ctx = await requireCustomerPortal(req, { portal: 'FSM', roles: ['ADMIN', 'REQUESTER'] });
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ ok: false, error: 'Expected multipart form data' }, { status: 400 }); }
  try {
    const result = await saveTicketPhotos({
      tenantId: ctx.tenantId, ticketId: id, files: photoFilesFrom(form),
      uploadedBy: `customer-portal:${ctx.user.id}`, customerId: ctx.customerId,
    });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    void logAudit({
      tenantId: ctx.tenantId, userId: ctx.user.id, userRole: 'CUSTOMER_PORTAL', entityType: 'ServiceTicket', entityId: id,
      entityName: result.readableId ?? id, action: 'UPDATE', details: `Customer attached ${result.attachments.length} photo(s)`,
    });
    return NextResponse.json({ ok: true, attachments: result.attachments }, { status: 201 });
  } catch (err) {
    captureException(err, { context: 'customer-portal.fsm.attachments' });
    return NextResponse.json({ ok: false, error: 'Failed to store the photos' }, { status: 500 });
  }
}
