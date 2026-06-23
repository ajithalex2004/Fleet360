/**
 * GET /api/admin/customers/portal-status
 *
 * Single-roundtrip data feed for the shipper-portal admin page. Returns
 * every customer in the tenant with:
 *   • current portal_tracking_level
 *   • count of portal users (with last_login_at of the most recent)
 *   • count of pending invitations
 *
 * Designed for the per-customer table on /admin/shipper-portal-config —
 * one fetch hydrates the whole UI.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureShipperPortalTables } from '@/lib/shipper-portal/schema';
import { DEFAULT_TRACKING_LEVEL } from '@/lib/shipper-portal/visibility';

export const runtime = 'nodejs';

interface CustomerRow {
  id: string;
  name_en: string;
  email: string | null;
  portal_tracking_level: string | null;
  active_users: bigint;
  pending_users: bigint;
  pending_invitations: bigint;
  last_login_at: string | null;
}

export async function GET(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    await ensureShipperPortalTables();

    // One query, LEFT JOINs to the portal-user and invitation tables.
    // Aggregates keep the result one row per customer.
    const rows = await prisma.$queryRawUnsafe<CustomerRow[]>(
      `SELECT
         c.id,
         c.name_en,
         c.email,
         c.portal_tracking_level,
         (
           SELECT COUNT(*)::bigint FROM customer_portal_users u
            WHERE u.tenant_id = c.tenant_id AND u.customer_id = c.id
              AND u.deleted_at IS NULL AND u.is_active = TRUE
              AND u.password_hash IS NOT NULL
         ) AS active_users,
         (
           SELECT COUNT(*)::bigint FROM customer_portal_users u
            WHERE u.tenant_id = c.tenant_id AND u.customer_id = c.id
              AND u.deleted_at IS NULL AND u.password_hash IS NULL
         ) AS pending_users,
         (
           SELECT COUNT(*)::bigint FROM customer_portal_invitations i
            JOIN customer_portal_users u ON u.id = i.portal_user_id
            WHERE i.tenant_id = c.tenant_id AND u.customer_id = c.id
              AND i.accepted_at IS NULL AND i.expires_at > NOW()
         ) AS pending_invitations,
         (
           SELECT MAX(u.last_login_at)::text FROM customer_portal_users u
            WHERE u.tenant_id = c.tenant_id AND u.customer_id = c.id
              AND u.deleted_at IS NULL
         ) AS last_login_at
       FROM customers c
       WHERE c.tenant_id = $1 AND c.deleted_at IS NULL
       ORDER BY c.name_en ASC
       LIMIT 500`,
      tenantId,
    );

    return NextResponse.json({
      customers: rows.map(r => ({
        id: r.id,
        name: r.name_en,
        email: r.email,
        trackingLevel: r.portal_tracking_level ?? DEFAULT_TRACKING_LEVEL,
        usingDefault: r.portal_tracking_level === null,
        activeUserCount: Number(r.active_users),
        pendingUserCount: Number(r.pending_users),
        pendingInvitationCount: Number(r.pending_invitations),
        lastLoginAt: r.last_login_at,
      })),
    }, {
      headers: { 'Cache-Control': 'private, max-age=15, stale-while-revalidate=30' },
    });
  } catch (e) {
    console.error('[admin/customers/portal-status]', e);
    return NextResponse.json({ customers: [] });
  }
}
