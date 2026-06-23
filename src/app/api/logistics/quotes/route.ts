import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { LogisticsValidationError } from '@/lib/logistics/domain';
import { logisticsErrorResponse } from '@/lib/logistics/api-context';

/**
 * Freight Quotation API
 * GET  /api/logistics/quotes        — list all quotes
 * POST /api/logistics/quotes        — create a new quote
 * POST /api/logistics/quotes/calculate — calculate freight cost (no save)
 */

// ── Rate matrix (AED per km per tonne) ───────────────────────────────────────
const BASE_RATE_PER_KM_PER_TONNE: Record<string, number> = {
  FTL:     2.80,
  LTL:     4.20,
  FCL:     3.10,
  LCL:     5.50,
  REEFER:  6.80,
  SPECIAL: 9.50,
};

const VEHICLE_TYPE_FACTOR: Record<string, number> = {
  'Small Van (< 1 ton)':      0.8,
  'Medium Van (1–3 ton)':     1.0,
  'Light Truck (3–7 ton)':    1.2,
  'Heavy Truck (7–20 ton)':   1.5,
  'Flatbed / Low-bed':        1.6,
  'Tanker':                   1.4,
  'Reefer Truck':             1.7,
  'Any Available':            1.0,
};

const URGENCY_SURCHARGE   = 0.25;  // +25% for urgent
const HAZMAT_SURCHARGE    = 0.30;  // +30% for hazmat
const INSURANCE_RATE      = 0.005; // 0.5% of cargo value
const CUSTOMS_FIXED       = 350;   // AED fixed for customs clearance
const FUEL_SURCHARGE_PCT  = 0.08;  // 8%

export interface FreightCalculation {
  baseFreight:       number;
  fuelSurcharge:     number;
  urgencySurcharge:  number;
  hazmatSurcharge:   number;
  insuranceFee:      number;
  customsFee:        number;
  totalAED:          number;
  breakdown:         { label: string; amount: number }[];
}

export function calculateFreight(params: {
  distanceKm: number;
  weightTonnes: number;
  shipmentType: string;
  vehicleType?: string;
  isUrgent?: boolean;
  isHazmat?: boolean;
  requiresInsurance?: boolean;
  requiresCustoms?: boolean;
  cargoValueAED?: number;
}): FreightCalculation {
  const {
    distanceKm, weightTonnes, shipmentType,
    vehicleType = 'Any Available',
    isUrgent = false, isHazmat = false,
    requiresInsurance = false, requiresCustoms = false,
    cargoValueAED = 0,
  } = params;

  const ratePerKmTonne = BASE_RATE_PER_KM_PER_TONNE[shipmentType] ?? BASE_RATE_PER_KM_PER_TONNE.FTL;
  const vFactor        = VEHICLE_TYPE_FACTOR[vehicleType] ?? 1.0;

  const baseFreight        = Math.round(distanceKm * weightTonnes * ratePerKmTonne * vFactor);
  const fuelSurcharge      = Math.round(baseFreight * FUEL_SURCHARGE_PCT);
  const urgencySurcharge   = isUrgent  ? Math.round(baseFreight * URGENCY_SURCHARGE) : 0;
  const hazmatSurcharge    = isHazmat  ? Math.round(baseFreight * HAZMAT_SURCHARGE)  : 0;
  const insuranceFee       = requiresInsurance && cargoValueAED > 0
    ? Math.round(cargoValueAED * INSURANCE_RATE) : 0;
  const customsFee         = requiresCustoms ? CUSTOMS_FIXED : 0;

  const totalAED = baseFreight + fuelSurcharge + urgencySurcharge + hazmatSurcharge + insuranceFee + customsFee;

  const breakdown = [
    { label: 'Base Freight',     amount: baseFreight },
    { label: 'Fuel Surcharge',   amount: fuelSurcharge },
    ...(urgencySurcharge   ? [{ label: 'Urgency Surcharge (+25%)', amount: urgencySurcharge }]   : []),
    ...(hazmatSurcharge    ? [{ label: 'Hazmat Handling (+30%)',   amount: hazmatSurcharge }]    : []),
    ...(insuranceFee       ? [{ label: 'Cargo Insurance (0.5%)',   amount: insuranceFee }]       : []),
    ...(customsFee         ? [{ label: 'Customs Clearance',        amount: customsFee }]         : []),
  ];

  return { baseFreight, fuelSurcharge, urgencySurcharge, hazmatSurcharge, insuranceFee, customsFee, totalAED, breakdown };
}

// ── Table bootstrap ───────────────────────────────────────────────────────────

async function ensureTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS logistics_quotes (
      id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      quote_no        TEXT NOT NULL UNIQUE,
      customer_name   TEXT,
      customer_email  TEXT,
      customer_phone  TEXT,
      origin          TEXT,
      destination     TEXT,
      distance_km     NUMERIC,
      weight_tonnes   NUMERIC,
      shipment_type   TEXT,
      vehicle_type    TEXT,
      cargo_desc      TEXT,
      cargo_value_aed NUMERIC DEFAULT 0,
      is_urgent       BOOLEAN DEFAULT FALSE,
      is_hazmat       BOOLEAN DEFAULT FALSE,
      requires_insurance BOOLEAN DEFAULT FALSE,
      requires_customs   BOOLEAN DEFAULT FALSE,
      base_freight    NUMERIC,
      fuel_surcharge  NUMERIC,
      urgency_surch   NUMERIC DEFAULT 0,
      hazmat_surch    NUMERIC DEFAULT 0,
      insurance_fee   NUMERIC DEFAULT 0,
      customs_fee     NUMERIC DEFAULT 0,
      total_aed       NUMERIC,
      status          TEXT DEFAULT 'DRAFT',
      valid_days      INT DEFAULT 7,
      booking_id      TEXT,
      notes           TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`).catch(() => {});
}

// ── Handlers ──────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    await ensureTable();
    const quotes = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT id, quote_no, customer_name, customer_email, origin, destination,
              distance_km, weight_tonnes, shipment_type, total_aed, status,
              valid_days, booking_id, created_at
       FROM logistics_quotes
       ORDER BY created_at DESC
       LIMIT 100`
    ).catch(() => [] as Array<Record<string, unknown>>);

    return NextResponse.json(quotes.map(q => ({
      ...q,
      distance_km:   q.distance_km   != null ? Number(q.distance_km)   : null,
      weight_tonnes: q.weight_tonnes != null ? Number(q.weight_tonnes) : null,
      total_aed:     q.total_aed     != null ? Number(q.total_aed)     : null,
      created_at:    q.created_at instanceof Date ? q.created_at.toISOString() : q.created_at,
    })));
  } catch (err) {
    console.error('[quotes GET]', err);
    return NextResponse.json([]);
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureTable();
    const body = await req.json() as {
      action?: 'calculate' | 'save';
      customerName?: string;
      customerEmail?: string;
      customerPhone?: string;
      origin?: string;
      destination?: string;
      distanceKm: number;
      weightTonnes: number;
      shipmentType: string;
      vehicleType?: string;
      cargoDesc?: string;
      cargoValueAED?: number;
      isUrgent?: boolean;
      isHazmat?: boolean;
      requiresInsurance?: boolean;
      requiresCustoms?: boolean;
      validDays?: number;
      notes?: string;
    };
    const distanceKm = Number(body.distanceKm);
    const weightTonnes = Number(body.weightTonnes);
    const cargoValueAED = Number(body.cargoValueAED ?? 0);
    const validDays = Number(body.validDays ?? 7);
    const issues: string[] = [];

    if (!Number.isFinite(distanceKm) || distanceKm <= 0) issues.push('Distance must be greater than zero.');
    if (!Number.isFinite(weightTonnes) || weightTonnes <= 0) issues.push('Weight must be greater than zero.');
    if (!String(body.shipmentType ?? '').trim()) issues.push('Shipment type is required.');
    if (!Number.isFinite(cargoValueAED) || cargoValueAED < 0) issues.push('Cargo value cannot be negative.');
    if (!Number.isFinite(validDays) || validDays <= 0) issues.push('Quote validity must be greater than zero days.');
    if (body.action !== 'calculate') {
      if (!String(body.customerName ?? '').trim()) issues.push('Customer name is required to save a quote.');
      if (!String(body.origin ?? '').trim()) issues.push('Origin is required to save a quote.');
      if (!String(body.destination ?? '').trim()) issues.push('Destination is required to save a quote.');
    }
    if (issues.length > 0) throw new LogisticsValidationError(issues);

    const calc = calculateFreight({
      distanceKm,
      weightTonnes,
      shipmentType:       body.shipmentType,
      vehicleType:        body.vehicleType,
      isUrgent:           body.isUrgent,
      isHazmat:           body.isHazmat,
      requiresInsurance:  body.requiresInsurance,
      requiresCustoms:    body.requiresCustoms,
      cargoValueAED,
    });

    // Calculate-only mode
    if (body.action === 'calculate') {
      return NextResponse.json(calc);
    }

    // Save quote
    const dateStr = new Date().toISOString().replace(/\D/g, '').slice(0, 8);
    const rand    = Math.floor(Math.random() * 9000 + 1000);
    const quoteNo = `QT-${dateStr}-${rand}`;

    await prisma.$executeRawUnsafe(
      `INSERT INTO logistics_quotes (
         quote_no, customer_name, customer_email, customer_phone,
         origin, destination, distance_km, weight_tonnes, shipment_type, vehicle_type,
         cargo_desc, cargo_value_aed, is_urgent, is_hazmat, requires_insurance, requires_customs,
         base_freight, fuel_surcharge, urgency_surch, hazmat_surch, insurance_fee, customs_fee,
         total_aed, valid_days, notes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
      quoteNo,
      body.customerName ?? null, body.customerEmail ?? null, body.customerPhone ?? null,
      body.origin ?? null, body.destination ?? null,
      distanceKm, weightTonnes, body.shipmentType, body.vehicleType ?? null,
      body.cargoDesc ?? null, cargoValueAED,
      body.isUrgent ?? false, body.isHazmat ?? false,
      body.requiresInsurance ?? false, body.requiresCustoms ?? false,
      calc.baseFreight, calc.fuelSurcharge, calc.urgencySurcharge, calc.hazmatSurcharge,
      calc.insuranceFee, calc.customsFee, calc.totalAED,
      validDays, body.notes ?? null
    );

    return NextResponse.json({ success: true, quoteNo, ...calc }, { status: 201 });
  } catch (err) {
    console.error('[quotes POST]', err);
    return logisticsErrorResponse(err, 'Failed to process quote');
  }
}
