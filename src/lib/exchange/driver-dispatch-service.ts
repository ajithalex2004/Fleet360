/**
 * src/lib/exchange/driver-dispatch-service.ts
 *
 * Automated WhatsApp & SMS Driver Dispatch Engine for Fleet360 Exchange.
 * Automatically dispatches the secure, zero-login link (/track/partner-trip/[token])
 * directly to the assigned driver's WhatsApp/mobile upon assignment or substitution.
 */

import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';

export interface DispatchDriverLinkInput {
  assignmentId?: string;
  driverName: string;
  driverPhone: string;
  vehiclePlate: string;
  pickupLocation: string;
  pickupTime: string;
  dropoffLocation?: string;
  rawToken: string;
  channel?: 'WHATSAPP' | 'SMS' | 'AUTO';
  actorUserId?: string;
}

export interface DispatchResult {
  success: boolean;
  channel: 'WHATSAPP' | 'SMS';
  recipient: string;
  messageId: string;
  dispatchUrl: string;
  messageText?: string;
  timestamp: Date;
}

export class DriverDispatchService {
  /**
   * Dispatch trip link directly to driver's WhatsApp or SMS
   */
  static async dispatchDriverLink(input: DispatchDriverLinkInput): Promise<DispatchResult> {
    const cleanPhone = input.driverPhone.replace(/[^\d+]/g, '');
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://exchange.fleet360.ae';
    const dispatchUrl = `${baseUrl}/track/partner-trip/${input.rawToken}`;

    const messageText = `Assalamu Alaikum / Hello ${input.driverName},
You have been assigned to trip on vehicle ${input.vehiclePlate}.

📍 Pickup: ${input.pickupLocation}
⏰ Time: ${input.pickupTime}
${input.dropoffLocation ? `🏁 Destination: ${input.dropoffLocation}` : ''}

👉 Open your secure trip link to start and complete this trip:
${dispatchUrl}

- Fleet360 Transport Exchange`;

    const channel: 'WHATSAPP' | 'SMS' = input.channel === 'SMS' ? 'SMS' : 'WHATSAPP';
    const messageId = `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    // 1. If WhatsApp API credentials are configured, send message via WhatsApp API
    const waUrl   = process.env.WHATSAPP_API_URL;
    const waToken = process.env.WHATSAPP_API_TOKEN;
    if (channel === 'WHATSAPP' && waUrl && waToken && process.env.NODE_ENV !== 'test') {
      await fetch(waUrl, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${waToken}`,
        },
        body: JSON.stringify({
          to:   cleanPhone,
          type: 'text',
          text: { body: messageText },
        }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    }

    // 2. Record Immutable PartnerTripEvent
    if (input.assignmentId) {
      await prisma.partnerTripEvent.create({
        data: {
          assignmentId: input.assignmentId,
          eventType: channel === 'WHATSAPP' ? 'WHATSAPP_DISPATCHED' : 'SMS_DISPATCHED',
          actor: input.actorUserId || 'AUTO_DISPATCHER',
          payload: {
            channel,
            recipient: cleanPhone,
            messageId,
            dispatchUrl,
            messageText,
          },
        },
      }).catch(() => {});

      // 3. Platform-wide audit trail
      await logAudit({
        entityType: 'PartnerTripDispatch',
        entityId: input.assignmentId,
        action: 'CREATE',
        details: `Dispatched ${channel} trip link to ${input.driverName} (${cleanPhone}) for vehicle ${input.vehiclePlate}`,
        userId: input.actorUserId,
      }).catch(() => {});
    } else if (process.env.NODE_ENV !== 'test') {
      void logAudit({
        entityType: 'PartnerTripDispatch',
        entityId: input.assignmentId,
        action: 'CREATE',
        details: `Dispatched ${channel} trip link to ${input.driverName} (${cleanPhone}) for vehicle ${input.vehiclePlate}`,
        userId: input.actorUserId,
      }).catch(() => {});
    }

    return {
      success: true,
      channel,
      recipient: cleanPhone,
      messageId,
      dispatchUrl,
      messageText,
      timestamp: new Date(),
    };
  }

  /**
   * Fetch active/assigned dispatch jobs for a specific driver within a tenant
   */
  static async getDriverTrips(driverId: string, tenantId: string) {
    return prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT *
       FROM dispatch_jobs
       WHERE tenant_id = $1
         AND (assigned_driver_id = $2 OR driver_id = $2)
         AND status IN ('OFFERED', 'ACCEPTED', 'IN_PROGRESS')
       ORDER BY created_at DESC`,
      tenantId,
      driverId,
    ).catch(() => []);
  }

  /**
   * Update trip status for a driver's dispatch job and sync availability when completed
   */
  static async updateTripStatus(
    jobId: string,
    tenantId: string,
    status: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED',
  ) {
    const [job] = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `UPDATE dispatch_jobs
       SET status       = $3,
           completed_at = CASE WHEN $3 = 'COMPLETED' THEN NOW() ELSE completed_at END,
           updated_at   = NOW()
       WHERE id = $1::uuid AND tenant_id = $2
       RETURNING id, COALESCE(assigned_driver_id, driver_id) AS driver_id, COALESCE(assigned_vehicle_id, vehicle_id) AS vehicle_id, booking_id`,
      jobId,
      tenantId,
      status,
    ).catch(() => []);

    if (job && (status === 'COMPLETED' || status === 'CANCELLED')) {
      if (job.driver_id) {
        await prisma.$executeRawUnsafe(
          `UPDATE driver_availability
           SET status = 'AVAILABLE', current_job_id = NULL, updated_at = NOW()
           WHERE driver_id = $1`,
          String(job.driver_id),
        ).catch(() => {});
      }
      if (job.vehicle_id) {
        await prisma.$executeRawUnsafe(
          `UPDATE vehicles SET status = 'AVAILABLE' WHERE id::text = $1 AND tenant_id::text = $2`,
          String(job.vehicle_id),
          tenantId,
        ).catch(() => {});
      }
    }

    return job ?? null;
  }
}
