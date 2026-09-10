export const dynamic = 'force-dynamic';

/**
 * GET /api/service-tickets/track/[token]
 *
 * Public Zero-Auth Ticket Tracking Endpoint:
 * Allows clients, drivers, and passengers to track live ticket progress,
 * status transitions, and towing recovery ETAs without internal staff credentials.
 *
 * Security:
 *  - Strips confidential internal fields (tenant ID, technician email/UID, internal notes).
 *  - Only accessible with the cryptographically unguessable trackingToken.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';
import { TICKET_DEPARTMENTS, type TicketDepartment } from '@/types/service-tickets';

export const runtime = 'nodejs';

interface RouteParams {
  params: Promise<{ token: string }>;
}

// In-memory rate limiter: 30 requests per minute per IP to prevent brute force
const trackingRateLimit = new Map<string, { count: number; resetAt: number }>();

function checkTrackingRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = trackingRateLimit.get(ip);
  if (!entry || now > entry.resetAt) {
    trackingRateLimit.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  entry.count++;
  return entry.count > 30;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'anonymous';
    if (checkTrackingRateLimit(ip)) {
      return NextResponse.json(
        { error: 'Too many tracking requests. Please try again later.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      );
    }

    const { token } = await params;
    const sanitizedToken = String(token ?? '').trim();

    // P0 Security: Must be an unguessable 24-64 character random token.
    // Sequential IDs (e.g. ST2026-MNT-0001) or short strings are strictly rejected with 404 to prevent enumeration.
    if (!/^[a-f0-9]{24,64}$/i.test(sanitizedToken)) {
      return NextResponse.json(
        { error: 'Service ticket not found or link has expired' },
        { status: 404 }
      );
    }

    // Query ticket strictly by trackingToken in custom_fields using withPlatformAdmin to allow capability-token lookup across tenants
    const rows = await withPlatformAdmin(prisma, async (tx) =>
      tx.$queryRawUnsafe<
        Array<{
          id: string;
          ticket_type: string;
          readable_id: string | null;
          title: string;
          description: string | null;
          priority: string;
          status: string;
          created_at: string;
          updated_at: string;
          due_date: string | null;
          history: unknown;
          custom_fields: Record<string, unknown>;
        }>
      >(
        `SELECT id, ticket_type, readable_id, title, description, priority, status,
                created_at::text, updated_at::text, due_date::text, history, custom_fields
         FROM service_tickets
         WHERE custom_fields->>'trackingToken' = $1
           AND deleted_at IS NULL
         LIMIT 1`,
        sanitizedToken
      )
    ).catch(() => []);

    const ticket = rows[0];
    if (!ticket) {
      return NextResponse.json(
        { error: 'Service ticket not found or link has expired' },
        { status: 404 }
      );
    }

    // Token expiration check: default 30-day validity from creation
    const createdAtMs = new Date(ticket.created_at).getTime();
    const tokenMaxAgeMs = 30 * 24 * 60 * 60 * 1000; // 30 days
    if (Date.now() - createdAtMs > tokenMaxAgeMs) {
      return NextResponse.json(
        { error: 'Tracking link has expired. Please contact support for updated status.' },
        { status: 410 }
      );
    }

    const customFields = ticket.custom_fields || {};
    const assignedDepartment = (customFields.assignedDepartment as TicketDepartment) || 'OPERATIONS_TRIAGE';
    const deptDef = TICKET_DEPARTMENTS.find((d) => d.key === assignedDepartment);

    // Filter history to public-safe milestones (masking internal staff usernames/emails)
    const rawHistory = Array.isArray(ticket.history) ? ticket.history : [];
    const publicTimeline = rawHistory.map((h: any) => {
      let publicNote = h.note || `Status updated to ${h.status}`;
      // Strip any email addresses or internal system IDs from note
      publicNote = publicNote.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, 'Support Officer');

      return {
        status: h.status,
        date: h.date,
        note: publicNote,
      };
    });

    const towingDispatch = customFields.towingDispatch as {
      vendorName?: string;
      dispatchedAt?: string;
      etaMinutes?: number;
      trackingStatus?: string;
    } | undefined;

    return NextResponse.json({
      ok: true,
      ticket: {
        readableId: ticket.readable_id || ticket.id.slice(0, 8).toUpperCase(),
        ticketType: ticket.ticket_type,
        title: ticket.title,
        description: ticket.description,
        status: ticket.status,
        priority: ticket.priority,
        department: {
          key: assignedDepartment,
          label: deptDef?.label || 'Operations Triage',
          shortLabel: deptDef?.shortLabel || 'Triage',
          tone: deptDef?.tone || 'slate',
        },
        createdAt: ticket.created_at,
        updatedAt: ticket.updated_at,
        dueDate: ticket.due_date,
        timeline: publicTimeline,
        recovery: towingDispatch
          ? {
              vendorName: towingDispatch.vendorName,
              dispatchedAt: towingDispatch.dispatchedAt,
              etaMinutes: towingDispatch.etaMinutes,
              trackingStatus: towingDispatch.trackingStatus,
            }
          : null,
      },
    });
  } catch (err) {
    console.error('GET /api/service-tickets/track/[token] error:', err);
    return NextResponse.json(
      { error: 'An error occurred while retrieving ticket status' },
      { status: 500 }
    );
  }
}
