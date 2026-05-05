/**
 * TRIPEXL Dispatch Notification Engine
 * Sends driver accept/reject links via WhatsApp + push notification.
 * Fire-and-forget — never crashes the dispatch orchestrator.
 */

import type { Candidate, DispatchJob, ServiceType } from './types';

const SERVICE_ICONS: Record<ServiceType, string> = {
  PASSENGER:   '🚗',
  FREIGHT:     '🚛',
  DELIVERY:    '📦',
  AMBULANCE:   '🚑',
  TECHNICIAN:  '🔧',
  SCHOOL_BUS:  '🚌',
};

const SERVICE_LABELS: Record<ServiceType, string> = {
  PASSENGER:   'Passenger Transport',
  FREIGHT:     'Freight Transport',
  DELIVERY:    'Delivery',
  AMBULANCE:   'Ambulance',
  TECHNICIAN:  'Technician Dispatch',
  SCHOOL_BUS:  'School Bus Route',
};

function buildAcceptUrl(baseUrl: string, token: string, action: 'accept' | 'reject'): string {
  return `${baseUrl}/api/dispatch/respond?token=${token}&action=${action}`;
}

/** Build WhatsApp message text for driver */
export function buildDriverMessage(
  job: DispatchJob,
  candidate: Candidate,
  acceptUrl: string,
  rejectUrl: string,
): string {
  const icon    = SERVICE_ICONS[job.serviceType] ?? '🚗';
  const label   = SERVICE_LABELS[job.serviceType] ?? job.serviceType;
  const urgency = ['P1', 'EMERGENCY'].includes(job.priority) ? '🚨 *EMERGENCY* — ' : '';

  return (
    `${icon} *${urgency}New Job Assignment*\n` +
    `─────────────────────\n` +
    `📋 Service: ${label}\n` +
    `⚡ Priority: ${job.priority}\n` +
    (job.pickupLat ? `📍 Pickup: ${job.pickupLat.toFixed(5)}, ${job.pickupLng?.toFixed(5)}\n` : '') +
    `🕐 ETA to pickup: ~${candidate.etaMinutes} min\n` +
    `📏 Distance: ${candidate.distanceKm.toFixed(1)} km\n` +
    `─────────────────────\n` +
    `✅ *Accept:* ${acceptUrl}\n` +
    `❌ *Reject:* ${rejectUrl}\n` +
    `─────────────────────\n` +
    `⏳ Response required within 6 minutes`
  );
}

/** Send WhatsApp notification via integration-configs API */
async function sendWhatsApp(
  driverPhone: string,
  message: string,
  baseUrl: string,
): Promise<void> {
  // Calls our existing WhatsApp send API
  await fetch(`${baseUrl}/api/whatsapp/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: driverPhone, message, type: 'dispatch' }),
  });
}

/** Send push notification via FCM-compatible endpoint */
async function sendPushNotification(
  driverId: string,
  job: DispatchJob,
  acceptToken: string,
  baseUrl: string,
): Promise<void> {
  await fetch(`${baseUrl}/api/push/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      driverId,
      title:   `New ${SERVICE_LABELS[job.serviceType]} Assignment`,
      body:    `Tap to accept — ETA available in app`,
      data: {
        type:        'DISPATCH_OFFER',
        jobId:       job.id,
        serviceType: job.serviceType,
        priority:    job.priority,
        acceptToken,
      },
    }),
  });
}

/**
 * Notify driver via both WhatsApp and push notification.
 * Fully fire-and-forget — errors are caught and logged but never re-thrown.
 */
export async function notifyDriver(
  candidate:   Candidate,
  job:         DispatchJob,
  acceptToken: string,
  baseUrl:     string,
  driverPhone?: string,
): Promise<void> {
  const acceptUrl = buildAcceptUrl(baseUrl, acceptToken, 'accept');
  const rejectUrl = buildAcceptUrl(baseUrl, acceptToken, 'reject');
  const message   = buildDriverMessage(job, candidate, acceptUrl, rejectUrl);

  const tasks: Promise<void>[] = [
    // Push (React Native app)
    sendPushNotification(candidate.driverId, job, acceptToken, baseUrl).catch(e =>
      console.error('[dispatch/notify] Push failed:', e)
    ),
  ];

  // WhatsApp — only if phone number is available
  if (driverPhone) {
    tasks.push(
      sendWhatsApp(driverPhone, message, baseUrl).catch(e =>
        console.error('[dispatch/notify] WhatsApp failed:', e)
      )
    );
  }

  await Promise.allSettled(tasks);
}

/**
 * Notify customer of dispatch status change.
 * Used for accepted, escalated, cancelled events.
 */
export async function notifyCustomer(
  customerPhone: string,
  event: 'ACCEPTED' | 'ESCALATED' | 'CANCELLED' | 'DRIVER_ARRIVED',
  job:   DispatchJob,
  candidate?: Candidate,
  baseUrl = '',
): Promise<void> {
  const messages: Record<string, string> = {
    ACCEPTED:  `✅ Your ${SERVICE_LABELS[job.serviceType]} has been assigned. Driver ETA: ~${candidate?.etaMinutes ?? '?'} min.`,
    ESCALATED: `⚠️ We are working to find the nearest available unit for your ${SERVICE_LABELS[job.serviceType]} request. A dispatcher will contact you shortly.`,
    CANCELLED: `❌ Your ${SERVICE_LABELS[job.serviceType]} booking has been cancelled. Please contact support if this is unexpected.`,
    DRIVER_ARRIVED: `🚗 Your driver has arrived. Please proceed to the pickup point.`,
  };

  const text = messages[event];
  if (!text || !customerPhone) return;

  await fetch(`${baseUrl}/api/whatsapp/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: customerPhone, message: text, type: 'dispatch_status' }),
  }).catch(e => console.error('[dispatch/notify] Customer notification failed:', e));
}
