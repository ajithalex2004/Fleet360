export type NotificationChannel = 'WHATSAPP' | 'SMS' | 'EMAIL' | 'IN_APP';

export type NotificationTrigger =
  | 'BOOKING_SUBMITTED'
  | 'BOOKING_CONFIRMED'
  | 'DRIVER_ASSIGNED'
  | 'DRIVER_ARRIVED'
  | 'TRIP_COMPLETED';

export interface NotificationPayload {
  bookingRef: string;
  requestorName: string;
  serviceType: string;
  vehicleCategory?: string;
  driverName?: string;
  driverPhone?: string;
  vehiclePlate?: string;
  vehicleModel?: string;
  pickupLocation?: string;
  destinationLocation?: string;
  pickupTime?: string;
  totalFareAed?: number;
  trackingUrl?: string;
  invoiceUrl?: string;
}

export interface WhatsAppMessage {
  recipientPhone: string;
  templateName: string;
  header: string;
  body: string;
  footer: string;
  actionButtons: Array<{ type: 'URL' | 'PHONE' | 'QUICK_REPLY'; label: string; value: string }>;
}

export interface SmsMessage {
  recipientPhone: string;
  messageText: string;
  shortLink: string;
}

export interface EmailMessage {
  recipientEmail: string;
  subject: string;
  htmlContent: string;
}

export interface ChatMessage {
  id: string;
  bookingRef: string;
  sender: 'PASSENGER' | 'DRIVER' | 'DISPATCHER' | 'SYSTEM';
  senderName: string;
  text: string;
  timestamp: string;
}

export const PASSENGER_QUICK_CHIPS = [
  '📍 Waiting at Terminal 3 Gate 4',
  '✈️ Flight delayed by 20 mins',
  '🧳 Need luggage assistance',
  '👋 I am walking out of arrivals now',
  '🏢 Waiting at building main lobby',
];

export const DRIVER_QUICK_CHIPS = [
  '🚗 Arrived at pickup point',
  '📋 Holding your name board in arrivals',
  '⏳ In traffic, ETA 5 minutes',
  '🟢 Ready for departure',
];

export function buildWhatsAppNotification(
  trigger: NotificationTrigger,
  payload: NotificationPayload,
  phone: string
): WhatsAppMessage {
  const ref = payload.bookingRef || 'FLT-BOOKING';
  const trackingUrl = payload.trackingUrl || `https://fleet360.io/track/${ref}`;
  const invoiceUrl = payload.invoiceUrl || `https://fleet360.io/invoice/${ref}`;

  switch (trigger) {
    case 'DRIVER_ASSIGNED':
      return {
        recipientPhone: phone,
        templateName: 'driver_assigned_v2',
        header: `🚗 Chauffeur Assigned · ${ref}`,
        body: `Dear ${payload.requestorName},\n\nYour chauffeur *${payload.driverName || 'Ahmed Al-Sayed'}* has been dispatched.\n\n• *Vehicle:* ${payload.vehicleModel || 'Lexus ES300h'} (${payload.vehiclePlate || 'DXB A 10293'})\n• *Pickup:* ${payload.pickupLocation || 'Dubai Airport T3'}\n• *Time:* ${payload.pickupTime || 'Immediate'}\n\nTrack your vehicle live on the interactive map below.`,
        footer: 'Fleet360 Enterprise Mobility Platform',
        actionButtons: [
          { type: 'URL', label: '📍 View Live Map', value: trackingUrl },
          { type: 'PHONE', label: '📞 Call Chauffeur', value: payload.driverPhone || '+971501234567' },
        ],
      };

    case 'DRIVER_ARRIVED':
      return {
        recipientPhone: phone,
        templateName: 'driver_arrived_v2',
        header: `📍 Chauffeur Arrived · ${ref}`,
        body: `Dear ${payload.requestorName},\n\nYour driver *${payload.driverName || 'Ahmed'}* has arrived at *${payload.pickupLocation || 'Pickup Point'}*.\n\n• *Vehicle:* ${payload.vehicleModel || 'Mercedes S-Class'} (${payload.vehiclePlate || 'DXB K 8892'})\n\nPlease proceed to meet your chauffeur.`,
        footer: 'Fleet360 Enterprise Mobility',
        actionButtons: [
          { type: 'URL', label: '📍 Open Vehicle Pin', value: trackingUrl },
          { type: 'PHONE', label: '📞 Call Chauffeur', value: payload.driverPhone || '+971501234567' },
        ],
      };

    case 'TRIP_COMPLETED':
      return {
        recipientPhone: phone,
        templateName: 'trip_completed_v2',
        header: `✅ Trip Completed · ${ref}`,
        body: `Dear ${payload.requestorName},\n\nYour journey to *${payload.destinationLocation || 'Destination'}* is complete.\n\n• *Total Fare:* AED ${(payload.totalFareAed || 0).toFixed(2)} (incl. 5% VAT)\n• *Status:* Billed to Corporate Account\n\nYour official UAE FTA Tax Invoice is ready.`,
        footer: 'Fleet360 Corporate Mobility',
        actionButtons: [
          { type: 'URL', label: '📄 Download Tax Invoice', value: invoiceUrl },
        ],
      };

    case 'BOOKING_CONFIRMED':
    default:
      return {
        recipientPhone: phone,
        templateName: 'booking_confirmed_v2',
        header: `✅ Booking Confirmed · ${ref}`,
        body: `Dear ${payload.requestorName},\n\nYour booking request for *${payload.serviceType}* (${payload.vehicleCategory || 'Standard'}) has been approved.\n\n• *From:* ${payload.pickupLocation || 'Dubai'}\n• *To:* ${payload.destinationLocation || 'Destination'}\n• *Estimated Fare:* AED ${(payload.totalFareAed || 0).toFixed(2)}\n\nWe will notify you when your chauffeur is on the way.`,
        footer: 'Fleet360 Enterprise Mobility',
        actionButtons: [
          { type: 'URL', label: '📋 View Booking Details', value: trackingUrl },
        ],
      };
  }
}

export function buildSmsNotification(
  trigger: NotificationTrigger,
  payload: NotificationPayload,
  phone: string
): SmsMessage {
  const ref = payload.bookingRef || 'FLT-BOOKING';
  const shortLink = `https://flt.ly/t/${ref}`;

  switch (trigger) {
    case 'DRIVER_ASSIGNED':
      return {
        recipientPhone: phone,
        messageText: `Fleet360: Chauffeur ${payload.driverName || 'Ahmed'} (${payload.vehiclePlate || 'DXB 10293'}) is dispatched for booking ${ref}. Live map: ${shortLink}`,
        shortLink,
      };

    case 'DRIVER_ARRIVED':
      return {
        recipientPhone: phone,
        messageText: `Fleet360: Your driver is waiting at ${payload.pickupLocation || 'Pickup Point'} (${payload.vehiclePlate || 'DXB 8892'}). Ref: ${ref} · Live: ${shortLink}`,
        shortLink,
      };

    case 'TRIP_COMPLETED':
      return {
        recipientPhone: phone,
        messageText: `Fleet360: Trip ${ref} completed. Total: AED ${(payload.totalFareAed || 0).toFixed(2)}. Tax Invoice: ${shortLink}`,
        shortLink,
      };

    case 'BOOKING_CONFIRMED':
    default:
      return {
        recipientPhone: phone,
        messageText: `Fleet360: Booking ${ref} confirmed for ${payload.serviceType}. Est. Total: AED ${(payload.totalFareAed || 0).toFixed(2)}. Details: ${shortLink}`,
        shortLink,
      };
  }
}
