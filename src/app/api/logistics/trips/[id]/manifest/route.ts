import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * /api/logistics/trips/[id]/manifest
 * Manages multi-stop cargo manifests stored in the `cargo_manifests` table.
 *
 * Table auto-created on first use — no migration required.
 *
 * Schema:
 *   cargo_manifests(
 *     id            UUID PK,
 *     booking_id    UUID NOT NULL,
 *     stop_number   INT  NOT NULL,       -- 1-based sort order
 *     stop_name     TEXT,                -- label, e.g. "Warehouse A"
 *     stop_address  TEXT,
 *     recipient     TEXT,
 *     recipient_phone TEXT,
 *     cargo_items   JSONB,              -- array of {desc, qty, unit, weightKg}
 *     status        TEXT DEFAULT 'PENDING', -- PENDING | DELIVERED | SKIPPED
 *     delivered_at  TIMESTAMPTZ,
 *     delivery_note TEXT,
 *     signature_b64 TEXT,
 *     created_at    TIMESTAMPTZ DEFAULT NOW(),
 *     updated_at    TIMESTAMPTZ DEFAULT NOW()
 *   )
 */

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS cargo_manifests (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id      UUID NOT NULL,
    stop_number     INT  NOT NULL DEFAULT 1,
    stop_name       TEXT,
    stop_address    TEXT,
    recipient       TEXT,
    recipient_phone TEXT,
    cargo_items     JSONB NOT NULL DEFAULT '[]',
    status          TEXT NOT NULL DEFAULT 'PENDING',
    delivered_at    TIMESTAMPTZ,
    delivery_note   TEXT,
    signature_b64   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;

async function ensureTable() {
  await prisma.$queryRawUnsafe(CREATE_TABLE).catch(() => {});
}

// ── GET — fetch all stops for a trip ─────────────────────────────────────────

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  await ensureTable();
  try {
    // Fetch booking details
    const bookings = await prisma.$queryRawUnsafe<Array<{
      id: string; booking_ref: string | null; status: string | null;
      requestor_name: string | null; notes: string | null;
      start_date: Date | null; end_date: Date | null;
    }>>(
      `SELECT id, booking_ref, status, requestor_name, notes, start_date, end_date
       FROM bookings WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      params.id
    ).catch(() => []);

    if (!bookings.length) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    const booking = bookings[0];

    // Parse notes
    let parsedNotes: Record<string, unknown> = {};
    try { parsedNotes = JSON.parse(booking.notes ?? '{}') as Record<string, unknown>; } catch { /* */ }

    // Fetch manifest stops
    const stops = await prisma.$queryRawUnsafe<Array<{
      id: string; stop_number: number; stop_name: string | null;
      stop_address: string | null; recipient: string | null;
      recipient_phone: string | null; cargo_items: unknown;
      status: string; delivered_at: Date | null; delivery_note: string | null;
      signature_b64: string | null; created_at: Date; updated_at: Date;
    }>>(
      `SELECT id, stop_number, stop_name, stop_address, recipient, recipient_phone,
              cargo_items, status, delivered_at, delivery_note, signature_b64,
              created_at, updated_at
       FROM cargo_manifests
       WHERE booking_id = $1
       ORDER BY stop_number ASC`,
      params.id
    ).catch(() => []);

    // Summary counts
    const summary = {
      totalStops:     stops.length,
      delivered:      stops.filter(s => s.status === 'DELIVERED').length,
      pending:        stops.filter(s => s.status === 'PENDING').length,
      skipped:        stops.filter(s => s.status === 'SKIPPED').length,
    };

    return NextResponse.json({
      booking: {
        id:           booking.id,
        bookingRef:   booking.booking_ref,
        status:       booking.status,
        customerName: booking.requestor_name,
        origin:       parsedNotes.origin       as string | null,
        driverName:   parsedNotes.driverName   as string | null,
        vehiclePlate: parsedNotes.vehiclePlate as string | null,
        scheduledDate: booking.start_date,
      },
      stops: stops.map(s => ({
        ...s,
        cargo_items: Array.isArray(s.cargo_items) ? s.cargo_items : [],
        delivered_at: s.delivered_at ? (s.delivered_at instanceof Date ? s.delivered_at : new Date(s.delivered_at)).toISOString() : null,
        created_at:   s.created_at   instanceof Date ? s.created_at.toISOString()   : s.created_at,
        updated_at:   s.updated_at   instanceof Date ? s.updated_at.toISOString()   : s.updated_at,
      })),
      summary,
    });
  } catch (err) {
    console.error('[manifest GET]', err);
    return NextResponse.json({ error: 'Failed to load manifest' }, { status: 500 });
  }
}

// ── POST — add a stop / update stop / confirm delivery ───────────────────────

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  await ensureTable();
  try {
    const body = await req.json() as {
      action: 'add_stop' | 'update_stop' | 'confirm_delivery' | 'reorder';
      stopId?: string;
      stopNumber?: number;
      stopName?: string;
      stopAddress?: string;
      recipient?: string;
      recipientPhone?: string;
      cargoItems?: Array<{ desc: string; qty: number; unit: string; weightKg?: number }>;
      status?: 'PENDING' | 'DELIVERED' | 'SKIPPED';
      deliveryNote?: string;
      signatureB64?: string;
      // reorder: array of {stopId, stopNumber}
      order?: Array<{ stopId: string; stopNumber: number }>;
    };

    // ── add_stop ──────────────────────────────────────────────────────────────
    if (body.action === 'add_stop') {
      // Auto-assign stop number if not given
      let nextStop = body.stopNumber;
      if (!nextStop) {
        const max = await prisma.$queryRawUnsafe<Array<{ max: number | null }>>(
          `SELECT MAX(stop_number) AS max FROM cargo_manifests WHERE booking_id = $1`,
          params.id
        ).catch(() => [{ max: null }]);
        nextStop = (max[0]?.max ?? 0) + 1;
      }

      await prisma.$queryRawUnsafe(
        `INSERT INTO cargo_manifests
           (booking_id, stop_number, stop_name, stop_address, recipient, recipient_phone, cargo_items)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        params.id,
        nextStop,
        body.stopName   ?? null,
        body.stopAddress ?? null,
        body.recipient  ?? null,
        body.recipientPhone ?? null,
        JSON.stringify(body.cargoItems ?? [])
      );

      return NextResponse.json({ ok: true, stopNumber: nextStop });
    }

    // ── update_stop ───────────────────────────────────────────────────────────
    if (body.action === 'update_stop' && body.stopId) {
      await prisma.$queryRawUnsafe(
        `UPDATE cargo_manifests
         SET stop_name = COALESCE($2, stop_name),
             stop_address = COALESCE($3, stop_address),
             recipient = COALESCE($4, recipient),
             recipient_phone = COALESCE($5, recipient_phone),
             cargo_items = CASE WHEN $6 IS NOT NULL THEN $6::jsonb ELSE cargo_items END,
             updated_at = NOW()
         WHERE id = $1 AND booking_id = $7`,
        body.stopId,
        body.stopName    ?? null,
        body.stopAddress ?? null,
        body.recipient   ?? null,
        body.recipientPhone ?? null,
        body.cargoItems ? JSON.stringify(body.cargoItems) : null,
        params.id
      );
      return NextResponse.json({ ok: true });
    }

    // ── confirm_delivery ──────────────────────────────────────────────────────
    if (body.action === 'confirm_delivery' && body.stopId) {
      await prisma.$queryRawUnsafe(
        `UPDATE cargo_manifests
         SET status = $2, delivered_at = NOW(), delivery_note = $3,
             signature_b64 = $4, updated_at = NOW()
         WHERE id = $1 AND booking_id = $5`,
        body.stopId,
        body.status ?? 'DELIVERED',
        body.deliveryNote  ?? null,
        body.signatureB64  ?? null,
        params.id
      );
      return NextResponse.json({ ok: true });
    }

    // ── reorder ───────────────────────────────────────────────────────────────
    if (body.action === 'reorder' && body.order) {
      for (const { stopId, stopNumber } of body.order) {
        await prisma.$queryRawUnsafe(
          `UPDATE cargo_manifests SET stop_number = $2, updated_at = NOW() WHERE id = $1 AND booking_id = $3`,
          stopId, stopNumber, params.id
        );
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('[manifest POST]', err);
    return NextResponse.json({ error: 'Failed to update manifest' }, { status: 500 });
  }
}

// ── DELETE — remove a stop ────────────────────────────────────────────────────

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  await ensureTable();
  try {
    const { stopId } = await req.json() as { stopId: string };
    if (!stopId) return NextResponse.json({ error: 'stopId required' }, { status: 400 });
    await prisma.$queryRawUnsafe(
      `DELETE FROM cargo_manifests WHERE id = $1 AND booking_id = $2`,
      stopId, params.id
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[manifest DELETE]', err);
    return NextResponse.json({ error: 'Failed to delete stop' }, { status: 500 });
  }
}
