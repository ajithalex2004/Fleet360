/**
 * Logistics trip notification utility.
 * Sends WhatsApp and email alerts when a logistics trip changes status.
 * Uses the existing /api/notifications/whatsapp and /api/notifications/send endpoints.
 * All calls are fire-and-forget (best-effort) — failures never block trip operations.
 */

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

// ── Message templates ─────────────────────────────────────────────────────────

const STATUS_MESSAGES: Record<string, (ref: string, extra?: string) => string> = {
  CRITICAL_SLA: (ref) => `🚨 *SLA BREACH — CRITICAL*: Trip *${ref}* is more than 4 hours past its delivery deadline. Immediate action required.`,
  APPROVED:         (ref) => `✅ Your logistics trip *${ref}* has been approved and is being prepared for dispatch.`,
  ASSIGNED:         (ref, driver?) => `👤 Trip *${ref}* has been assigned to driver ${driver ?? 'our team'}.`,
  DISPATCHED:       (ref, vehicle?) => `🚦 Trip *${ref}* has been dispatched. Vehicle: ${vehicle ?? 'assigned vehicle'} is on its way.`,
  ENROUTE_PICKUP:   (ref) => `🗺️ Driver is en-route to the pickup location for trip *${ref}*.`,
  LOADED:           (ref) => `📦 Cargo for trip *${ref}* has been loaded and secured.`,
  ENROUTE_DELIVERY: (ref) => `🚛 Trip *${ref}* is now en-route to the delivery destination.`,
  DELIVERED:        (ref) => `📍 Trip *${ref}* — cargo has been delivered. POD confirmation pending.`,
  POD_SUBMITTED:    (ref) => `📝 Proof of Delivery submitted for trip *${ref}*. Trip is being closed.`,
  CLOSED:           (ref) => `🔒 Trip *${ref}* has been successfully closed. Thank you!`,
  CANCELLED:        (ref) => `❌ Trip *${ref}* has been cancelled. Please contact operations for assistance.`,
};

const EMAIL_SUBJECTS: Record<string, string> = {
  APPROVED:         'Trip Approved — Logistics',
  ASSIGNED:         'Driver Assigned — Logistics',
  DISPATCHED:       'Your Shipment is Dispatched',
  ENROUTE_PICKUP:   'Driver En-route to Pickup',
  LOADED:           'Cargo Loaded — En-route',
  ENROUTE_DELIVERY: 'Shipment En-route to Delivery',
  DELIVERED:        'Shipment Delivered',
  POD_SUBMITTED:    'Proof of Delivery Submitted',
  CLOSED:           'Trip Closed',
  CANCELLED:        'Trip Cancelled',
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TripNotificationPayload {
  bookingRef: string;
  toStatus: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  driverPhone?: string | null;
  driverName?: string | null;
  vehiclePlate?: string | null;
  operationsPhone?: string | null;
  operationsEmail?: string | null;
}

// ── Internal send helpers ─────────────────────────────────────────────────────

async function sendWhatsApp(to: string, message: string) {
  try {
    await fetch(`${BASE_URL}/api/notifications/whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, message }),
    });
  } catch (e) {
    console.warn('[TripNotify] WhatsApp send failed (fire-and-forget):', e);
  }
}

async function sendEmail(to: string, subject: string, body: string, triggerReason?: string) {
  try {
    await fetch(`${BASE_URL}/api/notifications/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, body, triggerReason }),
    });
  } catch (e) {
    console.warn('[TripNotify] Email send failed (fire-and-forget):', e);
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Fire-and-forget notification for trip status transitions.
 * Safe to call without await — never throws.
 */
export function notifyTripStatusChange(payload: TripNotificationPayload): void {
  const {
    bookingRef, toStatus,
    customerPhone, customerEmail,
    driverPhone, driverName,
    vehiclePlate,
    operationsPhone, operationsEmail,
  } = payload;

  const msgFn = STATUS_MESSAGES[toStatus];
  if (!msgFn) return; // No template for this status

  const waMessage    = msgFn(bookingRef, driverName ?? vehiclePlate ?? undefined);
  const emailSubject = EMAIL_SUBJECTS[toStatus] ?? `Trip ${bookingRef} Update`;
  const emailBody    = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1a1a2e;padding:24px;border-radius:12px">
        <h2 style="color:#f59e0b;margin:0 0 16px">🚛 Logistics Trip Update</h2>
        <p style="color:#e2e8f0;font-size:16px">${waMessage.replace(/\*/g, '<strong>').replace(/\*/g, '</strong>')}</p>
        <div style="background:#0f172a;border-radius:8px;padding:16px;margin-top:16px">
          <p style="color:#94a3b8;font-size:12px;margin:0">
            Booking Reference: <span style="color:#f8fafc;font-family:monospace">${bookingRef}</span>
          </p>
          ${driverName   ? `<p style="color:#94a3b8;font-size:12px;margin:4px 0 0">Driver: <span style="color:#f8fafc">${driverName}</span></p>` : ''}
          ${vehiclePlate ? `<p style="color:#94a3b8;font-size:12px;margin:4px 0 0">Vehicle: <span style="color:#f8fafc">${vehiclePlate}</span></p>` : ''}
        </div>
        <p style="color:#475569;font-size:11px;margin-top:16px">Fleet360 Platform</p>
      </div>
    </div>
  `;

  // Notify customer
  if (customerPhone) sendWhatsApp(customerPhone, waMessage);
  if (customerEmail) sendEmail(customerEmail, emailSubject, emailBody, `LOGISTICS_TRIP_${toStatus}`);

  // Notify driver on assignment / dispatch
  if (driverPhone && ['ASSIGNED', 'DISPATCHED', 'ENROUTE_PICKUP'].includes(toStatus)) {
    const driverMsg = toStatus === 'ASSIGNED'
      ? `🚛 You have been assigned to trip *${bookingRef}*. Please check the dispatch board.`
      : toStatus === 'DISPATCHED'
      ? `🚦 Trip *${bookingRef}* is dispatched. Please proceed to pickup location.`
      : `📍 Please confirm when you arrive at the pickup for trip *${bookingRef}*.`;
    sendWhatsApp(driverPhone, driverMsg);
  }

  // Notify operations on delivery + cancellation
  if (operationsPhone && ['DELIVERED', 'POD_SUBMITTED', 'CANCELLED'].includes(toStatus)) {
    sendWhatsApp(operationsPhone, `[OPS] ${waMessage}`);
  }
  if (operationsEmail && ['DELIVERED', 'POD_SUBMITTED', 'CANCELLED'].includes(toStatus)) {
    sendEmail(operationsEmail, `[OPS] ${emailSubject}`, emailBody, `LOGISTICS_OPS_${toStatus}`);
  }
}
