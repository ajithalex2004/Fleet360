/**
 * src/lib/exchange/webhook-receipt-service.ts
 *
 * Webhook Delivery Receipt Processing Engine for WhatsApp Business & Twilio SMS.
 * Tracks dispatch message lifecycle: Sent -> Delivered -> Read -> Failed.
 */

import { prisma } from '@/lib/prisma';
import { raiseAlert } from '@/lib/alerts/raise';

export interface WhatsAppStatusInput {
  messageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  recipientId?: string;
  timestamp?: string | number;
  errorDetails?: {
    code?: number;
    title?: string;
    message?: string;
  };
}

export interface TwilioStatusInput {
  messageSid: string;
  messageStatus: 'queued' | 'sent' | 'delivered' | 'undelivered' | 'failed';
  to: string;
  errorCode?: string;
  errorMessage?: string;
}

export class WebhookReceiptService {
  /**
   * Process Meta WhatsApp Cloud API status receipt
   */
  static async processWhatsAppStatusUpdate(input: WhatsAppStatusInput) {
    let assignmentId: string | null = null;
    let eventType = 'WHATSAPP_STATUS_UPDATE';
    if (input.status === 'delivered') eventType = 'WHATSAPP_DELIVERED';
    else if (input.status === 'read') eventType = 'WHATSAPP_READ';
    else if (input.status === 'failed') eventType = 'WHATSAPP_FAILED';
    else if (input.status === 'sent') eventType = 'WHATSAPP_SENT';

    try {
      const dispatchEvents = await prisma.partnerTripEvent.findMany({
        where: {
          eventType: { in: ['WHATSAPP_DISPATCHED', 'SMS_DISPATCHED'] },
        },
        orderBy: { occurredAt: 'desc' },
        take: 100,
      });

      const matchingEvent = dispatchEvents.find((e) => {
        const payload = e.payload as any;
        return payload?.messageId === input.messageId;
      });

      if (matchingEvent) {
        assignmentId = matchingEvent.assignmentId;
        await prisma.partnerTripEvent.create({
          data: {
            assignmentId,
            eventType,
            actor: 'WHATSAPP_WEBHOOK',
            payload: {
              messageId: input.messageId,
              status: input.status,
              recipientId: input.recipientId,
              timestamp: input.timestamp,
              errorDetails: input.errorDetails,
            },
          },
        });

        // If delivery failed -> alert Operations Dispatch
        if (input.status === 'failed') {
          const assignment = await prisma.partnerAssignment.findUnique({
            where: { id: assignmentId },
            include: { award: { include: { request: true } } },
          });

          if (assignment) {
            await raiseAlert({
              tenantId: assignment.award.request.tenantId,
              code: 'DRIVER_DISPATCH_DELIVERY_FAILED',
              sourceModule: 'exchange',
              subjectType: 'TripSchedule' as any,
              subjectId: assignment.award.request.sourceReferenceId,
              title: `⚠️ Driver WhatsApp Delivery Failed: ${assignment.driverName} (${assignment.driverPhone})`,
              description: `WhatsApp message failed to deliver: ${input.errorDetails?.message || 'Undelivered'}. Please contact driver directly.`,
              severity: 'HIGH',
              actor: 'WEBHOOK_RECEIVER',
            }).catch(() => {});
          }
        }
      }
    } catch {
      // Safe error recovery if db table is in migration
    }

    return {
      ok: true,
      assignmentId,
      messageId: input.messageId,
      status: input.status,
      eventType,
    };
  }

  /**
   * Process Twilio SMS status callback
   */
  static async processTwilioStatusCallback(input: TwilioStatusInput) {
    let assignmentId: string | null = null;
    let eventType = 'SMS_STATUS_UPDATE';
    if (input.messageStatus === 'delivered') eventType = 'SMS_DELIVERED';
    else if (input.messageStatus === 'failed' || input.messageStatus === 'undelivered') eventType = 'SMS_FAILED';
    else if (input.messageStatus === 'sent') eventType = 'SMS_SENT';

    try {
      const dispatchEvents = await prisma.partnerTripEvent.findMany({
        where: {
          eventType: { in: ['WHATSAPP_DISPATCHED', 'SMS_DISPATCHED'] },
        },
        orderBy: { occurredAt: 'desc' },
        take: 100,
      });

      const matchingEvent = dispatchEvents.find((e) => {
        const payload = e.payload as any;
        return payload?.messageId === input.messageSid;
      });

      if (matchingEvent) {
        assignmentId = matchingEvent.assignmentId;
        await prisma.partnerTripEvent.create({
          data: {
            assignmentId,
            eventType,
            actor: 'TWILIO_WEBHOOK',
            payload: {
              messageSid: input.messageSid,
              messageStatus: input.messageStatus,
              to: input.to,
              errorCode: input.errorCode,
              errorMessage: input.errorMessage,
            },
          },
        });

        if (input.messageStatus === 'failed' || input.messageStatus === 'undelivered') {
          const assignment = await prisma.partnerAssignment.findUnique({
            where: { id: assignmentId },
            include: { award: { include: { request: true } } },
          });

          if (assignment) {
            await raiseAlert({
              tenantId: assignment.award.request.tenantId,
              code: 'DRIVER_DISPATCH_DELIVERY_FAILED',
              sourceModule: 'exchange',
              subjectType: 'TripSchedule' as any,
              subjectId: assignment.award.request.sourceReferenceId,
              title: `⚠️ Driver SMS Delivery Failed: ${assignment.driverName} (${assignment.driverPhone})`,
              description: `SMS failed to deliver to ${input.to}: ${input.errorMessage || 'Undelivered'}.`,
              severity: 'HIGH',
              actor: 'WEBHOOK_RECEIVER',
            }).catch(() => {});
          }
        }
      }
    } catch {
      // Safe error recovery
    }

    return {
      ok: true,
      assignmentId,
      messageSid: input.messageSid,
      messageStatus: input.messageStatus,
      eventType,
    };
  }
}
