export const dynamic = 'force-dynamic';

/**
 * POST /api/agents/preventive-maintenance/book-slot
 * --------------------------------------------------
 * 1-Click Commit of a recommended low-impact slot into a Fleet Work Order.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { ensureAgentSchema } from '@/lib/agents/schema';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  await ensureAgentSchema();

  return withTenantRls(prisma, tenantId, async () => {
    try {
      const body = await req.json();
      const { vehicleId, forecastId, slotDate, startTime, endTime, serviceThreshold } = body as {
        vehicleId: string;
        forecastId?: string;
        slotDate: string;
        startTime: string;
        endTime: string;
        serviceThreshold: string;
      };

      if (!vehicleId || !slotDate) {
        return NextResponse.json({ error: 'vehicleId and slotDate are required' }, { status: 400 });
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const startDateTime = new Date(`${slotDate}T${startTime || '13:00'}:00.000Z`).toISOString();
      const endDateTime = new Date(`${slotDate}T${endTime || '16:30'}:00.000Z`).toISOString();

      // Determine sequence
      const seqResult = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT COUNT(*) AS count FROM fleet_work_orders`
      ).catch(() => [{ count: BigInt(100) }]);
      const seq = Number(seqResult[0]?.count || 100) + 1;
      const woNumber = 'FWO-PM-' + String(seq).padStart(5, '0');

      const description =
        `[Auto-Scheduled PM] ${serviceThreshold || 'Routine Milestone Service'}\n` +
        `Booked into Lowest-Impact Slot: ${slotDate} (${startTime} - ${endTime}).\n` +
        `Zero/Minimal passenger disruption window scheduled by Preventive Maintenance Agent.`;

      // Insert into fleet_work_orders
      await prisma.$executeRawUnsafe(`
        INSERT INTO fleet_work_orders (
          id, wo_number, vehicle_id, description, status, priority,
          wo_type, requested_by, start_date, end_date, created_at, updated_at
        ) VALUES (
          $1::uuid, $2, $3::uuid, $4, 'OPEN', 'MEDIUM',
          'PREVENTIVE', 'Preventive Maintenance Agent', $5::timestamptz, $6::timestamptz, $7, $8
        )
      `,
        id,
        woNumber,
        vehicleId,
        description,
        startDateTime,
        endDateTime,
        now,
        now
      );

      // Update forecast status if forecastId passed
      if (forecastId) {
        await prisma.$executeRawUnsafe(`
          UPDATE preventive_maintenance_forecasts
          SET status = 'SCHEDULED', updated_at = NOW()
          WHERE id = $1::uuid AND tenant_id = $2
        `, forecastId, tenantId).catch(() => {});
      }

      return NextResponse.json({
        success: true,
        message: `Work Order ${woNumber} booked for ${slotDate} (${startTime} - ${endTime}).`,
        workOrderId: id,
        woNumber,
        scheduledSlot: {
          slotDate,
          startTime,
          endTime,
        },
      });
    } catch (err: any) {
      console.error('[PM-Agent Book-Slot API] Error:', err);
      return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
  });
}
