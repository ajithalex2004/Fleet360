/**
 * Staff transport trip notices (bus-ops schedules): which email template
 * each notice uses and the values it is filled with. The wording itself is
 * the tenant's (Admin > Email templates > Staff transport); WhatsApp and
 * SMS get the same text as the email.
 */
import { escapeHtml, type EmailBlock } from '@/lib/email-templates/render';
import type { EmailLocale } from '@/lib/email-templates/catalogue';

export const TRIP_NOTICE_KINDS = ['DELAY', 'CANCELLED', 'ROUTE_CHANGE', 'DEPARTURE_REMINDER', 'CUSTOM'] as const;
export type TripNoticeKind = (typeof TRIP_NOTICE_KINDS)[number];

export const TRIP_NOTICE_KEY: Record<TripNoticeKind, string> = {
  DELAY: 'staff_transport.trip_delay',
  CANCELLED: 'staff_transport.trip_cancelled',
  ROUTE_CHANGE: 'staff_transport.route_change',
  DEPARTURE_REMINDER: 'staff_transport.departure_reminder',
  CUSTOM: 'staff_transport.trip_update',
};

export const SEAT_CONFIRMED_KEY = 'staff_transport.seat_confirmed';
export const OPS_SUMMARY_KEY = 'staff_transport.ops_summary';

const NOTICE_LABEL: Record<TripNoticeKind, Record<EmailLocale, string>> = {
  DELAY: { en: 'Delay', ar: 'تأخير' },
  CANCELLED: { en: 'Cancellation', ar: 'إلغاء' },
  ROUTE_CHANGE: { en: 'Route change', ar: 'تغيير المسار' },
  DEPARTURE_REMINDER: { en: 'Departure reminder', ar: 'تذكير بموعد الانطلاق' },
  CUSTOM: { en: 'Message', ar: 'رسالة' },
};

export const noticeLabel = (kind: TripNoticeKind, locale: EmailLocale) => NOTICE_LABEL[kind][locale];

/** HH:MM of a departure (server time, as the dispatcher screens show it). */
export function formatTripTime(value: Date | string | null | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] ?? '';

/** Values of a passenger notice (staffName is added per recipient). */
export function tripNoticeValues(kind: TripNoticeKind, trip: {
  tripNumber: string; routeName: string | null; departure: Date;
  delayMinutes?: number; newDeparture?: string | null; reason?: string | null; message?: string | null;
}): Record<string, string> {
  const values: Record<string, string> = {
    tripNumber: trip.tripNumber,
    routeName: trip.routeName ?? '',
    departureTime: formatTripTime(trip.departure),
    reason: trip.reason?.trim() ?? '',
  };
  if (kind === 'DELAY') {
    values.delayMinutes = trip.delayMinutes !== undefined ? String(trip.delayMinutes) : '?';
    values.newDepartureTime = formatTripTime(trip.newDeparture);
  }
  if (kind === 'ROUTE_CHANGE') values.newDepartureTime = formatTripTime(trip.newDeparture) || values.departureTime;
  if (kind === 'CUSTOM') values.message = trip.message ?? '';
  return values;
}

/** A plain-text message shown as a quoted box (the ops summary's copy of the notice). */
export function quotedTextBlock(text: string): EmailBlock {
  return {
    html: `<div style="margin:0 0 16px;padding:12px 16px;border-inline-start:3px solid #cbd5e1;background:#f8fafc;color:#374151;font-size:14px;line-height:1.6;">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`,
    text: text.split('\n').map((l) => `> ${l}`).join('\n'),
  };
}
