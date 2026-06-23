/**
 * POST /api/admin/shipper-portal/seed-demo
 *
 * Dev / QA convenience: creates a demo customer + portal user + a handful
 * of shipments at varying statuses so the shipper portal can be exercised
 * end-to-end without hand-crafting data.
 *
 * Guards:
 *   • Requires a tenant operator session.
 *   • Refuses to run when NODE_ENV === 'production' unless the request
 *     carries ?force=true AND x-user-role is SUPER_ADMIN — this is a
 *     data-creation endpoint and shouldn't be casually hit in prod.
 *
 * Returns the created customer id + portal-user setup link so the tester
 * can immediately log in as the shipper.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';
import { createPortalUser } from '@/lib/shipper-portal/portal-users-store';
import { createInvitation } from '@/lib/shipper-portal/invitations';
import { ensureShipperPortalTables } from '@/lib/shipper-portal/schema';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  const userId   = req.headers.get('x-user-id');
  const role     = req.headers.get('x-user-role') ?? '';
  if (!tenantId || !userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const force = req.nextUrl.searchParams.get('force') === 'true';
  if (process.env.NODE_ENV === 'production' && !(force && role === 'SUPER_ADMIN')) {
    return NextResponse.json({
      error: 'Demo seeding is disabled in production. Pass ?force=true as SUPER_ADMIN to override.',
    }, { status: 403 });
  }

  try {
    await ensureShipperPortalTables();

    const stamp = new Date().toISOString().slice(0, 10);
    const customerId = randomUUID();
    const demoEmail = `demo.shipper+${Date.now()}@example.com`;

    // 1. Create a demo customer.
    await prisma.$executeRawUnsafe(
      `INSERT INTO customers
         (id, tenant_id, customer_type, name_en, email, mobile_number,
          portal_tracking_level, created_at, updated_at)
       VALUES ($1, $2, 'CORPORATE', $3, $4, '+971500000000',
               'STATUS_AND_ETA', NOW(), NOW())`,
      customerId, tenantId, `Demo Shipper (${stamp})`, demoEmail,
    );

    // 2. Create a portal user + invitation.
    const portalUser = await createPortalUser({
      tenantId, customerId, email: demoEmail, fullName: 'Demo Shipper', role: 'SHIPPER_ADMIN',
    });
    const invitation = await createInvitation({
      tenantId, portalUserId: portalUser.id, invitedByUserId: userId,
    });
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL
      ?? req.headers.get('origin')
      ?? `http://localhost:3000`;
    const setupUrl = `${baseUrl.replace(/\/$/, '')}/shipper-portal/setup?token=${encodeURIComponent(invitation.rawToken)}`;

    // 3. Create a few shipments at varying statuses.
    const statuses = ['PENDING', 'ACKNOWLEDGED', 'DISPATCHED', 'ENROUTE_DELIVERY', 'DELIVERED'];
    const created: string[] = [];
    let seq = 1;
    for (const status of statuses) {
      const shipmentId = randomUUID();
      const shipmentNo = `DEMO-${stamp}-${String(seq).padStart(3, '0')}`;
      try {
        await prisma.$executeRawUnsafe(
          `INSERT INTO logistics_shipment_orders
             (id, tenant_id, shipment_no, cargo_owner_customer_id, cargo_owner_name,
              booking_mode, marketplace_status, status, priority,
              origin_name, origin_city, origin_country,
              destination_name, destination_city, destination_country,
              total_weight_kg, customer_rate_amount, currency,
              source_channel, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5,
                   'CONTRACT', 'PRIVATE', $6, 'Medium',
                   'Dubai Port Terminal 3', 'Dubai', 'AE',
                   'Mussafah Warehouse 12', 'Abu Dhabi', 'AE',
                   2500, 425.00, 'AED',
                   'SHIPPER_PORTAL', NOW() - ($7 || ' hours')::interval, NOW())`,
          shipmentId, tenantId, shipmentNo, customerId, `Demo Shipper (${stamp})`,
          status, String(seq * 6),
        );
        created.push(shipmentNo);
      } catch (e) {
        // If the logistics table shape differs, skip shipment seeding but
        // keep the customer + portal user (still useful for login testing).
        console.warn('[seed-demo] shipment insert skipped:', e instanceof Error ? e.message : e);
      }
      seq++;
    }

    return NextResponse.json({
      ok: true,
      customer: { id: customerId, email: demoEmail },
      portalUser: { id: portalUser.id, email: portalUser.email },
      setupUrl,
      shipmentsCreated: created,
      note: 'Open setupUrl in an incognito window to log in as the demo shipper.',
    }, { status: 201 });
  } catch (e) {
    console.error('[admin/shipper-portal/seed-demo]', e);
    return NextResponse.json({
      error: e instanceof Error ? e.message : 'Seed failed',
    }, { status: 500 });
  }
}
