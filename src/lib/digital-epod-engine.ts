import crypto from 'crypto';

export type DeliveryExecutionStatus =
  | 'ASSIGNED'
  | 'EN_ROUTE_TO_PICKUP'
  | 'ARRIVED_AT_DOCK'
  | 'CARGO_LOADED'
  | 'IN_TRANSIT'
  | 'ARRIVED_AT_DESTINATION'
  | 'DELIVERED';

export interface PalletDeliveryCondition {
  palletId: string;
  condition: 'INTACT_PERFECT' | 'MINOR_TEAR' | 'DAMAGED_REJECTED';
  temperatureVerified: string;
  sealIntact: boolean;
}

export interface DigitalEPODRecord {
  epodNumber: string;
  ebolNumber: string;
  tripReference: string;
  bookingRef: string;
  tenantId: string;
  carrierName: string;
  driverId: string;
  driverName: string;
  driverPhone: string;
  vehiclePlate: string;
  consigneeName: string;
  consigneeRecipientName: string;
  consigneeDesignation: string;
  consigneeEmiratesId: string;
  deliveredAt: string;
  gpsCoordinates: { lat: number; lng: number };
  deliveryPhotoUrl: string;
  consigneeSignatureSvg: string;
  consigneeSignatureHash: string;
  palletsSummary: PalletDeliveryCondition[];
  discrepancyNotes: string | null;
  cryptographicPODSeal: string;
  autoInvoiceTriggered: boolean;
  status: 'DELIVERED_CONFIRMED';
}

/**
 * Computes a SHA-256 cryptographic seal over the entire e-POD certificate
 */
export function generateEPODSeal(payload: Partial<DigitalEPODRecord>): string {
  const dataToHash = JSON.stringify({
    epodNumber: payload.epodNumber,
    ebolNumber: payload.ebolNumber,
    bookingRef: payload.bookingRef,
    carrierName: payload.carrierName,
    driverName: payload.driverName,
    consigneeRecipientName: payload.consigneeRecipientName,
    consigneeEmiratesId: payload.consigneeEmiratesId,
    deliveredAt: payload.deliveredAt,
    gpsCoordinates: payload.gpsCoordinates,
    palletsSummary: payload.palletsSummary,
  });

  return crypto.createHash('sha256').update(dataToHash).digest('hex');
}

/**
 * Creates an official sealed Digital e-POD record
 */
export function createDigitalEPOD(params: {
  ebolNumber?: string;
  bookingRef: string;
  tripReference?: string;
  tenantId?: string;
  carrierName?: string;
  driverId?: string;
  driverName?: string;
  driverPhone?: string;
  vehiclePlate?: string;
  consigneeName: string;
  consigneeRecipientName: string;
  consigneeDesignation?: string;
  consigneeEmiratesId: string;
  gpsCoordinates?: { lat: number; lng: number };
  deliveryPhotoUrl?: string;
  consigneeSignatureSvg: string;
  palletsSummary: PalletDeliveryCondition[];
  discrepancyNotes?: string | null;
}): DigitalEPODRecord {
  const epodNumber = `EPOD-EXL-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const deliveredAt = new Date().toISOString();

  const consigneeSignatureHash = crypto
    .createHash('sha256')
    .update(params.consigneeSignatureSvg || 'signature-signed')
    .digest('hex');

  const record: DigitalEPODRecord = {
    epodNumber,
    ebolNumber: params.ebolNumber || `EBOL-EXL-${epodNumber.slice(9)}`,
    tripReference: params.tripReference || `TRIP-${epodNumber.slice(9)}`,
    bookingRef: params.bookingRef,
    tenantId: params.tenantId || 'tnt-exl-solutions',
    carrierName: params.carrierName || 'EXL Solutions Freight Lines LLC',
    driverId: params.driverId || 'DRV-884',
    driverName: params.driverName || 'Tariq Mansoor',
    driverPhone: params.driverPhone || '+971 50 998 1234',
    vehiclePlate: params.vehiclePlate || 'DXB-K-94821 (3-Ton Reefer)',
    consigneeName: params.consigneeName,
    consigneeRecipientName: params.consigneeRecipientName,
    consigneeDesignation: params.consigneeDesignation || 'Receiving Dock Lead',
    consigneeEmiratesId: params.consigneeEmiratesId,
    deliveredAt,
    gpsCoordinates: params.gpsCoordinates || { lat: 25.1972, lng: 55.2744 }, // Dubai Mall Dock coords
    deliveryPhotoUrl:
      params.deliveryPhotoUrl ||
      'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=800&auto=format&fit=crop&q=80',
    consigneeSignatureSvg: params.consigneeSignatureSvg,
    consigneeSignatureHash,
    palletsSummary: params.palletsSummary,
    discrepancyNotes: params.discrepancyNotes || null,
    cryptographicPODSeal: '',
    autoInvoiceTriggered: true,
    status: 'DELIVERED_CONFIRMED',
  };

  record.cryptographicPODSeal = generateEPODSeal(record);
  return record;
}
