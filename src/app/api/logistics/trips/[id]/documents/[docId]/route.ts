import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { assertGovernedShipmentWrite, ensureShipmentForLegacyBooking } from '@/lib/logistics/domain';
import { logisticsErrorResponse } from '@/lib/logistics/api-context';

/**
 * DELETE /api/logistics/trips/[id]/documents/[docId]
 * GET    /api/logistics/trips/[id]/documents/[docId]  — fetch with fileData
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; docId: string } }
) {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM trip_documents WHERE id = $1 AND booking_id = $2 LIMIT 1`,
      params.docId, params.id
    ).catch(() => []);

    if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const d = rows[0];
    return NextResponse.json({
      ...d,
      file_size:   d.file_size != null ? Number(d.file_size as bigint) : null,
      uploaded_at: d.uploaded_at instanceof Date ? (d.uploaded_at as Date).toISOString() : d.uploaded_at,
    });
  } catch (err) {
    console.error('[trip-docs GET single]', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; docId: string } }
) {
  try {
    const body = await req.json().catch(() => ({})) as { tenantId?: string };
    const tenantId = req.headers.get('x-tenant-id') ?? body.tenantId ?? req.nextUrl.searchParams.get('tenantId');
    if (tenantId) {
      const shipment = await ensureShipmentForLegacyBooking({
        tenantId,
        bookingId: params.id,
        actorUserId: req.headers.get('x-user-id') ?? null,
      });
      if (shipment) {
        await assertGovernedShipmentWrite({
          tenantId,
          shipmentOrderId: shipment.id,
          action: 'Trip document deletion',
        });
      }
    }
    await prisma.$executeRawUnsafe(
      `DELETE FROM trip_documents WHERE id = $1 AND booking_id = $2`,
      params.docId, params.id
    );
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[trip-docs DELETE]', err);
    return logisticsErrorResponse(err, 'Failed to delete');
  }
}
