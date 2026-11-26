/**
 * Customer Portal — Logistics shipments. The data comes from the Logistics
 * APIs under /api/shipper-portal/*, which accept the Customer Portal session
 * and apply the customer's tracking level (what is shown at each level is
 * decided on the server, src/lib/shipper-portal/visibility.ts).
 */

export type TrackingLevel = 'NONE' | 'STATUS_ONLY' | 'STATUS_AND_ETA' | 'FULL_TRACKING';

export interface ShipmentListItem {
  id: string;
  shipmentNo: string | null;
  status: string;
  origin: { name: string | null } | null;
  destination: { name: string | null } | null;
  pickupWindowFrom: string | null;
  deliveryWindowFrom: string | null;
  submittedAt: string;
  customerRateAmount?: number | null;
  currency?: string | null;
}

export interface ShippingRequestItem {
  id: string;
  requestNo: string;
  status: string;
  origin?: { name: string | null } | null;
  destination?: { name: string | null } | null;
  submittedAt?: string;
}

export interface ShipmentDetail {
  id: string;
  shipmentNo: string | null;
  status: string;
  submittedAt: string;
  origin?: { name: string | null; address: string | null; city: string | null; country: string | null };
  destination?: { name: string | null; address: string | null; city: string | null; country: string | null };
  pickupWindowFrom?: string | null;
  pickupWindowTo?: string | null;
  deliveryWindowFrom?: string | null;
  deliveryWindowTo?: string | null;
  cargoSummary?: string | null;
  totalWeightKg?: number | null;
  totalVolumeCbm?: number | null;
  customerRateAmount?: number | null;
  currency?: string | null;
  timeline?: Array<{ status: string; date: string; note?: string | null }>;
  estimatedDeliveryAt?: string | null;
  liveLocation?: { lat: number; lng: number; capturedAt: string; source: string } | null;
  driver?: { name: string | null; phone: string | null } | null;
  vehicle?: { plate: string | null; type: string | null } | null;
  carrierName?: string | null;
  trackingLevel: TrackingLevel;
}

export const TRACKING_LABEL: Record<TrackingLevel, string> = {
  NONE: 'Status updates are not shared for your account',
  STATUS_ONLY: 'You see the shipment status',
  STATUS_AND_ETA: 'You see the status and estimated delivery',
  FULL_TRACKING: 'You see live tracking, driver and vehicle',
};

/** "IN_TRANSIT" → "In transit". */
export const shipmentStatusLabel = (s: string) => {
  const t = s.replace(/_/g, ' ').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export function shipmentStatusTone(s: string): string {
  if (['DELIVERED', 'POD_SUBMITTED', 'CLOSED'].includes(s)) return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30';
  if (['CANCELLED', 'REJECTED'].includes(s)) return 'bg-rose-500/10 text-rose-600 border-rose-500/30';
  if (['IN_TRANSIT', 'PICKED_UP', 'AT_PICKUP', 'AT_DELIVERY', 'DISPATCHED'].includes(s)) return 'bg-cyan-500/10 text-cyan-600 border-cyan-500/30';
  if (['SUBMITTED', 'UNDER_REVIEW', 'PENDING', 'DRAFT'].includes(s)) return 'bg-amber-500/10 text-amber-600 border-amber-500/30';
  return 'bg-blue-500/10 text-blue-600 border-blue-500/30';
}

export function fmtMoney(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount == null || !Number.isFinite(Number(amount))) return '—';
  return `${currency ?? 'AED'} ${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
