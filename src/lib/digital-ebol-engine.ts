import crypto from 'crypto';

export interface ConsignmentPalletItem {
  palletId: string;
  gs1Barcode: string;
  gtin?: string;
  batchLot?: string;
  serialNumber?: string;
  description: string;
  palletType: 'EURO_PALLET_EPAL' | 'ISO_STANDARD' | 'CHEP_BLUE';
  weightKg: number;
  dimensionsCm: { l: number; w: number; h: number };
  hazardousCode: string | null;
  temperatureRange: string | null;
  scannedAt: string | null;
  scannedBy: string | null;
  verificationStatus: 'PENDING' | 'VERIFIED_LOADED' | 'DAMAGED_REJECTED';
}

export interface DigitalEBOLRecord {
  ebolNumber: string;
  tripReference: string;
  bookingRef: string;
  tenantId: string;
  carrierName: string;
  carrierTradeLicense: string;
  shipperName: string;
  shipperAddress: string;
  shipperContact: string;
  consigneeName: string;
  consigneeAddress: string;
  consigneeContact: string;
  uaeCustomsDeclarationNo: string;
  vehiclePlateNumber: string;
  driverName: string;
  totalPallets: number;
  totalGrossWeightKg: number;
  items: ConsignmentPalletItem[];
  shipperSignatureHash: string;
  driverSignatureHash: string;
  consigneeSignatureHash: string | null;
  cryptographicSeal: string;
  qrVerificationUrl: string;
  issuedAt: string;
  status: 'DRAFT' | 'SEALED' | 'IN_TRANSIT' | 'DELIVERED';
}

/**
 * Parses GS1-128 Application Identifiers from barcode strings
 * Example: (01)06291100000001(10)LOT-2026-A(21)SN987654(3102)000550
 */
export function parseGs1Barcode(barcode: string): {
  gtin?: string;
  batchLot?: string;
  serialNumber?: string;
  weightKg?: number;
} {
  const result: { gtin?: string; batchLot?: string; serialNumber?: string; weightKg?: number } = {};

  // Extract GTIN (01)
  const gtinMatch = barcode.match(/\(01\)(\d{14})/);
  if (gtinMatch) result.gtin = gtinMatch[1];

  // Extract Batch/Lot (10)
  const batchMatch = barcode.match(/\(10\)([A-Za-z0-9-_]+)/);
  if (batchMatch) result.batchLot = batchMatch[1];

  // Extract Serial Number (21)
  const serialMatch = barcode.match(/\(21\)([A-Za-z0-9-_]+)/);
  if (serialMatch) result.serialNumber = serialMatch[1];

  // Extract Net Weight in kg (3102)
  const weightMatch = barcode.match(/\(3102\)(\d{6})/);
  if (weightMatch) {
    result.weightKg = parseFloat(weightMatch[1]) / 100;
  }

  return result;
}

/**
 * Computes a SHA-256 cryptographic seal over the e-BOL manifest and customs numbers
 */
export function generateEBOLSeal(payload: Partial<DigitalEBOLRecord>): string {
  const dataToHash = JSON.stringify({
    ebolNumber: payload.ebolNumber,
    carrierName: payload.carrierName,
    shipperName: payload.shipperName,
    consigneeName: payload.consigneeName,
    uaeCustomsDeclarationNo: payload.uaeCustomsDeclarationNo,
    totalGrossWeightKg: payload.totalGrossWeightKg,
    items: payload.items?.map((item) => ({
      palletId: item.palletId,
      gs1Barcode: item.gs1Barcode,
      weightKg: item.weightKg,
      verificationStatus: item.verificationStatus,
    })),
    issuedAt: payload.issuedAt,
  });

  return crypto.createHash('sha256').update(dataToHash).digest('hex');
}

/**
 * Creates an official sealed Digital e-BOL record
 */
export function createDigitalEBOL(params: {
  bookingRef: string;
  tenantId?: string;
  carrierName?: string;
  shipperName: string;
  shipperAddress: string;
  shipperContact: string;
  consigneeName: string;
  consigneeAddress: string;
  consigneeContact: string;
  uaeCustomsDeclarationNo?: string;
  vehiclePlateNumber?: string;
  driverName?: string;
  items: ConsignmentPalletItem[];
}): DigitalEBOLRecord {
  const ebolNumber = `EBOL-EXL-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const uaeCustomsDeclarationNo =
    params.uaeCustomsDeclarationNo ||
    `DEC-DXB-CUST-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
  const issuedAt = new Date().toISOString();

  let totalGrossWeightKg = 0;
  for (const item of params.items) {
    totalGrossWeightKg += item.weightKg || 0;
  }

  const dummyShipperSig = crypto
    .createHash('sha256')
    .update(`${params.shipperName}-${issuedAt}`)
    .digest('hex');
  const dummyDriverSig = crypto
    .createHash('sha256')
    .update(`${params.driverName || 'EXL Driver'}-${issuedAt}`)
    .digest('hex');

  const record: DigitalEBOLRecord = {
    ebolNumber,
    tripReference: `TRIP-${ebolNumber.slice(5)}`,
    bookingRef: params.bookingRef,
    tenantId: params.tenantId || 'tnt-exl-solutions',
    carrierName: params.carrierName || 'EXL Solutions Freight Lines LLC',
    carrierTradeLicense: 'TL-DXB-EXL-908812',
    shipperName: params.shipperName,
    shipperAddress: params.shipperAddress,
    shipperContact: params.shipperContact,
    consigneeName: params.consigneeName,
    consigneeAddress: params.consigneeAddress,
    consigneeContact: params.consigneeContact,
    uaeCustomsDeclarationNo,
    vehiclePlateNumber: params.vehiclePlateNumber || 'DXB-K-94821',
    driverName: params.driverName || 'Tariq Mansoor (EXL Driver ID #884)',
    totalPallets: params.items.length,
    totalGrossWeightKg,
    items: params.items,
    shipperSignatureHash: dummyShipperSig,
    driverSignatureHash: dummyDriverSig,
    consigneeSignatureHash: null,
    cryptographicSeal: '',
    qrVerificationUrl: `https://fleet360-app-production.up.railway.app/verify-ebol/${ebolNumber}`,
    issuedAt,
    status: 'SEALED',
  };

  record.cryptographicSeal = generateEBOLSeal(record);
  return record;
}
