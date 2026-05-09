/**
 * WhatsApp messaging via Twilio's REST API.
 *
 * Uses fetch (no SDK dep). Reads TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and
 * TWILIO_WHATSAPP_NUMBER from env. If any are missing the helpers no-op and
 * return { sent: false, reason: 'not_configured' } so dev environments and
 * tenants without Twilio can run without errors.
 *
 * All sends are best-effort — failures are logged to Sentry but never thrown
 * into request handlers, so booking confirms / activations don't fail because
 * of a transient WhatsApp outage.
 */

import { captureException } from './sentry';

export interface WhatsAppSendResult {
  sent: boolean;
  sid?: string;
  reason?: 'not_configured' | 'no_phone' | 'twilio_error' | 'network_error';
  error?: string;
}

interface BookingForMessage {
  bookingRef: string | null;
  pickupDate: Date;
  dropoffDate: Date;
  pickupLocation: string | null;
  dropoffLocation: string | null;
  vehicleCategory: string | null;
  totalAmount: number | null;
  currency: string;
}

interface CustomerForMessage {
  fullName: string | null;
  phone: string | null;
}

/**
 * Format a phone number into Twilio WhatsApp format:
 *   "whatsapp:+971501234567"
 * Strips non-digits except leading +. Returns null if the number is too short
 * to be a real international number.
 */
function formatWhatsAppTo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Keep leading + plus digits.
  let cleaned = trimmed.startsWith('+') ? '+' + trimmed.slice(1).replace(/\D/g, '') : trimmed.replace(/\D/g, '');
  // If no + and no country code, assume UAE (+971) — common for our market.
  if (!cleaned.startsWith('+')) {
    if (cleaned.startsWith('0')) cleaned = cleaned.slice(1);
    if (cleaned.startsWith('971')) cleaned = '+' + cleaned;
    else if (cleaned.length >= 9) cleaned = '+971' + cleaned;
  }
  // Sanity: at least + and 8 digits
  if (cleaned.length < 9) return null;
  return `whatsapp:${cleaned}`;
}

/** Low-level send. Public so other modules (e.g. dunning) can reuse. */
export async function sendWhatsApp(opts: { to: string; body: string }): Promise<WhatsAppSendResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_NUMBER;
  if (!sid || !token || !from) {
    return { sent: false, reason: 'not_configured' };
  }
  const to = formatWhatsAppTo(opts.to);
  if (!to) return { sent: false, reason: 'no_phone' };

  const fromFmt = from.startsWith('whatsapp:') ? from : `whatsapp:${from}`;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const form = new URLSearchParams({ From: fromFmt, To: to, Body: opts.body });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    if (!res.ok) {
      const text = await res.text();
      const err = new Error(`Twilio ${res.status}: ${text.slice(0, 300)}`);
      captureException(err, { context: 'whatsapp.send', tags: { status: String(res.status) } });
      return { sent: false, reason: 'twilio_error', error: err.message };
    }
    const json = (await res.json()) as { sid?: string };
    return { sent: true, sid: json.sid };
  } catch (err) {
    captureException(err, { context: 'whatsapp.send' });
    return {
      sent: false,
      reason: 'network_error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

const fmtDate = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
  ' ' +
  d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });

const fmtMoney = (amount: number | null, currency: string) =>
  amount == null ? '—' : `${currency} ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Booking has been confirmed — vehicle reserved, agreement drafted. */
export async function sendBookingConfirmedWhatsApp(
  customer: CustomerForMessage,
  booking: BookingForMessage,
): Promise<WhatsAppSendResult> {
  if (!customer.phone) return { sent: false, reason: 'no_phone' };
  const ref = booking.bookingRef ?? '—';
  const veh = booking.vehicleCategory ?? 'your selected vehicle';
  const body =
    `✅ Booking Confirmed — ${ref}\n\n` +
    `Hi ${customer.fullName ?? 'there'},\n\n` +
    `Your rental is confirmed:\n` +
    `🚗 ${veh}\n` +
    `📍 Pickup: ${booking.pickupLocation ?? 'TBD'}\n` +
    `🕐 ${fmtDate(booking.pickupDate)}\n` +
    `🔁 Return: ${booking.dropoffLocation ?? 'same'}, ${fmtDate(booking.dropoffDate)}\n` +
    `💰 Total: ${fmtMoney(booking.totalAmount, booking.currency)}\n\n` +
    `Please bring a valid driving licence and credit card. Reply to this message for any changes.\n\n` +
    `— Fleet360`;
  return sendWhatsApp({ to: customer.phone, body });
}

/** Booking has been activated — vehicle handed over. */
export async function sendBookingActivatedWhatsApp(
  customer: CustomerForMessage,
  booking: BookingForMessage,
): Promise<WhatsAppSendResult> {
  if (!customer.phone) return { sent: false, reason: 'no_phone' };
  const ref = booking.bookingRef ?? '—';
  const body =
    `🚗 Rental Started — ${ref}\n\n` +
    `Hi ${customer.fullName ?? 'there'}, your vehicle is on the road.\n\n` +
    `🔁 Return by ${fmtDate(booking.dropoffDate)}\n` +
    `📍 Drop-off: ${booking.dropoffLocation ?? 'pickup branch'}\n\n` +
    `Drive safely. For roadside assistance call our 24/7 line. Salik tolls and traffic fines incurred during the rental are billed to you.\n\n` +
    `— Fleet360`;
  return sendWhatsApp({ to: customer.phone, body });
}

/** 24h before drop-off — return reminder. */
export async function sendBookingReturnReminderWhatsApp(
  customer: CustomerForMessage,
  booking: BookingForMessage,
): Promise<WhatsAppSendResult> {
  if (!customer.phone) return { sent: false, reason: 'no_phone' };
  const ref = booking.bookingRef ?? '—';
  const body =
    `⏰ Return Reminder — ${ref}\n\n` +
    `Hi ${customer.fullName ?? 'there'}, your vehicle is due back tomorrow.\n\n` +
    `🔁 ${fmtDate(booking.dropoffDate)}\n` +
    `📍 ${booking.dropoffLocation ?? 'pickup branch'}\n\n` +
    `Late returns incur hourly charges past the 30-minute grace window. Need an extension? Reply to this message.\n\n` +
    `— Fleet360`;
  return sendWhatsApp({ to: customer.phone, body });
}
