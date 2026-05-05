/**
 * POST /api/rental/invoices/:id/send
 * Marks an invoice as SENT (transitions from DRAFT → SENT).
 * In production this would trigger email/WhatsApp delivery;
 * here we record the sent event and update status.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json().catch(() => ({}));
    const { sentBy, channel = 'EMAIL', recipientEmail, recipientPhone } = body;

    const rows = await prisma.$queryRawUnsafe<any[]>(
      "SELECT * FROM rental_invoices WHERE id = $1 AND deleted_at IS NULL", params.id
    );
    if (!rows.length) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

    const inv = rows[0];
    if (['VOID', 'CANCELLED'].includes(inv.status)) {
      return NextResponse.json({ error: 'Cannot send a ' + inv.status + ' invoice' }, { status: 422 });
    }

    const now = new Date().toISOString();
    const sentNote = '[SENT ' + now + ' via ' + channel + (sentBy ? ' by ' + sentBy : '') +
      (recipientEmail ? ' to ' + recipientEmail : '') + ']';
    const existingNotes = inv.internal_notes ? inv.internal_notes + '\n' + sentNote : sentNote;

    // Transition: DRAFT → SENT; all other statuses remain unchanged
    const newStatus = inv.status === 'DRAFT' ? 'SENT' : inv.status;

    await prisma.$executeRawUnsafe(
      "UPDATE rental_invoices SET status=$1, internal_notes=$2, updated_at=$3 WHERE id=$4",
      newStatus, existingNotes, now, params.id
    );

    const updated = await prisma.$queryRawUnsafe<any[]>(
      "SELECT * FROM rental_invoices WHERE id = $1", params.id
    );

    return NextResponse.json({
      invoice: updated[0],
      sent: {
        at: now, channel,
        recipientEmail: recipientEmail ?? null,
        recipientPhone: recipientPhone ?? null,
        sentBy: sentBy ?? null,
      },
    });
  } catch (e: any) {
    console.error('Invoice send error:', e);
    return NextResponse.json({ error: e.message ?? 'Failed to send invoice' }, { status: 500 });
  }
}
