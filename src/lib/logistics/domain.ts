import { prisma } from '@/lib/prisma';
import { ensureFinanceSourceLedger } from '@/lib/finance-source-ledger';
import { logAudit } from '@/lib/audit';
import { createHash, randomBytes } from 'crypto';

type JsonRecord = Record<string, unknown>;

export type LogisticsShipmentStatus =
  | 'DRAFT'
  | 'PENDING'
  | 'APPROVED'
  | 'ASSIGNED'
  | 'DISPATCHED'
  | 'ENROUTE_PICKUP'
  | 'LOADED'
  | 'ENROUTE_DELIVERY'
  | 'DELIVERED'
  | 'POD_SUBMITTED'
  | 'CLOSED'
  | 'CANCELLED';

export interface LogisticsCargoLineInput {
  description: string;
  commodityCode?: string | null;
  quantity?: number | null;
  packageType?: string | null;
  weightKg?: number | null;
  volumeCbm?: number | null;
  isHazmat?: boolean;
  tempMinC?: number | null;
  tempMaxC?: number | null;
  cargoValueAmount?: number | null;
  metadata?: JsonRecord | null;
}

export interface LogisticsStopInput {
  stopType: 'PICKUP' | 'DELIVERY' | 'INTERMEDIATE' | string;
  sequenceNo?: number;
  locationName?: string | null;
  address?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  plannedArrivalAt?: string | Date | null;
  plannedDepartAt?: string | Date | null;
  instructions?: string | null;
  metadata?: JsonRecord | null;
}

export interface LogisticsFreightChargeInput {
  chargeSide: 'CUSTOMER' | 'CARRIER' | string;
  chargeType: string;
  description?: string | null;
  quantity?: number | null;
  unitRate?: number | null;
  amount?: number | null;
  taxAmount?: number | null;
  totalAmount?: number | null;
  currency?: string | null;
  metadata?: JsonRecord | null;
}

export interface LogisticsShipmentCreateInput {
  tenantId: string;
  shipmentNo?: string | null;
  legacyBookingId?: string | null;
  cargoOwnerCustomerId?: string | null;
  cargoOwnerName?: string | null;
  cargoOwnerEmail?: string | null;
  cargoOwnerPhone?: string | null;
  shipmentType?: string | null;
  bookingMode?: 'SPOT' | 'CONTRACT' | 'RFQ' | string;
  marketplaceStatus?: 'PRIVATE' | 'DRAFT' | 'OPEN' | 'AWARDED' | 'CANCELLED' | string;
  status?: LogisticsShipmentStatus | string;
  priority?: string | null;
  originName?: string | null;
  originAddress?: string | null;
  destinationName?: string | null;
  destinationAddress?: string | null;
  pickupWindowFrom?: string | Date | null;
  pickupWindowTo?: string | Date | null;
  deliveryWindowFrom?: string | Date | null;
  deliveryWindowTo?: string | Date | null;
  requestedVehicleType?: string | null;
  totalWeightKg?: number | null;
  totalVolumeCbm?: number | null;
  cargoValueAmount?: number | null;
  currency?: string | null;
  customerRateAmount?: number | null;
  carrierCostAmount?: number | null;
  platformCommissionAmount?: number | null;
  marginAmount?: number | null;
  assignedCarrierId?: string | null;
  assignedDriverId?: string | null;
  assignedVehicleId?: string | null;
  sourceChannel?: string | null;
  notes?: string | null;
  metadata?: JsonRecord | null;
  createdBy?: string | null;
  cargoLines?: LogisticsCargoLineInput[];
  stops?: LogisticsStopInput[];
  freightCharges?: LogisticsFreightChargeInput[];
}

export interface LogisticsShipmentUpdateInput extends Partial<Omit<LogisticsShipmentCreateInput, 'tenantId' | 'createdBy'>> {
  tenantId: string;
  shipmentOrderId: string;
  updatedBy?: string | null;
}

export interface LogisticsCarrierInput {
  tenantId: string;
  carrierCode?: string | null;
  carrierType?: string | null;
  name: string;
  tradeLicense?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  status?: string | null;
  onboardingStatus?: string | null;
  complianceStatus?: string | null;
  serviceRegions?: unknown;
  capacityProfile?: unknown;
  commissionModel?: string | null;
  commissionRate?: number | null;
  marginRuleJson?: unknown;
  metadata?: JsonRecord | null;
}

export interface LogisticsCarrierDocumentInput {
  tenantId: string;
  carrierId: string;
  documentType: string;
  documentName: string;
  documentUrl: string;
  storageKey?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  status?: string | null;
  issueDate?: string | Date | null;
  expiryDate?: string | Date | null;
  metadata?: JsonRecord | null;
  actorUserId?: string | null;
}

export interface LogisticsCarrierVehicleInput {
  tenantId: string;
  carrierId: string;
  ownerDriverId?: string | null;
  vehicleCode?: string | null;
  plateNo: string;
  registrationNo?: string | null;
  vehicleType: string;
  make?: string | null;
  model?: string | null;
  year?: number | null;
  color?: string | null;
  capacityTons?: number | null;
  volumeCbm?: number | null;
  palletCapacity?: number | null;
  axleCount?: number | null;
  gpsEnabled?: boolean | null;
  gpsProvider?: string | null;
  homeRegion?: string | null;
  currentRegion?: string | null;
  availabilityStatus?: string | null;
  complianceStatus?: string | null;
  status?: string | null;
  registrationExpiry?: string | Date | null;
  insuranceExpiry?: string | Date | null;
  permitExpiry?: string | Date | null;
  inspectionExpiry?: string | Date | null;
  metadata?: JsonRecord | null;
  actorUserId?: string | null;
}

export interface LogisticsFreightRfqInput {
  tenantId: string;
  shipmentOrderId: string;
  rfqNo?: string | null;
  status?: string | null;
  inviteScope?: string | null;
  bidDeadlineAt?: string | Date | null;
  negotiationRound?: number | null;
  invitedCarrierIds?: string[];
  metadata?: JsonRecord | null;
}

export interface LogisticsCarrierBidInput {
  tenantId: string;
  shipmentOrderId: string;
  rfqId?: string | null;
  carrierId: string;
  bidNo?: string | null;
  amount: number;
  currency?: string | null;
  transitTimeHours?: number | null;
  validityUntil?: string | Date | null;
  status?: string | null;
  chargeBreakdown?: unknown;
  notes?: string | null;
}

export type LogisticsCustomerProcurementMode = 'DIRECT_ONLY' | 'RFQ_NO_BIDS' | 'RFQ_BIDDING';

export interface LogisticsCustomerMarketplaceSettingsInput {
  tenantId: string;
  customerId: string;
  customerName?: string | null;
  rfqEnabled?: boolean | null;
  bidSubmissionEnabled?: boolean | null;
  directAssignmentEnabled?: boolean | null;
  defaultProcurementMode?: LogisticsCustomerProcurementMode | string | null;
  requireRfqBeforeAward?: boolean | null;
  notes?: string | null;
  metadata?: JsonRecord | null;
  updatedBy?: string | null;
}

export interface LogisticsCustomerMarketplacePolicy {
  tenantId: string;
  customerId: string | null;
  customerName: string | null;
  rfqEnabled: boolean;
  bidSubmissionEnabled: boolean;
  directAssignmentEnabled: boolean;
  defaultProcurementMode: LogisticsCustomerProcurementMode;
  requireRfqBeforeAward: boolean;
  notes: string | null;
  configured: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface LogisticsCarrierPortalRfqFilter {
  tenantId: string;
  carrierId: string;
  rfqId?: string | null;
  status?: string | null;
  search?: string | null;
  limit?: number;
}

export interface LogisticsCarrierPortalInviteInput {
  tenantId: string;
  rfqId: string;
  carrierId: string;
  expiresAt?: string | Date | null;
  createdBy?: string | null;
  metadata?: JsonRecord | null;
}

export interface LogisticsAssignmentInput {
  tenantId: string;
  shipmentOrderId: string;
  carrierId?: string | null;
  driverId?: string | null;
  vehicleId?: string | null;
  assignmentType?: string | null;
  status?: string | null;
  costAmount?: number | null;
  currency?: string | null;
  metadata?: JsonRecord | null;
}

export interface LogisticsRateContractInput {
  tenantId: string;
  customerId?: string | null;
  customerName?: string | null;
  carrierId?: string | null;
  contractNo?: string | null;
  laneOrigin: string;
  laneDestination: string;
  vehicleType?: string | null;
  serviceLevel?: string | null;
  currency?: string | null;
  baseRate: number;
  minCharge?: number | null;
  fuelSurchargePct?: number | null;
  accessorialRules?: unknown;
  effectiveFrom?: string | Date | null;
  effectiveTo?: string | Date | null;
  status?: string | null;
  metadata?: JsonRecord | null;
}

export interface LogisticsCarrierScorecardInput {
  tenantId: string;
  carrierId: string;
  periodStart?: string | Date | null;
  periodEnd?: string | Date | null;
  onTimeRate?: number | null;
  acceptanceRate?: number | null;
  cancellationRate?: number | null;
  claimRate?: number | null;
  complianceScore?: number | null;
  averageRating?: number | null;
  shipmentsCompleted?: number | null;
  preferred?: boolean | null;
  blacklisted?: boolean | null;
  blacklistReason?: string | null;
  status?: string | null;
  metadata?: JsonRecord | null;
}

export interface LogisticsTelematicsEventInput {
  tenantId: string;
  shipmentOrderId: string;
  assignmentId?: string | null;
  vehicleId?: string | null;
  provider?: string | null;
  deviceId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  speedKph?: number | null;
  heading?: number | null;
  odometerKm?: number | null;
  eventTime?: string | Date | null;
  etaAt?: string | Date | null;
  etaConfidence?: number | null;
  rawPayload?: unknown;
}

export interface LogisticsAccessorialCatalogInput {
  tenantId: string;
  code: string;
  name: string;
  chargeType?: string | null;
  defaultAmount?: number | null;
  currency?: string | null;
  taxable?: boolean | null;
  autoApplyRule?: unknown;
  status?: string | null;
  metadata?: JsonRecord | null;
}

export interface LogisticsShipmentAccessorialInput {
  tenantId: string;
  shipmentOrderId: string;
  catalogId?: string | null;
  code?: string | null;
  name?: string | null;
  chargeSide?: 'CUSTOMER' | 'CARRIER' | string;
  quantity?: number | null;
  unitRate?: number | null;
  amount?: number | null;
  taxAmount?: number | null;
  currency?: string | null;
  actorUserId?: string | null;
  metadata?: JsonRecord | null;
}

export type LogisticsMasterDataType =
  | 'SHIPPER'
  | 'CUSTOMER'
  | 'PICKUP_LOCATION'
  | 'COUNTRY'
  | 'AIRPORT'
  | 'AIRLINE'
  | 'AGENT'
  | 'VEHICLE_TYPE'
  | 'SERVICE_TYPE'
  | string;

export interface LogisticsMasterDataInput {
  tenantId: string;
  type: LogisticsMasterDataType;
  code: string;
  label: string;
  description?: string | null;
  status?: string | null;
  sortOrder?: number | null;
  metadata?: JsonRecord | null;
  actorUserId?: string | null;
}

export interface LogisticsShiftHandoverInput {
  tenantId: string;
  shiftDate?: string | Date | null;
  shiftCode: 'MORNING' | 'AFTERNOON' | 'NIGHT' | string;
  outgoingUserId?: string | null;
  incomingUserId?: string | null;
  notes?: string | null;
  actorUserId?: string | null;
}

export interface LogisticsFieldOpsEventInput {
  tenantId: string;
  shipmentOrderId: string;
  eventType: 'PICKUP_CONFIRMED' | 'DELIVERY_CONFIRMED' | 'ETA_UPDATED' | 'EXCEPTION_REPORTED' | 'PHOTO_ATTACHED' | 'OPERATIONAL_REMARK' | string;
  occurredAt?: string | Date | null;
  latitude?: number | null;
  longitude?: number | null;
  etaAt?: string | Date | null;
  recipientName?: string | null;
  signatureUrl?: string | null;
  photoUrls?: string[] | null;
  documentUrls?: string[] | null;
  remarks?: string | null;
  exceptionSeverity?: string | null;
  actorUserId?: string | null;
  metadata?: JsonRecord | null;
}

export class LogisticsValidationError extends Error {
  issues: string[];
  warnings: string[];
  statusCode = 422;

  constructor(issues: string[], warnings: string[] = []) {
    super(issues.join(' '));
    this.name = 'LogisticsValidationError';
    this.issues = issues;
    this.warnings = warnings;
  }
}

export interface LogisticsShipmentRow {
  id: string;
  tenant_id: string;
  shipment_no: string;
  legacy_booking_id: string | null;
  cargo_owner_customer_id: string | null;
  cargo_owner_name: string | null;
  cargo_owner_email: string | null;
  cargo_owner_phone: string | null;
  shipment_type: string | null;
  booking_mode: string;
  marketplace_status: string;
  status: string;
  priority: string;
  origin_name: string | null;
  origin_address: string | null;
  destination_name: string | null;
  destination_address: string | null;
  pickup_window_from: Date | null;
  pickup_window_to: Date | null;
  delivery_window_from: Date | null;
  delivery_window_to: Date | null;
  requested_vehicle_type: string | null;
  total_weight_kg: string | number | null;
  total_volume_cbm: string | number | null;
  cargo_value_amount: string | number | null;
  currency: string;
  customer_rate_amount: string | number | null;
  carrier_cost_amount: string | number | null;
  platform_commission_amount: string | number | null;
  margin_amount: string | number | null;
  assigned_carrier_id: string | null;
  assigned_driver_id: string | null;
  assigned_vehicle_id: string | null;
  source_channel: string | null;
  notes: string | null;
  metadata: JsonRecord | null;
  created_at: Date;
  updated_at: Date;
}

export interface LogisticsFreightRfqRow {
  id: string;
  tenant_id: string;
  shipment_order_id: string;
  rfq_no: string;
  status: string;
  invite_scope: string;
  bid_deadline_at: Date | null;
  negotiation_round: number;
  awarded_bid_id: string | null;
  metadata: JsonRecord | null;
  created_at: Date;
  updated_at: Date;
}

export interface LogisticsCarrierBidRow {
  id: string;
  tenant_id: string;
  shipment_order_id: string;
  rfq_id: string | null;
  carrier_id: string;
  bid_no: string | null;
  amount: string | number;
  currency: string;
  transit_time_hours: number | null;
  validity_until: Date | null;
  status: string;
  charge_breakdown: unknown;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface LogisticsCustomerMarketplaceSettingsRow {
  id: string;
  created_at: Date;
  updated_at: Date;
  tenant_id: string;
  customer_id: string;
  customer_name: string | null;
  rfq_enabled: boolean;
  bid_submission_enabled: boolean;
  direct_assignment_enabled: boolean;
  default_procurement_mode: string;
  require_rfq_before_award: boolean;
  notes: string | null;
  metadata: JsonRecord | null;
  updated_by: string | null;
}

export interface LogisticsAssignmentRow {
  id: string;
  tenant_id: string;
  shipment_order_id: string;
  carrier_id: string | null;
  driver_id: string | null;
  vehicle_id: string | null;
  assignment_type: string;
  status: string;
  cost_amount: string | number | null;
  currency: string;
  accepted_at: Date | null;
  dispatched_at: Date | null;
  completed_at: Date | null;
  metadata: JsonRecord | null;
  created_at: Date;
  updated_at: Date;
}

export interface LogisticsCarrierRow {
  id: string;
  tenant_id: string;
  carrier_code: string | null;
  carrier_type: string;
  name: string;
  trade_license: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  status: string;
  onboarding_status: string;
  compliance_status: string;
  service_regions: unknown;
  capacity_profile: unknown;
  commission_model: string | null;
  commission_rate: string | number | null;
  margin_rule_json: unknown;
  metadata: JsonRecord | null;
  created_at: Date;
  updated_at: Date;
}

export interface LogisticsCarrierInviteRow {
  id: string;
  tenant_id: string;
  rfq_id: string;
  shipment_order_id: string;
  carrier_id: string;
  token_hash: string;
  status: string;
  expires_at: Date | null;
  last_accessed_at: Date | null;
  created_by: string | null;
  metadata: JsonRecord | null;
  created_at: Date;
  updated_at: Date;
}

export interface LogisticsCarrierDocumentRow {
  id: string;
  tenant_id: string;
  carrier_id: string;
  document_type: string;
  document_name: string;
  document_url: string;
  storage_key: string | null;
  file_name: string | null;
  mime_type: string | null;
  file_size: string | number | null;
  status: string;
  issue_date: Date | null;
  expiry_date: Date | null;
  verified_by: string | null;
  verified_at: Date | null;
  metadata: JsonRecord | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface LogisticsCarrierVehicleRow {
  id: string;
  tenant_id: string;
  carrier_id: string;
  owner_driver_id: string | null;
  vehicle_code: string | null;
  plate_no: string;
  registration_no: string | null;
  vehicle_type: string;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  capacity_tons: string | number | null;
  volume_cbm: string | number | null;
  pallet_capacity: number | null;
  axle_count: number | null;
  gps_enabled: boolean;
  gps_provider: string | null;
  home_region: string | null;
  current_region: string | null;
  availability_status: string;
  compliance_status: string;
  status: string;
  registration_expiry: Date | null;
  insurance_expiry: Date | null;
  permit_expiry: Date | null;
  inspection_expiry: Date | null;
  verified_by: string | null;
  verified_at: Date | null;
  metadata: JsonRecord | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface LogisticsFinancePostingRow {
  id: string;
  tenant_id: string;
  shipment_order_id: string;
  posting_type: string;
  source_record_id: string;
  finance_invoice_id: string | null;
  finance_journal_entry_id: string | null;
  amount: string | number;
  currency: string;
  status: string;
  metadata: JsonRecord | null;
  created_at: Date;
  updated_at: Date;
}

export interface LogisticsRateContractRow {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  customer_name: string | null;
  carrier_id: string | null;
  carrier_name?: string | null;
  contract_no: string;
  lane_origin: string;
  lane_destination: string;
  vehicle_type: string | null;
  service_level: string | null;
  currency: string;
  base_rate: string | number;
  min_charge: string | number | null;
  fuel_surcharge_pct: string | number | null;
  accessorial_rules: unknown;
  effective_from: Date | null;
  effective_to: Date | null;
  status: string;
  metadata: JsonRecord | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface LogisticsCarrierScorecardRow {
  id: string;
  tenant_id: string;
  carrier_id: string;
  carrier_name?: string | null;
  period_start: Date | null;
  period_end: Date | null;
  on_time_rate: string | number | null;
  acceptance_rate: string | number | null;
  cancellation_rate: string | number | null;
  claim_rate: string | number | null;
  compliance_score: string | number | null;
  average_rating: string | number | null;
  shipments_completed: number | null;
  preferred: boolean;
  blacklisted: boolean;
  blacklist_reason: string | null;
  status: string;
  metadata: JsonRecord | null;
  created_at: Date;
  updated_at: Date;
}

export interface LogisticsTelematicsEventRow {
  id: string;
  created_at: Date;
  tenant_id: string;
  shipment_order_id: string;
  assignment_id: string | null;
  vehicle_id: string | null;
  provider: string | null;
  device_id: string | null;
  latitude: string | number | null;
  longitude: string | number | null;
  speed_kph: string | number | null;
  heading: string | number | null;
  odometer_km: string | number | null;
  event_time: Date;
  eta_at: Date | null;
  eta_confidence: string | number | null;
  raw_payload: unknown;
}

export interface LogisticsAccessorialCatalogRow {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  charge_type: string;
  default_amount: string | number | null;
  currency: string;
  taxable: boolean;
  auto_apply_rule: unknown;
  status: string;
  metadata: JsonRecord | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface LogisticsShipmentExceptionRow {
  id: string;
  created_at: Date;
  updated_at: Date;
  tenant_id: string;
  shipment_order_id: string;
  assignment_id: string | null;
  exception_type: string;
  severity: string;
  status: string;
  title: string;
  description: string | null;
  raised_at: Date;
  assigned_to: string | null;
  acknowledged_at: Date | null;
  acknowledged_by: string | null;
  escalated_at: Date | null;
  escalated_by: string | null;
  sla_due_at: Date | null;
  sla_breached_at: Date | null;
  resolved_at: Date | null;
  resolution_note: string | null;
  metadata: JsonRecord | null;
}

export type LogisticsExceptionLifecycleAction =
  | 'ASSIGN'
  | 'ACKNOWLEDGE'
  | 'RESOLVE'
  | 'ESCALATE'
  | 'MARK_SLA_BREACHED'
  | 'REOPEN';

export interface LegacyBookingView {
  id: string;
  bookingRef: string;
  serviceType: 'LOGISTICS';
  requestorId: string | null;
  requestorName: string | null;
  requestorEmail: string | null;
  startDate: string;
  endDate: string | null;
  vehicleCategory: string | null;
  vehicleId: string | null;
  notes: string;
  status: string;
  approvedBy: string | null;
  approvedAt: string | null;
  shipmentId: string;
  shipmentNo: string;
  tenantId: string;
}

interface LegacyBookingRaw {
  id: string;
  booking_ref: string | null;
  requestor_id: string | null;
  requestor_name: string | null;
  requestor_email: string | null;
  start_date: Date | string | null;
  end_date: Date | string | null;
  vehicle_category: string | null;
  vehicle_id: string | null;
  notes: string | null;
  status: string | null;
}

let ensurePromise: Promise<void> | null = null;
let ensured = false;

export async function ensureLogisticsDomainTables() {
  if (ensured) return;
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS logistics_carriers (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        tenant_id TEXT NOT NULL,
        carrier_code TEXT,
        carrier_type TEXT NOT NULL DEFAULT 'TRANSPORT_COMPANY',
        name TEXT NOT NULL,
        trade_license TEXT,
        contact_name TEXT,
        contact_email TEXT,
        contact_phone TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        onboarding_status TEXT NOT NULL DEFAULT 'DRAFT',
        compliance_status TEXT NOT NULL DEFAULT 'PENDING',
        service_regions JSONB,
        capacity_profile JSONB,
        commission_model TEXT,
        commission_rate NUMERIC(10,2),
        margin_rule_json JSONB,
        metadata JSONB
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS logistics_carrier_documents (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        tenant_id TEXT NOT NULL,
        carrier_id TEXT NOT NULL,
        document_type TEXT NOT NULL,
        document_name TEXT NOT NULL,
        document_url TEXT NOT NULL,
        storage_key TEXT,
        file_name TEXT,
        mime_type TEXT,
        file_size NUMERIC(14,0),
        status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
        issue_date DATE,
        expiry_date DATE,
        verified_by TEXT,
        verified_at TIMESTAMPTZ,
        metadata JSONB
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS logistics_carrier_vehicles (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        tenant_id TEXT NOT NULL,
        carrier_id TEXT NOT NULL,
        owner_driver_id TEXT,
        vehicle_code TEXT,
        plate_no TEXT NOT NULL,
        registration_no TEXT,
        vehicle_type TEXT NOT NULL,
        make TEXT,
        model TEXT,
        year INT,
        color TEXT,
        capacity_tons NUMERIC(12,3),
        volume_cbm NUMERIC(12,3),
        pallet_capacity INT,
        axle_count INT,
        gps_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        gps_provider TEXT,
        home_region TEXT,
        current_region TEXT,
        availability_status TEXT NOT NULL DEFAULT 'AVAILABLE',
        compliance_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        registration_expiry DATE,
        insurance_expiry DATE,
        permit_expiry DATE,
        inspection_expiry DATE,
        verified_by TEXT,
        verified_at TIMESTAMPTZ,
        metadata JSONB
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS logistics_shipment_orders (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        tenant_id TEXT NOT NULL,
        shipment_no TEXT NOT NULL,
        legacy_booking_id TEXT UNIQUE,
        cargo_owner_customer_id TEXT,
        cargo_owner_name TEXT,
        cargo_owner_email TEXT,
        cargo_owner_phone TEXT,
        shipment_type TEXT,
        booking_mode TEXT NOT NULL DEFAULT 'SPOT',
        marketplace_status TEXT NOT NULL DEFAULT 'PRIVATE',
        status TEXT NOT NULL DEFAULT 'DRAFT',
        priority TEXT NOT NULL DEFAULT 'NORMAL',
        origin_name TEXT,
        origin_address TEXT,
        destination_name TEXT,
        destination_address TEXT,
        pickup_window_from TIMESTAMPTZ,
        pickup_window_to TIMESTAMPTZ,
        delivery_window_from TIMESTAMPTZ,
        delivery_window_to TIMESTAMPTZ,
        requested_vehicle_type TEXT,
        total_weight_kg NUMERIC(14,3),
        total_volume_cbm NUMERIC(14,3),
        cargo_value_amount NUMERIC(15,2),
        currency TEXT NOT NULL DEFAULT 'AED',
        customer_rate_amount NUMERIC(15,2),
        carrier_cost_amount NUMERIC(15,2),
        platform_commission_amount NUMERIC(15,2),
        margin_amount NUMERIC(15,2),
        assigned_carrier_id TEXT,
        assigned_driver_id TEXT,
        assigned_vehicle_id TEXT,
        source_channel TEXT,
        notes TEXT,
        metadata JSONB,
        created_by TEXT,
        updated_by TEXT
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS logistics_customer_marketplace_settings (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        tenant_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        customer_name TEXT,
        rfq_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        bid_submission_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        direct_assignment_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        default_procurement_mode TEXT NOT NULL DEFAULT 'RFQ_BIDDING',
        require_rfq_before_award BOOLEAN NOT NULL DEFAULT FALSE,
        notes TEXT,
        metadata JSONB,
        updated_by TEXT
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS logistics_consignments (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        tenant_id TEXT NOT NULL,
        shipment_order_id TEXT NOT NULL,
        consignment_no TEXT,
        shipper_name TEXT,
        consignee_name TEXT,
        cargo_summary TEXT,
        handling_notes TEXT,
        status TEXT NOT NULL DEFAULT 'PLANNED',
        metadata JSONB
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS logistics_cargo_lines (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        tenant_id TEXT NOT NULL,
        shipment_order_id TEXT NOT NULL,
        consignment_id TEXT,
        description TEXT NOT NULL,
        commodity_code TEXT,
        quantity NUMERIC(14,3),
        package_type TEXT,
        weight_kg NUMERIC(14,3),
        volume_cbm NUMERIC(14,3),
        is_hazmat BOOLEAN NOT NULL DEFAULT FALSE,
        temp_min_c NUMERIC(8,2),
        temp_max_c NUMERIC(8,2),
        cargo_value_amount NUMERIC(15,2),
        metadata JSONB
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS logistics_shipment_stops (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        tenant_id TEXT NOT NULL,
        shipment_order_id TEXT NOT NULL,
        sequence_no INT NOT NULL,
        stop_type TEXT NOT NULL,
        location_name TEXT,
        address TEXT,
        contact_name TEXT,
        contact_phone TEXT,
        latitude NUMERIC(10,7),
        longitude NUMERIC(10,7),
        planned_arrival_at TIMESTAMPTZ,
        planned_depart_at TIMESTAMPTZ,
        actual_arrival_at TIMESTAMPTZ,
        actual_depart_at TIMESTAMPTZ,
        status TEXT NOT NULL DEFAULT 'PLANNED',
        instructions TEXT,
        metadata JSONB
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS logistics_route_legs (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        tenant_id TEXT NOT NULL,
        shipment_order_id TEXT NOT NULL,
        sequence_no INT NOT NULL,
        from_stop_id TEXT,
        to_stop_id TEXT,
        planned_distance_km NUMERIC(12,3),
        planned_duration_min INT,
        actual_distance_km NUMERIC(12,3),
        actual_duration_min INT,
        toll_amount NUMERIC(15,2),
        status TEXT NOT NULL DEFAULT 'PLANNED',
        metadata JSONB
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS logistics_freight_rfqs (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        tenant_id TEXT NOT NULL,
        shipment_order_id TEXT NOT NULL,
        rfq_no TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'DRAFT',
        invite_scope TEXT NOT NULL DEFAULT 'SELECTED_CARRIERS',
        bid_deadline_at TIMESTAMPTZ,
        negotiation_round INT NOT NULL DEFAULT 1,
        awarded_bid_id TEXT,
        metadata JSONB
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS logistics_carrier_portal_invites (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        tenant_id TEXT NOT NULL,
        rfq_id TEXT NOT NULL,
        shipment_order_id TEXT NOT NULL,
        carrier_id TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        expires_at TIMESTAMPTZ,
        last_accessed_at TIMESTAMPTZ,
        created_by TEXT,
        metadata JSONB
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS logistics_carrier_bids (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        tenant_id TEXT NOT NULL,
        shipment_order_id TEXT NOT NULL,
        rfq_id TEXT,
        carrier_id TEXT NOT NULL,
        bid_no TEXT,
        amount NUMERIC(15,2) NOT NULL,
        currency TEXT NOT NULL DEFAULT 'AED',
        transit_time_hours INT,
        validity_until TIMESTAMPTZ,
        status TEXT NOT NULL DEFAULT 'SUBMITTED',
        charge_breakdown JSONB,
        notes TEXT
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS logistics_assignments (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        tenant_id TEXT NOT NULL,
        shipment_order_id TEXT NOT NULL,
        carrier_id TEXT,
        driver_id TEXT,
        vehicle_id TEXT,
        assignment_type TEXT NOT NULL DEFAULT 'CARRIER',
        status TEXT NOT NULL DEFAULT 'ASSIGNED',
        cost_amount NUMERIC(15,2),
        currency TEXT NOT NULL DEFAULT 'AED',
        accepted_at TIMESTAMPTZ,
        dispatched_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        metadata JSONB
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS logistics_tracking_events (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        tenant_id TEXT NOT NULL,
        shipment_order_id TEXT NOT NULL,
        assignment_id TEXT,
        event_type TEXT NOT NULL,
        status TEXT,
        latitude NUMERIC(10,7),
        longitude NUMERIC(10,7),
        source TEXT NOT NULL DEFAULT 'SYSTEM',
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        notes TEXT,
        metadata JSONB
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS logistics_pod_events (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        tenant_id TEXT NOT NULL,
        shipment_order_id TEXT NOT NULL,
        assignment_id TEXT,
        delivered_at TIMESTAMPTZ,
        recipient_name TEXT,
        signature_url TEXT,
        photo_urls JSONB,
        document_urls JSONB,
        gps JSONB,
        status TEXT NOT NULL DEFAULT 'SUBMITTED',
        created_by TEXT,
        metadata JSONB
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS logistics_freight_charges (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        tenant_id TEXT NOT NULL,
        shipment_order_id TEXT NOT NULL,
        charge_side TEXT NOT NULL,
        charge_type TEXT NOT NULL,
        description TEXT,
        quantity NUMERIC(14,3) NOT NULL DEFAULT 1,
        unit_rate NUMERIC(15,2) NOT NULL DEFAULT 0,
        amount NUMERIC(15,2) NOT NULL DEFAULT 0,
        tax_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
        total_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'AED',
        billing_status TEXT NOT NULL DEFAULT 'DRAFT',
        invoice_id TEXT,
        settlement_id TEXT,
        metadata JSONB
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS logistics_carrier_settlements (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        tenant_id TEXT NOT NULL,
        carrier_id TEXT NOT NULL,
        settlement_no TEXT NOT NULL,
        period_start DATE,
        period_end DATE,
        gross_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
        deductions_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
        commission_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
        net_payable_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'AED',
        status TEXT NOT NULL DEFAULT 'DRAFT',
        payment_id TEXT,
        metadata JSONB
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS logistics_driver_payouts (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        tenant_id TEXT NOT NULL,
        shipment_order_id TEXT NOT NULL,
        assignment_id TEXT,
        driver_id TEXT,
        payout_no TEXT NOT NULL,
        gross_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
        deductions_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
        net_payable_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'AED',
        status TEXT NOT NULL DEFAULT 'DRAFT',
        payment_id TEXT,
        metadata JSONB
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS logistics_finance_postings (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        tenant_id TEXT NOT NULL,
        shipment_order_id TEXT NOT NULL,
        posting_type TEXT NOT NULL,
        source_record_id TEXT NOT NULL DEFAULT '',
        finance_invoice_id TEXT,
        finance_journal_entry_id TEXT,
        amount NUMERIC(15,2) NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'AED',
        status TEXT NOT NULL DEFAULT 'POSTED',
        metadata JSONB
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS logistics_shipment_exceptions (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        tenant_id TEXT NOT NULL,
        shipment_order_id TEXT NOT NULL,
        assignment_id TEXT,
        exception_type TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'MEDIUM',
        status TEXT NOT NULL DEFAULT 'OPEN',
        title TEXT NOT NULL,
        description TEXT,
        raised_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        assigned_to TEXT,
        acknowledged_at TIMESTAMPTZ,
        acknowledged_by TEXT,
        escalated_at TIMESTAMPTZ,
        escalated_by TEXT,
        sla_due_at TIMESTAMPTZ,
        sla_breached_at TIMESTAMPTZ,
        resolved_at TIMESTAMPTZ,
        resolution_note TEXT,
        metadata JSONB
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS logistics_rate_contracts (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        tenant_id TEXT NOT NULL,
        customer_id TEXT,
        customer_name TEXT,
        carrier_id TEXT,
        contract_no TEXT NOT NULL,
        lane_origin TEXT NOT NULL,
        lane_destination TEXT NOT NULL,
        vehicle_type TEXT,
        service_level TEXT,
        currency TEXT NOT NULL DEFAULT 'AED',
        base_rate NUMERIC(15,2) NOT NULL DEFAULT 0,
        min_charge NUMERIC(15,2),
        fuel_surcharge_pct NUMERIC(8,2),
        accessorial_rules JSONB,
        effective_from DATE,
        effective_to DATE,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        metadata JSONB
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS logistics_carrier_scorecards (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        tenant_id TEXT NOT NULL,
        carrier_id TEXT NOT NULL,
        period_start DATE,
        period_end DATE,
        on_time_rate NUMERIC(6,2),
        acceptance_rate NUMERIC(6,2),
        cancellation_rate NUMERIC(6,2),
        claim_rate NUMERIC(6,2),
        compliance_score NUMERIC(6,2),
        average_rating NUMERIC(4,2),
        shipments_completed INT NOT NULL DEFAULT 0,
        preferred BOOLEAN NOT NULL DEFAULT FALSE,
        blacklisted BOOLEAN NOT NULL DEFAULT FALSE,
        blacklist_reason TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        metadata JSONB
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS logistics_telematics_events (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        tenant_id TEXT NOT NULL,
        shipment_order_id TEXT NOT NULL,
        assignment_id TEXT,
        vehicle_id TEXT,
        provider TEXT,
        device_id TEXT,
        latitude NUMERIC(10,7),
        longitude NUMERIC(10,7),
        speed_kph NUMERIC(10,2),
        heading NUMERIC(7,2),
        odometer_km NUMERIC(14,2),
        event_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        eta_at TIMESTAMPTZ,
        eta_confidence NUMERIC(5,2),
        raw_payload JSONB
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS logistics_accessorial_catalog (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        tenant_id TEXT NOT NULL,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        charge_type TEXT NOT NULL DEFAULT 'ACCESSORIAL',
        default_amount NUMERIC(15,2),
        currency TEXT NOT NULL DEFAULT 'AED',
        taxable BOOLEAN NOT NULL DEFAULT TRUE,
        auto_apply_rule JSONB,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        metadata JSONB
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS logistics_master_data (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        tenant_id TEXT NOT NULL,
        type TEXT NOT NULL,
        code TEXT NOT NULL,
        label TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        sort_order INT NOT NULL DEFAULT 0,
        metadata JSONB,
        created_by TEXT,
        updated_by TEXT
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS logistics_shift_handovers (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        tenant_id TEXT NOT NULL,
        shift_date DATE NOT NULL,
        shift_code TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'DRAFT',
        outgoing_user_id TEXT,
        incoming_user_id TEXT,
        summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        notes TEXT,
        created_by TEXT,
        accepted_by TEXT,
        accepted_at TIMESTAMPTZ,
        metadata JSONB
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS logistics_change_history (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        tenant_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        action TEXT NOT NULL,
        actor_user_id TEXT,
        before_json JSONB,
        after_json JSONB,
        summary TEXT,
        metadata JSONB
      )
    `);
    await Promise.all([
      prisma.$executeRawUnsafe(`ALTER TABLE logistics_shipment_exceptions ADD COLUMN IF NOT EXISTS assigned_to TEXT`),
      prisma.$executeRawUnsafe(`ALTER TABLE logistics_shipment_exceptions ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ`),
      prisma.$executeRawUnsafe(`ALTER TABLE logistics_shipment_exceptions ADD COLUMN IF NOT EXISTS acknowledged_by TEXT`),
      prisma.$executeRawUnsafe(`ALTER TABLE logistics_shipment_exceptions ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ`),
      prisma.$executeRawUnsafe(`ALTER TABLE logistics_shipment_exceptions ADD COLUMN IF NOT EXISTS escalated_by TEXT`),
      prisma.$executeRawUnsafe(`ALTER TABLE logistics_shipment_exceptions ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMPTZ`),
      prisma.$executeRawUnsafe(`ALTER TABLE logistics_shipment_exceptions ADD COLUMN IF NOT EXISTS sla_breached_at TIMESTAMPTZ`),
      prisma.$executeRawUnsafe(`ALTER TABLE logistics_shipment_exceptions ADD COLUMN IF NOT EXISTS resolution_note TEXT`),
      // Day 4 of the rate-matrix gap-closure: store the contract id that
      // priced the shipment so dispatch can group "shipments under contract
      // RC-123" without parsing metadata.rateQuote out of JSONB. Nullable on
      // purpose — spot/marketplace shipments and quote-misses both leave
      // it null and that's the signal "this needs manual pricing review".
      prisma.$executeRawUnsafe(`ALTER TABLE logistics_shipment_orders ADD COLUMN IF NOT EXISTS quoted_contract_id TEXT`),
    ]);

    await Promise.all([
      prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS logistics_carriers_tenant_code_key ON logistics_carriers (tenant_id, carrier_code)`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_carriers_tenant_status ON logistics_carriers (tenant_id, status)`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_carrier_documents_carrier ON logistics_carrier_documents (tenant_id, carrier_id, status) WHERE deleted_at IS NULL`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_carrier_documents_expiry ON logistics_carrier_documents (tenant_id, expiry_date) WHERE deleted_at IS NULL`),
      prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS logistics_carrier_vehicles_plate_key ON logistics_carrier_vehicles (tenant_id, carrier_id, plate_no) WHERE deleted_at IS NULL`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_carrier_vehicles_carrier ON logistics_carrier_vehicles (tenant_id, carrier_id, status, availability_status) WHERE deleted_at IS NULL`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_carrier_vehicles_compliance ON logistics_carrier_vehicles (tenant_id, compliance_status) WHERE deleted_at IS NULL`),
      prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS logistics_shipment_orders_tenant_no_key ON logistics_shipment_orders (tenant_id, shipment_no)`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_shipment_orders_tenant_status ON logistics_shipment_orders (tenant_id, status)`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_shipment_orders_tenant_customer ON logistics_shipment_orders (tenant_id, cargo_owner_customer_id)`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_shipment_orders_marketplace ON logistics_shipment_orders (tenant_id, marketplace_status)`),
      prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS logistics_customer_marketplace_settings_customer_key ON logistics_customer_marketplace_settings (tenant_id, customer_id)`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_customer_marketplace_settings_policy ON logistics_customer_marketplace_settings (tenant_id, rfq_enabled, bid_submission_enabled)`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_consignments_shipment ON logistics_consignments (tenant_id, shipment_order_id)`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_cargo_lines_shipment ON logistics_cargo_lines (tenant_id, shipment_order_id)`),
      prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS logistics_shipment_stops_order_sequence_key ON logistics_shipment_stops (shipment_order_id, sequence_no)`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_shipment_stops_shipment ON logistics_shipment_stops (tenant_id, shipment_order_id)`),
      prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS logistics_route_legs_order_sequence_key ON logistics_route_legs (shipment_order_id, sequence_no)`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_route_legs_shipment ON logistics_route_legs (tenant_id, shipment_order_id)`),
      prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS logistics_freight_rfqs_tenant_no_key ON logistics_freight_rfqs (tenant_id, rfq_no)`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_freight_rfqs_shipment ON logistics_freight_rfqs (tenant_id, shipment_order_id)`),
      prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS logistics_carrier_portal_invites_token_key ON logistics_carrier_portal_invites (token_hash)`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_carrier_portal_invites_scope ON logistics_carrier_portal_invites (tenant_id, rfq_id, carrier_id, status)`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_carrier_bids_shipment ON logistics_carrier_bids (tenant_id, shipment_order_id)`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_carrier_bids_carrier ON logistics_carrier_bids (tenant_id, carrier_id)`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_assignments_shipment ON logistics_assignments (tenant_id, shipment_order_id)`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_tracking_events_shipment_time ON logistics_tracking_events (tenant_id, shipment_order_id, occurred_at DESC)`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_pod_events_shipment ON logistics_pod_events (tenant_id, shipment_order_id)`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_freight_charges_shipment ON logistics_freight_charges (tenant_id, shipment_order_id)`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_carrier_settlements_carrier ON logistics_carrier_settlements (tenant_id, carrier_id)`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_driver_payouts_shipment ON logistics_driver_payouts (tenant_id, shipment_order_id)`),
      prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS logistics_finance_postings_unique_source ON logistics_finance_postings (tenant_id, shipment_order_id, posting_type, source_record_id)`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_finance_postings_shipment ON logistics_finance_postings (tenant_id, shipment_order_id, status)`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_shipment_exceptions_status ON logistics_shipment_exceptions (tenant_id, status)`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_shipment_exceptions_shipment_status ON logistics_shipment_exceptions (tenant_id, shipment_order_id, status)`),
      prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS logistics_rate_contracts_tenant_no_key ON logistics_rate_contracts (tenant_id, contract_no) WHERE deleted_at IS NULL`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_rate_contracts_lane ON logistics_rate_contracts (tenant_id, lane_origin, lane_destination, status) WHERE deleted_at IS NULL`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_rate_contracts_carrier_customer ON logistics_rate_contracts (tenant_id, carrier_id, customer_id, status) WHERE deleted_at IS NULL`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_carrier_scorecards_carrier ON logistics_carrier_scorecards (tenant_id, carrier_id, period_end DESC)`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_carrier_scorecards_rules ON logistics_carrier_scorecards (tenant_id, preferred, blacklisted, status)`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_telematics_shipment_time ON logistics_telematics_events (tenant_id, shipment_order_id, event_time DESC)`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_telematics_vehicle_time ON logistics_telematics_events (tenant_id, vehicle_id, event_time DESC)`),
      prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS logistics_accessorial_catalog_code_key ON logistics_accessorial_catalog (tenant_id, code) WHERE deleted_at IS NULL`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_accessorial_catalog_status ON logistics_accessorial_catalog (tenant_id, status) WHERE deleted_at IS NULL`),
      prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS logistics_master_data_code_key ON logistics_master_data (tenant_id, type, code) WHERE deleted_at IS NULL`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_master_data_type_status ON logistics_master_data (tenant_id, type, status) WHERE deleted_at IS NULL`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_shift_handovers_scope ON logistics_shift_handovers (tenant_id, shift_date DESC, shift_code)`),
      prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_logistics_change_history_scope ON logistics_change_history (tenant_id, entity_type, entity_id, created_at DESC)`),
    ]);
    ensured = true;
  })();

  try {
    await ensurePromise;
  } finally {
    ensurePromise = null;
  }
}

function parseJsonRecord(value: string | null | undefined): JsonRecord {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonRecord : {};
  } catch {
    return {};
  }
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function dateOnly(value: Date | string | null | undefined): string | null {
  const date = iso(value);
  return date ? date.slice(0, 10) : null;
}

function numberOrNull(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function jsonParam(value: unknown): string | null {
  if (value == null) return null;
  return JSON.stringify(value);
}

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function after(a: Date | null, b: Date | null) {
  return Boolean(a && b && a.getTime() > b.getTime());
}

export function validateShipmentTimeline(input: Pick<LogisticsShipmentCreateInput, 'pickupWindowFrom' | 'pickupWindowTo' | 'deliveryWindowFrom' | 'deliveryWindowTo' | 'stops' | 'originName' | 'destinationName'>) {
  const issues: string[] = [];
  const warnings: string[] = [];
  const pickupFrom = asDate(input.pickupWindowFrom);
  const pickupTo = asDate(input.pickupWindowTo);
  const deliveryFrom = asDate(input.deliveryWindowFrom);
  const deliveryTo = asDate(input.deliveryWindowTo);

  if (after(pickupFrom, pickupTo)) issues.push('Shipment pickup window end cannot be earlier than pickup window start.');
  if (after(deliveryFrom, deliveryTo)) issues.push('Shipment delivery window end cannot be earlier than delivery window start.');
  if (after(pickupFrom, deliveryFrom)) issues.push('Shipment delivery window start cannot be earlier than pickup ready time.');
  if (after(pickupTo, deliveryFrom)) issues.push('Shipment delivery ETA cannot be earlier than pickup deadline.');
  if (after(pickupTo, deliveryTo)) issues.push('Shipment delivery deadline cannot be earlier than pickup deadline.');
  if (!input.originName) warnings.push('Origin is missing; reporting and handover quality will be reduced.');
  if (!input.destinationName) warnings.push('Destination is missing; reporting and handover quality will be reduced.');

  const stops = [...(input.stops ?? [])].sort((a, b) => (a.sequenceNo ?? 0) - (b.sequenceNo ?? 0));
  let previousStopTime: Date | null = null;
  for (const [index, stop] of stops.entries()) {
    const label = `${stop.stopType || 'STOP'} #${stop.sequenceNo ?? index + 1}`;
    const arrival = asDate(stop.plannedArrivalAt);
    const departure = asDate(stop.plannedDepartAt);
    if (!stop.stopType) issues.push(`Stop ${index + 1} must have a stop type.`);
    if (!stop.locationName && !stop.address) warnings.push(`${label} has no location name or address.`);
    if (after(arrival, departure)) issues.push(`${label} departure cannot be earlier than arrival.`);
    const anchor = arrival ?? departure;
    if (after(previousStopTime, anchor)) issues.push(`${label} cannot be earlier than the previous stop.`);
    previousStopTime = departure ?? arrival ?? previousStopTime;
    if (stop.stopType?.toUpperCase() === 'PICKUP' && pickupFrom && anchor && after(pickupFrom, anchor)) {
      issues.push(`${label} cannot be earlier than shipment ready time.`);
    }
    if (stop.stopType?.toUpperCase() === 'DELIVERY' && pickupFrom && anchor && after(pickupFrom, anchor)) {
      issues.push(`${label} cannot be earlier than shipment ready time.`);
    }
  }

  return { ok: issues.length === 0, issues, warnings };
}

function assertShipmentTimelineValid(input: Pick<LogisticsShipmentCreateInput, 'pickupWindowFrom' | 'pickupWindowTo' | 'deliveryWindowFrom' | 'deliveryWindowTo' | 'stops' | 'originName' | 'destinationName'>) {
  const result = validateShipmentTimeline(input);
  if (!result.ok) throw new LogisticsValidationError(result.issues, result.warnings);
  return result;
}

function metadataString(metadata: JsonRecord | null | undefined, key: string) {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function assertActiveMasterDataSelection(args: {
  tenantId: string;
  types: LogisticsMasterDataType[];
  fieldLabel: string;
  code?: string | null;
  id?: string | null;
  label?: string | null;
  required?: boolean;
}) {
  const values = [args.code, args.id, args.label].filter((value): value is string => Boolean(value && value.trim()));
  if (values.length === 0) {
    if (args.required) {
      throw new LogisticsValidationError([`${args.fieldLabel} must be selected from active Logistics master data.`]);
    }
    return null;
  }

  await seedDefaultLogisticsMasterData(args.tenantId);
  const allowedTypes = new Set(args.types.map(type => normaliseKey(String(type))));
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    type: string;
    code: string;
    label: string;
    status: string;
  }>>(
    `SELECT id, type, code, label, status
       FROM logistics_master_data
      WHERE tenant_id = $1
        AND deleted_at IS NULL`,
    args.tenantId,
  );

  const candidateCodes = new Set(values.map(value => normalizeMasterCode(value)));
  const candidateLabels = new Set(values.map(value => normaliseKey(value)));
  const match = rows.find(row => {
    if (normaliseKey(row.status) !== 'ACTIVE') return false;
    if (!allowedTypes.has(normaliseKey(row.type))) return false;
    return values.includes(row.id)
      || candidateCodes.has(normalizeMasterCode(row.code))
      || candidateLabels.has(normaliseKey(row.label));
  });

  if (!match) {
    throw new LogisticsValidationError([
      `${args.fieldLabel} must reference an active Logistics master-data value (${args.types.join(' / ')}).`,
    ]);
  }
  return match;
}

async function assertShipmentMasterDataGovernance(input: Partial<LogisticsShipmentCreateInput> & {
  tenantId: string;
}) {
  const metadata = input.metadata ?? {};
  const governed = metadata.masterDataGoverned === true
    || metadata.governedDataModel === true
    || String(metadata.source ?? '').includes('governed');
  if (!governed) return;

  await assertActiveMasterDataSelection({
    tenantId: input.tenantId,
    types: ['CUSTOMER', 'SHIPPER'],
    fieldLabel: 'Cargo owner / shipper',
    id: input.cargoOwnerCustomerId ?? null,
    code: metadataString(metadata, 'selectedCustomerCode') ?? metadataString(metadata, 'customerCode'),
    label: input.cargoOwnerName ?? null,
    required: true,
  });
  await assertActiveMasterDataSelection({
    tenantId: input.tenantId,
    types: ['PICKUP_LOCATION', 'AIRPORT', 'COUNTRY'],
    fieldLabel: 'Origin',
    code: metadataString(metadata, 'originCode'),
    label: input.originName ?? null,
    required: true,
  });
  await assertActiveMasterDataSelection({
    tenantId: input.tenantId,
    types: ['PICKUP_LOCATION', 'AIRPORT', 'COUNTRY'],
    fieldLabel: 'Destination',
    code: metadataString(metadata, 'destinationCode'),
    label: input.destinationName ?? null,
    required: true,
  });
  await assertActiveMasterDataSelection({
    tenantId: input.tenantId,
    types: ['SERVICE_TYPE'],
    fieldLabel: 'Service type',
    code: input.shipmentType ?? metadataString(metadata, 'serviceTypeCode'),
    label: input.shipmentType ?? null,
    required: true,
  });
  if (input.requestedVehicleType) {
    await assertActiveMasterDataSelection({
      tenantId: input.tenantId,
      types: ['VEHICLE_TYPE'],
      fieldLabel: 'Vehicle type',
      code: input.requestedVehicleType,
      label: input.requestedVehicleType,
      required: false,
    });
  }
}

function complianceBlockedError(message: string, blockers: LogisticsComplianceBlocker[]) {
  const error = new Error(message);
  (error as Error & { code?: string; blockers?: LogisticsComplianceBlocker[] }).code = 'LOGISTICS_COMPLIANCE_BLOCKED';
  (error as Error & { code?: string; blockers?: LogisticsComplianceBlocker[] }).blockers = blockers;
  return error;
}

export async function assertGovernedShipmentWrite(args: {
  tenantId: string;
  shipmentOrderId: string;
  action: string;
  stops?: LogisticsStopInput[] | null;
  allowClosed?: boolean;
  allowCancelled?: boolean;
}) {
  const shipment = await fetchShipmentById(args.shipmentOrderId, args.tenantId);
  if (!shipment) throw new LogisticsValidationError(['Shipment was not found for this tenant.']);

  const status = normaliseKey(shipment.status);
  const issues: string[] = [];
  if (!args.allowClosed && ['CLOSED', 'COMPLETED'].includes(status)) {
    issues.push(`${args.action} cannot be applied because shipment ${shipment.shipment_no} is already closed.`);
  }
  if (!args.allowCancelled && status === 'CANCELLED') {
    issues.push(`${args.action} cannot be applied because shipment ${shipment.shipment_no} is cancelled.`);
  }

  const validation = validateShipmentTimeline({
    pickupWindowFrom: shipment.pickup_window_from,
    pickupWindowTo: shipment.pickup_window_to,
    deliveryWindowFrom: shipment.delivery_window_from,
    deliveryWindowTo: shipment.delivery_window_to,
    originName: shipment.origin_name,
    destinationName: shipment.destination_name,
    stops: args.stops ?? undefined,
  });
  issues.push(...validation.issues);
  if (issues.length > 0) throw new LogisticsValidationError(issues, validation.warnings);
  return { shipment, validation };
}

async function logLogisticsAudit(args: {
  tenantId: string;
  entityType: string;
  entityId?: string | null;
  entityName?: string | null;
  action: string;
  actorUserId?: string | null;
  actorRole?: string | null;
  summary?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: JsonRecord | null;
}) {
  await ensureLogisticsDomainTables();
  await Promise.allSettled([
    logAudit({
      tenantId: args.tenantId,
      entityType: args.entityType,
      entityId: args.entityId ?? undefined,
      entityName: args.entityName ?? undefined,
      userId: args.actorUserId ?? undefined,
      userRole: args.actorRole ?? undefined,
      action: args.action,
      details: args.summary ?? undefined,
    }),
    prisma.$executeRawUnsafe(
      `INSERT INTO logistics_change_history
         (tenant_id, entity_type, entity_id, action, actor_user_id,
          before_json, after_json, summary, metadata)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9::jsonb)`,
      args.tenantId,
      args.entityType,
      args.entityId ?? null,
      args.action,
      args.actorUserId ?? null,
      jsonParam(args.before ?? null),
      jsonParam(args.after ?? null),
      args.summary ?? null,
      jsonParam(args.metadata ?? {}),
    ),
  ]);
}

const DEFAULT_CUSTOMER_PROCUREMENT_MODE: LogisticsCustomerProcurementMode = 'RFQ_BIDDING';

function normalizeCustomerProcurementMode(value?: string | null): LogisticsCustomerProcurementMode {
  switch ((value ?? '').toUpperCase()) {
    case 'DIRECT_ONLY':
      return 'DIRECT_ONLY';
    case 'RFQ_NO_BIDS':
      return 'RFQ_NO_BIDS';
    case 'RFQ_BIDDING':
      return 'RFQ_BIDDING';
    default:
      return DEFAULT_CUSTOMER_PROCUREMENT_MODE;
  }
}

function defaultCustomerMarketplacePolicy(args: {
  tenantId: string;
  customerId?: string | null;
  customerName?: string | null;
}): LogisticsCustomerMarketplacePolicy {
  return {
    tenantId: args.tenantId,
    customerId: args.customerId ?? null,
    customerName: args.customerName ?? null,
    rfqEnabled: true,
    bidSubmissionEnabled: true,
    directAssignmentEnabled: true,
    defaultProcurementMode: DEFAULT_CUSTOMER_PROCUREMENT_MODE,
    requireRfqBeforeAward: false,
    notes: null,
    configured: false,
    updatedAt: null,
    updatedBy: null,
  };
}

function mapCustomerMarketplaceSettingsRow(row: LogisticsCustomerMarketplaceSettingsRow): LogisticsCustomerMarketplacePolicy {
  return {
    tenantId: row.tenant_id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    rfqEnabled: Boolean(row.rfq_enabled),
    bidSubmissionEnabled: Boolean(row.bid_submission_enabled),
    directAssignmentEnabled: Boolean(row.direct_assignment_enabled),
    defaultProcurementMode: normalizeCustomerProcurementMode(row.default_procurement_mode),
    requireRfqBeforeAward: Boolean(row.require_rfq_before_award),
    notes: row.notes,
    configured: true,
    updatedAt: iso(row.updated_at),
    updatedBy: row.updated_by,
  };
}

function mapJoinedCustomerMarketplacePolicy(row: {
  tenant_id?: string | null;
  cargo_owner_customer_id?: string | null;
  cargo_owner_name?: string | null;
  customer_policy_configured?: boolean | null;
  customer_rfq_enabled?: boolean | null;
  customer_bid_submission_enabled?: boolean | null;
  customer_direct_assignment_enabled?: boolean | null;
  customer_default_procurement_mode?: string | null;
  customer_require_rfq_before_award?: boolean | null;
  customer_marketplace_notes?: string | null;
  customer_marketplace_updated_at?: Date | string | null;
  customer_marketplace_updated_by?: string | null;
}): LogisticsCustomerMarketplacePolicy {
  if (!row.customer_policy_configured) {
    return defaultCustomerMarketplacePolicy({
      tenantId: row.tenant_id ?? '',
      customerId: row.cargo_owner_customer_id ?? null,
      customerName: row.cargo_owner_name ?? null,
    });
  }
  return {
    tenantId: row.tenant_id ?? '',
    customerId: row.cargo_owner_customer_id ?? null,
    customerName: row.cargo_owner_name ?? null,
    rfqEnabled: row.customer_rfq_enabled !== false,
    bidSubmissionEnabled: row.customer_bid_submission_enabled !== false,
    directAssignmentEnabled: row.customer_direct_assignment_enabled !== false,
    defaultProcurementMode: normalizeCustomerProcurementMode(row.customer_default_procurement_mode),
    requireRfqBeforeAward: Boolean(row.customer_require_rfq_before_award),
    notes: row.customer_marketplace_notes ?? null,
    configured: true,
    updatedAt: iso(row.customer_marketplace_updated_at),
    updatedBy: row.customer_marketplace_updated_by ?? null,
  };
}

export async function getCustomerMarketplacePolicy(args: {
  tenantId: string;
  customerId?: string | null;
  customerName?: string | null;
}) {
  await ensureLogisticsDomainTables();
  if (!args.customerId) return defaultCustomerMarketplacePolicy(args);

  const rows = await prisma.$queryRawUnsafe<LogisticsCustomerMarketplaceSettingsRow[]>(
    `SELECT *
       FROM logistics_customer_marketplace_settings
      WHERE tenant_id = $1
        AND customer_id = $2
      LIMIT 1`,
    args.tenantId,
    args.customerId,
  );

  return rows[0]
    ? mapCustomerMarketplaceSettingsRow(rows[0])
    : defaultCustomerMarketplacePolicy(args);
}

export async function listCustomerMarketplaceSettings(args: {
  tenantId: string;
  search?: string | null;
  limit?: number;
}) {
  await ensureLogisticsDomainTables();
  const rawLimit = Number(args.limit ?? 100);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 100;
  const rows = await prisma.$queryRawUnsafe<LogisticsCustomerMarketplaceSettingsRow[]>(
    `SELECT *
       FROM logistics_customer_marketplace_settings
      WHERE tenant_id = $1
        AND (
          $2::text IS NULL
          OR customer_id ILIKE '%' || $2 || '%'
          OR customer_name ILIKE '%' || $2 || '%'
        )
      ORDER BY updated_at DESC, customer_name ASC NULLS LAST
      LIMIT $3`,
    args.tenantId,
    args.search || null,
    limit,
  );
  return rows.map(mapCustomerMarketplaceSettingsRow);
}

export async function upsertCustomerMarketplaceSettings(input: LogisticsCustomerMarketplaceSettingsInput) {
  await ensureLogisticsDomainTables();
  const existing = await getCustomerMarketplacePolicy({
    tenantId: input.tenantId,
    customerId: input.customerId,
    customerName: input.customerName ?? null,
  });
  const mode = normalizeCustomerProcurementMode(input.defaultProcurementMode ?? existing.defaultProcurementMode);
  const rfqEnabled = input.rfqEnabled ?? (mode !== 'DIRECT_ONLY' && existing.rfqEnabled);
  const bidSubmissionEnabled = input.bidSubmissionEnabled ?? (mode === 'RFQ_BIDDING' && existing.bidSubmissionEnabled);
  const directAssignmentEnabled = input.directAssignmentEnabled ?? existing.directAssignmentEnabled;

  const rows = await prisma.$queryRawUnsafe<LogisticsCustomerMarketplaceSettingsRow[]>(
    `INSERT INTO logistics_customer_marketplace_settings (
       tenant_id, customer_id, customer_name, rfq_enabled, bid_submission_enabled,
       direct_assignment_enabled, default_procurement_mode, require_rfq_before_award,
       notes, metadata, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
     ON CONFLICT (tenant_id, customer_id)
     DO UPDATE SET
       updated_at = NOW(),
       customer_name = COALESCE(EXCLUDED.customer_name, logistics_customer_marketplace_settings.customer_name),
       rfq_enabled = EXCLUDED.rfq_enabled,
       bid_submission_enabled = EXCLUDED.bid_submission_enabled,
       direct_assignment_enabled = EXCLUDED.direct_assignment_enabled,
       default_procurement_mode = EXCLUDED.default_procurement_mode,
       require_rfq_before_award = EXCLUDED.require_rfq_before_award,
       notes = EXCLUDED.notes,
       metadata = COALESCE(EXCLUDED.metadata, logistics_customer_marketplace_settings.metadata),
       updated_by = EXCLUDED.updated_by
     RETURNING *`,
    input.tenantId,
    input.customerId,
    input.customerName ?? existing.customerName,
    rfqEnabled,
    bidSubmissionEnabled,
    directAssignmentEnabled,
    mode,
    input.requireRfqBeforeAward ?? existing.requireRfqBeforeAward,
    input.notes ?? existing.notes,
    jsonParam(input.metadata ?? {}),
    input.updatedBy ?? null,
  );

  return rows[0] ? mapCustomerMarketplaceSettingsRow(rows[0]) : getCustomerMarketplacePolicy(input);
}

async function assertCustomerAllowsRfq(args: {
  tenantId: string;
  shipmentOrderId: string;
}) {
  const shipment = await fetchShipmentById(args.shipmentOrderId, args.tenantId);
  if (!shipment) throw new Error('Shipment not found for this tenant');

  const policy = await getCustomerMarketplacePolicy({
    tenantId: args.tenantId,
    customerId: shipment.cargo_owner_customer_id,
    customerName: shipment.cargo_owner_name,
  });
  if (!policy.rfqEnabled || policy.defaultProcurementMode === 'DIRECT_ONLY') {
    const customer = policy.customerName || shipment.cargo_owner_name || policy.customerId || 'this customer';
    throw new Error(`RFQ is disabled for ${customer}. Use direct assignment for this customer.`);
  }
  return { shipment, policy };
}

async function assertCustomerAllowsBidSubmission(args: {
  tenantId: string;
  shipmentOrderId: string;
}) {
  const { shipment, policy } = await assertCustomerAllowsRfq(args);
  if (!policy.bidSubmissionEnabled || policy.defaultProcurementMode === 'RFQ_NO_BIDS') {
    const customer = policy.customerName || shipment.cargo_owner_name || policy.customerId || 'this customer';
    throw new Error(`Carrier bid submission is disabled for ${customer}. Use RFQ visibility without vendor bidding or direct assignment.`);
  }
  return { shipment, policy };
}

function normalizeBookingStatus(status?: string | null): LogisticsShipmentStatus {
  switch ((status ?? '').toUpperCase()) {
    case 'CONFIRMED':
      return 'APPROVED';
    case 'ACTIVE':
      return 'ENROUTE_DELIVERY';
    case 'COMPLETED':
      return 'CLOSED';
    case 'POD_SUBMITTED':
      return 'POD_SUBMITTED';
    case 'CLOSED':
      return 'CLOSED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'DISPATCHED':
      return 'DISPATCHED';
    case 'ENROUTE_PICKUP':
      return 'ENROUTE_PICKUP';
    case 'LOADED':
      return 'LOADED';
    case 'ENROUTE_DELIVERY':
      return 'ENROUTE_DELIVERY';
    case 'DELIVERED':
      return 'DELIVERED';
    case 'ASSIGNED':
      return 'ASSIGNED';
    case 'APPROVED':
      return 'APPROVED';
    case 'PENDING':
      return 'PENDING';
    default:
      return 'PENDING';
  }
}

function defaultShipmentNoPrefix(date = new Date()) {
  const yy = String(date.getFullYear()).slice(-2);
  return `SHP-LOG-${yy}`;
}

export async function nextShipmentNo(tenantId: string) {
  await ensureLogisticsDomainTables();
  const prefix = defaultShipmentNoPrefix();
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint | number | string }>>(
    `SELECT COUNT(*) AS count
       FROM logistics_shipment_orders
      WHERE tenant_id = $1 AND shipment_no LIKE $2`,
    tenantId,
    `${prefix}%`,
  );
  const count = Number(rows[0]?.count ?? 0) + 1;
  return `${prefix}${String(count).padStart(5, '0')}`;
}

export function shipmentToBookingView(row: LogisticsShipmentRow): LegacyBookingView {
  const metadata = row.metadata ?? {};
  const notes = {
    ...(typeof metadata === 'object' && metadata ? metadata : {}),
    shipmentId: row.id,
    shipmentNo: row.shipment_no,
    origin: row.origin_name ?? row.origin_address,
    destination: row.destination_name ?? row.destination_address,
    shipmentType: row.shipment_type,
    driverId: row.assigned_driver_id,
  };

  return {
    id: row.legacy_booking_id ?? row.id,
    bookingRef: row.shipment_no,
    serviceType: 'LOGISTICS',
    requestorId: row.cargo_owner_customer_id,
    requestorName: row.cargo_owner_name,
    requestorEmail: row.cargo_owner_email,
    startDate: iso(row.pickup_window_from) ?? iso(row.created_at) ?? new Date().toISOString(),
    endDate: iso(row.delivery_window_to),
    vehicleCategory: row.requested_vehicle_type ?? row.shipment_type,
    vehicleId: row.assigned_vehicle_id,
    notes: JSON.stringify(notes),
    status: row.status,
    approvedBy: null,
    approvedAt: null,
    shipmentId: row.id,
    shipmentNo: row.shipment_no,
    tenantId: row.tenant_id,
  };
}

export function shipmentRowToDetail(row: LogisticsShipmentRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    shipmentNo: row.shipment_no,
    legacyBookingId: row.legacy_booking_id,
    cargoOwnerCustomerId: row.cargo_owner_customer_id,
    cargoOwnerName: row.cargo_owner_name,
    cargoOwnerEmail: row.cargo_owner_email,
    cargoOwnerPhone: row.cargo_owner_phone,
    shipmentType: row.shipment_type,
    bookingMode: row.booking_mode,
    marketplaceStatus: row.marketplace_status,
    status: row.status,
    priority: row.priority,
    originName: row.origin_name,
    originAddress: row.origin_address,
    destinationName: row.destination_name,
    destinationAddress: row.destination_address,
    pickupWindowFrom: iso(row.pickup_window_from),
    pickupWindowTo: iso(row.pickup_window_to),
    deliveryWindowFrom: iso(row.delivery_window_from),
    deliveryWindowTo: iso(row.delivery_window_to),
    requestedVehicleType: row.requested_vehicle_type,
    totalWeightKg: numberOrNull(row.total_weight_kg),
    totalVolumeCbm: numberOrNull(row.total_volume_cbm),
    cargoValueAmount: numberOrNull(row.cargo_value_amount),
    currency: row.currency,
    customerRateAmount: numberOrNull(row.customer_rate_amount),
    carrierCostAmount: numberOrNull(row.carrier_cost_amount),
    platformCommissionAmount: numberOrNull(row.platform_commission_amount),
    marginAmount: numberOrNull(row.margin_amount),
    assignedCarrierId: row.assigned_carrier_id,
    assignedDriverId: row.assigned_driver_id,
    assignedVehicleId: row.assigned_vehicle_id,
    sourceChannel: row.source_channel,
    notes: row.notes,
    metadata: row.metadata ?? {},
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    legacyBookingView: shipmentToBookingView(row),
  };
}

export function legacyBookingToShipmentInput(args: {
  tenantId: string;
  booking: {
    id: string;
    bookingRef?: string | null;
    requestorId?: string | null;
    requestorName?: string | null;
    requestorEmail?: string | null;
    startDate?: Date | string | null;
    endDate?: Date | string | null;
    vehicleCategory?: string | null;
    vehicleId?: string | null;
    notes?: string | null;
    status?: string | null;
  };
  actorUserId?: string | null;
}): LogisticsShipmentCreateInput {
  const notes = parseJsonRecord(args.booking.notes);
  const text = (...keys: string[]) => {
    for (const key of keys) {
      const value = notes[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
  };

  return {
    tenantId: args.tenantId,
    shipmentNo: args.booking.bookingRef ?? null,
    legacyBookingId: args.booking.id,
    cargoOwnerCustomerId: args.booking.requestorId ?? text('customerId', 'cargoOwnerCustomerId'),
    cargoOwnerName: args.booking.requestorName ?? text('customerName', 'cargoOwnerName'),
    cargoOwnerEmail: args.booking.requestorEmail ?? text('customerEmail', 'cargoOwnerEmail'),
    cargoOwnerPhone: text('customerPhone', 'cargoOwnerPhone'),
    shipmentType: text('shipmentType') ?? args.booking.vehicleCategory ?? null,
    bookingMode: text('bookingMode') ?? 'SPOT',
    marketplaceStatus: text('marketplaceStatus') ?? 'PRIVATE',
    status: normalizeBookingStatus(args.booking.status),
    originName: text('origin', 'originName', 'pickupLocation'),
    originAddress: text('originAddress'),
    destinationName: text('destination', 'destinationName', 'dropoffLocation'),
    destinationAddress: text('destinationAddress'),
    pickupWindowFrom: args.booking.startDate ?? null,
    deliveryWindowTo: args.booking.endDate ?? null,
    requestedVehicleType: text('vehicleType') ?? args.booking.vehicleCategory ?? null,
    totalWeightKg: typeof notes.weightKg === 'number' ? notes.weightKg : null,
    totalVolumeCbm: typeof notes.volumeCbm === 'number' ? notes.volumeCbm : null,
    cargoValueAmount: typeof notes.cargoValueAED === 'number' ? notes.cargoValueAED : null,
    currency: text('currency') ?? 'AED',
    assignedDriverId: text('driverId'),
    assignedVehicleId: args.booking.vehicleId ?? text('vehicleId'),
    sourceChannel: text('sourceChannel') ?? 'legacy-booking',
    notes: args.booking.notes ?? null,
    metadata: {
      legacyBookingRef: args.booking.bookingRef ?? null,
      legacyNotes: notes,
      adapterVersion: 1,
    },
    createdBy: args.actorUserId ?? 'legacy-adapter',
  };
}

export async function backfillLegacyLogisticsBookings(args: {
  tenantId: string;
  actorUserId?: string | null;
  limit?: number;
  dryRun?: boolean;
}) {
  await ensureLogisticsDomainTables();
  const limit = Math.min(Math.max(args.limit ?? 250, 1), 1000);
  const rows = await prisma.$queryRawUnsafe<LegacyBookingRaw[]>(
    `SELECT b.id,
            b.booking_ref,
            b.requestor_id,
            b.requestor_name,
            b.requestor_email,
            b.start_date,
            b.end_date,
            b.vehicle_category,
            b.vehicle_id,
            b.notes,
            b.status
       FROM bookings b
       LEFT JOIN logistics_shipment_orders so
         ON so.legacy_booking_id = b.id
        AND so.deleted_at IS NULL
      WHERE b.deleted_at IS NULL
        AND b.service_type = 'LOGISTICS'
        AND so.id IS NULL
      ORDER BY b.created_at DESC
      LIMIT $1`,
    limit,
  );

  if (args.dryRun) {
    return {
      scanned: rows.length,
      created: 0,
      dryRun: true,
      legacyBookingIds: rows.map(row => row.id),
    };
  }

  let created = 0;
  const shipmentIds: string[] = [];
  for (const row of rows) {
    const shipment = await createShipmentOrder(legacyBookingToShipmentInput({
      tenantId: args.tenantId,
      actorUserId: args.actorUserId ?? 'logistics-backfill',
      booking: {
        id: row.id,
        bookingRef: row.booking_ref,
        requestorId: row.requestor_id,
        requestorName: row.requestor_name,
        requestorEmail: row.requestor_email,
        startDate: row.start_date,
        endDate: row.end_date,
        vehicleCategory: row.vehicle_category,
        vehicleId: row.vehicle_id,
        notes: row.notes,
        status: row.status,
      },
    }));
    if (shipment) {
      created += 1;
      shipmentIds.push(shipment.id);
    }
  }

  return {
    scanned: rows.length,
    created,
    dryRun: false,
    shipmentIds,
  };
}

export async function fetchShipmentById(id: string, tenantId?: string | null) {
  await ensureLogisticsDomainTables();
  const rows = await prisma.$queryRawUnsafe<LogisticsShipmentRow[]>(
    `SELECT * FROM logistics_shipment_orders
      WHERE id = $1
        AND deleted_at IS NULL
        AND ($2::text IS NULL OR tenant_id = $2)
      LIMIT 1`,
    id,
    tenantId ?? null,
  );
  return rows[0] ?? null;
}

export async function listShipmentOrders(args: {
  tenantId?: string | null;
  status?: string | null;
  search?: string | null;
  limit?: number;
}) {
  await ensureLogisticsDomainTables();
  const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
  const rows = await prisma.$queryRawUnsafe<Array<LogisticsShipmentRow & {
    stop_count: bigint | number | string;
    cargo_line_count: bigint | number | string;
    customer_charge_total: string | number | null;
    carrier_charge_total: string | number | null;
    customer_policy_configured: boolean | null;
    customer_rfq_enabled: boolean | null;
    customer_bid_submission_enabled: boolean | null;
    customer_direct_assignment_enabled: boolean | null;
    customer_default_procurement_mode: string | null;
    customer_require_rfq_before_award: boolean | null;
    customer_marketplace_notes: string | null;
    customer_marketplace_updated_at: Date | null;
    customer_marketplace_updated_by: string | null;
  }>>(
    `SELECT so.*,
            COUNT(DISTINCT st.id) AS stop_count,
            COUNT(DISTINCT cl.id) AS cargo_line_count,
            COALESCE(SUM(fc.total_amount) FILTER (WHERE fc.charge_side = 'CUSTOMER'), 0) AS customer_charge_total,
            COALESCE(SUM(fc.total_amount) FILTER (WHERE fc.charge_side = 'CARRIER'), 0) AS carrier_charge_total,
            (cms.id IS NOT NULL) AS customer_policy_configured,
            cms.rfq_enabled AS customer_rfq_enabled,
            cms.bid_submission_enabled AS customer_bid_submission_enabled,
            cms.direct_assignment_enabled AS customer_direct_assignment_enabled,
            cms.default_procurement_mode AS customer_default_procurement_mode,
            cms.require_rfq_before_award AS customer_require_rfq_before_award,
            cms.notes AS customer_marketplace_notes,
            cms.updated_at AS customer_marketplace_updated_at,
            cms.updated_by AS customer_marketplace_updated_by
       FROM logistics_shipment_orders so
       LEFT JOIN logistics_shipment_stops st ON st.shipment_order_id = so.id
       LEFT JOIN logistics_cargo_lines cl ON cl.shipment_order_id = so.id
       LEFT JOIN logistics_freight_charges fc ON fc.shipment_order_id = so.id
       LEFT JOIN logistics_customer_marketplace_settings cms
         ON cms.tenant_id = so.tenant_id
        AND cms.customer_id = so.cargo_owner_customer_id
      WHERE so.deleted_at IS NULL
        AND ($1::text IS NULL OR so.tenant_id = $1)
        AND ($2::text IS NULL OR so.status = $2)
        AND (
          $3::text IS NULL
          OR so.shipment_no ILIKE '%' || $3 || '%'
          OR so.cargo_owner_name ILIKE '%' || $3 || '%'
          OR so.origin_name ILIKE '%' || $3 || '%'
          OR so.destination_name ILIKE '%' || $3 || '%'
        )
      GROUP BY so.id
             , cms.id
             , cms.rfq_enabled
             , cms.bid_submission_enabled
             , cms.direct_assignment_enabled
             , cms.default_procurement_mode
             , cms.require_rfq_before_award
             , cms.notes
             , cms.updated_at
             , cms.updated_by
      ORDER BY so.created_at DESC
      LIMIT $4`,
    args.tenantId ?? null,
    args.status ?? null,
    args.search || null,
    limit,
  );

  return rows.map(row => ({
    id: row.id,
    tenantId: row.tenant_id,
    shipmentNo: row.shipment_no,
    legacyBookingId: row.legacy_booking_id,
    cargoOwnerCustomerId: row.cargo_owner_customer_id,
    cargoOwnerName: row.cargo_owner_name,
    cargoOwnerEmail: row.cargo_owner_email,
    cargoOwnerPhone: row.cargo_owner_phone,
    shipmentType: row.shipment_type,
    bookingMode: row.booking_mode,
    marketplaceStatus: row.marketplace_status,
    status: row.status,
    priority: row.priority,
    originName: row.origin_name,
    originAddress: row.origin_address,
    destinationName: row.destination_name,
    destinationAddress: row.destination_address,
    pickupWindowFrom: iso(row.pickup_window_from),
    pickupWindowTo: iso(row.pickup_window_to),
    deliveryWindowFrom: iso(row.delivery_window_from),
    deliveryWindowTo: iso(row.delivery_window_to),
    requestedVehicleType: row.requested_vehicle_type,
    totalWeightKg: numberOrNull(row.total_weight_kg),
    totalVolumeCbm: numberOrNull(row.total_volume_cbm),
    cargoValueAmount: numberOrNull(row.cargo_value_amount),
    currency: row.currency,
    customerRateAmount: numberOrNull(row.customer_rate_amount),
    carrierCostAmount: numberOrNull(row.carrier_cost_amount),
    platformCommissionAmount: numberOrNull(row.platform_commission_amount),
    marginAmount: numberOrNull(row.margin_amount),
    assignedCarrierId: row.assigned_carrier_id,
    assignedDriverId: row.assigned_driver_id,
    assignedVehicleId: row.assigned_vehicle_id,
    sourceChannel: row.source_channel,
    notes: row.notes,
    metadata: row.metadata ?? {},
    stopCount: Number(row.stop_count ?? 0),
    cargoLineCount: Number(row.cargo_line_count ?? 0),
    customerChargeTotal: numberOrNull(row.customer_charge_total),
    carrierChargeTotal: numberOrNull(row.carrier_charge_total),
    customerMarketplacePolicy: mapJoinedCustomerMarketplacePolicy(row),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    legacyBookingView: shipmentToBookingView(row),
  }));
}

export async function createShipmentOrder(input: LogisticsShipmentCreateInput) {
  await ensureLogisticsDomainTables();
  await assertShipmentMasterDataGovernance(input);
  const validation = assertShipmentTimelineValid(input);
  const shipmentNo = input.shipmentNo || await nextShipmentNo(input.tenantId);

  const rows = await prisma.$queryRawUnsafe<LogisticsShipmentRow[]>(
    `INSERT INTO logistics_shipment_orders (
       tenant_id, shipment_no, legacy_booking_id,
       cargo_owner_customer_id, cargo_owner_name, cargo_owner_email, cargo_owner_phone,
       shipment_type, booking_mode, marketplace_status, status, priority,
       origin_name, origin_address, destination_name, destination_address,
       pickup_window_from, pickup_window_to, delivery_window_from, delivery_window_to,
       requested_vehicle_type, total_weight_kg, total_volume_cbm, cargo_value_amount,
       currency, customer_rate_amount, carrier_cost_amount, platform_commission_amount,
       margin_amount, assigned_carrier_id, assigned_driver_id, assigned_vehicle_id,
       source_channel, notes, metadata, created_by, updated_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
       $17::timestamptz,$18::timestamptz,$19::timestamptz,$20::timestamptz,
       $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35::jsonb,$36,$36
     )
     ON CONFLICT (legacy_booking_id)
     DO UPDATE SET
       updated_at = NOW(),
       status = EXCLUDED.status,
       assigned_driver_id = COALESCE(EXCLUDED.assigned_driver_id, logistics_shipment_orders.assigned_driver_id),
       assigned_vehicle_id = COALESCE(EXCLUDED.assigned_vehicle_id, logistics_shipment_orders.assigned_vehicle_id),
       metadata = COALESCE(EXCLUDED.metadata, logistics_shipment_orders.metadata),
       updated_by = EXCLUDED.updated_by
     RETURNING *`,
    input.tenantId,
    shipmentNo,
    input.legacyBookingId ?? null,
    input.cargoOwnerCustomerId ?? null,
    input.cargoOwnerName ?? null,
    input.cargoOwnerEmail ?? null,
    input.cargoOwnerPhone ?? null,
    input.shipmentType ?? null,
    input.bookingMode ?? 'SPOT',
    input.marketplaceStatus ?? 'PRIVATE',
    input.status ?? 'DRAFT',
    input.priority ?? 'NORMAL',
    input.originName ?? null,
    input.originAddress ?? null,
    input.destinationName ?? null,
    input.destinationAddress ?? null,
    iso(input.pickupWindowFrom),
    iso(input.pickupWindowTo),
    iso(input.deliveryWindowFrom),
    iso(input.deliveryWindowTo),
    input.requestedVehicleType ?? null,
    input.totalWeightKg ?? null,
    input.totalVolumeCbm ?? null,
    input.cargoValueAmount ?? null,
    input.currency ?? 'AED',
    input.customerRateAmount ?? null,
    input.carrierCostAmount ?? null,
    input.platformCommissionAmount ?? null,
    input.marginAmount ?? null,
    input.assignedCarrierId ?? null,
    input.assignedDriverId ?? null,
    input.assignedVehicleId ?? null,
    input.sourceChannel ?? null,
    input.notes ?? null,
    jsonParam(input.metadata ?? {}),
    input.createdBy ?? null,
  );

  const shipment = rows[0];
  if (!shipment) throw new Error('Shipment creation failed');

  await replaceShipmentDetails({
    tenantId: input.tenantId,
    shipmentOrderId: shipment.id,
    cargoLines: input.cargoLines,
    stops: input.stops,
    freightCharges: input.freightCharges,
  });

  await addTrackingEvent({
    tenantId: shipment.tenant_id,
    shipmentOrderId: shipment.id,
    eventType: 'SHIPMENT_CREATED',
    status: shipment.status,
    source: 'DOMAIN_ADAPTER',
    notes: shipment.legacy_booking_id ? 'Created from legacy logistics booking' : 'Created from shipment-native API',
    metadata: { validationWarnings: validation.warnings },
  });

  await logLogisticsAudit({
    tenantId: shipment.tenant_id,
    entityType: 'LogisticsShipment',
    entityId: shipment.id,
    entityName: shipment.shipment_no,
    action: 'CREATE',
    actorUserId: input.createdBy ?? null,
    summary: `Created logistics shipment ${shipment.shipment_no}`,
    after: {
      shipmentNo: shipment.shipment_no,
      status: shipment.status,
      originName: shipment.origin_name,
      destinationName: shipment.destination_name,
      pickupWindowFrom: iso(shipment.pickup_window_from),
      deliveryWindowTo: iso(shipment.delivery_window_to),
      validationWarnings: validation.warnings,
    },
  });

  return fetchShipmentById(shipment.id, input.tenantId);
}

export async function updateShipmentOrder(input: LogisticsShipmentUpdateInput) {
  await ensureLogisticsDomainTables();
  const before = await fetchShipmentById(input.shipmentOrderId, input.tenantId);
  if (!before) throw new LogisticsValidationError(['Shipment was not found for this tenant.']);
  await assertShipmentMasterDataGovernance({
    tenantId: input.tenantId,
    cargoOwnerCustomerId: input.cargoOwnerCustomerId ?? before.cargo_owner_customer_id,
    cargoOwnerName: input.cargoOwnerName ?? before.cargo_owner_name,
    shipmentType: input.shipmentType ?? before.shipment_type,
    originName: input.originName ?? before.origin_name,
    destinationName: input.destinationName ?? before.destination_name,
    requestedVehicleType: input.requestedVehicleType ?? before.requested_vehicle_type,
    metadata: {
      ...(before.metadata ?? {}),
      ...(input.metadata ?? {}),
    },
  });

  const validation = assertShipmentTimelineValid({
    pickupWindowFrom: input.pickupWindowFrom ?? before.pickup_window_from,
    pickupWindowTo: input.pickupWindowTo ?? before.pickup_window_to,
    deliveryWindowFrom: input.deliveryWindowFrom ?? before.delivery_window_from,
    deliveryWindowTo: input.deliveryWindowTo ?? before.delivery_window_to,
    originName: input.originName ?? before.origin_name,
    destinationName: input.destinationName ?? before.destination_name,
    stops: input.stops,
  });

  const rows = await prisma.$queryRawUnsafe<LogisticsShipmentRow[]>(
    `UPDATE logistics_shipment_orders
        SET cargo_owner_customer_id = COALESCE($1, cargo_owner_customer_id),
            cargo_owner_name = COALESCE($2, cargo_owner_name),
            cargo_owner_email = COALESCE($3, cargo_owner_email),
            cargo_owner_phone = COALESCE($4, cargo_owner_phone),
            shipment_type = COALESCE($5, shipment_type),
            booking_mode = COALESCE($6, booking_mode),
            marketplace_status = COALESCE($7, marketplace_status),
            status = COALESCE($8, status),
            priority = COALESCE($9, priority),
            origin_name = COALESCE($10, origin_name),
            origin_address = COALESCE($11, origin_address),
            destination_name = COALESCE($12, destination_name),
            destination_address = COALESCE($13, destination_address),
            pickup_window_from = COALESCE($14::timestamptz, pickup_window_from),
            pickup_window_to = COALESCE($15::timestamptz, pickup_window_to),
            delivery_window_from = COALESCE($16::timestamptz, delivery_window_from),
            delivery_window_to = COALESCE($17::timestamptz, delivery_window_to),
            requested_vehicle_type = COALESCE($18, requested_vehicle_type),
            total_weight_kg = COALESCE($19, total_weight_kg),
            total_volume_cbm = COALESCE($20, total_volume_cbm),
            cargo_value_amount = COALESCE($21, cargo_value_amount),
            currency = COALESCE($22, currency),
            customer_rate_amount = COALESCE($23, customer_rate_amount),
            carrier_cost_amount = COALESCE($24, carrier_cost_amount),
            platform_commission_amount = COALESCE($25, platform_commission_amount),
            margin_amount = COALESCE($26, margin_amount),
            assigned_carrier_id = COALESCE($27, assigned_carrier_id),
            assigned_driver_id = COALESCE($28, assigned_driver_id),
            assigned_vehicle_id = COALESCE($29, assigned_vehicle_id),
            source_channel = COALESCE($30, source_channel),
            notes = COALESCE($31, notes),
            metadata = COALESCE(metadata, '{}'::jsonb) || $32::jsonb,
            updated_by = $33,
            updated_at = NOW()
      WHERE tenant_id = $34
        AND id = $35
        AND deleted_at IS NULL
      RETURNING *`,
    input.cargoOwnerCustomerId ?? null,
    input.cargoOwnerName ?? null,
    input.cargoOwnerEmail ?? null,
    input.cargoOwnerPhone ?? null,
    input.shipmentType ?? null,
    input.bookingMode ?? null,
    input.marketplaceStatus ?? null,
    input.status ?? null,
    input.priority ?? null,
    input.originName ?? null,
    input.originAddress ?? null,
    input.destinationName ?? null,
    input.destinationAddress ?? null,
    iso(input.pickupWindowFrom),
    iso(input.pickupWindowTo),
    iso(input.deliveryWindowFrom),
    iso(input.deliveryWindowTo),
    input.requestedVehicleType ?? null,
    input.totalWeightKg ?? null,
    input.totalVolumeCbm ?? null,
    input.cargoValueAmount ?? null,
    input.currency ?? null,
    input.customerRateAmount ?? null,
    input.carrierCostAmount ?? null,
    input.platformCommissionAmount ?? null,
    input.marginAmount ?? null,
    input.assignedCarrierId ?? null,
    input.assignedDriverId ?? null,
    input.assignedVehicleId ?? null,
    input.sourceChannel ?? null,
    input.notes ?? null,
    jsonParam({
      ...(input.metadata ?? {}),
      governedDataModel: true,
      validationWarnings: validation.warnings,
    }),
    input.updatedBy ?? null,
    input.tenantId,
    input.shipmentOrderId,
  );

  const updated = rows[0];
  if (!updated) throw new LogisticsValidationError(['Shipment was not found for this tenant.']);

  if (input.cargoLines || input.stops || input.freightCharges) {
    await replaceShipmentDetails({
      tenantId: input.tenantId,
      shipmentOrderId: input.shipmentOrderId,
      cargoLines: input.cargoLines,
      stops: input.stops,
      freightCharges: input.freightCharges,
    });
  }

  if (updated.legacy_booking_id) {
    await prisma.booking.update({
      where: { id: updated.legacy_booking_id },
      data: {
        requestorId: updated.cargo_owner_customer_id,
        requestorName: updated.cargo_owner_name,
        requestorEmail: updated.cargo_owner_email,
        startDate: updated.pickup_window_from ?? undefined,
        endDate: updated.delivery_window_to ?? undefined,
        vehicleCategory: updated.requested_vehicle_type ?? updated.shipment_type,
        vehicleId: updated.assigned_vehicle_id,
        status: updated.status,
        notes: JSON.stringify({
          ...(updated.metadata ?? {}),
          shipmentId: updated.id,
          shipmentNo: updated.shipment_no,
          origin: updated.origin_name ?? updated.origin_address,
          destination: updated.destination_name ?? updated.destination_address,
          shipmentType: updated.shipment_type,
          driverId: updated.assigned_driver_id,
        }),
      },
    }).catch(() => null);
  }

  await addTrackingEvent({
    tenantId: input.tenantId,
    shipmentOrderId: input.shipmentOrderId,
    eventType: 'SHIPMENT_UPDATED',
    status: updated.status,
    source: 'GOVERNED_LOGISTICS_UI',
    notes: 'Shipment updated through governed master-data form',
    metadata: {
      validationWarnings: validation.warnings,
      updatedBy: input.updatedBy ?? null,
    },
  });

  await logLogisticsAudit({
    tenantId: input.tenantId,
    entityType: 'LogisticsShipment',
    entityId: input.shipmentOrderId,
    entityName: updated.shipment_no,
    action: 'UPDATE',
    actorUserId: input.updatedBy ?? null,
    summary: `Updated logistics shipment ${updated.shipment_no}`,
    before: {
      status: before.status,
      cargoOwnerName: before.cargo_owner_name,
      originName: before.origin_name,
      destinationName: before.destination_name,
      pickupWindowFrom: iso(before.pickup_window_from),
      deliveryWindowTo: iso(before.delivery_window_to),
    },
    after: {
      status: updated.status,
      cargoOwnerName: updated.cargo_owner_name,
      originName: updated.origin_name,
      destinationName: updated.destination_name,
      pickupWindowFrom: iso(updated.pickup_window_from),
      deliveryWindowTo: iso(updated.delivery_window_to),
      validationWarnings: validation.warnings,
    },
  });

  return fetchShipmentById(input.shipmentOrderId, input.tenantId);
}

export async function replaceShipmentDetails(args: {
  tenantId: string;
  shipmentOrderId: string;
  cargoLines?: LogisticsCargoLineInput[];
  stops?: LogisticsStopInput[];
  freightCharges?: LogisticsFreightChargeInput[];
}) {
  if (args.stops) {
    const shipmentRows = await prisma.$queryRawUnsafe<Array<{
      pickup_window_from: Date | null;
      pickup_window_to: Date | null;
      delivery_window_from: Date | null;
      delivery_window_to: Date | null;
      origin_name: string | null;
      destination_name: string | null;
    }>>(
      `SELECT pickup_window_from, pickup_window_to, delivery_window_from, delivery_window_to,
              origin_name, destination_name
         FROM logistics_shipment_orders
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
        LIMIT 1`,
      args.tenantId,
      args.shipmentOrderId,
    );
    const shipment = shipmentRows[0];
    if (shipment) {
      assertShipmentTimelineValid({
        pickupWindowFrom: shipment.pickup_window_from,
        pickupWindowTo: shipment.pickup_window_to,
        deliveryWindowFrom: shipment.delivery_window_from,
        deliveryWindowTo: shipment.delivery_window_to,
        originName: shipment.origin_name,
        destinationName: shipment.destination_name,
        stops: args.stops,
      });
    }
  }

  if (args.cargoLines) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM logistics_cargo_lines WHERE tenant_id = $1 AND shipment_order_id = $2`,
      args.tenantId,
      args.shipmentOrderId,
    );
    for (const line of args.cargoLines) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO logistics_cargo_lines
           (tenant_id, shipment_order_id, description, commodity_code, quantity, package_type,
            weight_kg, volume_cbm, is_hazmat, temp_min_c, temp_max_c, cargo_value_amount, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)`,
        args.tenantId,
        args.shipmentOrderId,
        line.description,
        line.commodityCode ?? null,
        line.quantity ?? null,
        line.packageType ?? null,
        line.weightKg ?? null,
        line.volumeCbm ?? null,
        line.isHazmat ?? false,
        line.tempMinC ?? null,
        line.tempMaxC ?? null,
        line.cargoValueAmount ?? null,
        jsonParam(line.metadata ?? {}),
      );
    }
  }

  if (args.stops) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM logistics_shipment_stops WHERE tenant_id = $1 AND shipment_order_id = $2`,
      args.tenantId,
      args.shipmentOrderId,
    );
    for (const [index, stop] of args.stops.entries()) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO logistics_shipment_stops
           (tenant_id, shipment_order_id, sequence_no, stop_type, location_name, address,
            contact_name, contact_phone, latitude, longitude, planned_arrival_at, planned_depart_at,
            instructions, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz,$12::timestamptz,$13,$14::jsonb)`,
        args.tenantId,
        args.shipmentOrderId,
        stop.sequenceNo ?? index + 1,
        stop.stopType,
        stop.locationName ?? null,
        stop.address ?? null,
        stop.contactName ?? null,
        stop.contactPhone ?? null,
        stop.latitude ?? null,
        stop.longitude ?? null,
        iso(stop.plannedArrivalAt),
        iso(stop.plannedDepartAt),
        stop.instructions ?? null,
        jsonParam(stop.metadata ?? {}),
      );
    }
  }

  if (args.freightCharges) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM logistics_freight_charges WHERE tenant_id = $1 AND shipment_order_id = $2`,
      args.tenantId,
      args.shipmentOrderId,
    );
    for (const charge of args.freightCharges) {
      const quantity = charge.quantity ?? 1;
      const unitRate = charge.unitRate ?? 0;
      const amount = charge.amount ?? quantity * unitRate;
      const taxAmount = charge.taxAmount ?? 0;
      const totalAmount = charge.totalAmount ?? amount + taxAmount;
      await prisma.$executeRawUnsafe(
        `INSERT INTO logistics_freight_charges
           (tenant_id, shipment_order_id, charge_side, charge_type, description, quantity,
            unit_rate, amount, tax_amount, total_amount, currency, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
        args.tenantId,
        args.shipmentOrderId,
        charge.chargeSide,
        charge.chargeType,
        charge.description ?? null,
        quantity,
        unitRate,
        amount,
        taxAmount,
        totalAmount,
        charge.currency ?? 'AED',
        jsonParam(charge.metadata ?? {}),
      );
    }
  }
}

export async function ensureShipmentForLegacyBooking(args: {
  tenantId: string;
  bookingId: string;
  actorUserId?: string | null;
}) {
  await ensureLogisticsDomainTables();
  const existing = await prisma.$queryRawUnsafe<LogisticsShipmentRow[]>(
    `SELECT * FROM logistics_shipment_orders
      WHERE legacy_booking_id = $1
        AND tenant_id = $2
        AND deleted_at IS NULL
      LIMIT 1`,
    args.bookingId,
    args.tenantId,
  );
  if (existing[0]) return existing[0];

  const booking = await prisma.booking.findUnique({ where: { id: args.bookingId } });
  if (!booking || booking.serviceType !== 'LOGISTICS') return null;

  return createShipmentOrder(legacyBookingToShipmentInput({
    tenantId: args.tenantId,
    booking,
    actorUserId: args.actorUserId,
  }));
}

export async function syncShipmentStatusFromBooking(args: {
  tenantId: string;
  bookingId: string;
  status: string;
  actorUserId?: string | null;
  note?: string | null;
  metadata?: JsonRecord | null;
}) {
  const shipment = await ensureShipmentForLegacyBooking({
    tenantId: args.tenantId,
    bookingId: args.bookingId,
    actorUserId: args.actorUserId,
  });
  if (!shipment) return null;

  const booking = await prisma.booking.findUnique({ where: { id: args.bookingId } });
  const bookingNotes = parseJsonRecord(booking?.notes);
  const assignedDriverId = typeof bookingNotes.driverId === 'string' ? bookingNotes.driverId : null;
  const assignedVehicleId = booking?.vehicleId ?? (typeof bookingNotes.vehicleId === 'string' ? bookingNotes.vehicleId : null);
  const normalized = normalizeBookingStatus(args.status);
  const rows = await prisma.$queryRawUnsafe<LogisticsShipmentRow[]>(
    `UPDATE logistics_shipment_orders
        SET status = $1,
            updated_at = NOW(),
            updated_by = $2,
            assigned_driver_id = COALESCE($3, assigned_driver_id),
            assigned_vehicle_id = COALESCE($4, assigned_vehicle_id),
            metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb
      WHERE id = $6 AND tenant_id = $7
      RETURNING *`,
    normalized,
    args.actorUserId ?? 'legacy-adapter',
    assignedDriverId,
    assignedVehicleId,
    jsonParam(args.metadata ?? {}),
    shipment.id,
    args.tenantId,
  );
  const updatedShipment = rows[0] ?? shipment;

  await syncCarrierVehicleAvailability({
    tenantId: args.tenantId,
    carrierId: updatedShipment.assigned_carrier_id,
    vehicleId: updatedShipment.assigned_vehicle_id,
    shipmentStatus: normalized,
    actorUserId: args.actorUserId ?? null,
  });

  await addTrackingEvent({
    tenantId: args.tenantId,
    shipmentOrderId: shipment.id,
    eventType: 'STATUS_CHANGED',
    status: normalized,
    source: 'LEGACY_BOOKING_STATUS',
    notes: args.note ?? null,
    metadata: {
      legacyBookingId: args.bookingId,
      rawStatus: args.status,
      ...(args.metadata ?? {}),
    },
  });

  return updatedShipment;
}

export async function addTrackingEvent(args: {
  tenantId: string;
  shipmentOrderId: string;
  assignmentId?: string | null;
  eventType: string;
  status?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  source?: string | null;
  occurredAt?: string | Date | null;
  notes?: string | null;
  metadata?: JsonRecord | null;
}) {
  await ensureLogisticsDomainTables();
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO logistics_tracking_events
       (tenant_id, shipment_order_id, assignment_id, event_type, status,
        latitude, longitude, source, occurred_at, notes, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10,$11::jsonb)
     RETURNING id`,
    args.tenantId,
    args.shipmentOrderId,
    args.assignmentId ?? null,
    args.eventType,
    args.status ?? null,
    args.latitude ?? null,
    args.longitude ?? null,
    args.source ?? 'SYSTEM',
    iso(args.occurredAt) ?? new Date().toISOString(),
    args.notes ?? null,
    jsonParam(args.metadata ?? {}),
  );

  await logLogisticsAudit({
    tenantId: args.tenantId,
    entityType: 'LogisticsTrackingEvent',
    entityId: rows[0]?.id ?? null,
    entityName: args.eventType,
    action: 'CREATE',
    summary: `${args.eventType} recorded for logistics shipment`,
    after: {
      shipmentOrderId: args.shipmentOrderId,
      status: args.status ?? null,
      source: args.source ?? 'SYSTEM',
      occurredAt: iso(args.occurredAt) ?? new Date().toISOString(),
    },
    metadata: { source: args.source ?? 'SYSTEM' },
  });
}

export async function createLegacyBookingForShipment(args: {
  shipment: LogisticsShipmentRow;
  actorUserId?: string | null;
}) {
  if (args.shipment.legacy_booking_id) return args.shipment.legacy_booking_id;

  const notes = {
    shipmentId: args.shipment.id,
    shipmentNo: args.shipment.shipment_no,
    origin: args.shipment.origin_name ?? args.shipment.origin_address,
    destination: args.shipment.destination_name ?? args.shipment.destination_address,
    shipmentType: args.shipment.shipment_type,
    marketplaceStatus: args.shipment.marketplace_status,
    bookingMode: args.shipment.booking_mode,
    sourceChannel: 'shipment-domain-adapter',
  };

  const booking = await prisma.booking.create({
    data: {
      bookingRef: args.shipment.shipment_no,
      serviceType: 'LOGISTICS',
      requestorId: args.shipment.cargo_owner_customer_id,
      requestorName: args.shipment.cargo_owner_name,
      requestorEmail: args.shipment.cargo_owner_email,
      startDate: args.shipment.pickup_window_from ?? new Date(),
      endDate: args.shipment.delivery_window_to,
      vehicleCategory: args.shipment.requested_vehicle_type ?? args.shipment.shipment_type,
      vehicleId: args.shipment.assigned_vehicle_id,
      notes: JSON.stringify(notes),
      status: args.shipment.status === 'DRAFT' ? 'PENDING' : args.shipment.status,
    },
  });

  await prisma.$executeRawUnsafe(
    `UPDATE logistics_shipment_orders
        SET legacy_booking_id = $1,
            updated_by = $2,
            updated_at = NOW()
      WHERE id = $3`,
    booking.id,
    args.actorUserId ?? 'shipment-domain-adapter',
    args.shipment.id,
  );

  return booking.id;
}

export async function listCarriers(args: {
  tenantId: string;
  status?: string | null;
  search?: string | null;
  limit?: number;
}) {
  await ensureLogisticsDomainTables();
  const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
  const rows = await prisma.$queryRawUnsafe<LogisticsCarrierRow[]>(
    `SELECT *
       FROM logistics_carriers
      WHERE tenant_id = $1
        AND deleted_at IS NULL
        AND ($2::text IS NULL OR status = $2)
        AND (
          $3::text IS NULL
          OR name ILIKE '%' || $3 || '%'
          OR carrier_code ILIKE '%' || $3 || '%'
          OR contact_email ILIKE '%' || $3 || '%'
          OR contact_phone ILIKE '%' || $3 || '%'
        )
      ORDER BY created_at DESC
      LIMIT $4`,
    args.tenantId,
    args.status ?? null,
    args.search || null,
    limit,
  );

  return rows.map(row => ({
    id: row.id,
    tenantId: row.tenant_id,
    carrierCode: row.carrier_code,
    carrierType: row.carrier_type,
    name: row.name,
    tradeLicense: row.trade_license,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    status: row.status,
    onboardingStatus: row.onboarding_status,
    complianceStatus: row.compliance_status,
    serviceRegions: row.service_regions,
    capacityProfile: row.capacity_profile,
    commissionModel: row.commission_model,
    commissionRate: numberOrNull(row.commission_rate),
    marginRuleJson: row.margin_rule_json,
    metadata: row.metadata ?? {},
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }));
}

export async function createCarrier(input: LogisticsCarrierInput) {
  await ensureLogisticsDomainTables();
  const rows = await prisma.$queryRawUnsafe<LogisticsCarrierRow[]>(
    `INSERT INTO logistics_carriers (
       tenant_id, carrier_code, carrier_type, name, trade_license,
       contact_name, contact_email, contact_phone, status, onboarding_status,
       compliance_status, service_regions, capacity_profile, commission_model,
       commission_rate, margin_rule_json, metadata
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16::jsonb,$17::jsonb
     )
     ON CONFLICT (tenant_id, carrier_code)
     DO UPDATE SET
       updated_at = NOW(),
       carrier_type = EXCLUDED.carrier_type,
       name = EXCLUDED.name,
       trade_license = EXCLUDED.trade_license,
       contact_name = EXCLUDED.contact_name,
       contact_email = EXCLUDED.contact_email,
       contact_phone = EXCLUDED.contact_phone,
       status = EXCLUDED.status,
       onboarding_status = EXCLUDED.onboarding_status,
       compliance_status = EXCLUDED.compliance_status,
       service_regions = EXCLUDED.service_regions,
       capacity_profile = EXCLUDED.capacity_profile,
       commission_model = EXCLUDED.commission_model,
       commission_rate = EXCLUDED.commission_rate,
       margin_rule_json = EXCLUDED.margin_rule_json,
       metadata = EXCLUDED.metadata
     RETURNING *`,
    input.tenantId,
    input.carrierCode ?? null,
    input.carrierType ?? 'TRANSPORT_COMPANY',
    input.name,
    input.tradeLicense ?? null,
    input.contactName ?? null,
    input.contactEmail ?? null,
    input.contactPhone ?? null,
    input.status ?? 'ACTIVE',
    input.onboardingStatus ?? 'DRAFT',
    input.complianceStatus ?? 'PENDING',
    jsonParam(input.serviceRegions ?? []),
    jsonParam(input.capacityProfile ?? {}),
    input.commissionModel ?? null,
    input.commissionRate ?? null,
    jsonParam(input.marginRuleJson ?? {}),
    jsonParam(input.metadata ?? {}),
  );
  return rows[0] ?? null;
}

export async function updateCarrierCompliance(args: {
  tenantId: string;
  carrierId: string;
  onboardingStatus?: string | null;
  complianceStatus?: string | null;
  status?: string | null;
  serviceRegions?: unknown;
  capacityProfile?: unknown;
  commissionModel?: string | null;
  commissionRate?: number | null;
  documents?: unknown;
  notes?: string | null;
  actorUserId?: string | null;
}) {
  await ensureLogisticsDomainTables();
  const existing = await prisma.$queryRawUnsafe<LogisticsCarrierRow[]>(
    `SELECT *
       FROM logistics_carriers
      WHERE tenant_id = $1
        AND id = $2
        AND deleted_at IS NULL
      LIMIT 1`,
    args.tenantId,
    args.carrierId,
  );
  if (!existing[0]) throw new Error('Carrier not found for this tenant');

  const metadata = {
    ...(existing[0].metadata ?? {}),
    complianceDocuments: args.documents ?? (existing[0].metadata ?? {}).complianceDocuments ?? [],
    lastComplianceUpdate: {
      at: new Date().toISOString(),
      by: args.actorUserId ?? null,
      notes: args.notes ?? null,
    },
  };

  const rows = await prisma.$queryRawUnsafe<LogisticsCarrierRow[]>(
    `UPDATE logistics_carriers
        SET updated_at = NOW(),
            status = COALESCE($1, status),
            onboarding_status = COALESCE($2, onboarding_status),
            compliance_status = COALESCE($3, compliance_status),
            service_regions = COALESCE($4::jsonb, service_regions),
            capacity_profile = COALESCE($5::jsonb, capacity_profile),
            commission_model = COALESCE($6, commission_model),
            commission_rate = COALESCE($7, commission_rate),
            metadata = $8::jsonb
      WHERE tenant_id = $9
        AND id = $10
      RETURNING *`,
    args.status ?? null,
    args.onboardingStatus ?? null,
    args.complianceStatus ?? null,
    args.serviceRegions == null ? null : jsonParam(args.serviceRegions),
    args.capacityProfile == null ? null : jsonParam(args.capacityProfile),
    args.commissionModel ?? null,
    args.commissionRate ?? null,
    jsonParam(metadata),
    args.tenantId,
    args.carrierId,
  );

  return rows[0] ? {
    id: rows[0].id,
    tenantId: rows[0].tenant_id,
    carrierCode: rows[0].carrier_code,
    carrierType: rows[0].carrier_type,
    name: rows[0].name,
    status: rows[0].status,
    onboardingStatus: rows[0].onboarding_status,
    complianceStatus: rows[0].compliance_status,
    serviceRegions: rows[0].service_regions,
    capacityProfile: rows[0].capacity_profile,
    commissionModel: rows[0].commission_model,
    commissionRate: numberOrNull(rows[0].commission_rate),
    metadata: rows[0].metadata ?? {},
    updatedAt: iso(rows[0].updated_at),
  } : null;
}

function mapCarrierDocument(row: LogisticsCarrierDocumentRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    carrierId: row.carrier_id,
    documentType: row.document_type,
    documentName: row.document_name,
    documentUrl: row.document_url,
    storageKey: row.storage_key,
    fileName: row.file_name,
    mimeType: row.mime_type,
    fileSize: numberOrNull(row.file_size),
    status: row.status,
    issueDate: iso(row.issue_date)?.slice(0, 10) ?? null,
    expiryDate: iso(row.expiry_date)?.slice(0, 10) ?? null,
    verifiedBy: row.verified_by,
    verifiedAt: iso(row.verified_at),
    metadata: row.metadata ?? {},
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

async function refreshCarrierDocumentSummary(tenantId: string, carrierId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{
    total: string | number | bigint;
    pending: string | number | bigint;
    verified: string | number | bigint;
    expired: string | number | bigint;
    expiring_soon: string | number | bigint;
  }>>(
    `SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status IN ('PENDING_REVIEW','NEEDS_UPDATE')) AS pending,
        COUNT(*) FILTER (WHERE status = 'VERIFIED') AS verified,
        COUNT(*) FILTER (WHERE expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE) AS expired,
        COUNT(*) FILTER (
          WHERE expiry_date IS NOT NULL
            AND expiry_date >= CURRENT_DATE
            AND expiry_date <= CURRENT_DATE + INTERVAL '30 days'
        ) AS expiring_soon
       FROM logistics_carrier_documents
      WHERE tenant_id = $1
        AND carrier_id = $2
        AND deleted_at IS NULL`,
    tenantId,
    carrierId,
  );
  const summary = {
    total: Number(rows[0]?.total ?? 0),
    pending: Number(rows[0]?.pending ?? 0),
    verified: Number(rows[0]?.verified ?? 0),
    expired: Number(rows[0]?.expired ?? 0),
    expiringSoon: Number(rows[0]?.expiring_soon ?? 0),
    lastRefreshedAt: new Date().toISOString(),
  };
  await prisma.$executeRawUnsafe(
    `UPDATE logistics_carriers
        SET updated_at = NOW(),
            compliance_status = CASE
              WHEN $3::int > 0 THEN 'EXPIRED'
              WHEN $4::int > 0 THEN 'REVIEW_REQUIRED'
              WHEN $5::int > 0 AND $5::int = $6::int THEN 'COMPLIANT'
              ELSE compliance_status
            END,
            metadata = COALESCE(metadata, '{}'::jsonb) || $7::jsonb
      WHERE tenant_id = $1
        AND id = $2`,
    tenantId,
    carrierId,
    summary.expired,
    summary.pending,
    summary.verified,
    summary.total,
    jsonParam({ documentSummary: summary }),
  );
  return summary;
}

export async function listCarrierDocuments(args: {
  tenantId: string;
  carrierId: string;
  status?: string | null;
}) {
  await ensureLogisticsDomainTables();
  const rows = await prisma.$queryRawUnsafe<LogisticsCarrierDocumentRow[]>(
    `SELECT *
       FROM logistics_carrier_documents
      WHERE tenant_id = $1
        AND carrier_id = $2
        AND deleted_at IS NULL
        AND ($3::text IS NULL OR status = $3)
      ORDER BY
        CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END,
        expiry_date ASC,
        created_at DESC`,
    args.tenantId,
    args.carrierId,
    args.status ?? null,
  );
  return rows.map(mapCarrierDocument);
}

export async function upsertCarrierDocument(input: LogisticsCarrierDocumentInput) {
  await ensureLogisticsDomainTables();
  assertCarrierDocumentDates(input.issueDate, input.expiryDate);
  const carrierRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id
       FROM logistics_carriers
      WHERE tenant_id = $1
        AND id = $2
        AND deleted_at IS NULL
      LIMIT 1`,
    input.tenantId,
    input.carrierId,
  );
  if (!carrierRows[0]) throw new Error('Carrier not found for this tenant');

  const rows = await prisma.$queryRawUnsafe<LogisticsCarrierDocumentRow[]>(
    `INSERT INTO logistics_carrier_documents (
       tenant_id, carrier_id, document_type, document_name, document_url,
       storage_key, file_name, mime_type, file_size, status,
       issue_date, expiry_date, metadata
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::date,$12::date,$13::jsonb
     )
     RETURNING *`,
    input.tenantId,
    input.carrierId,
    input.documentType,
    input.documentName,
    input.documentUrl,
    input.storageKey ?? null,
    input.fileName ?? null,
    input.mimeType ?? null,
    input.fileSize ?? null,
    input.status ?? 'PENDING_REVIEW',
    input.issueDate ? new Date(input.issueDate).toISOString().slice(0, 10) : null,
    input.expiryDate ? new Date(input.expiryDate).toISOString().slice(0, 10) : null,
    jsonParam({
      ...(input.metadata ?? {}),
      uploadedBy: input.actorUserId ?? null,
      uploadedAt: new Date().toISOString(),
    }),
  );
  await refreshCarrierDocumentSummary(input.tenantId, input.carrierId);
  return rows[0] ? mapCarrierDocument(rows[0]) : null;
}

export async function updateCarrierDocumentStatus(args: {
  tenantId: string;
  carrierId: string;
  documentId: string;
  status?: string | null;
  documentName?: string | null;
  documentType?: string | null;
  issueDate?: string | Date | null;
  expiryDate?: string | Date | null;
  metadata?: JsonRecord | null;
  actorUserId?: string | null;
}) {
  await ensureLogisticsDomainTables();
  assertCarrierDocumentDates(args.issueDate, args.expiryDate);
  const rows = await prisma.$queryRawUnsafe<LogisticsCarrierDocumentRow[]>(
    `UPDATE logistics_carrier_documents
        SET updated_at = NOW(),
            status = COALESCE($1, status),
            document_name = COALESCE($2, document_name),
            document_type = COALESCE($3, document_type),
            issue_date = COALESCE($4::date, issue_date),
            expiry_date = COALESCE($5::date, expiry_date),
            verified_by = CASE WHEN $1 = 'VERIFIED' THEN $6 ELSE verified_by END,
            verified_at = CASE WHEN $1 = 'VERIFIED' THEN NOW() ELSE verified_at END,
            metadata = COALESCE(metadata, '{}'::jsonb) || $7::jsonb
      WHERE tenant_id = $8
        AND carrier_id = $9
        AND id = $10
        AND deleted_at IS NULL
      RETURNING *`,
    args.status ?? null,
    args.documentName ?? null,
    args.documentType ?? null,
    args.issueDate ? new Date(args.issueDate).toISOString().slice(0, 10) : null,
    args.expiryDate ? new Date(args.expiryDate).toISOString().slice(0, 10) : null,
    args.actorUserId ?? null,
    jsonParam({
      ...(args.metadata ?? {}),
      reviewedBy: args.actorUserId ?? null,
      reviewedAt: new Date().toISOString(),
    }),
    args.tenantId,
    args.carrierId,
    args.documentId,
  );
  if (!rows[0]) throw new Error('Carrier document not found for this tenant');
  await refreshCarrierDocumentSummary(args.tenantId, args.carrierId);
  return mapCarrierDocument(rows[0]);
}

function assertCarrierDocumentDates(
  issueDate: string | Date | null | undefined,
  expiryDate: string | Date | null | undefined,
) {
  const issues: string[] = [];
  const issue = parseOptionalValidationDate(issueDate, 'Carrier document issue date', issues);
  const expiry = parseOptionalValidationDate(expiryDate, 'Carrier document expiry date', issues);

  if (issue && expiry && expiry < issue) {
    issues.push('Carrier document expiry date cannot be earlier than issue date.');
  }

  if (issues.length > 0) {
    throw new LogisticsValidationError(issues);
  }
}

function parseOptionalValidationDate(
  value: string | Date | null | undefined,
  label: string,
  issues: string[],
) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    issues.push(`${label} is invalid.`);
    return null;
  }
  date.setHours(0, 0, 0, 0);
  return date;
}

export async function archiveCarrierDocument(args: {
  tenantId: string;
  carrierId: string;
  documentId: string;
  actorUserId?: string | null;
}) {
  await ensureLogisticsDomainTables();
  const rows = await prisma.$queryRawUnsafe<LogisticsCarrierDocumentRow[]>(
    `UPDATE logistics_carrier_documents
        SET deleted_at = NOW(),
            updated_at = NOW(),
            status = 'ARCHIVED',
            metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb
      WHERE tenant_id = $2
        AND carrier_id = $3
        AND id = $4
        AND deleted_at IS NULL
      RETURNING *`,
    jsonParam({ archivedBy: args.actorUserId ?? null, archivedAt: new Date().toISOString() }),
    args.tenantId,
    args.carrierId,
    args.documentId,
  );
  if (!rows[0]) throw new Error('Carrier document not found for this tenant');
  await refreshCarrierDocumentSummary(args.tenantId, args.carrierId);
  return mapCarrierDocument(rows[0]);
}

function mapCarrierVehicle(row: LogisticsCarrierVehicleRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    carrierId: row.carrier_id,
    ownerDriverId: row.owner_driver_id,
    vehicleCode: row.vehicle_code,
    plateNo: row.plate_no,
    registrationNo: row.registration_no,
    vehicleType: row.vehicle_type,
    make: row.make,
    model: row.model,
    year: row.year,
    color: row.color,
    capacityTons: numberOrNull(row.capacity_tons),
    volumeCbm: numberOrNull(row.volume_cbm),
    palletCapacity: row.pallet_capacity,
    axleCount: row.axle_count,
    gpsEnabled: row.gps_enabled,
    gpsProvider: row.gps_provider,
    homeRegion: row.home_region,
    currentRegion: row.current_region,
    availabilityStatus: row.availability_status,
    complianceStatus: row.compliance_status,
    status: row.status,
    registrationExpiry: iso(row.registration_expiry)?.slice(0, 10) ?? null,
    insuranceExpiry: iso(row.insurance_expiry)?.slice(0, 10) ?? null,
    permitExpiry: iso(row.permit_expiry)?.slice(0, 10) ?? null,
    inspectionExpiry: iso(row.inspection_expiry)?.slice(0, 10) ?? null,
    verifiedBy: row.verified_by,
    verifiedAt: iso(row.verified_at),
    metadata: row.metadata ?? {},
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function deriveCarrierVehicleCompliance(input: Pick<LogisticsCarrierVehicleInput, 'registrationExpiry' | 'insuranceExpiry' | 'permitExpiry' | 'inspectionExpiry'>) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dates = [
    input.registrationExpiry,
    input.insuranceExpiry,
    input.permitExpiry,
    input.inspectionExpiry,
  ].map(value => {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return null;
    date.setHours(0, 0, 0, 0);
    return date;
  }).filter((date): date is Date => Boolean(date));

  if (dates.some(date => date < today)) return 'EXPIRED';

  const thirtyDays = new Date(today);
  thirtyDays.setDate(thirtyDays.getDate() + 30);
  if (dates.some(date => date <= thirtyDays)) return 'EXPIRING_SOON';

  return 'PENDING_REVIEW';
}

async function assertCarrierForTenant(tenantId: string, carrierId: string) {
  const carrierRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id
       FROM logistics_carriers
      WHERE tenant_id = $1
        AND id = $2
        AND deleted_at IS NULL
      LIMIT 1`,
    tenantId,
    carrierId,
  );
  if (!carrierRows[0]) throw new Error('Carrier not found for this tenant');
}

async function refreshCarrierFleetSummary(tenantId: string, carrierId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{
    total: string | number | bigint;
    active: string | number | bigint;
    available: string | number | bigint;
    assigned: string | number | bigint;
    blocked: string | number | bigint;
    verified: string | number | bigint;
    expired: string | number | bigint;
    expiring_soon: string | number | bigint;
  }>>(
    `SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'ACTIVE') AS active,
        COUNT(*) FILTER (WHERE availability_status = 'AVAILABLE' AND status = 'ACTIVE') AS available,
        COUNT(*) FILTER (WHERE availability_status IN ('ASSIGNED','IN_TRANSIT')) AS assigned,
        COUNT(*) FILTER (WHERE availability_status = 'BLOCKED' OR status = 'BLOCKED') AS blocked,
        COUNT(*) FILTER (WHERE compliance_status = 'VERIFIED') AS verified,
        COUNT(*) FILTER (
          WHERE compliance_status = 'EXPIRED'
             OR registration_expiry < CURRENT_DATE
             OR insurance_expiry < CURRENT_DATE
             OR permit_expiry < CURRENT_DATE
             OR inspection_expiry < CURRENT_DATE
        ) AS expired,
        COUNT(*) FILTER (WHERE compliance_status = 'EXPIRING_SOON') AS expiring_soon
       FROM logistics_carrier_vehicles
      WHERE tenant_id = $1
        AND carrier_id = $2
        AND deleted_at IS NULL`,
    tenantId,
    carrierId,
  );
  const summary = {
    total: Number(rows[0]?.total ?? 0),
    active: Number(rows[0]?.active ?? 0),
    available: Number(rows[0]?.available ?? 0),
    assigned: Number(rows[0]?.assigned ?? 0),
    blocked: Number(rows[0]?.blocked ?? 0),
    verified: Number(rows[0]?.verified ?? 0),
    expired: Number(rows[0]?.expired ?? 0),
    expiringSoon: Number(rows[0]?.expiring_soon ?? 0),
    lastRefreshedAt: new Date().toISOString(),
  };

  await prisma.$executeRawUnsafe(
    `UPDATE logistics_carriers
        SET updated_at = NOW(),
            compliance_status = CASE
              WHEN $3::int > 0 THEN 'REVIEW_REQUIRED'
              WHEN $4::int > 0 THEN 'REVIEW_REQUIRED'
              ELSE compliance_status
            END,
            metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb
      WHERE tenant_id = $1
        AND id = $2`,
    tenantId,
    carrierId,
    summary.expired,
    summary.blocked,
    jsonParam({ fleetSummary: summary }),
  );
  return summary;
}

export async function listCarrierVehicles(args: {
  tenantId: string;
  carrierId: string;
  status?: string | null;
  availabilityStatus?: string | null;
  complianceStatus?: string | null;
}) {
  await ensureLogisticsDomainTables();
  const rows = await prisma.$queryRawUnsafe<LogisticsCarrierVehicleRow[]>(
    `SELECT *
       FROM logistics_carrier_vehicles
      WHERE tenant_id = $1
        AND carrier_id = $2
        AND deleted_at IS NULL
        AND ($3::text IS NULL OR status = $3)
        AND ($4::text IS NULL OR availability_status = $4)
        AND ($5::text IS NULL OR compliance_status = $5)
      ORDER BY
        CASE availability_status WHEN 'AVAILABLE' THEN 0 WHEN 'ASSIGNED' THEN 1 WHEN 'IN_TRANSIT' THEN 2 ELSE 3 END,
        plate_no ASC`,
    args.tenantId,
    args.carrierId,
    args.status ?? null,
    args.availabilityStatus ?? null,
    args.complianceStatus ?? null,
  );
  return rows.map(mapCarrierVehicle);
}

export async function upsertCarrierVehicle(input: LogisticsCarrierVehicleInput) {
  await ensureLogisticsDomainTables();
  await assertCarrierForTenant(input.tenantId, input.carrierId);
  const complianceStatus = input.complianceStatus ?? deriveCarrierVehicleCompliance(input);
  const rows = await prisma.$queryRawUnsafe<LogisticsCarrierVehicleRow[]>(
    `INSERT INTO logistics_carrier_vehicles (
       tenant_id, carrier_id, owner_driver_id, vehicle_code, plate_no,
       registration_no, vehicle_type, make, model, year, color,
       capacity_tons, volume_cbm, pallet_capacity, axle_count,
       gps_enabled, gps_provider, home_region, current_region,
       availability_status, compliance_status, status,
       registration_expiry, insurance_expiry, permit_expiry, inspection_expiry,
       verified_by, verified_at, metadata
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
       $23::date,$24::date,$25::date,$26::date,
       CASE WHEN $21 = 'VERIFIED' THEN $27 ELSE NULL END,
       CASE WHEN $21 = 'VERIFIED' THEN NOW() ELSE NULL END,
       $28::jsonb
     )
     ON CONFLICT (tenant_id, carrier_id, plate_no) WHERE deleted_at IS NULL
     DO UPDATE SET
       updated_at = NOW(),
       owner_driver_id = EXCLUDED.owner_driver_id,
       vehicle_code = EXCLUDED.vehicle_code,
       registration_no = EXCLUDED.registration_no,
       vehicle_type = EXCLUDED.vehicle_type,
       make = EXCLUDED.make,
       model = EXCLUDED.model,
       year = EXCLUDED.year,
       color = EXCLUDED.color,
       capacity_tons = EXCLUDED.capacity_tons,
       volume_cbm = EXCLUDED.volume_cbm,
       pallet_capacity = EXCLUDED.pallet_capacity,
       axle_count = EXCLUDED.axle_count,
       gps_enabled = EXCLUDED.gps_enabled,
       gps_provider = EXCLUDED.gps_provider,
       home_region = EXCLUDED.home_region,
       current_region = EXCLUDED.current_region,
       availability_status = EXCLUDED.availability_status,
       compliance_status = EXCLUDED.compliance_status,
       status = EXCLUDED.status,
       registration_expiry = EXCLUDED.registration_expiry,
       insurance_expiry = EXCLUDED.insurance_expiry,
       permit_expiry = EXCLUDED.permit_expiry,
       inspection_expiry = EXCLUDED.inspection_expiry,
       verified_by = COALESCE(EXCLUDED.verified_by, logistics_carrier_vehicles.verified_by),
       verified_at = COALESCE(EXCLUDED.verified_at, logistics_carrier_vehicles.verified_at),
       metadata = COALESCE(logistics_carrier_vehicles.metadata, '{}'::jsonb) || EXCLUDED.metadata
     RETURNING *`,
    input.tenantId,
    input.carrierId,
    input.ownerDriverId ?? null,
    input.vehicleCode ?? null,
    input.plateNo.trim().toUpperCase(),
    input.registrationNo ?? null,
    input.vehicleType,
    input.make ?? null,
    input.model ?? null,
    input.year ?? null,
    input.color ?? null,
    input.capacityTons ?? null,
    input.volumeCbm ?? null,
    input.palletCapacity ?? null,
    input.axleCount ?? null,
    Boolean(input.gpsEnabled),
    input.gpsProvider ?? null,
    input.homeRegion ?? null,
    input.currentRegion ?? input.homeRegion ?? null,
    input.availabilityStatus ?? 'AVAILABLE',
    complianceStatus,
    input.status ?? 'ACTIVE',
    dateOnly(input.registrationExpiry),
    dateOnly(input.insuranceExpiry),
    dateOnly(input.permitExpiry),
    dateOnly(input.inspectionExpiry),
    input.actorUserId ?? null,
    jsonParam({
      ...(input.metadata ?? {}),
      source: 'carrier-fleet-onboarding',
      lastSavedBy: input.actorUserId ?? null,
      lastSavedAt: new Date().toISOString(),
    }),
  );
  await refreshCarrierFleetSummary(input.tenantId, input.carrierId);
  return rows[0] ? mapCarrierVehicle(rows[0]) : null;
}

export async function updateCarrierVehicle(args: {
  tenantId: string;
  carrierId: string;
  vehicleId: string;
  patch: Partial<Omit<LogisticsCarrierVehicleInput, 'tenantId' | 'carrierId'>>;
  actorUserId?: string | null;
}) {
  await ensureLogisticsDomainTables();
  const patch = args.patch;
  const hasExpiryPatch = ['registrationExpiry', 'insuranceExpiry', 'permitExpiry', 'inspectionExpiry']
    .some(key => Object.prototype.hasOwnProperty.call(patch, key));
  const complianceStatus = patch.complianceStatus ?? (hasExpiryPatch ? deriveCarrierVehicleCompliance(patch) : null);
  const rows = await prisma.$queryRawUnsafe<LogisticsCarrierVehicleRow[]>(
    `UPDATE logistics_carrier_vehicles
        SET updated_at = NOW(),
            owner_driver_id = COALESCE($1, owner_driver_id),
            vehicle_code = COALESCE($2, vehicle_code),
            plate_no = COALESCE($3, plate_no),
            registration_no = COALESCE($4, registration_no),
            vehicle_type = COALESCE($5, vehicle_type),
            make = COALESCE($6, make),
            model = COALESCE($7, model),
            year = COALESCE($8, year),
            color = COALESCE($9, color),
            capacity_tons = COALESCE($10, capacity_tons),
            volume_cbm = COALESCE($11, volume_cbm),
            pallet_capacity = COALESCE($12, pallet_capacity),
            axle_count = COALESCE($13, axle_count),
            gps_enabled = COALESCE($14, gps_enabled),
            gps_provider = COALESCE($15, gps_provider),
            home_region = COALESCE($16, home_region),
            current_region = COALESCE($17, current_region),
            availability_status = COALESCE($18, availability_status),
            compliance_status = COALESCE($19, compliance_status),
            status = COALESCE($20, status),
            registration_expiry = COALESCE($21::date, registration_expiry),
            insurance_expiry = COALESCE($22::date, insurance_expiry),
            permit_expiry = COALESCE($23::date, permit_expiry),
            inspection_expiry = COALESCE($24::date, inspection_expiry),
            verified_by = CASE WHEN $19 = 'VERIFIED' THEN $25 ELSE verified_by END,
            verified_at = CASE WHEN $19 = 'VERIFIED' THEN NOW() ELSE verified_at END,
            metadata = COALESCE(metadata, '{}'::jsonb) || $26::jsonb
      WHERE tenant_id = $27
        AND carrier_id = $28
        AND id = $29
        AND deleted_at IS NULL
      RETURNING *`,
    patch.ownerDriverId ?? null,
    patch.vehicleCode ?? null,
    patch.plateNo ? patch.plateNo.trim().toUpperCase() : null,
    patch.registrationNo ?? null,
    patch.vehicleType ?? null,
    patch.make ?? null,
    patch.model ?? null,
    patch.year ?? null,
    patch.color ?? null,
    patch.capacityTons ?? null,
    patch.volumeCbm ?? null,
    patch.palletCapacity ?? null,
    patch.axleCount ?? null,
    typeof patch.gpsEnabled === 'boolean' ? patch.gpsEnabled : null,
    patch.gpsProvider ?? null,
    patch.homeRegion ?? null,
    patch.currentRegion ?? null,
    patch.availabilityStatus ?? null,
    complianceStatus,
    patch.status ?? null,
    dateOnly(patch.registrationExpiry),
    dateOnly(patch.insuranceExpiry),
    dateOnly(patch.permitExpiry),
    dateOnly(patch.inspectionExpiry),
    args.actorUserId ?? null,
    jsonParam({
      ...(patch.metadata ?? {}),
      lastUpdatedBy: args.actorUserId ?? null,
      lastUpdatedAt: new Date().toISOString(),
    }),
    args.tenantId,
    args.carrierId,
    args.vehicleId,
  );
  if (!rows[0]) throw new Error('Carrier vehicle not found for this tenant');
  await refreshCarrierFleetSummary(args.tenantId, args.carrierId);
  return mapCarrierVehicle(rows[0]);
}

export async function archiveCarrierVehicle(args: {
  tenantId: string;
  carrierId: string;
  vehicleId: string;
  actorUserId?: string | null;
}) {
  await ensureLogisticsDomainTables();
  const rows = await prisma.$queryRawUnsafe<LogisticsCarrierVehicleRow[]>(
    `UPDATE logistics_carrier_vehicles
        SET deleted_at = NOW(),
            updated_at = NOW(),
            status = 'ARCHIVED',
            availability_status = 'UNAVAILABLE',
            metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb
      WHERE tenant_id = $2
        AND carrier_id = $3
        AND id = $4
        AND deleted_at IS NULL
      RETURNING *`,
    jsonParam({ archivedBy: args.actorUserId ?? null, archivedAt: new Date().toISOString() }),
    args.tenantId,
    args.carrierId,
    args.vehicleId,
  );
  if (!rows[0]) throw new Error('Carrier vehicle not found for this tenant');
  await refreshCarrierFleetSummary(args.tenantId, args.carrierId);
  return mapCarrierVehicle(rows[0]);
}

function defaultRfqNoPrefix(date = new Date()) {
  const yy = String(date.getFullYear()).slice(-2);
  return `RFQ-LOG-${yy}`;
}

function defaultBidNoPrefix(date = new Date()) {
  const yy = String(date.getFullYear()).slice(-2);
  return `BID-LOG-${yy}`;
}

function defaultSettlementNoPrefix(date = new Date()) {
  const yy = String(date.getFullYear()).slice(-2);
  return `SET-LOG-${yy}`;
}

function defaultDriverPayoutNoPrefix(date = new Date()) {
  const yy = String(date.getFullYear()).slice(-2);
  return `DPO-LOG-${yy}`;
}

function hashPortalToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export type LogisticsComplianceBlocker = {
  code: string;
  label: string;
  severity: 'ERROR' | 'WARNING';
  subjectType: 'CARRIER' | 'DOCUMENT' | 'VEHICLE' | 'DRIVER';
  subjectId?: string | null;
  expiresAt?: string | null;
};

const REQUIRED_CARRIER_AWARD_DOCUMENTS = [
  { type: 'TRADE_LICENSE', label: 'Trade license' },
  { type: 'INSURANCE', label: 'Carrier insurance' },
];

const TERMINAL_SHIPMENT_STATUSES = new Set(['DELIVERED', 'POD_SUBMITTED', 'CLOSED', 'CANCELLED', 'COMPLETED']);
const IN_TRANSIT_SHIPMENT_STATUSES = new Set(['DISPATCHED', 'ENROUTE_PICKUP', 'LOADED', 'ENROUTE_DELIVERY', 'ACTIVE']);

function normaliseKey(value?: string | null) {
  return String(value ?? '').trim().toUpperCase();
}

function friendlyStatus(status?: string | null) {
  return normaliseKey(status).replace(/_/g, ' ').toLowerCase() || 'unknown';
}

function isExpired(value?: Date | string | null) {
  if (!value) return false;
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  date.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date < today;
}

async function syncCarrierVehicleAvailability(args: {
  tenantId: string;
  carrierId?: string | null;
  vehicleId?: string | null;
  shipmentStatus: string;
  actorUserId?: string | null;
}) {
  if (!args.vehicleId || !args.carrierId) return;
  const status = normaliseKey(args.shipmentStatus);
  const availabilityStatus = TERMINAL_SHIPMENT_STATUSES.has(status)
    ? 'AVAILABLE'
    : IN_TRANSIT_SHIPMENT_STATUSES.has(status)
      ? 'IN_TRANSIT'
      : status === 'ASSIGNED'
        ? 'ASSIGNED'
        : null;
  if (!availabilityStatus) return;

  await prisma.$executeRawUnsafe(
    `UPDATE logistics_carrier_vehicles
        SET availability_status = $1,
            updated_at = NOW(),
            metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
      WHERE tenant_id = $3
        AND carrier_id = $4
        AND id = $5
        AND deleted_at IS NULL`,
    availabilityStatus,
    jsonParam({
      lastAvailabilitySync: new Date().toISOString(),
      lastAvailabilityStatus: availabilityStatus,
      lastShipmentStatus: status,
      updatedBy: args.actorUserId ?? null,
    }),
    args.tenantId,
    args.carrierId,
    args.vehicleId,
  );
  await refreshCarrierFleetSummary(args.tenantId, args.carrierId).catch(() => null);
}

export async function getCarrierAwardComplianceBlockers(args: {
  tenantId: string;
  carrierId: string;
  vehicleId?: string | null;
  driverId?: string | null;
  requireVehicle?: boolean;
}) {
  await ensureLogisticsDomainTables();
  const blockers: LogisticsComplianceBlocker[] = [];
  const [carrier] = await prisma.$queryRawUnsafe<LogisticsCarrierRow[]>(
    `SELECT *
       FROM logistics_carriers
      WHERE tenant_id = $1
        AND id = $2
        AND deleted_at IS NULL
      LIMIT 1`,
    args.tenantId,
    args.carrierId,
  );

  if (!carrier) {
    return [{
      code: 'CARRIER_NOT_FOUND',
      label: 'Carrier is not available for this tenant',
      severity: 'ERROR' as const,
      subjectType: 'CARRIER' as const,
      subjectId: args.carrierId,
    }];
  }

  if (carrier.status !== 'ACTIVE') {
    blockers.push({
      code: 'CARRIER_NOT_ACTIVE',
      label: `Carrier is ${friendlyStatus(carrier.status)}; only active carriers can be awarded`,
      severity: 'ERROR',
      subjectType: 'CARRIER',
      subjectId: carrier.id,
    });
  }

  if (!['COMPLIANT', 'VERIFIED'].includes(normaliseKey(carrier.compliance_status))) {
    blockers.push({
      code: 'CARRIER_COMPLIANCE_NOT_READY',
      label: `Carrier compliance is ${friendlyStatus(carrier.compliance_status)}; compliance must be compliant before award`,
      severity: 'ERROR',
      subjectType: 'CARRIER',
      subjectId: carrier.id,
    });
  }

  const docs = await prisma.$queryRawUnsafe<LogisticsCarrierDocumentRow[]>(
    `SELECT *
       FROM logistics_carrier_documents
      WHERE tenant_id = $1
        AND carrier_id = $2
        AND deleted_at IS NULL
      ORDER BY created_at DESC`,
    args.tenantId,
    args.carrierId,
  );

  for (const spec of REQUIRED_CARRIER_AWARD_DOCUMENTS) {
    const doc = docs.find(row => normaliseKey(row.document_type) === spec.type);
    if (!doc) {
      blockers.push({
        code: `${spec.type}_MISSING`,
        label: `${spec.label} is missing`,
        severity: 'ERROR',
        subjectType: 'DOCUMENT',
      });
      continue;
    }
    if (normaliseKey(doc.status) !== 'VERIFIED') {
      blockers.push({
        code: `${spec.type}_NOT_VERIFIED`,
        label: `${spec.label} is ${friendlyStatus(doc.status)}; verification is required`,
        severity: 'ERROR',
        subjectType: 'DOCUMENT',
        subjectId: doc.id,
        expiresAt: dateOnly(doc.expiry_date),
      });
    }
    if (isExpired(doc.expiry_date)) {
      blockers.push({
        code: `${spec.type}_EXPIRED`,
        label: `${spec.label} expired on ${dateOnly(doc.expiry_date)}`,
        severity: 'ERROR',
        subjectType: 'DOCUMENT',
        subjectId: doc.id,
        expiresAt: dateOnly(doc.expiry_date),
      });
    }
  }

  if (args.requireVehicle !== false && !args.vehicleId) {
    blockers.push({
      code: 'VEHICLE_REQUIRED',
      label: 'Select a verified available truck before awarding this carrier',
      severity: 'ERROR',
      subjectType: 'VEHICLE',
    });
  }

  let vehicleDriverId = args.driverId ?? null;
  if (args.vehicleId) {
    const [vehicle] = await prisma.$queryRawUnsafe<LogisticsCarrierVehicleRow[]>(
      `SELECT *
         FROM logistics_carrier_vehicles
        WHERE tenant_id = $1
          AND carrier_id = $2
          AND id = $3
          AND deleted_at IS NULL
        LIMIT 1`,
      args.tenantId,
      args.carrierId,
      args.vehicleId,
    );
    if (!vehicle) {
      blockers.push({
        code: 'VEHICLE_NOT_FOUND',
        label: 'Selected truck is not onboarded for this carrier',
        severity: 'ERROR',
        subjectType: 'VEHICLE',
        subjectId: args.vehicleId,
      });
    } else {
      vehicleDriverId = vehicleDriverId ?? vehicle.owner_driver_id;
      if (vehicle.status !== 'ACTIVE') {
        blockers.push({
          code: 'VEHICLE_NOT_ACTIVE',
          label: `Truck ${vehicle.plate_no} is ${friendlyStatus(vehicle.status)}`,
          severity: 'ERROR',
          subjectType: 'VEHICLE',
          subjectId: vehicle.id,
        });
      }
      if (vehicle.availability_status !== 'AVAILABLE') {
        blockers.push({
          code: 'VEHICLE_NOT_AVAILABLE',
          label: `Truck ${vehicle.plate_no} is ${friendlyStatus(vehicle.availability_status)}`,
          severity: 'ERROR',
          subjectType: 'VEHICLE',
          subjectId: vehicle.id,
        });
      }
      if (normaliseKey(vehicle.compliance_status) !== 'VERIFIED') {
        blockers.push({
          code: 'VEHICLE_COMPLIANCE_NOT_VERIFIED',
          label: `Truck ${vehicle.plate_no} compliance is ${friendlyStatus(vehicle.compliance_status)}`,
          severity: 'ERROR',
          subjectType: 'VEHICLE',
          subjectId: vehicle.id,
        });
      }
      [
        ['registration', vehicle.registration_expiry],
        ['insurance', vehicle.insurance_expiry],
        ['permit', vehicle.permit_expiry],
        ['inspection', vehicle.inspection_expiry],
      ].forEach(([label, expiry]) => {
        if (isExpired(expiry as Date | null)) {
          blockers.push({
            code: `VEHICLE_${normaliseKey(label as string)}_EXPIRED`,
            label: `Truck ${vehicle.plate_no} ${label} expired on ${dateOnly(expiry as Date | null)}`,
            severity: 'ERROR',
            subjectType: 'VEHICLE',
            subjectId: vehicle.id,
            expiresAt: dateOnly(expiry as Date | null),
          });
        }
      });
    }
  }

  if (vehicleDriverId) {
    const driverDocs = docs.filter(row => {
      const type = normaliseKey(row.document_type);
      const metaDriverId = typeof row.metadata?.driverId === 'string' ? row.metadata.driverId : null;
      return ['DRIVER_LICENSE', 'DRIVER_ID', 'DRIVER_PERMIT'].includes(type)
        && (!metaDriverId || metaDriverId === vehicleDriverId);
    });
    const hasVerifiedDriverDoc = driverDocs.some(row => normaliseKey(row.status) === 'VERIFIED' && !isExpired(row.expiry_date));
    if (!hasVerifiedDriverDoc) {
      blockers.push({
        code: 'DRIVER_DOCS_PENDING',
        label: 'Driver documents are pending or expired for the selected driver',
        severity: 'ERROR',
        subjectType: 'DRIVER',
        subjectId: vehicleDriverId,
      });
    }
  }

  return blockers;
}

async function nextMarketplaceNo(args: {
  tenantId: string;
  tableName:
    | 'logistics_freight_rfqs'
    | 'logistics_carrier_bids'
    | 'logistics_carrier_settlements'
    | 'logistics_driver_payouts';
  columnName: 'rfq_no' | 'bid_no' | 'settlement_no' | 'payout_no';
  prefix: string;
}) {
  await ensureLogisticsDomainTables();
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint | number | string }>>(
    `SELECT COUNT(*) AS count
       FROM ${args.tableName}
      WHERE tenant_id = $1
        AND ${args.columnName} LIKE $2`,
    args.tenantId,
    `${args.prefix}%`,
  );
  const count = Number(rows[0]?.count ?? 0) + 1;
  return `${args.prefix}${String(count).padStart(5, '0')}`;
}

type LogisticsFreightRfqWithPolicyRow = LogisticsFreightRfqRow & {
  bid_count?: bigint | number | string;
  cargo_owner_customer_id?: string | null;
  cargo_owner_name?: string | null;
  customer_policy_configured?: boolean | null;
  customer_rfq_enabled?: boolean | null;
  customer_bid_submission_enabled?: boolean | null;
  customer_direct_assignment_enabled?: boolean | null;
  customer_default_procurement_mode?: string | null;
  customer_require_rfq_before_award?: boolean | null;
  customer_marketplace_notes?: string | null;
  customer_marketplace_updated_at?: Date | null;
  customer_marketplace_updated_by?: string | null;
};

function mapRfq(row: LogisticsFreightRfqWithPolicyRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    shipmentOrderId: row.shipment_order_id,
    rfqNo: row.rfq_no,
    status: row.status,
    inviteScope: row.invite_scope,
    bidDeadlineAt: iso(row.bid_deadline_at),
    negotiationRound: row.negotiation_round,
    awardedBidId: row.awarded_bid_id,
    metadata: row.metadata ?? {},
    bidCount: Number(row.bid_count ?? 0),
    customerMarketplacePolicy: row.cargo_owner_customer_id !== undefined || row.customer_policy_configured !== undefined
      ? mapJoinedCustomerMarketplacePolicy(row)
      : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapBid(row: LogisticsCarrierBidRow & { carrier_name?: string | null }) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    shipmentOrderId: row.shipment_order_id,
    rfqId: row.rfq_id,
    carrierId: row.carrier_id,
    carrierName: row.carrier_name ?? null,
    bidNo: row.bid_no,
    amount: numberOrNull(row.amount) ?? 0,
    currency: row.currency,
    transitTimeHours: row.transit_time_hours,
    validityUntil: iso(row.validity_until),
    status: row.status,
    chargeBreakdown: row.charge_breakdown ?? {},
    notes: row.notes,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapAssignment(row: LogisticsAssignmentRow & { carrier_name?: string | null }) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    shipmentOrderId: row.shipment_order_id,
    carrierId: row.carrier_id,
    carrierName: row.carrier_name ?? null,
    driverId: row.driver_id,
    vehicleId: row.vehicle_id,
    assignmentType: row.assignment_type,
    status: row.status,
    costAmount: numberOrNull(row.cost_amount),
    currency: row.currency,
    acceptedAt: iso(row.accepted_at),
    dispatchedAt: iso(row.dispatched_at),
    completedAt: iso(row.completed_at),
    metadata: row.metadata ?? {},
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export async function listFreightRfqs(args: {
  tenantId: string;
  shipmentOrderId?: string | null;
  status?: string | null;
  search?: string | null;
  limit?: number;
}) {
  await ensureLogisticsDomainTables();
  const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
  const rows = await prisma.$queryRawUnsafe<LogisticsFreightRfqWithPolicyRow[]>(
    `SELECT rfq.*,
            COUNT(b.id) AS bid_count,
            so.cargo_owner_customer_id,
            so.cargo_owner_name,
            (cms.id IS NOT NULL) AS customer_policy_configured,
            cms.rfq_enabled AS customer_rfq_enabled,
            cms.bid_submission_enabled AS customer_bid_submission_enabled,
            cms.direct_assignment_enabled AS customer_direct_assignment_enabled,
            cms.default_procurement_mode AS customer_default_procurement_mode,
            cms.require_rfq_before_award AS customer_require_rfq_before_award,
            cms.notes AS customer_marketplace_notes,
            cms.updated_at AS customer_marketplace_updated_at,
            cms.updated_by AS customer_marketplace_updated_by
       FROM logistics_freight_rfqs rfq
       LEFT JOIN logistics_carrier_bids b
         ON b.rfq_id = rfq.id
        AND b.tenant_id = rfq.tenant_id
       LEFT JOIN logistics_shipment_orders so
         ON so.id = rfq.shipment_order_id
        AND so.tenant_id = rfq.tenant_id
        AND so.deleted_at IS NULL
       LEFT JOIN logistics_customer_marketplace_settings cms
         ON cms.tenant_id = so.tenant_id
        AND cms.customer_id = so.cargo_owner_customer_id
      WHERE rfq.tenant_id = $1
        AND ($2::text IS NULL OR rfq.shipment_order_id = $2)
        AND ($3::text IS NULL OR rfq.status = $3)
        AND ($4::text IS NULL OR rfq.rfq_no ILIKE '%' || $4 || '%')
      GROUP BY rfq.id
             , so.cargo_owner_customer_id
             , so.cargo_owner_name
             , cms.id
             , cms.rfq_enabled
             , cms.bid_submission_enabled
             , cms.direct_assignment_enabled
             , cms.default_procurement_mode
             , cms.require_rfq_before_award
             , cms.notes
             , cms.updated_at
             , cms.updated_by
      ORDER BY rfq.created_at DESC
      LIMIT $5`,
    args.tenantId,
    args.shipmentOrderId ?? null,
    args.status ?? null,
    args.search || null,
    limit,
  );
  return rows.map(mapRfq);
}

export async function fetchFreightRfqById(id: string, tenantId: string) {
  await ensureLogisticsDomainTables();
  const rows = await prisma.$queryRawUnsafe<LogisticsFreightRfqWithPolicyRow[]>(
    `SELECT rfq.*,
            COUNT(b.id) AS bid_count,
            so.cargo_owner_customer_id,
            so.cargo_owner_name,
            (cms.id IS NOT NULL) AS customer_policy_configured,
            cms.rfq_enabled AS customer_rfq_enabled,
            cms.bid_submission_enabled AS customer_bid_submission_enabled,
            cms.direct_assignment_enabled AS customer_direct_assignment_enabled,
            cms.default_procurement_mode AS customer_default_procurement_mode,
            cms.require_rfq_before_award AS customer_require_rfq_before_award,
            cms.notes AS customer_marketplace_notes,
            cms.updated_at AS customer_marketplace_updated_at,
            cms.updated_by AS customer_marketplace_updated_by
       FROM logistics_freight_rfqs rfq
       LEFT JOIN logistics_carrier_bids b
         ON b.rfq_id = rfq.id
        AND b.tenant_id = rfq.tenant_id
       LEFT JOIN logistics_shipment_orders so
         ON so.id = rfq.shipment_order_id
        AND so.tenant_id = rfq.tenant_id
        AND so.deleted_at IS NULL
       LEFT JOIN logistics_customer_marketplace_settings cms
         ON cms.tenant_id = so.tenant_id
        AND cms.customer_id = so.cargo_owner_customer_id
      WHERE rfq.id = $1
        AND rfq.tenant_id = $2
      GROUP BY rfq.id
             , so.cargo_owner_customer_id
             , so.cargo_owner_name
             , cms.id
             , cms.rfq_enabled
             , cms.bid_submission_enabled
             , cms.direct_assignment_enabled
             , cms.default_procurement_mode
             , cms.require_rfq_before_award
             , cms.notes
             , cms.updated_at
             , cms.updated_by
      LIMIT 1`,
    id,
    tenantId,
  );
  return rows[0] ? mapRfq(rows[0]) : null;
}

export async function createCarrierPortalInvite(input: LogisticsCarrierPortalInviteInput) {
  await ensureLogisticsDomainTables();
  const rfq = await fetchFreightRfqById(input.rfqId, input.tenantId);
  if (!rfq) throw new Error('RFQ not found for this tenant');
  await assertGovernedShipmentWrite({
    tenantId: input.tenantId,
    shipmentOrderId: rfq.shipmentOrderId,
    action: 'Carrier invite creation',
  });

  const carrierRows = await prisma.$queryRawUnsafe<LogisticsCarrierRow[]>(
    `SELECT *
       FROM logistics_carriers
      WHERE tenant_id = $1
        AND id = $2
        AND deleted_at IS NULL
        AND status = 'ACTIVE'
      LIMIT 1`,
    input.tenantId,
    input.carrierId,
  );
  const carrier = carrierRows[0];
  if (!carrier) throw new Error('Active carrier not found for this tenant');

  const existingInvites = Array.isArray(rfq.metadata?.invitedCarrierIds)
    ? rfq.metadata.invitedCarrierIds.filter((id): id is string => typeof id === 'string')
    : [];
  const invitedCarrierIds = Array.from(new Set([...existingInvites, input.carrierId]));
  const rfqMetadata = {
    ...(rfq.metadata ?? {}),
    invitedCarrierIds,
    lastInviteGeneratedAt: new Date().toISOString(),
  };
  await prisma.$executeRawUnsafe(
    `UPDATE logistics_freight_rfqs
        SET metadata = $1::jsonb,
            updated_at = NOW()
      WHERE tenant_id = $2
        AND id = $3`,
    jsonParam(rfqMetadata),
    input.tenantId,
    input.rfqId,
  );

  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashPortalToken(token);
  const expiresAt = input.expiresAt
    ? iso(input.expiresAt)
    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  if (!expiresAt || new Date(expiresAt) <= new Date()) {
    throw new LogisticsValidationError(['Carrier invite expiry must be a future date/time.']);
  }
  const rows = await prisma.$queryRawUnsafe<LogisticsCarrierInviteRow[]>(
    `INSERT INTO logistics_carrier_portal_invites (
       tenant_id, rfq_id, shipment_order_id, carrier_id, token_hash,
       status, expires_at, created_by, metadata
     ) VALUES ($1,$2,$3,$4,$5,'ACTIVE',$6::timestamptz,$7,$8::jsonb)
     RETURNING *`,
    input.tenantId,
    input.rfqId,
    rfq.shipmentOrderId,
    input.carrierId,
    tokenHash,
    expiresAt,
    input.createdBy ?? null,
    jsonParam(input.metadata ?? {}),
  );

  await addTrackingEvent({
    tenantId: input.tenantId,
    shipmentOrderId: rfq.shipmentOrderId,
    eventType: 'CARRIER_PORTAL_INVITE_CREATED',
    status: 'INVITED',
    source: 'FREIGHT_MARKETPLACE',
    notes: `Carrier portal invite created for ${carrier.name}`,
    metadata: {
      rfqId: input.rfqId,
      carrierId: input.carrierId,
      inviteId: rows[0]?.id,
      expiresAt,
    },
  });

  return rows[0] ? {
    id: rows[0].id,
    tenantId: rows[0].tenant_id,
    rfqId: rows[0].rfq_id,
    shipmentOrderId: rows[0].shipment_order_id,
    carrierId: rows[0].carrier_id,
    status: rows[0].status,
    expiresAt: iso(rows[0].expires_at),
    createdAt: iso(rows[0].created_at),
    token,
    portalPath: `/carrier-portal/logistics/invite/${token}`,
    carrier: {
      id: carrier.id,
      name: carrier.name,
      carrierCode: carrier.carrier_code,
      contactEmail: carrier.contact_email,
      complianceStatus: carrier.compliance_status,
    },
  } : null;
}

export async function listCarrierPortalInvites(args: {
  tenantId: string;
  rfqId: string;
  carrierId?: string | null;
  includeExpired?: boolean;
}) {
  await ensureLogisticsDomainTables();
  const rows = await prisma.$queryRawUnsafe<Array<LogisticsCarrierInviteRow & {
    carrier_name: string | null;
    carrier_code: string | null;
    carrier_status: string | null;
    carrier_compliance_status: string | null;
  }>>(
    `SELECT inv.*,
            c.name AS carrier_name,
            c.carrier_code,
            c.status AS carrier_status,
            c.compliance_status AS carrier_compliance_status
       FROM logistics_carrier_portal_invites inv
       LEFT JOIN logistics_carriers c
         ON c.id = inv.carrier_id
        AND c.tenant_id = inv.tenant_id
      WHERE inv.tenant_id = $1
        AND inv.rfq_id = $2
        AND ($3::text IS NULL OR inv.carrier_id = $3)
        AND ($4::boolean = true OR inv.status <> 'EXPIRED')
      ORDER BY inv.created_at DESC
      LIMIT 200`,
    args.tenantId,
    args.rfqId,
    args.carrierId ?? null,
    Boolean(args.includeExpired),
  );

  return rows.map(row => {
    const expired = row.status === 'ACTIVE' && row.expires_at && new Date(row.expires_at) <= new Date();
    return {
      id: row.id,
      tenantId: row.tenant_id,
      rfqId: row.rfq_id,
      shipmentOrderId: row.shipment_order_id,
      carrierId: row.carrier_id,
      status: expired ? 'EXPIRED' : row.status,
      expiresAt: iso(row.expires_at),
      lastAccessedAt: iso(row.last_accessed_at),
      createdBy: row.created_by,
      metadata: row.metadata ?? {},
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      carrier: {
        id: row.carrier_id,
        name: row.carrier_name,
        carrierCode: row.carrier_code,
        status: row.carrier_status,
        complianceStatus: row.carrier_compliance_status,
      },
    };
  });
}

export async function revokeCarrierPortalInvite(args: {
  tenantId: string;
  rfqId: string;
  inviteId: string;
  actorUserId?: string | null;
  reason?: string | null;
}) {
  await ensureLogisticsDomainTables();
  const existingRows = await prisma.$queryRawUnsafe<LogisticsCarrierInviteRow[]>(
    `SELECT *
       FROM logistics_carrier_portal_invites
      WHERE tenant_id = $1
        AND rfq_id = $2
        AND id = $3
        AND status = 'ACTIVE'
      LIMIT 1`,
    args.tenantId,
    args.rfqId,
    args.inviteId,
  );
  if (!existingRows[0]) throw new Error('Active carrier invite not found for this RFQ');
  await assertGovernedShipmentWrite({
    tenantId: args.tenantId,
    shipmentOrderId: existingRows[0].shipment_order_id,
    action: 'Carrier invite revocation',
  });

  const rows = await prisma.$queryRawUnsafe<LogisticsCarrierInviteRow[]>(
    `UPDATE logistics_carrier_portal_invites
        SET status = 'REVOKED',
            updated_at = NOW(),
            metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb
      WHERE tenant_id = $2
        AND rfq_id = $3
        AND id = $4
        AND status = 'ACTIVE'
      RETURNING *`,
    jsonParam({
      revokedBy: args.actorUserId ?? null,
      revokedAt: new Date().toISOString(),
      revokeReason: args.reason ?? null,
    }),
    args.tenantId,
    args.rfqId,
    args.inviteId,
  );
  if (!rows[0]) throw new Error('Active carrier invite not found for this RFQ');

  await addTrackingEvent({
    tenantId: args.tenantId,
    shipmentOrderId: rows[0].shipment_order_id,
    eventType: 'CARRIER_PORTAL_INVITE_REVOKED',
    status: 'REVOKED',
    source: 'FREIGHT_MARKETPLACE',
    notes: args.reason ?? 'Carrier portal invite revoked',
    metadata: {
      rfqId: args.rfqId,
      inviteId: args.inviteId,
      carrierId: rows[0].carrier_id,
      revokedBy: args.actorUserId ?? null,
    },
  });

  return listCarrierPortalInvites({
    tenantId: args.tenantId,
    rfqId: args.rfqId,
    carrierId: rows[0].carrier_id,
    includeExpired: true,
  }).then(invites => invites.find(invite => invite.id === args.inviteId) ?? null);
}

export async function resolveCarrierPortalInvite(token: string) {
  await ensureLogisticsDomainTables();
  const tokenHash = hashPortalToken(token);
  const rows = await prisma.$queryRawUnsafe<Array<LogisticsCarrierInviteRow & {
    carrier_name: string;
    carrier_code: string | null;
    carrier_status: string;
    carrier_compliance_status: string | null;
    carrier_onboarding_status: string | null;
  }>>(
    `SELECT inv.*,
            c.name AS carrier_name,
            c.carrier_code,
            c.status AS carrier_status,
            c.compliance_status AS carrier_compliance_status,
            c.onboarding_status AS carrier_onboarding_status
       FROM logistics_carrier_portal_invites inv
       INNER JOIN logistics_carriers c
          ON c.id = inv.carrier_id
         AND c.tenant_id = inv.tenant_id
         AND c.deleted_at IS NULL
      WHERE inv.token_hash = $1
        AND inv.status = 'ACTIVE'
        AND (inv.expires_at IS NULL OR inv.expires_at > NOW())
      LIMIT 1`,
    tokenHash,
  );
  const invite = rows[0];
  if (!invite) return null;

  await prisma.$executeRawUnsafe(
    `UPDATE logistics_carrier_portal_invites
        SET last_accessed_at = NOW(),
            updated_at = NOW()
      WHERE id = $1`,
    invite.id,
  );

  const [rfq] = await listCarrierPortalRfqs({
    tenantId: invite.tenant_id,
    carrierId: invite.carrier_id,
    rfqId: invite.rfq_id,
    limit: 1,
  });
  const timeline = rfq
    ? await listShipmentExecutionTimeline({
      tenantId: invite.tenant_id,
      shipmentOrderId: invite.shipment_order_id,
    })
    : null;
  const [documents, vehicles, complianceBlockers] = await Promise.all([
    listCarrierDocuments({
      tenantId: invite.tenant_id,
      carrierId: invite.carrier_id,
    }),
    listCarrierVehicles({
      tenantId: invite.tenant_id,
      carrierId: invite.carrier_id,
    }),
    getCarrierAwardComplianceBlockers({
      tenantId: invite.tenant_id,
      carrierId: invite.carrier_id,
      requireVehicle: false,
    }),
  ]);

  return {
    invite: {
      id: invite.id,
      tenantId: invite.tenant_id,
      rfqId: invite.rfq_id,
      shipmentOrderId: invite.shipment_order_id,
      carrierId: invite.carrier_id,
      status: invite.status,
      expiresAt: iso(invite.expires_at),
      lastAccessedAt: iso(invite.last_accessed_at),
      metadata: invite.metadata ?? {},
    },
    carrier: {
      id: invite.carrier_id,
      name: invite.carrier_name,
      carrierCode: invite.carrier_code,
      status: invite.carrier_status,
      complianceStatus: invite.carrier_compliance_status,
      onboardingStatus: invite.carrier_onboarding_status,
    },
    rfq: rfq ?? null,
    timeline,
    documents,
    vehicles,
    compliance: {
      canBid: invite.carrier_status === 'ACTIVE',
      blockers: complianceBlockers,
    },
  };
}

export async function listCarrierPortalRfqs(args: LogisticsCarrierPortalRfqFilter) {
  await ensureLogisticsDomainTables();
  const limit = Math.min(Math.max(args.limit ?? 100, 1), 300);
  const rows = await prisma.$queryRawUnsafe<Array<LogisticsFreightRfqRow & {
    bid_count: bigint | number | string;
    carrier_name: string;
    carrier_code: string | null;
    carrier_status: string;
    shipment_no: string | null;
    cargo_owner_customer_id: string | null;
    cargo_owner_name: string | null;
    shipment_type: string | null;
    shipment_status: string | null;
    priority: string | null;
    origin_name: string | null;
    origin_address: string | null;
    destination_name: string | null;
    destination_address: string | null;
    pickup_window_from: Date | null;
    pickup_window_to: Date | null;
    delivery_window_from: Date | null;
    delivery_window_to: Date | null;
    requested_vehicle_type: string | null;
    total_weight_kg: string | number | null;
    customer_rate_amount: string | number | null;
    shipment_currency: string | null;
    carrier_bid_id: string | null;
    carrier_bid_no: string | null;
    carrier_bid_amount: string | number | null;
    carrier_bid_currency: string | null;
    carrier_bid_transit_time_hours: number | null;
    carrier_bid_validity_until: Date | null;
    carrier_bid_status: string | null;
    carrier_bid_notes: string | null;
    carrier_bid_created_at: Date | null;
    customer_policy_configured: boolean | null;
    customer_rfq_enabled: boolean | null;
    customer_bid_submission_enabled: boolean | null;
    customer_direct_assignment_enabled: boolean | null;
    customer_default_procurement_mode: string | null;
    customer_require_rfq_before_award: boolean | null;
    customer_marketplace_notes: string | null;
    customer_marketplace_updated_at: Date | null;
    customer_marketplace_updated_by: string | null;
  }>>(
    `SELECT rfq.*,
            c.name AS carrier_name,
            c.carrier_code,
            c.status AS carrier_status,
            so.shipment_no,
            so.cargo_owner_customer_id,
            so.cargo_owner_name,
            so.shipment_type,
            so.status AS shipment_status,
            so.priority,
            so.origin_name,
            so.origin_address,
            so.destination_name,
            so.destination_address,
            so.pickup_window_from,
            so.pickup_window_to,
            so.delivery_window_from,
            so.delivery_window_to,
            so.requested_vehicle_type,
            so.total_weight_kg,
            so.customer_rate_amount,
            so.currency AS shipment_currency,
            (SELECT COUNT(*)
               FROM logistics_carrier_bids b
              WHERE b.tenant_id = rfq.tenant_id
                AND b.rfq_id = rfq.id) AS bid_count,
            cb.id AS carrier_bid_id,
            cb.bid_no AS carrier_bid_no,
            cb.amount AS carrier_bid_amount,
            cb.currency AS carrier_bid_currency,
            cb.transit_time_hours AS carrier_bid_transit_time_hours,
            cb.validity_until AS carrier_bid_validity_until,
            cb.status AS carrier_bid_status,
            cb.notes AS carrier_bid_notes,
            cb.created_at AS carrier_bid_created_at,
            (cms.id IS NOT NULL) AS customer_policy_configured,
            cms.rfq_enabled AS customer_rfq_enabled,
            cms.bid_submission_enabled AS customer_bid_submission_enabled,
            cms.direct_assignment_enabled AS customer_direct_assignment_enabled,
            cms.default_procurement_mode AS customer_default_procurement_mode,
            cms.require_rfq_before_award AS customer_require_rfq_before_award,
            cms.notes AS customer_marketplace_notes,
            cms.updated_at AS customer_marketplace_updated_at,
            cms.updated_by AS customer_marketplace_updated_by
       FROM logistics_freight_rfqs rfq
       INNER JOIN logistics_carriers c
          ON c.id = $2
         AND c.tenant_id = rfq.tenant_id
         AND c.deleted_at IS NULL
         AND c.status = 'ACTIVE'
       INNER JOIN logistics_shipment_orders so
         ON so.id = rfq.shipment_order_id
         AND so.tenant_id = rfq.tenant_id
         AND so.deleted_at IS NULL
       LEFT JOIN logistics_customer_marketplace_settings cms
         ON cms.tenant_id = so.tenant_id
        AND cms.customer_id = so.cargo_owner_customer_id
       LEFT JOIN LATERAL (
         SELECT *
           FROM logistics_carrier_bids b
          WHERE b.tenant_id = rfq.tenant_id
            AND b.rfq_id = rfq.id
            AND b.carrier_id = $2
          ORDER BY b.created_at DESC
          LIMIT 1
       ) cb ON TRUE
      WHERE rfq.tenant_id = $1
        AND ($3::text IS NULL OR rfq.id = $3)
        AND ($4::text IS NULL OR rfq.status = $4)
        AND (
          rfq.invite_scope = 'ALL_ACTIVE_CARRIERS'
          OR COALESCE(rfq.metadata -> 'invitedCarrierIds', '[]'::jsonb) ? $2
          OR cb.id IS NOT NULL
        )
        AND (
          $5::text IS NULL
          OR rfq.rfq_no ILIKE '%' || $5 || '%'
          OR so.shipment_no ILIKE '%' || $5 || '%'
          OR so.cargo_owner_name ILIKE '%' || $5 || '%'
          OR so.origin_name ILIKE '%' || $5 || '%'
          OR so.destination_name ILIKE '%' || $5 || '%'
        )
      ORDER BY
        CASE rfq.status
          WHEN 'OPEN' THEN 1
          WHEN 'AWARDED' THEN 2
          ELSE 3
        END,
        rfq.created_at DESC
      LIMIT $6`,
    args.tenantId,
    args.carrierId,
    args.rfqId ?? null,
    args.status ?? null,
    args.search || null,
    limit,
  );

  return rows.map(row => ({
    ...mapRfq(row),
    carrier: {
      id: args.carrierId,
      name: row.carrier_name,
      carrierCode: row.carrier_code,
      status: row.carrier_status,
    },
    shipment: {
      id: row.shipment_order_id,
      shipmentNo: row.shipment_no,
      cargoOwnerCustomerId: row.cargo_owner_customer_id,
      cargoOwnerName: row.cargo_owner_name,
      shipmentType: row.shipment_type,
      status: row.shipment_status,
      priority: row.priority,
      originName: row.origin_name,
      originAddress: row.origin_address,
      destinationName: row.destination_name,
      destinationAddress: row.destination_address,
      pickupWindowFrom: iso(row.pickup_window_from),
      pickupWindowTo: iso(row.pickup_window_to),
      deliveryWindowFrom: iso(row.delivery_window_from),
      deliveryWindowTo: iso(row.delivery_window_to),
      requestedVehicleType: row.requested_vehicle_type,
      totalWeightKg: numberOrNull(row.total_weight_kg),
      customerRateAmount: numberOrNull(row.customer_rate_amount),
      currency: row.shipment_currency,
    },
    carrierBid: row.carrier_bid_id ? {
      id: row.carrier_bid_id,
      bidNo: row.carrier_bid_no,
      amount: numberOrNull(row.carrier_bid_amount) ?? 0,
      currency: row.carrier_bid_currency,
      transitTimeHours: row.carrier_bid_transit_time_hours,
      validityUntil: iso(row.carrier_bid_validity_until),
      status: row.carrier_bid_status,
      notes: row.carrier_bid_notes,
      createdAt: iso(row.carrier_bid_created_at),
    } : null,
  }));
}

export async function createFreightRfq(input: LogisticsFreightRfqInput) {
  await ensureLogisticsDomainTables();
  await assertGovernedShipmentWrite({
    tenantId: input.tenantId,
    shipmentOrderId: input.shipmentOrderId,
    action: 'RFQ creation',
  });
  const { policy } = await assertCustomerAllowsRfq({
    tenantId: input.tenantId,
    shipmentOrderId: input.shipmentOrderId,
  });

  const rfqNo = input.rfqNo || await nextMarketplaceNo({
    tenantId: input.tenantId,
    tableName: 'logistics_freight_rfqs',
    columnName: 'rfq_no',
    prefix: defaultRfqNoPrefix(),
  });
  const metadata = {
    ...(input.metadata ?? {}),
    invitedCarrierIds: input.invitedCarrierIds ?? [],
    customerMarketplacePolicy: {
      customerId: policy.customerId,
      customerName: policy.customerName,
      rfqEnabled: policy.rfqEnabled,
      bidSubmissionEnabled: policy.bidSubmissionEnabled,
      directAssignmentEnabled: policy.directAssignmentEnabled,
      defaultProcurementMode: policy.defaultProcurementMode,
      requireRfqBeforeAward: policy.requireRfqBeforeAward,
      configured: policy.configured,
    },
  };

  const rows = await prisma.$queryRawUnsafe<LogisticsFreightRfqRow[]>(
    `INSERT INTO logistics_freight_rfqs (
       tenant_id, shipment_order_id, rfq_no, status, invite_scope,
       bid_deadline_at, negotiation_round, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7,$8::jsonb)
     ON CONFLICT (tenant_id, rfq_no)
     DO UPDATE SET
       updated_at = NOW(),
       status = EXCLUDED.status,
       invite_scope = EXCLUDED.invite_scope,
       bid_deadline_at = EXCLUDED.bid_deadline_at,
       negotiation_round = EXCLUDED.negotiation_round,
       metadata = EXCLUDED.metadata
     RETURNING *`,
    input.tenantId,
    input.shipmentOrderId,
    rfqNo,
    input.status ?? 'OPEN',
    input.inviteScope ?? 'SELECTED_CARRIERS',
    iso(input.bidDeadlineAt),
    input.negotiationRound ?? 1,
    jsonParam(metadata),
  );

  await prisma.$executeRawUnsafe(
    `UPDATE logistics_shipment_orders
        SET marketplace_status = 'OPEN',
            booking_mode = 'RFQ',
            updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2`,
    input.shipmentOrderId,
    input.tenantId,
  );

  await addTrackingEvent({
    tenantId: input.tenantId,
    shipmentOrderId: input.shipmentOrderId,
    eventType: 'RFQ_CREATED',
    status: 'RFQ_OPEN',
    source: 'FREIGHT_MARKETPLACE',
    notes: `RFQ ${rfqNo} opened for carrier bidding`,
    metadata: { rfqId: rows[0]?.id, invitedCarrierIds: input.invitedCarrierIds ?? [] },
  });

  return rows[0] ? mapRfq({ ...rows[0], bid_count: 0 }) : null;
}

export async function listCarrierBids(args: {
  tenantId: string;
  rfqId?: string | null;
  shipmentOrderId?: string | null;
  carrierId?: string | null;
  status?: string | null;
  limit?: number;
}) {
  await ensureLogisticsDomainTables();
  const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
  const rows = await prisma.$queryRawUnsafe<Array<LogisticsCarrierBidRow & { carrier_name: string | null }>>(
    `SELECT b.*, c.name AS carrier_name
       FROM logistics_carrier_bids b
       LEFT JOIN logistics_carriers c
         ON c.id = b.carrier_id
        AND c.tenant_id = b.tenant_id
      WHERE b.tenant_id = $1
        AND ($2::text IS NULL OR b.rfq_id = $2)
        AND ($3::text IS NULL OR b.shipment_order_id = $3)
        AND ($4::text IS NULL OR b.carrier_id = $4)
        AND ($5::text IS NULL OR b.status = $5)
      ORDER BY b.amount ASC, b.created_at ASC
      LIMIT $6`,
    args.tenantId,
    args.rfqId ?? null,
    args.shipmentOrderId ?? null,
    args.carrierId ?? null,
    args.status ?? null,
    limit,
  );
  return rows.map(mapBid);
}

export async function submitCarrierBid(input: LogisticsCarrierBidInput) {
  await ensureLogisticsDomainTables();
  await assertGovernedShipmentWrite({
    tenantId: input.tenantId,
    shipmentOrderId: input.shipmentOrderId,
    action: 'Carrier bid submission',
  });
  await assertCustomerAllowsBidSubmission({
    tenantId: input.tenantId,
    shipmentOrderId: input.shipmentOrderId,
  });

  if (input.rfqId) {
    const rfq = await prisma.$queryRawUnsafe<LogisticsFreightRfqRow[]>(
      `SELECT * FROM logistics_freight_rfqs
        WHERE id = $1
          AND tenant_id = $2
          AND shipment_order_id = $3
        LIMIT 1`,
      input.rfqId,
      input.tenantId,
      input.shipmentOrderId,
    );
    if (!rfq[0]) throw new Error('RFQ not found for this shipment');
    if (rfq[0].status === 'AWARDED' || rfq[0].status === 'CLOSED' || rfq[0].status === 'CANCELLED') {
      throw new Error(`RFQ is ${rfq[0].status}; new bids are not allowed`);
    }
  }

  const carrier = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM logistics_carriers
      WHERE id = $1
        AND tenant_id = $2
        AND deleted_at IS NULL
      LIMIT 1`,
    input.carrierId,
    input.tenantId,
  );
  if (!carrier[0]) throw new Error('Carrier not found for this tenant');

  const bidNo = input.bidNo || await nextMarketplaceNo({
    tenantId: input.tenantId,
    tableName: 'logistics_carrier_bids',
    columnName: 'bid_no',
    prefix: defaultBidNoPrefix(),
  });

  const rows = await prisma.$queryRawUnsafe<LogisticsCarrierBidRow[]>(
    `INSERT INTO logistics_carrier_bids (
       tenant_id, shipment_order_id, rfq_id, carrier_id, bid_no, amount,
       currency, transit_time_hours, validity_until, status, charge_breakdown, notes
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10,$11::jsonb,$12)
     RETURNING *`,
    input.tenantId,
    input.shipmentOrderId,
    input.rfqId ?? null,
    input.carrierId,
    bidNo,
    input.amount,
    input.currency ?? 'AED',
    input.transitTimeHours ?? null,
    iso(input.validityUntil),
    input.status ?? 'SUBMITTED',
    jsonParam(input.chargeBreakdown ?? {}),
    input.notes ?? null,
  );

  await addTrackingEvent({
    tenantId: input.tenantId,
    shipmentOrderId: input.shipmentOrderId,
    eventType: 'CARRIER_BID_SUBMITTED',
    status: 'BID_SUBMITTED',
    source: 'FREIGHT_MARKETPLACE',
    notes: `Carrier bid ${bidNo} submitted`,
    metadata: {
      rfqId: input.rfqId ?? null,
      carrierId: input.carrierId,
      bidId: rows[0]?.id,
      amount: input.amount,
      currency: input.currency ?? 'AED',
    },
  });

  return rows[0] ? mapBid(rows[0]) : null;
}

export async function listShipmentAssignments(args: {
  tenantId: string;
  shipmentOrderId: string;
  status?: string | null;
}) {
  await ensureLogisticsDomainTables();
  const rows = await prisma.$queryRawUnsafe<Array<LogisticsAssignmentRow & { carrier_name: string | null }>>(
    `SELECT a.*, c.name AS carrier_name
       FROM logistics_assignments a
       LEFT JOIN logistics_carriers c
         ON c.id = a.carrier_id
        AND c.tenant_id = a.tenant_id
      WHERE a.tenant_id = $1
        AND a.shipment_order_id = $2
        AND ($3::text IS NULL OR a.status = $3)
      ORDER BY a.created_at DESC`,
    args.tenantId,
    args.shipmentOrderId,
    args.status ?? null,
  );
  return rows.map(mapAssignment);
}

export async function createShipmentAssignment(input: LogisticsAssignmentInput) {
  await ensureLogisticsDomainTables();
  const { shipment } = await assertGovernedShipmentWrite({
    tenantId: input.tenantId,
    shipmentOrderId: input.shipmentOrderId,
    action: 'Shipment assignment',
  });

  if (input.carrierId) {
    const requestedStatus = normaliseKey(input.status ?? 'ASSIGNED');
    const requireVehicle = requestedStatus !== 'PLANNED';
    const blockers = await getCarrierAwardComplianceBlockers({
      tenantId: input.tenantId,
      carrierId: input.carrierId,
      vehicleId: input.vehicleId ?? null,
      driverId: input.driverId ?? null,
      requireVehicle,
    });
    const overrideAllowed = Boolean(
      input.metadata?.overrideCompliance === true
      && input.metadata?.actorRole === 'SUPER_ADMIN'
      && input.metadata?.overrideReason,
    );
    if (blockers.length > 0 && !overrideAllowed) {
      throw complianceBlockedError('Carrier compliance blocks shipment assignment', blockers);
    }
  }

  const rows = await prisma.$queryRawUnsafe<LogisticsAssignmentRow[]>(
    `INSERT INTO logistics_assignments (
       tenant_id, shipment_order_id, carrier_id, driver_id, vehicle_id,
       assignment_type, status, cost_amount, currency, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
     RETURNING *`,
    input.tenantId,
    input.shipmentOrderId,
    input.carrierId ?? null,
    input.driverId ?? null,
    input.vehicleId ?? null,
    input.assignmentType ?? (input.carrierId ? 'CARRIER' : 'INTERNAL_FLEET'),
    input.status ?? 'ASSIGNED',
    input.costAmount ?? null,
    input.currency ?? 'AED',
    jsonParam(input.metadata ?? {}),
  );
  const assignment = rows[0];
  if (!assignment) return null;

  await prisma.$executeRawUnsafe(
    `UPDATE logistics_shipment_orders
        SET status = CASE
              WHEN status IN ('DRAFT','PENDING','APPROVED') THEN 'ASSIGNED'
              ELSE status
            END,
            assigned_carrier_id = COALESCE($1, assigned_carrier_id),
            assigned_driver_id = COALESCE($2, assigned_driver_id),
            assigned_vehicle_id = COALESCE($3, assigned_vehicle_id),
            carrier_cost_amount = COALESCE($4, carrier_cost_amount),
            updated_at = NOW()
      WHERE id = $5 AND tenant_id = $6`,
    input.carrierId ?? null,
    input.driverId ?? null,
    input.vehicleId ?? null,
    input.costAmount ?? null,
    input.shipmentOrderId,
    input.tenantId,
  );

  if (shipment.legacy_booking_id) {
    await prisma.booking.update({
      where: { id: shipment.legacy_booking_id },
      data: {
        status: 'ASSIGNED',
        vehicleId: input.vehicleId ?? shipment.assigned_vehicle_id,
      },
    }).catch(() => null);
  }

  await syncCarrierVehicleAvailability({
    tenantId: input.tenantId,
    carrierId: input.carrierId ?? null,
    vehicleId: input.vehicleId ?? null,
    shipmentStatus: input.status ?? 'ASSIGNED',
    actorUserId: typeof input.metadata?.assignedBy === 'string' ? input.metadata.assignedBy : null,
  });

  await addTrackingEvent({
    tenantId: input.tenantId,
    shipmentOrderId: input.shipmentOrderId,
    assignmentId: assignment.id,
    eventType: 'SHIPMENT_ASSIGNED',
    status: 'ASSIGNED',
    source: 'FREIGHT_MARKETPLACE',
    notes: input.carrierId ? 'Shipment assigned to carrier' : 'Shipment assigned internally',
    metadata: {
      carrierId: input.carrierId ?? null,
      driverId: input.driverId ?? null,
      vehicleId: input.vehicleId ?? null,
    },
  });

  const hydrated = await listShipmentAssignments({
    tenantId: input.tenantId,
    shipmentOrderId: input.shipmentOrderId,
  });
  return hydrated.find(row => row.id === assignment.id) ?? mapAssignment(assignment);
}

export async function prepareFreightFinancialSettlement(args: {
  tenantId: string;
  shipmentOrderId: string;
  rfqId?: string | null;
  bidId?: string | null;
  assignmentId?: string | null;
  carrierId: string;
  driverId?: string | null;
  carrierAmount: number;
  currency?: string | null;
  actorUserId?: string | null;
}) {
  await ensureLogisticsDomainTables();
  const shipment = await fetchShipmentById(args.shipmentOrderId, args.tenantId);
  if (!shipment) throw new Error('Shipment not found for settlement');

  const carrierRows = await prisma.$queryRawUnsafe<LogisticsCarrierRow[]>(
    `SELECT *
       FROM logistics_carriers
      WHERE tenant_id = $1
        AND id = $2
        AND deleted_at IS NULL
      LIMIT 1`,
    args.tenantId,
    args.carrierId,
  );
  const carrier = carrierRows[0];
  if (!carrier) throw new Error('Carrier not found for settlement');

  const currency = args.currency ?? shipment.currency ?? 'AED';
  const commissionRate = numberOrNull(carrier.commission_rate) ?? 0;
  const carrierAmount = Number(args.carrierAmount || 0);
  const fallbackCommission = Number((carrierAmount * commissionRate / 100).toFixed(2));
  const customerAmount = numberOrNull(shipment.customer_rate_amount) ?? Number((carrierAmount + fallbackCommission).toFixed(2));
  const commissionAmount = numberOrNull(shipment.platform_commission_amount) ?? Number(Math.max(customerAmount - carrierAmount, fallbackCommission).toFixed(2));
  const marginAmount = Number((customerAmount - carrierAmount).toFixed(2));
  const driverId = args.driverId ?? shipment.assigned_driver_id ?? null;
  const driverPayoutAmount = Number((carrierAmount * 0.7).toFixed(2));

  await prisma.$executeRawUnsafe(
    `INSERT INTO logistics_freight_charges (
       tenant_id, shipment_order_id, charge_side, charge_type, description,
       quantity, unit_rate, amount, tax_amount, total_amount, currency, billing_status, metadata
     )
     SELECT $1,$2,'CUSTOMER','CUSTOMER_FREIGHT',$3,1,$4,$4,0,$4,$5,'READY',$6::jsonb
      WHERE NOT EXISTS (
        SELECT 1 FROM logistics_freight_charges
         WHERE tenant_id = $1
           AND shipment_order_id = $2
           AND charge_side = 'CUSTOMER'
           AND charge_type = 'CUSTOMER_FREIGHT'
           AND COALESCE(metadata ->> 'awardBidId', '') = COALESCE($7, '')
      )`,
    args.tenantId,
    args.shipmentOrderId,
    `Customer freight billing for ${shipment.shipment_no}`,
    customerAmount,
    currency,
    jsonParam({
      source: 'freight-award',
      rfqId: args.rfqId ?? null,
      awardBidId: args.bidId ?? null,
      carrierId: args.carrierId,
      commissionAmount,
    }),
    args.bidId ?? null,
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO logistics_freight_charges (
       tenant_id, shipment_order_id, charge_side, charge_type, description,
       quantity, unit_rate, amount, tax_amount, total_amount, currency, billing_status, metadata
     )
     SELECT $1,$2,'CARRIER','CARRIER_FREIGHT',$3,1,$4,$4,0,$4,$5,'READY',$6::jsonb
      WHERE NOT EXISTS (
        SELECT 1 FROM logistics_freight_charges
         WHERE tenant_id = $1
           AND shipment_order_id = $2
           AND charge_side = 'CARRIER'
           AND charge_type = 'CARRIER_FREIGHT'
           AND COALESCE(metadata ->> 'awardBidId', '') = COALESCE($7, '')
      )`,
    args.tenantId,
    args.shipmentOrderId,
    `Carrier payable for ${carrier.name}`,
    carrierAmount,
    currency,
    jsonParam({
      source: 'freight-award',
      rfqId: args.rfqId ?? null,
      awardBidId: args.bidId ?? null,
      assignmentId: args.assignmentId ?? null,
      carrierId: args.carrierId,
    }),
    args.bidId ?? null,
  );

  const existingSettlement = await prisma.$queryRawUnsafe<Array<{ id: string; settlement_no: string }>>(
    `SELECT id, settlement_no
       FROM logistics_carrier_settlements
      WHERE tenant_id = $1
        AND carrier_id = $2
        AND COALESCE(metadata ->> 'awardBidId', '') = COALESCE($3, '')
      LIMIT 1`,
    args.tenantId,
    args.carrierId,
    args.bidId ?? null,
  );
  let settlement = existingSettlement[0] ?? null;
  if (!settlement) {
    const settlementNo = await nextMarketplaceNo({
      tenantId: args.tenantId,
      tableName: 'logistics_carrier_settlements',
      columnName: 'settlement_no',
      prefix: defaultSettlementNoPrefix(),
    });
    const settlementRows = await prisma.$queryRawUnsafe<Array<{ id: string; settlement_no: string }>>(
      `INSERT INTO logistics_carrier_settlements (
         tenant_id, carrier_id, settlement_no, gross_amount, deductions_amount,
         commission_amount, net_payable_amount, currency, status, metadata
       ) VALUES ($1,$2,$3,$4,0,$5,$6,$7,'READY',$8::jsonb)
       RETURNING id, settlement_no`,
      args.tenantId,
      args.carrierId,
      settlementNo,
      carrierAmount,
      commissionAmount,
      carrierAmount,
      currency,
      jsonParam({
        source: 'freight-award',
        shipmentOrderId: args.shipmentOrderId,
        shipmentNo: shipment.shipment_no,
        rfqId: args.rfqId ?? null,
        awardBidId: args.bidId ?? null,
        assignmentId: args.assignmentId ?? null,
      }),
    );
    settlement = settlementRows[0] ?? null;
  }

  let driverPayout: { id: string; payout_no: string } | null = null;
  if (driverId) {
    const existingPayout = await prisma.$queryRawUnsafe<Array<{ id: string; payout_no: string }>>(
      `SELECT id, payout_no
         FROM logistics_driver_payouts
        WHERE tenant_id = $1
          AND shipment_order_id = $2
          AND COALESCE(metadata ->> 'awardBidId', '') = COALESCE($3, '')
        LIMIT 1`,
      args.tenantId,
      args.shipmentOrderId,
      args.bidId ?? null,
    );
    driverPayout = existingPayout[0] ?? null;
    if (!driverPayout) {
      const payoutNo = await nextMarketplaceNo({
        tenantId: args.tenantId,
        tableName: 'logistics_driver_payouts',
        columnName: 'payout_no',
        prefix: defaultDriverPayoutNoPrefix(),
      });
      const payoutRows = await prisma.$queryRawUnsafe<Array<{ id: string; payout_no: string }>>(
        `INSERT INTO logistics_driver_payouts (
           tenant_id, shipment_order_id, assignment_id, driver_id, payout_no,
           gross_amount, deductions_amount, net_payable_amount, currency, status, metadata
         ) VALUES ($1,$2,$3,$4,$5,$6,0,$6,$7,'DRAFT',$8::jsonb)
         RETURNING id, payout_no`,
        args.tenantId,
        args.shipmentOrderId,
        args.assignmentId ?? null,
        driverId,
        payoutNo,
        driverPayoutAmount,
        currency,
        jsonParam({
          source: 'freight-award',
          rfqId: args.rfqId ?? null,
          awardBidId: args.bidId ?? null,
          basis: '70% of carrier payable until driver contract rules are configured',
        }),
      );
      driverPayout = payoutRows[0] ?? null;
    }
  }

  await prisma.$executeRawUnsafe(
    `UPDATE logistics_shipment_orders
        SET customer_rate_amount = COALESCE(customer_rate_amount, $1),
            carrier_cost_amount = COALESCE(carrier_cost_amount, $2),
            platform_commission_amount = $3,
            margin_amount = $4,
            updated_at = NOW(),
            updated_by = $5,
            metadata = COALESCE(metadata, '{}'::jsonb) || $6::jsonb
      WHERE tenant_id = $7
        AND id = $8`,
    customerAmount,
    carrierAmount,
    commissionAmount,
    marginAmount,
    args.actorUserId ?? 'freight-settlement',
    jsonParam({
      settlementPrepared: true,
      settlementId: settlement?.id ?? null,
      driverPayoutId: driverPayout?.id ?? null,
      customerBillingStatus: 'READY',
      carrierPayableStatus: 'READY',
    }),
    args.tenantId,
    args.shipmentOrderId,
  );

  await addTrackingEvent({
    tenantId: args.tenantId,
    shipmentOrderId: args.shipmentOrderId,
    assignmentId: args.assignmentId ?? null,
    eventType: 'FREIGHT_SETTLEMENT_PREPARED',
    status: 'FINANCE_READY',
    source: 'FREIGHT_MARKETPLACE',
    notes: 'Customer billing, carrier payable, commission, and driver payout shell prepared',
    metadata: {
      rfqId: args.rfqId ?? null,
      bidId: args.bidId ?? null,
      carrierId: args.carrierId,
      settlementId: settlement?.id ?? null,
      driverPayoutId: driverPayout?.id ?? null,
      customerAmount,
      carrierAmount,
      commissionAmount,
      marginAmount,
      currency,
    },
  });

  return {
    customerAmount,
    carrierAmount,
    commissionAmount,
    marginAmount,
    currency,
    settlement,
    driverPayout,
  };
}

async function ensureFinanceJournalPostingTables() {
  await ensureFinanceSourceLedger();
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS finance_journal_entries (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW(),
      deleted_at      TIMESTAMPTZ,
      je_number       TEXT UNIQUE NOT NULL,
      entry_date      DATE NOT NULL,
      period_year     INTEGER NOT NULL,
      period_month    INTEGER NOT NULL,
      narration       TEXT NOT NULL,
      reference       TEXT,
      source_type     TEXT DEFAULT 'MANUAL',
      source_id       TEXT,
      status          TEXT DEFAULT 'DRAFT',
      total_debit     NUMERIC(15,2) DEFAULT 0,
      total_credit    NUMERIC(15,2) DEFAULT 0,
      is_balanced     BOOLEAN DEFAULT FALSE,
      reversed_je_id  TEXT,
      reversal_je_id  TEXT,
      prepared_by     TEXT,
      approved_by     TEXT,
      posted_by       TEXT,
      approved_at     TIMESTAMPTZ,
      posted_at       TIMESTAMPTZ,
      notes           TEXT,
      currency        TEXT DEFAULT 'AED',
      tenant_id       TEXT
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS finance_journal_lines (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      journal_entry_id TEXT NOT NULL,
      line_number     INTEGER NOT NULL,
      account_code    TEXT NOT NULL,
      account_name    TEXT,
      description     TEXT,
      debit_amount    NUMERIC(15,2) DEFAULT 0,
      credit_amount   NUMERIC(15,2) DEFAULT 0,
      normal_balance  TEXT DEFAULT 'DEBIT',
      cost_centre     TEXT,
      currency        TEXT DEFAULT 'AED'
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS idx_finance_journal_entries_logistics_source
      ON finance_journal_entries(tenant_id, source_type, source_id)
      WHERE deleted_at IS NULL
  `).catch(() => {});
}

async function nextFinanceInvoiceNo(tenantId: string, date = new Date()) {
  const yy = String(date.getFullYear()).slice(-2);
  const prefix = `INV-LOG-${yy}`;
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint | number | string }>>(
    `SELECT COUNT(*) AS count
       FROM finance_invoices
      WHERE tenant_id::text = $1
        AND invoice_number LIKE $2`,
    tenantId,
    `${prefix}%`,
  ).catch(() => [{ count: 0 }]);
  const seq = Number(rows[0]?.count ?? 0) + 1;
  const suffix = randomBytes(2).toString('hex').toUpperCase();
  return `${prefix}${String(seq).padStart(5, '0')}-${suffix}`;
}

async function nextFinanceJournalNo(tenantId: string, date = new Date()) {
  const ym = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`;
  const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint | number | string }>>(
    `SELECT COUNT(*) AS count
       FROM finance_journal_entries
      WHERE tenant_id::text = $1
        AND je_number LIKE $2`,
    tenantId,
    `JE-${ym}-%`,
  ).catch(() => [{ count: 0 }]);
  return `JE-${ym}-${String(Number(rows[0]?.count ?? 0) + 1).padStart(5, '0')}`;
}

function mapFinancePosting(row: LogisticsFinancePostingRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    shipmentOrderId: row.shipment_order_id,
    postingType: row.posting_type,
    sourceRecordId: row.source_record_id,
    financeInvoiceId: row.finance_invoice_id,
    financeJournalEntryId: row.finance_journal_entry_id,
    amount: numberOrNull(row.amount) ?? 0,
    currency: row.currency,
    status: row.status,
    metadata: row.metadata ?? {},
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

async function getFinancePosting(args: {
  tenantId: string;
  shipmentOrderId: string;
  postingType: string;
  sourceRecordId?: string | null;
}) {
  const rows = await prisma.$queryRawUnsafe<LogisticsFinancePostingRow[]>(
    `SELECT *
       FROM logistics_finance_postings
      WHERE tenant_id = $1
        AND shipment_order_id = $2
        AND posting_type = $3
        AND source_record_id = COALESCE($4, '')
        AND status <> 'REVERSED'
      LIMIT 1`,
    args.tenantId,
    args.shipmentOrderId,
    args.postingType,
    args.sourceRecordId ?? '',
  );
  return rows[0] ? mapFinancePosting(rows[0]) : null;
}

async function insertFinancePosting(args: {
  tenantId: string;
  shipmentOrderId: string;
  postingType: string;
  sourceRecordId?: string | null;
  financeInvoiceId?: string | null;
  financeJournalEntryId?: string | null;
  amount: number;
  currency: string;
  metadata?: JsonRecord | null;
}) {
  const rows = await prisma.$queryRawUnsafe<LogisticsFinancePostingRow[]>(
    `INSERT INTO logistics_finance_postings (
       tenant_id, shipment_order_id, posting_type, source_record_id,
       finance_invoice_id, finance_journal_entry_id, amount, currency, status, metadata
     ) VALUES ($1,$2,$3,COALESCE($4,''),$5,$6,$7,$8,'POSTED',$9::jsonb)
     ON CONFLICT (tenant_id, shipment_order_id, posting_type, source_record_id)
     DO UPDATE SET
       updated_at = NOW(),
       finance_invoice_id = COALESCE(EXCLUDED.finance_invoice_id, logistics_finance_postings.finance_invoice_id),
       finance_journal_entry_id = COALESCE(EXCLUDED.finance_journal_entry_id, logistics_finance_postings.finance_journal_entry_id),
       amount = EXCLUDED.amount,
       currency = EXCLUDED.currency,
       status = EXCLUDED.status,
       metadata = COALESCE(logistics_finance_postings.metadata, '{}'::jsonb) || EXCLUDED.metadata
     RETURNING *`,
    args.tenantId,
    args.shipmentOrderId,
    args.postingType,
    args.sourceRecordId ?? '',
    args.financeInvoiceId ?? null,
    args.financeJournalEntryId ?? null,
    args.amount,
    args.currency,
    jsonParam(args.metadata ?? {}),
  );
  return rows[0] ? mapFinancePosting(rows[0]) : null;
}

async function createFinanceJournalEntry(args: {
  tenantId: string;
  narration: string;
  reference: string;
  sourceId: string;
  amount: number;
  currency: string;
  preparedBy?: string | null;
  notes?: string | null;
  debit: { code: string; name: string; description: string };
  credit: { code: string; name: string; description: string };
}) {
  const entryDate = new Date();
  const jeNumber = await nextFinanceJournalNo(args.tenantId, entryDate);
  const [je] = await prisma.$queryRawUnsafe<Array<{ id: string; je_number: string }>>(
    `INSERT INTO finance_journal_entries (
       je_number, entry_date, period_year, period_month, narration, reference,
       source_type, source_id, status, total_debit, total_credit, is_balanced,
       prepared_by, approved_by, posted_by, approved_at, posted_at, notes, currency, tenant_id
     ) VALUES (
       $1,$2::date,$3,$4,$5,$6,
       'LOGISTICS_SETTLEMENT',$7,'POSTED',$8,$8,true,
       $9,$9,$9,NOW(),NOW(),$10,$11,$12
     )
     RETURNING id::text, je_number`,
    jeNumber,
    entryDate.toISOString().slice(0, 10),
    entryDate.getFullYear(),
    entryDate.getMonth() + 1,
    args.narration,
    args.reference,
    args.sourceId,
    args.amount,
    args.preparedBy ?? 'logistics-settlement-posting',
    args.notes ?? null,
    args.currency,
    args.tenantId,
  );
  if (!je) throw new Error(`Failed to create finance journal entry for ${args.reference}`);

  await prisma.$executeRawUnsafe(
    `INSERT INTO finance_journal_lines
       (journal_entry_id, line_number, account_code, account_name, description,
        debit_amount, credit_amount, normal_balance, cost_centre, currency)
     VALUES
       ($1,1,$2,$3,$4,$5,0,'DEBIT','LOGISTICS',$6),
       ($1,2,$7,$8,$9,0,$5,'CREDIT','LOGISTICS',$6)`,
    je.id,
    args.debit.code,
    args.debit.name,
    args.debit.description,
    args.amount,
    args.currency,
    args.credit.code,
    args.credit.name,
    args.credit.description,
  );

  return { id: je.id, number: je.je_number };
}

export async function listLogisticsFinancePostings(args: {
  tenantId: string;
  shipmentOrderId: string;
}) {
  await ensureLogisticsDomainTables();
  const rows = await prisma.$queryRawUnsafe<LogisticsFinancePostingRow[]>(
    `SELECT *
       FROM logistics_finance_postings
      WHERE tenant_id = $1
        AND shipment_order_id = $2
      ORDER BY created_at DESC`,
    args.tenantId,
    args.shipmentOrderId,
  );
  return rows.map(mapFinancePosting);
}

export async function reverseLogisticsFinancePosting(args: {
  tenantId: string;
  shipmentOrderId: string;
  postingId: string;
  actorUserId?: string | null;
  reason?: string | null;
}) {
  await ensureLogisticsDomainTables();
  if (!String(args.reason ?? '').trim()) {
    throw new LogisticsValidationError(['Reversal reason is required for Logistics Finance postings.']);
  }
  await assertGovernedShipmentWrite({
    tenantId: args.tenantId,
    shipmentOrderId: args.shipmentOrderId,
    action: 'Finance posting reversal',
    allowClosed: true,
  });
  const beforeRows = await prisma.$queryRawUnsafe<LogisticsFinancePostingRow[]>(
    `SELECT *
       FROM logistics_finance_postings
      WHERE tenant_id = $1
        AND shipment_order_id = $2
        AND id = $3
        AND status <> 'REVERSED'
      LIMIT 1`,
    args.tenantId,
    args.shipmentOrderId,
    args.postingId,
  );
  const before = beforeRows[0];
  if (!before) throw new LogisticsValidationError(['Active Finance posting link not found for this shipment.']);

  const rows = await prisma.$queryRawUnsafe<LogisticsFinancePostingRow[]>(
    `UPDATE logistics_finance_postings
        SET status = 'REVERSED',
            updated_at = NOW(),
            metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb
      WHERE tenant_id = $2
        AND shipment_order_id = $3
        AND id = $4
        AND status <> 'REVERSED'
      RETURNING *`,
    jsonParam({
      reversedBy: args.actorUserId ?? null,
      reversedAt: new Date().toISOString(),
      reversalReason: args.reason ?? null,
    }),
    args.tenantId,
    args.shipmentOrderId,
    args.postingId,
  );
  const posting = rows[0];
  if (!posting) throw new LogisticsValidationError(['Active Finance posting link not found for this shipment.']);

  if (posting.posting_type === 'CUSTOMER_INVOICE') {
    await prisma.$executeRawUnsafe(
      `UPDATE logistics_freight_charges
          SET billing_status = 'READY',
              updated_at = NOW(),
              metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb
        WHERE tenant_id = $2
          AND shipment_order_id = $3
          AND id = $4`,
      jsonParam({ financePostingReversedAt: new Date().toISOString(), financePostingId: posting.id }),
      args.tenantId,
      args.shipmentOrderId,
      posting.source_record_id,
    );
  }
  if (posting.posting_type === 'CARRIER_PAYABLE') {
    await prisma.$executeRawUnsafe(
      `UPDATE logistics_carrier_settlements
          SET status = 'READY',
              updated_at = NOW(),
              metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb
        WHERE tenant_id = $2
          AND id = $3`,
      jsonParam({ financePostingReversedAt: new Date().toISOString(), financePostingId: posting.id }),
      args.tenantId,
      posting.source_record_id,
    );
  }
  if (posting.posting_type === 'DRIVER_PAYOUT') {
    await prisma.$executeRawUnsafe(
      `UPDATE logistics_driver_payouts
          SET status = 'DRAFT',
              updated_at = NOW(),
              metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb
        WHERE tenant_id = $2
          AND id = $3`,
      jsonParam({ financePostingReversedAt: new Date().toISOString(), financePostingId: posting.id }),
      args.tenantId,
      posting.source_record_id,
    );
  }

  await addTrackingEvent({
    tenantId: args.tenantId,
    shipmentOrderId: args.shipmentOrderId,
    eventType: 'FREIGHT_FINANCE_POSTING_REVERSED',
    status: 'FINANCE_REVERSED',
    source: 'FINANCE',
    notes: args.reason ?? `Reversed ${posting.posting_type.replace(/_/g, ' ').toLowerCase()} posting link`,
    metadata: {
      postingId: posting.id,
      postingType: posting.posting_type,
      sourceRecordId: posting.source_record_id,
      financeInvoiceId: posting.finance_invoice_id,
      financeJournalEntryId: posting.finance_journal_entry_id,
      actorUserId: args.actorUserId ?? null,
    },
  });

  await logLogisticsAudit({
    tenantId: args.tenantId,
    entityType: 'LogisticsFinancePosting',
    entityId: posting.id,
    entityName: posting.posting_type,
    action: 'REVERSE',
    actorUserId: args.actorUserId ?? null,
    summary: `Reversed ${posting.posting_type.replace(/_/g, ' ').toLowerCase()} for Logistics shipment ${args.shipmentOrderId}`,
    before: mapFinancePosting(before),
    after: mapFinancePosting(posting),
    metadata: {
      shipmentOrderId: args.shipmentOrderId,
      reason: args.reason ?? null,
    },
  });

  return mapFinancePosting(posting);
}

export async function postFreightSettlementToFinance(args: {
  tenantId: string;
  shipmentOrderId: string;
  actorUserId?: string | null;
}) {
  await ensureLogisticsDomainTables();
  await ensureFinanceJournalPostingTables();

  const { shipment } = await assertGovernedShipmentWrite({
    tenantId: args.tenantId,
    shipmentOrderId: args.shipmentOrderId,
    action: 'Finance settlement posting',
    allowClosed: true,
  });

  const [customerCharge] = await prisma.$queryRawUnsafe<Array<{
    id: string;
    total_amount: string | number;
    currency: string;
    description: string | null;
    invoice_id: string | null;
    metadata: JsonRecord | null;
  }>>(
    `SELECT id, total_amount, currency, description, invoice_id, metadata
       FROM logistics_freight_charges
      WHERE tenant_id = $1
        AND shipment_order_id = $2
        AND charge_side = 'CUSTOMER'
        AND billing_status IN ('READY','POSTED')
      ORDER BY created_at DESC
      LIMIT 1`,
    args.tenantId,
    args.shipmentOrderId,
  );

  const [carrierCharge] = await prisma.$queryRawUnsafe<Array<{
    id: string;
    total_amount: string | number;
    currency: string;
    description: string | null;
    settlement_id: string | null;
    metadata: JsonRecord | null;
  }>>(
    `SELECT id, total_amount, currency, description, settlement_id, metadata
       FROM logistics_freight_charges
      WHERE tenant_id = $1
        AND shipment_order_id = $2
        AND charge_side = 'CARRIER'
        AND billing_status IN ('READY','POSTED')
      ORDER BY created_at DESC
      LIMIT 1`,
    args.tenantId,
    args.shipmentOrderId,
  );

  if (!customerCharge && !carrierCharge) {
    throw new Error('No ready logistics settlement charges found. Award a carrier bid first.');
  }

  const [settlement] = await prisma.$queryRawUnsafe<Array<{
    id: string;
    settlement_no: string;
    carrier_id: string;
    net_payable_amount: string | number;
    currency: string;
    status: string;
    metadata: JsonRecord | null;
    carrier_name: string | null;
  }>>(
    `SELECT s.id, s.settlement_no, s.carrier_id, s.net_payable_amount, s.currency,
            s.status, s.metadata, c.name AS carrier_name
       FROM logistics_carrier_settlements s
       LEFT JOIN logistics_carriers c
         ON c.id = s.carrier_id
        AND c.tenant_id = s.tenant_id
      WHERE s.tenant_id = $1
        AND (
          COALESCE(s.metadata ->> 'shipmentOrderId', '') = $2
          OR s.id = COALESCE($3, '')
        )
      ORDER BY s.created_at DESC
      LIMIT 1`,
    args.tenantId,
    args.shipmentOrderId,
    carrierCharge?.settlement_id ?? '',
  );

  const [driverPayout] = await prisma.$queryRawUnsafe<Array<{
    id: string;
    payout_no: string;
    net_payable_amount: string | number;
    currency: string;
    status: string;
    driver_id: string | null;
  }>>(
    `SELECT id, payout_no, net_payable_amount, currency, status, driver_id
       FROM logistics_driver_payouts
      WHERE tenant_id = $1
        AND shipment_order_id = $2
      ORDER BY created_at DESC
      LIMIT 1`,
    args.tenantId,
    args.shipmentOrderId,
  );

  const results: Array<Record<string, unknown>> = [];
  const currency = customerCharge?.currency ?? carrierCharge?.currency ?? shipment.currency ?? 'AED';

  if (customerCharge) {
    const existing = await getFinancePosting({
      tenantId: args.tenantId,
      shipmentOrderId: args.shipmentOrderId,
      postingType: 'CUSTOMER_INVOICE',
      sourceRecordId: customerCharge.id,
    });
    if (existing?.financeInvoiceId || customerCharge.invoice_id) {
      results.push({ postingType: 'CUSTOMER_INVOICE', mode: 'existing', financeInvoiceId: existing?.financeInvoiceId ?? customerCharge.invoice_id });
    } else {
      const invoiceNo = await nextFinanceInvoiceNo(args.tenantId);
      const amount = numberOrNull(customerCharge.total_amount) ?? 0;
      const lineItems = [{
        description: customerCharge.description ?? `Freight service for ${shipment.shipment_no}`,
        qty: 1,
        unitPrice: amount,
        amount,
        sourceModule: 'LOGISTICS',
        shipmentOrderId: shipment.id,
      }];
      const [invoice] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `INSERT INTO finance_invoices (
           invoice_number, client_name, client_email, client_phone,
           service_type, module, module_source, description,
           line_items, line_items_json, subtotal, discount_amount, vat_rate,
           vat_amount, total_amount, paid_amount, currency, issue_date, due_date,
           payment_status, notes, reference_id, reference_type, created_by, tenant_id,
           source_entity_type, source_entity_id, source_entity_no,
           source_customer_id, source_customer_name, source_payload
         ) VALUES (
           $1,$2,$3,$4,
           'LOGISTICS','LOGISTICS','LOGISTICS',$5,
           $6::jsonb,$6::jsonb,$7,0,0,
           0,$7,0,$8,CURRENT_DATE,NULL,
           'SENT',$9,$10::uuid,'LOGISTICS_SHIPMENT',$11,$12,
           'LOGISTICS_SHIPMENT',$10,$13,
           $14,$2,$15::jsonb
         )
         RETURNING id::text`,
        invoiceNo,
        shipment.cargo_owner_name ?? 'Cargo Owner',
        shipment.cargo_owner_email ?? null,
        shipment.cargo_owner_phone ?? null,
        `Logistics freight invoice for ${shipment.shipment_no}`,
        JSON.stringify(lineItems),
        amount,
        currency,
        `Created from logistics shipment ${shipment.shipment_no}`,
        shipment.id,
        args.actorUserId ?? 'logistics-finance-posting',
        args.tenantId,
        shipment.shipment_no,
        shipment.cargo_owner_customer_id ?? null,
        jsonParam({
          source: 'logistics-settlement',
          shipmentOrderId: shipment.id,
          shipmentNo: shipment.shipment_no,
          chargeId: customerCharge.id,
          route: {
            origin: shipment.origin_name ?? shipment.origin_address ?? null,
            destination: shipment.destination_name ?? shipment.destination_address ?? null,
          },
        }),
      );
      await prisma.$executeRawUnsafe(
        `UPDATE logistics_freight_charges
            SET billing_status = 'POSTED',
                invoice_id = $1,
                updated_at = NOW()
          WHERE tenant_id = $2
            AND id = $3`,
        invoice.id,
        args.tenantId,
        customerCharge.id,
      );
      const posting = await insertFinancePosting({
        tenantId: args.tenantId,
        shipmentOrderId: args.shipmentOrderId,
        postingType: 'CUSTOMER_INVOICE',
        sourceRecordId: customerCharge.id,
        financeInvoiceId: invoice.id,
        amount,
        currency,
        metadata: { invoiceNo, shipmentNo: shipment.shipment_no },
      });
      results.push({ postingType: 'CUSTOMER_INVOICE', mode: 'created', financeInvoiceId: invoice.id, posting });
    }
  }

  if (carrierCharge && settlement) {
    const existing = await getFinancePosting({
      tenantId: args.tenantId,
      shipmentOrderId: args.shipmentOrderId,
      postingType: 'CARRIER_PAYABLE',
      sourceRecordId: settlement.id,
    });
    if (existing?.financeJournalEntryId) {
      results.push({ postingType: 'CARRIER_PAYABLE', mode: 'existing', financeJournalEntryId: existing.financeJournalEntryId });
    } else {
      const amount = numberOrNull(settlement.net_payable_amount) ?? numberOrNull(carrierCharge.total_amount) ?? 0;
      const je = await createFinanceJournalEntry({
        tenantId: args.tenantId,
        narration: `Carrier payable for ${shipment.shipment_no}`,
        reference: settlement.settlement_no,
        sourceId: settlement.id,
        amount,
        currency: settlement.currency ?? currency,
        preparedBy: args.actorUserId,
        notes: `Carrier settlement ${settlement.settlement_no} for ${settlement.carrier_name ?? settlement.carrier_id}`,
        debit: {
          code: '5200-LOG',
          name: 'Logistics Carrier Freight Cost',
          description: `Freight cost for ${shipment.shipment_no}`,
        },
        credit: {
          code: '2200-LOG',
          name: 'Carrier Payables',
          description: `Carrier payable ${settlement.settlement_no}`,
        },
      });
      await prisma.$executeRawUnsafe(
        `UPDATE logistics_carrier_settlements
            SET status = 'POSTED',
                updated_at = NOW(),
                metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb
          WHERE tenant_id = $2
            AND id = $3`,
        jsonParam({ financeJournalEntryId: je.id, financeJournalNumber: je.number, postedAt: new Date().toISOString() }),
        args.tenantId,
        settlement.id,
      );
      await prisma.$executeRawUnsafe(
        `UPDATE logistics_freight_charges
            SET billing_status = 'POSTED',
                settlement_id = $1,
                updated_at = NOW()
          WHERE tenant_id = $2
            AND id = $3`,
        settlement.id,
        args.tenantId,
        carrierCharge.id,
      );
      const posting = await insertFinancePosting({
        tenantId: args.tenantId,
        shipmentOrderId: args.shipmentOrderId,
        postingType: 'CARRIER_PAYABLE',
        sourceRecordId: settlement.id,
        financeJournalEntryId: je.id,
        amount,
        currency: settlement.currency ?? currency,
        metadata: { settlementNo: settlement.settlement_no, journalNumber: je.number, shipmentNo: shipment.shipment_no },
      });
      results.push({ postingType: 'CARRIER_PAYABLE', mode: 'created', financeJournalEntryId: je.id, journalNumber: je.number, posting });
    }
  }

  if (driverPayout) {
    const existing = await getFinancePosting({
      tenantId: args.tenantId,
      shipmentOrderId: args.shipmentOrderId,
      postingType: 'DRIVER_PAYOUT',
      sourceRecordId: driverPayout.id,
    });
    if (existing?.financeJournalEntryId) {
      results.push({ postingType: 'DRIVER_PAYOUT', mode: 'existing', financeJournalEntryId: existing.financeJournalEntryId });
    } else {
      const amount = numberOrNull(driverPayout.net_payable_amount) ?? 0;
      const je = await createFinanceJournalEntry({
        tenantId: args.tenantId,
        narration: `Driver payout for ${shipment.shipment_no}`,
        reference: driverPayout.payout_no,
        sourceId: driverPayout.id,
        amount,
        currency: driverPayout.currency ?? currency,
        preparedBy: args.actorUserId,
        notes: `Driver payout ${driverPayout.payout_no}`,
        debit: {
          code: '5250-LOG',
          name: 'Logistics Driver Payout Cost',
          description: `Driver payout cost for ${shipment.shipment_no}`,
        },
        credit: {
          code: '2210-LOG',
          name: 'Driver Payables',
          description: `Driver payout payable ${driverPayout.payout_no}`,
        },
      });
      await prisma.$executeRawUnsafe(
        `UPDATE logistics_driver_payouts
            SET status = 'POSTED',
                updated_at = NOW(),
                metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb
          WHERE tenant_id = $2
            AND id = $3`,
        jsonParam({ financeJournalEntryId: je.id, financeJournalNumber: je.number, postedAt: new Date().toISOString() }),
        args.tenantId,
        driverPayout.id,
      );
      const posting = await insertFinancePosting({
        tenantId: args.tenantId,
        shipmentOrderId: args.shipmentOrderId,
        postingType: 'DRIVER_PAYOUT',
        sourceRecordId: driverPayout.id,
        financeJournalEntryId: je.id,
        amount,
        currency: driverPayout.currency ?? currency,
        metadata: { payoutNo: driverPayout.payout_no, journalNumber: je.number, shipmentNo: shipment.shipment_no },
      });
      results.push({ postingType: 'DRIVER_PAYOUT', mode: 'created', financeJournalEntryId: je.id, journalNumber: je.number, posting });
    }
  }

  const customerAmountForCommission = customerCharge ? numberOrNull(customerCharge.total_amount) ?? 0 : numberOrNull(shipment.customer_rate_amount) ?? 0;
  const carrierAmountForCommission = carrierCharge ? numberOrNull(carrierCharge.total_amount) ?? 0 : numberOrNull(shipment.carrier_cost_amount) ?? 0;
  const commissionAmount = numberOrNull(shipment.platform_commission_amount)
    ?? Number(Math.max(customerAmountForCommission - carrierAmountForCommission, 0).toFixed(2));
  if (commissionAmount > 0) {
    const existing = await getFinancePosting({
      tenantId: args.tenantId,
      shipmentOrderId: args.shipmentOrderId,
      postingType: 'PLATFORM_COMMISSION',
      sourceRecordId: shipment.id,
    });
    if (existing) {
      results.push({ postingType: 'PLATFORM_COMMISSION', mode: 'existing', posting: existing });
    } else {
      const posting = await insertFinancePosting({
        tenantId: args.tenantId,
        shipmentOrderId: args.shipmentOrderId,
        postingType: 'PLATFORM_COMMISSION',
        sourceRecordId: shipment.id,
        amount: commissionAmount,
        currency,
        metadata: {
          shipmentNo: shipment.shipment_no,
          source: 'logistics-settlement',
          basis: 'customer invoice less carrier payable',
        },
      });
      results.push({ postingType: 'PLATFORM_COMMISSION', mode: 'created', posting });
    }
  }

  await prisma.$executeRawUnsafe(
    `UPDATE logistics_shipment_orders
        SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb,
            updated_at = NOW(),
            updated_by = $2
      WHERE tenant_id = $3
        AND id = $4`,
    jsonParam({ financePosted: true, financePostedAt: new Date().toISOString(), financePostingCount: results.length }),
    args.actorUserId ?? 'logistics-finance-posting',
    args.tenantId,
    args.shipmentOrderId,
  );

  await addTrackingEvent({
    tenantId: args.tenantId,
    shipmentOrderId: args.shipmentOrderId,
    eventType: 'FREIGHT_SETTLEMENT_POSTED_TO_FINANCE',
    status: 'FINANCE_POSTED',
    source: 'FINANCE',
    notes: 'Logistics settlement posted to Finance invoices and journal entries',
    metadata: { results },
  });

  await logLogisticsAudit({
    tenantId: args.tenantId,
    entityType: 'LogisticsShipment',
    entityId: args.shipmentOrderId,
    entityName: shipment.shipment_no,
    action: 'FINANCE_POST',
    actorUserId: args.actorUserId ?? null,
    summary: `Posted Logistics settlement for shipment ${shipment.shipment_no}`,
    after: {
      results,
      customerInvoice: results.find(row => row.postingType === 'CUSTOMER_INVOICE') ?? null,
      carrierPayable: results.find(row => row.postingType === 'CARRIER_PAYABLE') ?? null,
      platformCommission: results.find(row => row.postingType === 'PLATFORM_COMMISSION') ?? null,
      driverPayout: results.find(row => row.postingType === 'DRIVER_PAYOUT') ?? null,
    },
  });

  return {
    shipmentId: args.shipmentOrderId,
    shipmentNo: shipment.shipment_no,
    postings: await listLogisticsFinancePostings({
      tenantId: args.tenantId,
      shipmentOrderId: args.shipmentOrderId,
    }),
    results,
  };
}

export async function listShipmentExecutionTimeline(args: {
  tenantId: string;
  shipmentOrderId: string;
}) {
  await ensureLogisticsDomainTables();
  const shipment = await fetchShipmentById(args.shipmentOrderId, args.tenantId);
  if (!shipment) return null;

  const [trackingEvents, podEvents, charges, postings, assignments] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{
      id: string;
      event_type: string;
      status: string | null;
      latitude: string | number | null;
      longitude: string | number | null;
      source: string;
      occurred_at: Date;
      notes: string | null;
      metadata: JsonRecord | null;
    }>>(
      `SELECT id, event_type, status, latitude, longitude, source, occurred_at, notes, metadata
         FROM logistics_tracking_events
        WHERE tenant_id = $1
          AND shipment_order_id = $2
        ORDER BY occurred_at DESC, created_at DESC
        LIMIT 100`,
      args.tenantId,
      args.shipmentOrderId,
    ),
    prisma.$queryRawUnsafe<Array<{
      id: string;
      assignment_id: string | null;
      delivered_at: Date | null;
      recipient_name: string | null;
      signature_url: string | null;
      photo_urls: unknown;
      document_urls: unknown;
      gps: unknown;
      status: string;
      created_by: string | null;
      created_at: Date;
      metadata: JsonRecord | null;
    }>>(
      `SELECT id, assignment_id, delivered_at, recipient_name, signature_url,
              photo_urls, document_urls, gps, status, created_by, created_at, metadata
         FROM logistics_pod_events
        WHERE tenant_id = $1
          AND shipment_order_id = $2
        ORDER BY created_at DESC
        LIMIT 20`,
      args.tenantId,
      args.shipmentOrderId,
    ),
    prisma.$queryRawUnsafe<Array<{
      id: string;
      charge_side: string;
      charge_type: string;
      description: string | null;
      total_amount: string | number;
      currency: string;
      billing_status: string;
      invoice_id: string | null;
      settlement_id: string | null;
      metadata: JsonRecord | null;
    }>>(
      `SELECT id, charge_side, charge_type, description, total_amount, currency,
              billing_status, invoice_id, settlement_id, metadata
         FROM logistics_freight_charges
        WHERE tenant_id = $1
          AND shipment_order_id = $2
        ORDER BY created_at DESC
        LIMIT 100`,
      args.tenantId,
      args.shipmentOrderId,
    ),
    listLogisticsFinancePostings({
      tenantId: args.tenantId,
      shipmentOrderId: args.shipmentOrderId,
    }),
    listShipmentAssignments({
      tenantId: args.tenantId,
      shipmentOrderId: args.shipmentOrderId,
    }),
  ]);

  return {
    shipment,
    assignments,
    events: trackingEvents.map(event => ({
      id: event.id,
      type: event.event_type,
      status: event.status,
      latitude: numberOrNull(event.latitude),
      longitude: numberOrNull(event.longitude),
      source: event.source,
      occurredAt: iso(event.occurred_at),
      notes: event.notes,
      metadata: event.metadata ?? {},
    })),
    pods: podEvents.map(pod => ({
      id: pod.id,
      assignmentId: pod.assignment_id,
      deliveredAt: iso(pod.delivered_at),
      recipientName: pod.recipient_name,
      signatureUrl: pod.signature_url,
      photoUrls: pod.photo_urls ?? [],
      documentUrls: pod.document_urls ?? [],
      gps: pod.gps ?? null,
      status: pod.status,
      createdBy: pod.created_by,
      createdAt: iso(pod.created_at),
      metadata: pod.metadata ?? {},
    })),
    finance: {
      customerCharges: charges
        .filter(charge => charge.charge_side === 'CUSTOMER')
        .map(charge => ({
          id: charge.id,
          type: charge.charge_type,
          description: charge.description,
          totalAmount: numberOrNull(charge.total_amount) ?? 0,
          currency: charge.currency,
          status: charge.billing_status,
          invoiceId: charge.invoice_id,
          metadata: charge.metadata ?? {},
        })),
      carrierPayables: charges
        .filter(charge => charge.charge_side === 'CARRIER')
        .map(charge => ({
          id: charge.id,
          type: charge.charge_type,
          description: charge.description,
          totalAmount: numberOrNull(charge.total_amount) ?? 0,
          currency: charge.currency,
          status: charge.billing_status,
          settlementId: charge.settlement_id,
          metadata: charge.metadata ?? {},
        })),
      postings,
    },
  };
}

function nextRateContractNo() {
  const yy = String(new Date().getFullYear()).slice(-2);
  return `RC-LOG-${yy}${randomBytes(3).toString('hex').toUpperCase()}`;
}

function mapRateContract(row: LogisticsRateContractRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    carrierId: row.carrier_id,
    carrierName: row.carrier_name ?? null,
    contractNo: row.contract_no,
    laneOrigin: row.lane_origin,
    laneDestination: row.lane_destination,
    vehicleType: row.vehicle_type,
    serviceLevel: row.service_level,
    currency: row.currency,
    baseRate: numberOrNull(row.base_rate) ?? 0,
    minCharge: numberOrNull(row.min_charge),
    fuelSurchargePct: numberOrNull(row.fuel_surcharge_pct),
    accessorialRules: row.accessorial_rules ?? {},
    effectiveFrom: dateOnly(row.effective_from),
    effectiveTo: dateOnly(row.effective_to),
    status: row.status,
    metadata: row.metadata ?? {},
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapCarrierScorecard(row: LogisticsCarrierScorecardRow) {
  const qualityScore = Math.max(0, Math.min(100, Math.round(
    ((numberOrNull(row.on_time_rate) ?? 0) * 0.35)
    + ((numberOrNull(row.acceptance_rate) ?? 0) * 0.2)
    + ((numberOrNull(row.compliance_score) ?? 0) * 0.3)
    + ((100 - (numberOrNull(row.cancellation_rate) ?? 0)) * 0.1)
    + ((100 - (numberOrNull(row.claim_rate) ?? 0)) * 0.05),
  )));

  return {
    id: row.id,
    tenantId: row.tenant_id,
    carrierId: row.carrier_id,
    carrierName: row.carrier_name ?? null,
    periodStart: dateOnly(row.period_start),
    periodEnd: dateOnly(row.period_end),
    onTimeRate: numberOrNull(row.on_time_rate),
    acceptanceRate: numberOrNull(row.acceptance_rate),
    cancellationRate: numberOrNull(row.cancellation_rate),
    claimRate: numberOrNull(row.claim_rate),
    complianceScore: numberOrNull(row.compliance_score),
    averageRating: numberOrNull(row.average_rating),
    shipmentsCompleted: Number(row.shipments_completed ?? 0),
    qualityScore,
    preferred: row.preferred,
    blacklisted: row.blacklisted,
    blacklistReason: row.blacklist_reason,
    status: row.status,
    metadata: row.metadata ?? {},
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapTelematicsEvent(row: LogisticsTelematicsEventRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    shipmentOrderId: row.shipment_order_id,
    assignmentId: row.assignment_id,
    vehicleId: row.vehicle_id,
    provider: row.provider,
    deviceId: row.device_id,
    latitude: numberOrNull(row.latitude),
    longitude: numberOrNull(row.longitude),
    speedKph: numberOrNull(row.speed_kph),
    heading: numberOrNull(row.heading),
    odometerKm: numberOrNull(row.odometer_km),
    eventTime: iso(row.event_time),
    etaAt: iso(row.eta_at),
    etaConfidence: numberOrNull(row.eta_confidence),
    rawPayload: row.raw_payload ?? {},
    createdAt: iso(row.created_at),
  };
}

function mapAccessorialCatalog(row: LogisticsAccessorialCatalogRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    name: row.name,
    chargeType: row.charge_type,
    defaultAmount: numberOrNull(row.default_amount),
    currency: row.currency,
    taxable: row.taxable,
    autoApplyRule: row.auto_apply_rule ?? {},
    status: row.status,
    metadata: row.metadata ?? {},
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export async function listRateContracts(args: {
  tenantId: string;
  carrierId?: string | null;
  customerId?: string | null;
  status?: string | null;
  laneOrigin?: string | null;
  laneDestination?: string | null;
  search?: string | null;
  limit?: number;
}) {
  await ensureLogisticsDomainTables();
  const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
  const rows = await prisma.$queryRawUnsafe<Array<LogisticsRateContractRow & { carrier_name?: string | null }>>(
    `SELECT rc.*, c.name AS carrier_name
       FROM logistics_rate_contracts rc
       LEFT JOIN logistics_carriers c
         ON c.id = rc.carrier_id
        AND c.tenant_id = rc.tenant_id
      WHERE rc.tenant_id = $1
        AND rc.deleted_at IS NULL
        AND ($2::text IS NULL OR rc.carrier_id = $2)
        AND ($3::text IS NULL OR rc.customer_id = $3)
        AND ($4::text IS NULL OR rc.status = $4)
        AND ($5::text IS NULL OR rc.lane_origin ILIKE '%' || $5 || '%')
        AND ($6::text IS NULL OR rc.lane_destination ILIKE '%' || $6 || '%')
        AND (
          $7::text IS NULL
          OR rc.contract_no ILIKE '%' || $7 || '%'
          OR rc.customer_name ILIKE '%' || $7 || '%'
          OR rc.lane_origin ILIKE '%' || $7 || '%'
          OR rc.lane_destination ILIKE '%' || $7 || '%'
          OR c.name ILIKE '%' || $7 || '%'
        )
      ORDER BY rc.effective_from DESC NULLS LAST, rc.updated_at DESC
      LIMIT $8`,
    args.tenantId,
    args.carrierId ?? null,
    args.customerId ?? null,
    args.status ?? null,
    args.laneOrigin || null,
    args.laneDestination || null,
    args.search || null,
    limit,
  );
  return rows.map(mapRateContract);
}

export async function upsertRateContract(input: LogisticsRateContractInput) {
  await ensureLogisticsDomainTables();
  if (!input.laneOrigin?.trim() || !input.laneDestination?.trim()) {
    throw new Error('Lane origin and destination are required');
  }
  const contractNo = input.contractNo?.trim() || nextRateContractNo();
  const rows = await prisma.$queryRawUnsafe<LogisticsRateContractRow[]>(
    `INSERT INTO logistics_rate_contracts (
       tenant_id, customer_id, customer_name, carrier_id, contract_no,
       lane_origin, lane_destination, vehicle_type, service_level, currency,
       base_rate, min_charge, fuel_surcharge_pct, accessorial_rules,
       effective_from, effective_to, status, metadata
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,
       $15::date,$16::date,$17,$18::jsonb
     )
     ON CONFLICT (tenant_id, contract_no) WHERE deleted_at IS NULL
     DO UPDATE SET
       updated_at = NOW(),
       customer_id = EXCLUDED.customer_id,
       customer_name = EXCLUDED.customer_name,
       carrier_id = EXCLUDED.carrier_id,
       lane_origin = EXCLUDED.lane_origin,
       lane_destination = EXCLUDED.lane_destination,
       vehicle_type = EXCLUDED.vehicle_type,
       service_level = EXCLUDED.service_level,
       currency = EXCLUDED.currency,
       base_rate = EXCLUDED.base_rate,
       min_charge = EXCLUDED.min_charge,
       fuel_surcharge_pct = EXCLUDED.fuel_surcharge_pct,
       accessorial_rules = EXCLUDED.accessorial_rules,
       effective_from = EXCLUDED.effective_from,
       effective_to = EXCLUDED.effective_to,
       status = EXCLUDED.status,
       metadata = EXCLUDED.metadata
     RETURNING *`,
    input.tenantId,
    input.customerId ?? null,
    input.customerName ?? null,
    input.carrierId ?? null,
    contractNo,
    input.laneOrigin.trim(),
    input.laneDestination.trim(),
    input.vehicleType ?? null,
    input.serviceLevel ?? null,
    input.currency ?? 'AED',
    input.baseRate,
    input.minCharge ?? null,
    input.fuelSurchargePct ?? null,
    jsonParam(input.accessorialRules ?? {}),
    dateOnly(input.effectiveFrom),
    dateOnly(input.effectiveTo),
    input.status ?? 'ACTIVE',
    jsonParam(input.metadata ?? {}),
  );
  return mapRateContract(rows[0]);
}

export async function matchLaneRateContracts(args: {
  tenantId: string;
  origin: string;
  destination: string;
  vehicleType?: string | null;
  customerId?: string | null;
  carrierId?: string | null;
  serviceLevel?: string | null;
  limit?: number;
}) {
  const contracts = await listRateContracts({
    tenantId: args.tenantId,
    customerId: args.customerId ?? null,
    carrierId: args.carrierId ?? null,
    status: 'ACTIVE',
    laneOrigin: args.origin,
    laneDestination: args.destination,
    limit: args.limit ?? 20,
  });
  const vehicleType = args.vehicleType?.toUpperCase();
  const serviceLevel = args.serviceLevel?.toUpperCase();
  return contracts
    .filter(contract => !vehicleType || !contract.vehicleType || contract.vehicleType.toUpperCase() === vehicleType)
    .filter(contract => !serviceLevel || !contract.serviceLevel || contract.serviceLevel.toUpperCase() === serviceLevel);
}

export async function listCarrierScorecards(args: {
  tenantId: string;
  carrierId?: string | null;
  status?: string | null;
  preferred?: boolean | null;
  blacklisted?: boolean | null;
  search?: string | null;
  limit?: number;
}) {
  await ensureLogisticsDomainTables();
  const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
  const rows = await prisma.$queryRawUnsafe<Array<LogisticsCarrierScorecardRow & { carrier_name?: string | null }>>(
    `SELECT sc.*, c.name AS carrier_name
       FROM logistics_carrier_scorecards sc
       LEFT JOIN logistics_carriers c
         ON c.id = sc.carrier_id
        AND c.tenant_id = sc.tenant_id
      WHERE sc.tenant_id = $1
        AND ($2::text IS NULL OR sc.carrier_id = $2)
        AND ($3::text IS NULL OR sc.status = $3)
        AND ($4::boolean IS NULL OR sc.preferred = $4)
        AND ($5::boolean IS NULL OR sc.blacklisted = $5)
        AND (
          $6::text IS NULL
          OR c.name ILIKE '%' || $6 || '%'
          OR sc.blacklist_reason ILIKE '%' || $6 || '%'
        )
      ORDER BY sc.period_end DESC NULLS LAST, sc.updated_at DESC
      LIMIT $7`,
    args.tenantId,
    args.carrierId ?? null,
    args.status ?? null,
    args.preferred ?? null,
    args.blacklisted ?? null,
    args.search || null,
    limit,
  );
  return rows.map(mapCarrierScorecard);
}

export async function upsertCarrierScorecard(input: LogisticsCarrierScorecardInput) {
  await ensureLogisticsDomainTables();
  const existing = await prisma.$queryRawUnsafe<LogisticsCarrierScorecardRow[]>(
    `SELECT *
       FROM logistics_carrier_scorecards
      WHERE tenant_id = $1
        AND carrier_id = $2
        AND COALESCE(period_start, DATE '1970-01-01') = COALESCE($3::date, DATE '1970-01-01')
        AND COALESCE(period_end, DATE '2999-12-31') = COALESCE($4::date, DATE '2999-12-31')
      ORDER BY updated_at DESC
      LIMIT 1`,
    input.tenantId,
    input.carrierId,
    dateOnly(input.periodStart),
    dateOnly(input.periodEnd),
  );

  const params = [
    input.tenantId,
    input.carrierId,
    dateOnly(input.periodStart),
    dateOnly(input.periodEnd),
    input.onTimeRate ?? null,
    input.acceptanceRate ?? null,
    input.cancellationRate ?? null,
    input.claimRate ?? null,
    input.complianceScore ?? null,
    input.averageRating ?? null,
    input.shipmentsCompleted ?? 0,
    input.preferred ?? false,
    input.blacklisted ?? false,
    input.blacklistReason ?? null,
    input.status ?? 'ACTIVE',
    jsonParam(input.metadata ?? {}),
  ] as const;

  const rows = existing[0]
    ? await prisma.$queryRawUnsafe<LogisticsCarrierScorecardRow[]>(
      `UPDATE logistics_carrier_scorecards
          SET updated_at = NOW(),
              on_time_rate = $5,
              acceptance_rate = $6,
              cancellation_rate = $7,
              claim_rate = $8,
              compliance_score = $9,
              average_rating = $10,
              shipments_completed = $11,
              preferred = $12,
              blacklisted = $13,
              blacklist_reason = $14,
              status = $15,
              metadata = $16::jsonb
        WHERE id = $17
          AND tenant_id = $1
        RETURNING *`,
      ...params,
      existing[0].id,
    )
    : await prisma.$queryRawUnsafe<LogisticsCarrierScorecardRow[]>(
      `INSERT INTO logistics_carrier_scorecards (
         tenant_id, carrier_id, period_start, period_end, on_time_rate,
         acceptance_rate, cancellation_rate, claim_rate, compliance_score,
         average_rating, shipments_completed, preferred, blacklisted,
         blacklist_reason, status, metadata
       ) VALUES (
         $1,$2,$3::date,$4::date,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb
       )
       RETURNING *`,
      ...params,
    );

  const scorecard = rows[0];
  await prisma.$executeRawUnsafe(
    `UPDATE logistics_carriers
        SET updated_at = NOW(),
            metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb
      WHERE tenant_id = $2
        AND id = $3`,
    jsonParam({
      preferredCarrier: Boolean(scorecard.preferred),
      blacklistedCarrier: Boolean(scorecard.blacklisted),
      blacklistReason: scorecard.blacklist_reason ?? null,
      latestScorecardId: scorecard.id,
    }),
    input.tenantId,
    input.carrierId,
  );

  return mapCarrierScorecard(scorecard);
}

export async function setCarrierPreference(args: {
  tenantId: string;
  carrierId: string;
  preferred?: boolean | null;
  blacklisted?: boolean | null;
  blacklistReason?: string | null;
}) {
  const latest = (await listCarrierScorecards({ tenantId: args.tenantId, carrierId: args.carrierId, limit: 1 }))[0];
  return upsertCarrierScorecard({
    tenantId: args.tenantId,
    carrierId: args.carrierId,
    periodStart: latest?.periodStart ?? null,
    periodEnd: latest?.periodEnd ?? null,
    onTimeRate: latest?.onTimeRate ?? null,
    acceptanceRate: latest?.acceptanceRate ?? null,
    cancellationRate: latest?.cancellationRate ?? null,
    claimRate: latest?.claimRate ?? null,
    complianceScore: latest?.complianceScore ?? null,
    averageRating: latest?.averageRating ?? null,
    shipmentsCompleted: latest?.shipmentsCompleted ?? 0,
    preferred: args.preferred ?? latest?.preferred ?? false,
    blacklisted: args.blacklisted ?? latest?.blacklisted ?? false,
    blacklistReason: args.blacklistReason ?? latest?.blacklistReason ?? null,
    metadata: {
      ...(latest?.metadata ?? {}),
      preferenceUpdatedAt: new Date().toISOString(),
    },
  });
}

export async function recordTelematicsEvent(input: LogisticsTelematicsEventInput) {
  await ensureLogisticsDomainTables();
  const { shipment } = await assertGovernedShipmentWrite({
    tenantId: input.tenantId,
    shipmentOrderId: input.shipmentOrderId,
    action: 'Telematics event',
  });
  const eventTime = asDate(input.eventTime) ?? new Date();
  const etaAt = asDate(input.etaAt);
  const issues: string[] = [];
  if (shipment.pickup_window_from && eventTime.getTime() < shipment.pickup_window_from.getTime()) {
    issues.push('Telematics event time cannot be earlier than shipment ready time.');
  }
  if (etaAt && etaAt.getTime() < eventTime.getTime()) {
    issues.push('Telematics ETA cannot be earlier than the event time.');
  }
  if (input.latitude != null && (input.latitude < -90 || input.latitude > 90)) {
    issues.push('Telematics latitude must be between -90 and 90.');
  }
  if (input.longitude != null && (input.longitude < -180 || input.longitude > 180)) {
    issues.push('Telematics longitude must be between -180 and 180.');
  }
  if (issues.length > 0) throw new LogisticsValidationError(issues);
  const rows = await prisma.$queryRawUnsafe<LogisticsTelematicsEventRow[]>(
    `INSERT INTO logistics_telematics_events (
       tenant_id, shipment_order_id, assignment_id, vehicle_id, provider, device_id,
       latitude, longitude, speed_kph, heading, odometer_km, event_time,
       eta_at, eta_confidence, raw_payload
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::timestamptz,$13::timestamptz,$14,$15::jsonb
     )
     RETURNING *`,
    input.tenantId,
    input.shipmentOrderId,
    input.assignmentId ?? null,
    input.vehicleId ?? shipment.assigned_vehicle_id ?? null,
    input.provider ?? null,
    input.deviceId ?? null,
    input.latitude ?? null,
    input.longitude ?? null,
    input.speedKph ?? null,
    input.heading ?? null,
    input.odometerKm ?? null,
    iso(input.eventTime) ?? new Date().toISOString(),
    iso(input.etaAt),
    input.etaConfidence ?? null,
    jsonParam(input.rawPayload ?? {}),
  );
  const event = rows[0];
  await addTrackingEvent({
    tenantId: input.tenantId,
    shipmentOrderId: input.shipmentOrderId,
    assignmentId: input.assignmentId ?? null,
    eventType: 'TELEMATICS_POSITION',
    status: shipment.status,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    source: input.provider ?? 'TELEMATICS',
    occurredAt: input.eventTime ?? new Date(),
    notes: input.etaAt ? `ETA updated to ${iso(input.etaAt)}` : 'Telematics position received',
    metadata: {
      telematicsEventId: event.id,
      vehicleId: input.vehicleId ?? shipment.assigned_vehicle_id ?? null,
      speedKph: input.speedKph ?? null,
      heading: input.heading ?? null,
      etaAt: iso(input.etaAt),
      etaConfidence: input.etaConfidence ?? null,
    },
  });
  return mapTelematicsEvent(event);
}

export async function listTelematicsEvents(args: {
  tenantId: string;
  shipmentOrderId?: string | null;
  vehicleId?: string | null;
  limit?: number;
}) {
  await ensureLogisticsDomainTables();
  const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
  const rows = await prisma.$queryRawUnsafe<LogisticsTelematicsEventRow[]>(
    `SELECT *
       FROM logistics_telematics_events
      WHERE tenant_id = $1
        AND ($2::text IS NULL OR shipment_order_id = $2)
        AND ($3::text IS NULL OR vehicle_id = $3)
      ORDER BY event_time DESC, created_at DESC
      LIMIT $4`,
    args.tenantId,
    args.shipmentOrderId ?? null,
    args.vehicleId ?? null,
    limit,
  );
  return rows.map(mapTelematicsEvent);
}

export async function listAccessorialCatalog(args: {
  tenantId: string;
  status?: string | null;
  search?: string | null;
  limit?: number;
}) {
  await ensureLogisticsDomainTables();
  const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
  const rows = await prisma.$queryRawUnsafe<LogisticsAccessorialCatalogRow[]>(
    `SELECT *
       FROM logistics_accessorial_catalog
      WHERE tenant_id = $1
        AND deleted_at IS NULL
        AND ($2::text IS NULL OR status = $2)
        AND (
          $3::text IS NULL
          OR code ILIKE '%' || $3 || '%'
          OR name ILIKE '%' || $3 || '%'
          OR charge_type ILIKE '%' || $3 || '%'
        )
      ORDER BY name ASC
      LIMIT $4`,
    args.tenantId,
    args.status ?? null,
    args.search || null,
    limit,
  );
  return rows.map(mapAccessorialCatalog);
}

export async function upsertAccessorialCatalog(input: LogisticsAccessorialCatalogInput) {
  await ensureLogisticsDomainTables();
  if (!input.code?.trim() || !input.name?.trim()) {
    throw new Error('Accessorial code and name are required');
  }
  const rows = await prisma.$queryRawUnsafe<LogisticsAccessorialCatalogRow[]>(
    `INSERT INTO logistics_accessorial_catalog (
       tenant_id, code, name, charge_type, default_amount, currency,
       taxable, auto_apply_rule, status, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb)
     ON CONFLICT (tenant_id, code) WHERE deleted_at IS NULL
     DO UPDATE SET
       updated_at = NOW(),
       name = EXCLUDED.name,
       charge_type = EXCLUDED.charge_type,
       default_amount = EXCLUDED.default_amount,
       currency = EXCLUDED.currency,
       taxable = EXCLUDED.taxable,
       auto_apply_rule = EXCLUDED.auto_apply_rule,
       status = EXCLUDED.status,
       metadata = EXCLUDED.metadata
     RETURNING *`,
    input.tenantId,
    input.code.trim().toUpperCase(),
    input.name.trim(),
    input.chargeType ?? 'ACCESSORIAL',
    input.defaultAmount ?? null,
    input.currency ?? 'AED',
    input.taxable ?? true,
    jsonParam(input.autoApplyRule ?? {}),
    input.status ?? 'ACTIVE',
    jsonParam(input.metadata ?? {}),
  );
  return mapAccessorialCatalog(rows[0]);
}

export async function addShipmentAccessorialCharge(input: LogisticsShipmentAccessorialInput) {
  await ensureLogisticsDomainTables();
  const { shipment } = await assertGovernedShipmentWrite({
    tenantId: input.tenantId,
    shipmentOrderId: input.shipmentOrderId,
    action: 'Accessorial charge',
  });

  const catalogRows = input.catalogId || input.code
    ? await prisma.$queryRawUnsafe<LogisticsAccessorialCatalogRow[]>(
      `SELECT *
         FROM logistics_accessorial_catalog
        WHERE tenant_id = $1
          AND deleted_at IS NULL
          AND ($2::text IS NULL OR id = $2)
          AND ($3::text IS NULL OR code = UPPER($3))
        ORDER BY updated_at DESC
        LIMIT 1`,
      input.tenantId,
      input.catalogId ?? null,
      input.code ?? null,
    )
    : [];
  const catalog = catalogRows[0] ?? null;
  const quantity = input.quantity ?? 1;
  const unitRate = input.unitRate ?? input.amount ?? numberOrNull(catalog?.default_amount) ?? 0;
  const amount = input.amount ?? Number((quantity * unitRate).toFixed(2));
  const taxAmount = input.taxAmount ?? 0;
  const totalAmount = Number((amount + taxAmount).toFixed(2));
  const chargeSide = input.chargeSide ?? 'CUSTOMER';
  const chargeType = input.code?.trim().toUpperCase() ?? catalog?.code ?? 'ACCESSORIAL';
  const description = input.name ?? catalog?.name ?? chargeType;

  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    charge_side: string;
    charge_type: string;
    description: string | null;
    quantity: string | number;
    unit_rate: string | number;
    amount: string | number;
    tax_amount: string | number;
    total_amount: string | number;
    currency: string;
    billing_status: string;
    created_at: Date;
  }>>(
    `INSERT INTO logistics_freight_charges (
       tenant_id, shipment_order_id, charge_side, charge_type, description,
       quantity, unit_rate, amount, tax_amount, total_amount, currency,
       billing_status, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'READY',$12::jsonb)
     RETURNING id, charge_side, charge_type, description, quantity, unit_rate,
               amount, tax_amount, total_amount, currency, billing_status, created_at`,
    input.tenantId,
    input.shipmentOrderId,
    chargeSide,
    chargeType,
    description,
    quantity,
    unitRate,
    amount,
    taxAmount,
    totalAmount,
    input.currency ?? catalog?.currency ?? shipment.currency ?? 'AED',
    jsonParam({
      source: 'logistics-accessorial',
      catalogId: catalog?.id ?? null,
      actorUserId: input.actorUserId ?? null,
      ...(input.metadata ?? {}),
    }),
  );

  await addTrackingEvent({
    tenantId: input.tenantId,
    shipmentOrderId: input.shipmentOrderId,
    eventType: 'ACCESSORIAL_CHARGE_ADDED',
    status: shipment.status,
    source: 'LOGISTICS_FINANCE',
    notes: `${description} accessorial added`,
    metadata: {
      chargeId: rows[0]?.id,
      chargeSide,
      chargeType,
      amount,
      taxAmount,
      totalAmount,
    },
  });

  return rows[0]
    ? {
      id: rows[0].id,
      chargeSide: rows[0].charge_side,
      chargeType: rows[0].charge_type,
      description: rows[0].description,
      quantity: numberOrNull(rows[0].quantity) ?? 0,
      unitRate: numberOrNull(rows[0].unit_rate) ?? 0,
      amount: numberOrNull(rows[0].amount) ?? 0,
      taxAmount: numberOrNull(rows[0].tax_amount) ?? 0,
      totalAmount: numberOrNull(rows[0].total_amount) ?? 0,
      currency: rows[0].currency,
      billingStatus: rows[0].billing_status,
      createdAt: iso(rows[0].created_at),
    }
    : null;
}

const DEFAULT_LOGISTICS_MASTER_DATA: Array<Omit<LogisticsMasterDataInput, 'tenantId' | 'actorUserId'>> = [
  { type: 'SERVICE_TYPE', code: 'FTL', label: 'Full Truck Load', description: 'Dedicated truck movement', sortOrder: 10 },
  { type: 'SERVICE_TYPE', code: 'LTL', label: 'Less Than Truck Load', description: 'Shared capacity movement', sortOrder: 20 },
  { type: 'SERVICE_TYPE', code: 'EXPRESS', label: 'Express Delivery', description: 'Priority time-bound movement', sortOrder: 30 },
  { type: 'SERVICE_TYPE', code: 'REEFER', label: 'Temperature Controlled', description: 'Cold-chain or temperature-sensitive cargo', sortOrder: 40 },
  { type: 'VEHICLE_TYPE', code: 'SMALL_VAN', label: 'Small Van (< 1 ton)', sortOrder: 10 },
  { type: 'VEHICLE_TYPE', code: 'MEDIUM_VAN', label: 'Medium Van (1-3 ton)', sortOrder: 20 },
  { type: 'VEHICLE_TYPE', code: 'LIGHT_TRUCK', label: 'Light Truck (3-7 ton)', sortOrder: 30 },
  { type: 'VEHICLE_TYPE', code: 'HEAVY_TRUCK', label: 'Heavy Truck (7-20 ton)', sortOrder: 40 },
  { type: 'VEHICLE_TYPE', code: 'FLATBED_LOW_BED', label: 'Flatbed / Low-bed', sortOrder: 50 },
  { type: 'VEHICLE_TYPE', code: 'TANKER', label: 'Tanker', sortOrder: 60 },
  { type: 'VEHICLE_TYPE', code: 'REEFER_TRUCK', label: 'Reefer Truck', sortOrder: 70 },
  { type: 'VEHICLE_TYPE', code: 'ANY_AVAILABLE', label: 'Any Available', sortOrder: 80 },
  { type: 'COUNTRY', code: 'AE', label: 'United Arab Emirates', sortOrder: 10 },
  { type: 'COUNTRY', code: 'SA', label: 'Saudi Arabia', sortOrder: 20 },
  { type: 'COUNTRY', code: 'OM', label: 'Oman', sortOrder: 30 },
  { type: 'AIRPORT', code: 'DXB', label: 'Dubai International Airport', sortOrder: 10 },
  { type: 'AIRPORT', code: 'DWC', label: 'Al Maktoum International Airport', sortOrder: 20 },
  { type: 'AIRPORT', code: 'AUH', label: 'Zayed International Airport', sortOrder: 30 },
  { type: 'AIRLINE', code: 'EK', label: 'Emirates SkyCargo', sortOrder: 10 },
  { type: 'AIRLINE', code: 'EY', label: 'Etihad Cargo', sortOrder: 20 },
  { type: 'AGENT', code: 'DEFAULT_AGENT', label: 'Default Logistics Agent', sortOrder: 10 },
  { type: 'SHIPPER', code: 'DEFAULT_SHIPPER', label: 'Default Shipper', sortOrder: 10 },
  { type: 'PICKUP_LOCATION', code: 'DXB_WH', label: 'Dubai Warehouse', description: 'Default Dubai pickup warehouse', sortOrder: 10 },
];

function normalizeMasterCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
}

export async function seedDefaultLogisticsMasterData(tenantId: string, actorUserId?: string | null) {
  await ensureLogisticsDomainTables();
  for (const item of DEFAULT_LOGISTICS_MASTER_DATA) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO logistics_master_data
         (tenant_id, type, code, label, description, status, sort_order, metadata, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$9)
       ON CONFLICT (tenant_id, type, code) WHERE deleted_at IS NULL DO NOTHING`,
      tenantId,
      item.type,
      item.code,
      item.label,
      item.description ?? null,
      item.status ?? 'ACTIVE',
      item.sortOrder ?? 0,
      jsonParam(item.metadata ?? { seeded: true }),
      actorUserId ?? 'logistics-master-seed',
    );
  }
}

export async function listLogisticsMasterData(args: {
  tenantId: string;
  type?: string | null;
  status?: string | null;
  search?: string | null;
  includeSeed?: boolean;
}) {
  await ensureLogisticsDomainTables();
  if (args.includeSeed !== false) {
    await seedDefaultLogisticsMasterData(args.tenantId);
  }
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    type: string;
    code: string;
    label: string;
    description: string | null;
    status: string;
    sort_order: number;
    metadata: JsonRecord | null;
    created_at: Date;
    updated_at: Date;
  }>>(
    `SELECT id, type, code, label, description, status, sort_order, metadata, created_at, updated_at
       FROM logistics_master_data
      WHERE tenant_id = $1
        AND deleted_at IS NULL
        AND ($2::text IS NULL OR type = $2)
        AND ($3::text IS NULL OR status = $3)
        AND (
          $4::text IS NULL
          OR code ILIKE '%' || $4 || '%'
          OR label ILIKE '%' || $4 || '%'
          OR description ILIKE '%' || $4 || '%'
        )
      ORDER BY type ASC, sort_order ASC, label ASC`,
    args.tenantId,
    args.type ? args.type.toUpperCase() : null,
    args.status || null,
    args.search || null,
  );
  return rows.map(row => ({
    id: row.id,
    type: row.type,
    code: row.code,
    label: row.label,
    description: row.description,
    status: row.status,
    sortOrder: row.sort_order,
    metadata: row.metadata ?? {},
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }));
}

export async function upsertLogisticsMasterData(input: LogisticsMasterDataInput) {
  await ensureLogisticsDomainTables();
  const type = input.type.trim().toUpperCase();
  const code = normalizeMasterCode(input.code);
  if (!type) throw new LogisticsValidationError(['Master data type is required.']);
  if (!code) throw new LogisticsValidationError(['Master data code is required.']);
  if (!input.label.trim()) throw new LogisticsValidationError(['Master data label is required.']);
  const existing = await prisma.$queryRawUnsafe<Array<{ id: string; label: string; status: string; metadata: JsonRecord | null }>>(
    `SELECT id, label, status, metadata
       FROM logistics_master_data
      WHERE tenant_id = $1 AND type = $2 AND code = $3 AND deleted_at IS NULL
      LIMIT 1`,
    input.tenantId,
    type,
    code,
  );
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    type: string;
    code: string;
    label: string;
    description: string | null;
    status: string;
    sort_order: number;
    metadata: JsonRecord | null;
    created_at: Date;
    updated_at: Date;
  }>>(
    `INSERT INTO logistics_master_data
       (tenant_id, type, code, label, description, status, sort_order, metadata, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$9)
     ON CONFLICT (tenant_id, type, code) WHERE deleted_at IS NULL
     DO UPDATE SET
       updated_at = NOW(),
       label = EXCLUDED.label,
       description = EXCLUDED.description,
       status = EXCLUDED.status,
       sort_order = EXCLUDED.sort_order,
       metadata = EXCLUDED.metadata,
       updated_by = EXCLUDED.updated_by
     RETURNING id, type, code, label, description, status, sort_order, metadata, created_at, updated_at`,
    input.tenantId,
    type,
    code,
    input.label.trim(),
    input.description ?? null,
    input.status ?? 'ACTIVE',
    input.sortOrder ?? 0,
    jsonParam(input.metadata ?? {}),
    input.actorUserId ?? null,
  );
  const row = rows[0];
  await logLogisticsAudit({
    tenantId: input.tenantId,
    entityType: 'LogisticsMasterData',
    entityId: row?.id ?? null,
    entityName: `${type}/${code}`,
    action: existing[0] ? 'UPDATE' : 'CREATE',
    actorUserId: input.actorUserId ?? null,
    summary: `${existing[0] ? 'Updated' : 'Created'} logistics master data ${type}/${code}`,
    before: existing[0] ?? null,
    after: row ?? null,
  });
  return row ? {
    id: row.id,
    type: row.type,
    code: row.code,
    label: row.label,
    description: row.description,
    status: row.status,
    sortOrder: row.sort_order,
    metadata: row.metadata ?? {},
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  } : null;
}

export async function deleteLogisticsMasterData(args: {
  tenantId: string;
  id: string;
  actorUserId?: string | null;
}) {
  await ensureLogisticsDomainTables();
  const before = await prisma.$queryRawUnsafe<Array<{ id: string; type: string; code: string; label: string; status: string }>>(
    `SELECT id, type, code, label, status
       FROM logistics_master_data
      WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
      LIMIT 1`,
    args.tenantId,
    args.id,
  );
  await prisma.$executeRawUnsafe(
    `UPDATE logistics_master_data
        SET deleted_at = NOW(),
            status = 'INACTIVE',
            updated_at = NOW(),
            updated_by = $3
      WHERE tenant_id = $1
        AND id = $2
        AND deleted_at IS NULL`,
    args.tenantId,
    args.id,
    args.actorUserId ?? null,
  );
  await logLogisticsAudit({
    tenantId: args.tenantId,
    entityType: 'LogisticsMasterData',
    entityId: args.id,
    entityName: before[0] ? `${before[0].type}/${before[0].code}` : args.id,
    action: 'DELETE',
    actorUserId: args.actorUserId ?? null,
    summary: `Removed logistics master data ${before[0]?.label ?? args.id}`,
    before: before[0] ?? null,
  });
}

export async function listLogisticsChangeHistory(args: {
  tenantId: string;
  entityType?: string | null;
  entityId?: string | null;
  limit?: number;
}) {
  await ensureLogisticsDomainTables();
  const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    entity_type: string;
    entity_id: string | null;
    action: string;
    actor_user_id: string | null;
    before_json: JsonRecord | null;
    after_json: JsonRecord | null;
    summary: string | null;
    metadata: JsonRecord | null;
    created_at: Date;
  }>>(
    `SELECT id, entity_type, entity_id, action, actor_user_id,
            before_json, after_json, summary, metadata, created_at
       FROM logistics_change_history
      WHERE tenant_id = $1
        AND ($2::text IS NULL OR entity_type = $2)
        AND ($3::text IS NULL OR entity_id = $3)
      ORDER BY created_at DESC
      LIMIT $4`,
    args.tenantId,
    args.entityType ?? null,
    args.entityId ?? null,
    limit,
  );
  return rows.map(row => ({
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    actorUserId: row.actor_user_id,
    before: row.before_json ?? null,
    after: row.after_json ?? null,
    summary: row.summary,
    metadata: row.metadata ?? {},
    createdAt: iso(row.created_at),
  }));
}

export async function getLogisticsShiftHandoverSummary(args: {
  tenantId: string;
  limit?: number;
}) {
  const controlTower = await getShipmentControlTower({ tenantId: args.tenantId, limit: args.limit ?? 200 });
  const open = controlTower.shipments.filter(row => !TERMINAL_SHIPMENT_STATUSES.has(row.status.toUpperCase()));
  const pendingActions = [
    ...open
      .filter(row => !row.carrierId)
      .map(row => ({ shipmentNo: row.shipmentNo, action: 'Assign carrier/vehicle', priority: row.priority, status: row.status })),
    ...open
      .filter(row => row.slaStatus === 'BREACHED')
      .map(row => ({ shipmentNo: row.shipmentNo, action: 'Escalate breached SLA', priority: 'HIGH', status: row.status })),
    ...open
      .filter(row => row.slaStatus === 'AT_RISK')
      .map(row => ({ shipmentNo: row.shipmentNo, action: 'Monitor SLA risk', priority: row.priority, status: row.status })),
  ];

  return {
    generatedAt: new Date().toISOString(),
    summary: controlTower.summary,
    openShipments: open.slice(0, 50),
    pendingActions: pendingActions.slice(0, 50),
    delayedMovements: controlTower.shipments.filter(row => row.slaStatus === 'BREACHED').slice(0, 50),
    exceptionRisks: controlTower.shipments.filter(row => row.openExceptions > 0).slice(0, 50),
    slaRisks: controlTower.shipments.filter(row => row.slaStatus !== 'ON_TRACK').slice(0, 50),
  };
}

export async function listLogisticsShiftHandovers(args: {
  tenantId: string;
  limit?: number;
}) {
  await ensureLogisticsDomainTables();
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    shift_date: Date;
    shift_code: string;
    status: string;
    outgoing_user_id: string | null;
    incoming_user_id: string | null;
    summary_json: JsonRecord | null;
    notes: string | null;
    created_by: string | null;
    accepted_by: string | null;
    accepted_at: Date | null;
    created_at: Date;
    updated_at: Date;
  }>>(
    `SELECT id, shift_date, shift_code, status, outgoing_user_id, incoming_user_id,
            summary_json, notes, created_by, accepted_by, accepted_at, created_at, updated_at
       FROM logistics_shift_handovers
      WHERE tenant_id = $1
      ORDER BY shift_date DESC, created_at DESC
      LIMIT $2`,
    args.tenantId,
    limit,
  );
  return rows.map(row => ({
    id: row.id,
    shiftDate: dateOnly(row.shift_date),
    shiftCode: row.shift_code,
    status: row.status,
    outgoingUserId: row.outgoing_user_id,
    incomingUserId: row.incoming_user_id,
    summary: row.summary_json ?? {},
    notes: row.notes,
    createdBy: row.created_by,
    acceptedBy: row.accepted_by,
    acceptedAt: iso(row.accepted_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }));
}

export async function createLogisticsShiftHandover(input: LogisticsShiftHandoverInput) {
  await ensureLogisticsDomainTables();
  const summary = await getLogisticsShiftHandoverSummary({ tenantId: input.tenantId });
  const shiftDate = dateOnly(input.shiftDate ?? new Date()) ?? new Date().toISOString().slice(0, 10);
  const rows = await prisma.$queryRawUnsafe<Array<{
    id: string;
    shift_date: Date;
    shift_code: string;
    status: string;
    outgoing_user_id: string | null;
    incoming_user_id: string | null;
    summary_json: JsonRecord | null;
    notes: string | null;
    created_by: string | null;
    accepted_by: string | null;
    accepted_at: Date | null;
    created_at: Date;
    updated_at: Date;
  }>>(
    `INSERT INTO logistics_shift_handovers
       (tenant_id, shift_date, shift_code, status, outgoing_user_id, incoming_user_id,
        summary_json, notes, created_by, metadata)
     VALUES ($1,$2::date,$3,'OPEN',$4,$5,$6::jsonb,$7,$8,$9::jsonb)
     RETURNING id, shift_date, shift_code, status, outgoing_user_id, incoming_user_id,
               summary_json, notes, created_by, accepted_by, accepted_at, created_at, updated_at`,
    input.tenantId,
    shiftDate,
    input.shiftCode.toUpperCase(),
    input.outgoingUserId ?? input.actorUserId ?? null,
    input.incomingUserId ?? null,
    jsonParam(summary),
    input.notes ?? null,
    input.actorUserId ?? null,
    jsonParam({ source: 'logistics-shift-handover-console' }),
  );
  const handover = rows[0];
  await logLogisticsAudit({
    tenantId: input.tenantId,
    entityType: 'LogisticsShiftHandover',
    entityId: handover?.id ?? null,
    entityName: `${shiftDate}/${input.shiftCode.toUpperCase()}`,
    action: 'CREATE',
    actorUserId: input.actorUserId ?? null,
    summary: `Created ${input.shiftCode.toUpperCase()} shift handover`,
    after: handover ?? null,
  });
  return handover ? {
    id: handover.id,
    shiftDate: dateOnly(handover.shift_date),
    shiftCode: handover.shift_code,
    status: handover.status,
    outgoingUserId: handover.outgoing_user_id,
    incomingUserId: handover.incoming_user_id,
    summary: handover.summary_json ?? {},
    notes: handover.notes,
    createdBy: handover.created_by,
    acceptedBy: handover.accepted_by,
    acceptedAt: iso(handover.accepted_at),
    createdAt: iso(handover.created_at),
    updatedAt: iso(handover.updated_at),
  } : null;
}

export async function acceptLogisticsShiftHandover(args: {
  tenantId: string;
  id: string;
  actorUserId?: string | null;
}) {
  await ensureLogisticsDomainTables();
  const before = await prisma.$queryRawUnsafe<Array<{ id: string; status: string; shift_code: string; shift_date: Date }>>(
    `SELECT id, status, shift_code, shift_date
       FROM logistics_shift_handovers
      WHERE tenant_id = $1 AND id = $2
      LIMIT 1`,
    args.tenantId,
    args.id,
  );
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; status: string; accepted_by: string | null; accepted_at: Date | null }>>(
    `UPDATE logistics_shift_handovers
        SET status = 'ACCEPTED',
            accepted_by = $3,
            accepted_at = NOW(),
            updated_at = NOW()
      WHERE tenant_id = $1
        AND id = $2
      RETURNING id, status, accepted_by, accepted_at`,
    args.tenantId,
    args.id,
    args.actorUserId ?? null,
  );
  await logLogisticsAudit({
    tenantId: args.tenantId,
    entityType: 'LogisticsShiftHandover',
    entityId: args.id,
    entityName: before[0] ? `${dateOnly(before[0].shift_date)}/${before[0].shift_code}` : args.id,
    action: 'UPDATE',
    actorUserId: args.actorUserId ?? null,
    summary: 'Accepted logistics shift handover',
    before: before[0] ?? null,
    after: rows[0] ?? null,
  });
  return rows[0] ?? null;
}

export async function listLogisticsFieldOpsWorklist(args: {
  tenantId: string;
  limit?: number;
}) {
  const controlTower = await getShipmentControlTower({ tenantId: args.tenantId, limit: args.limit ?? 100 });
  return {
    generatedAt: controlTower.generatedAt,
    shipments: controlTower.shipments
      .filter(row => !TERMINAL_SHIPMENT_STATUSES.has(row.status.toUpperCase()))
      .map(row => ({
        id: row.id,
        shipmentNo: row.shipmentNo,
        customerName: row.customerName,
        status: row.status,
        originName: row.originName,
        destinationName: row.destinationName,
        carrierName: row.carrierName,
        pickupWindowTo: row.pickupWindowTo,
        deliveryWindowTo: row.deliveryWindowTo,
        latestEtaAt: row.latestEtaAt,
        slaStatus: row.slaStatus,
      })),
  };
}

export async function recordLogisticsFieldOpsEvent(input: LogisticsFieldOpsEventInput) {
  await ensureLogisticsDomainTables();
  const { shipment } = await assertGovernedShipmentWrite({
    tenantId: input.tenantId,
    shipmentOrderId: input.shipmentOrderId,
    action: 'Field operations update',
  });
  const occurredAt = asDate(input.occurredAt) ?? new Date();
  const issues: string[] = [];
  if (input.eventType === 'PICKUP_CONFIRMED' && shipment.pickup_window_from && occurredAt.getTime() < shipment.pickup_window_from.getTime()) {
    issues.push('Pickup confirmation cannot be earlier than shipment ready time.');
  }
  if (input.eventType === 'DELIVERY_CONFIRMED' && shipment.pickup_window_from && occurredAt.getTime() < shipment.pickup_window_from.getTime()) {
    issues.push('Delivery confirmation cannot be earlier than shipment ready time.');
  }
  if (input.eventType === 'ETA_UPDATED' && input.etaAt && asDate(input.etaAt) && asDate(input.etaAt)!.getTime() < occurredAt.getTime()) {
    issues.push('ETA cannot be earlier than the field update time.');
  }
  if (input.latitude != null && (input.latitude < -90 || input.latitude > 90)) {
    issues.push('Latitude must be between -90 and 90.');
  }
  if (input.longitude != null && (input.longitude < -180 || input.longitude > 180)) {
    issues.push('Longitude must be between -180 and 180.');
  }
  if (issues.length > 0) throw new LogisticsValidationError(issues);

  const statusByEvent: Record<string, string> = {
    PICKUP_CONFIRMED: 'LOADED',
    DELIVERY_CONFIRMED: 'DELIVERED',
    ETA_UPDATED: shipment.status,
    OPERATIONAL_REMARK: shipment.status,
    PHOTO_ATTACHED: shipment.status,
    EXCEPTION_REPORTED: shipment.status,
  };
  const nextStatus = statusByEvent[input.eventType] ?? shipment.status;
  if (nextStatus !== shipment.status || input.etaAt) {
    await prisma.$executeRawUnsafe(
      `UPDATE logistics_shipment_orders
          SET status = $1,
              metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
              updated_by = $3,
              updated_at = NOW()
        WHERE tenant_id = $4 AND id = $5`,
      nextStatus,
      jsonParam({
        lastFieldOpsEvent: input.eventType,
        lastFieldOpsAt: occurredAt.toISOString(),
        latestEtaAt: iso(input.etaAt),
      }),
      input.actorUserId ?? 'field-ops',
      input.tenantId,
      input.shipmentOrderId,
    );
  }

  await addTrackingEvent({
    tenantId: input.tenantId,
    shipmentOrderId: input.shipmentOrderId,
    eventType: input.eventType,
    status: nextStatus,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    source: 'FIELD_OPS',
    occurredAt,
    notes: input.remarks ?? null,
    metadata: {
      etaAt: iso(input.etaAt),
      photoUrls: input.photoUrls ?? [],
      documentUrls: input.documentUrls ?? [],
      actorUserId: input.actorUserId ?? null,
      ...(input.metadata ?? {}),
    },
  });

  if (input.eventType === 'DELIVERY_CONFIRMED') {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO logistics_pod_events
         (tenant_id, shipment_order_id, delivered_at, recipient_name,
          signature_url, photo_urls, document_urls, gps, status, created_by, metadata)
       VALUES ($1,$2,$3::timestamptz,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,'SUBMITTED',$9,$10::jsonb)
       RETURNING id`,
      input.tenantId,
      input.shipmentOrderId,
      occurredAt.toISOString(),
      input.recipientName ?? null,
      input.signatureUrl ?? null,
      jsonParam(input.photoUrls ?? []),
      jsonParam(input.documentUrls ?? []),
      jsonParam(input.latitude != null && input.longitude != null ? { lat: input.latitude, lng: input.longitude } : null),
      input.actorUserId ?? null,
      jsonParam(input.metadata ?? {}),
    );
    await logLogisticsAudit({
      tenantId: input.tenantId,
      entityType: 'LogisticsPodEvent',
      entityId: rows[0]?.id ?? null,
      entityName: shipment.shipment_no,
      action: 'CREATE',
      actorUserId: input.actorUserId ?? null,
      summary: `POD submitted for ${shipment.shipment_no}`,
      after: { recipientName: input.recipientName ?? null, deliveredAt: occurredAt.toISOString() },
    });
  }

  if (input.eventType === 'EXCEPTION_REPORTED') {
    const severity = normaliseKey(input.exceptionSeverity ?? 'MEDIUM');
    const slaHours = severity === 'CRITICAL' ? 2 : severity === 'HIGH' ? 4 : severity === 'LOW' ? 24 : 12;
    const slaDueAt = new Date(occurredAt.getTime() + slaHours * 60 * 60 * 1000);
    await prisma.$executeRawUnsafe(
      `INSERT INTO logistics_shipment_exceptions
         (tenant_id, shipment_order_id, exception_type, severity, status, title, description, raised_at, sla_due_at, metadata)
       VALUES ($1,$2,'FIELD_EXCEPTION',$3,'OPEN',$4,$5,$6::timestamptz,$7::timestamptz,$8::jsonb)`,
      input.tenantId,
      input.shipmentOrderId,
      severity,
      input.remarks?.slice(0, 120) || 'Field exception reported',
      input.remarks ?? null,
      occurredAt.toISOString(),
      slaDueAt.toISOString(),
      jsonParam({ source: 'field-ops', actorUserId: input.actorUserId ?? null, slaHours }),
    );
  }

  await logLogisticsAudit({
    tenantId: input.tenantId,
    entityType: 'LogisticsShipment',
    entityId: input.shipmentOrderId,
    entityName: shipment.shipment_no,
    action: 'UPDATE',
    actorUserId: input.actorUserId ?? null,
    summary: `${input.eventType} applied to ${shipment.shipment_no}`,
    before: { status: shipment.status },
    after: { status: nextStatus, eventType: input.eventType, occurredAt: occurredAt.toISOString() },
  });

  return listShipmentExecutionTimeline({ tenantId: input.tenantId, shipmentOrderId: input.shipmentOrderId });
}

function mapShipmentException(row: LogisticsShipmentExceptionRow) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    shipmentOrderId: row.shipment_order_id,
    assignmentId: row.assignment_id,
    exceptionType: row.exception_type,
    severity: row.severity,
    status: row.status,
    title: row.title,
    description: row.description,
    raisedAt: iso(row.raised_at),
    assignedTo: row.assigned_to,
    acknowledgedAt: iso(row.acknowledged_at),
    acknowledgedBy: row.acknowledged_by,
    escalatedAt: iso(row.escalated_at),
    escalatedBy: row.escalated_by,
    slaDueAt: iso(row.sla_due_at),
    slaBreachedAt: iso(row.sla_breached_at),
    resolvedAt: iso(row.resolved_at),
    resolutionNote: row.resolution_note,
    metadata: row.metadata ?? {},
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export async function listShipmentExceptions(args: {
  tenantId: string;
  shipmentOrderId?: string | null;
  status?: string | null;
  includeResolved?: boolean;
  limit?: number;
}) {
  await ensureLogisticsDomainTables();
  const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
  const rows = await prisma.$queryRawUnsafe<LogisticsShipmentExceptionRow[]>(
    `SELECT *
       FROM logistics_shipment_exceptions
      WHERE tenant_id = $1
        AND ($2::text IS NULL OR shipment_order_id = $2)
        AND ($3::text IS NULL OR status = $3)
        AND ($4::boolean = TRUE OR status <> 'RESOLVED')
      ORDER BY
        CASE status
          WHEN 'SLA_BREACHED' THEN 1
          WHEN 'ESCALATED' THEN 2
          WHEN 'OPEN' THEN 3
          WHEN 'ASSIGNED' THEN 4
          WHEN 'ACKNOWLEDGED' THEN 5
          ELSE 6
        END,
        COALESCE(sla_due_at, raised_at) ASC,
        raised_at DESC
      LIMIT $5`,
    args.tenantId,
    args.shipmentOrderId ?? null,
    args.status ?? null,
    Boolean(args.includeResolved),
    limit,
  );
  return rows.map(mapShipmentException);
}

export async function updateShipmentExceptionLifecycle(args: {
  tenantId: string;
  exceptionId: string;
  action: LogisticsExceptionLifecycleAction | string;
  assignedTo?: string | null;
  note?: string | null;
  actorUserId?: string | null;
}) {
  await ensureLogisticsDomainTables();
  const beforeRows = await prisma.$queryRawUnsafe<LogisticsShipmentExceptionRow[]>(
    `SELECT *
       FROM logistics_shipment_exceptions
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1`,
    args.tenantId,
    args.exceptionId,
  );
  const before = beforeRows[0];
  if (!before) throw new LogisticsValidationError(['Shipment exception was not found for this tenant.']);

  const action = normaliseKey(args.action) as LogisticsExceptionLifecycleAction;
  const now = new Date().toISOString();
  const next = {
    status: before.status,
    assignedTo: before.assigned_to,
    acknowledgedAt: iso(before.acknowledged_at),
    acknowledgedBy: before.acknowledged_by,
    escalatedAt: iso(before.escalated_at),
    escalatedBy: before.escalated_by,
    slaBreachedAt: iso(before.sla_breached_at),
    resolvedAt: iso(before.resolved_at),
    resolutionNote: before.resolution_note,
  };
  const currentStatus = normaliseKey(before.status);
  const allowedActionsByStatus: Record<string, LogisticsExceptionLifecycleAction[]> = {
    OPEN: ['ASSIGN', 'ACKNOWLEDGE', 'ESCALATE', 'MARK_SLA_BREACHED'],
    ASSIGNED: ['ACKNOWLEDGE', 'ESCALATE', 'MARK_SLA_BREACHED'],
    ACKNOWLEDGED: ['ESCALATE', 'RESOLVE', 'MARK_SLA_BREACHED'],
    ESCALATED: ['ACKNOWLEDGE', 'RESOLVE', 'MARK_SLA_BREACHED'],
    SLA_BREACHED: ['ASSIGN', 'ACKNOWLEDGE', 'ESCALATE', 'RESOLVE'],
    RESOLVED: ['REOPEN'],
  };
  const supportedActions: LogisticsExceptionLifecycleAction[] = [
    'ASSIGN',
    'ACKNOWLEDGE',
    'RESOLVE',
    'ESCALATE',
    'MARK_SLA_BREACHED',
    'REOPEN',
  ];
  if (!supportedActions.includes(action)) {
    throw new LogisticsValidationError([`Unsupported exception lifecycle action: ${args.action}.`]);
  }
  const allowedActions = allowedActionsByStatus[currentStatus] ?? allowedActionsByStatus.OPEN;
  if (!allowedActions.includes(action)) {
    throw new LogisticsValidationError([
      `Exception action ${action.replace(/_/g, ' ')} is not allowed while the exception is ${friendlyStatus(before.status)}.`,
    ]);
  }

  switch (action) {
    case 'ASSIGN':
      next.status = 'ASSIGNED';
      next.assignedTo = args.assignedTo || args.actorUserId || before.assigned_to;
      if (!next.assignedTo) throw new LogisticsValidationError(['Assignee is required to assign an exception.']);
      break;
    case 'ACKNOWLEDGE':
      next.status = 'ACKNOWLEDGED';
      next.acknowledgedAt = now;
      next.acknowledgedBy = args.actorUserId ?? before.acknowledged_by;
      break;
    case 'RESOLVE':
      next.status = 'RESOLVED';
      next.resolvedAt = now;
      next.resolutionNote = args.note || before.resolution_note || 'Resolved from Control Tower';
      if (!String(next.resolutionNote ?? '').trim()) {
        throw new LogisticsValidationError(['Resolution note is required to resolve an exception.']);
      }
      break;
    case 'ESCALATE':
      next.status = 'ESCALATED';
      next.escalatedAt = now;
      next.escalatedBy = args.actorUserId ?? before.escalated_by;
      break;
    case 'MARK_SLA_BREACHED':
      next.status = 'SLA_BREACHED';
      next.slaBreachedAt = now;
      break;
    case 'REOPEN':
      next.status = 'OPEN';
      next.resolvedAt = null;
      next.resolutionNote = null;
      break;
  }

  const rows = await prisma.$queryRawUnsafe<LogisticsShipmentExceptionRow[]>(
    `UPDATE logistics_shipment_exceptions
        SET updated_at = NOW(),
            status = $1,
            assigned_to = $2,
            acknowledged_at = $3::timestamptz,
            acknowledged_by = $4,
            escalated_at = $5::timestamptz,
            escalated_by = $6,
            sla_breached_at = $7::timestamptz,
            resolved_at = $8::timestamptz,
            resolution_note = $9,
            metadata = COALESCE(metadata, '{}'::jsonb) || $10::jsonb
      WHERE tenant_id = $11
        AND id = $12
      RETURNING *`,
    next.status,
    next.assignedTo ?? null,
    next.acknowledgedAt,
    next.acknowledgedBy ?? null,
    next.escalatedAt,
    next.escalatedBy ?? null,
    next.slaBreachedAt,
    next.resolvedAt,
    next.resolutionNote ?? null,
    jsonParam({
      lastLifecycleAction: action,
      lastLifecycleActor: args.actorUserId ?? null,
      lastLifecycleAt: now,
      lastLifecycleNote: args.note ?? null,
    }),
    args.tenantId,
    args.exceptionId,
  );

  const updated = rows[0];
  await logLogisticsAudit({
    tenantId: args.tenantId,
    entityType: 'LogisticsShipmentException',
    entityId: args.exceptionId,
    entityName: updated?.title ?? before.title,
    action: 'UPDATE',
    actorUserId: args.actorUserId ?? null,
    summary: `${action.replace(/_/g, ' ')} applied to shipment exception ${before.title}`,
    before: mapShipmentException(before),
    after: updated ? mapShipmentException(updated) : null,
    metadata: { shipmentOrderId: before.shipment_order_id },
  });

  if (updated) {
    await addTrackingEvent({
      tenantId: args.tenantId,
      shipmentOrderId: updated.shipment_order_id,
      eventType: `EXCEPTION_${next.status}`,
      status: next.status,
      source: 'CONTROL_TOWER',
      notes: args.note ?? updated.title,
      metadata: {
        exceptionId: updated.id,
        lifecycleAction: action,
        actorUserId: args.actorUserId ?? null,
      },
    });
  }

  return updated ? mapShipmentException(updated) : null;
}

export async function getLogisticsOperationsPulse(args: {
  tenantId: string;
}) {
  await ensureLogisticsDomainTables();
  const [controlTower, latestEvents, changeCount] = await Promise.all([
    getShipmentControlTower({ tenantId: args.tenantId, limit: 100 }),
    prisma.$queryRawUnsafe<Array<{ latest_event_at: Date | null; event_count: bigint | number | string }>>(
      `SELECT MAX(occurred_at) AS latest_event_at, COUNT(*) AS event_count
         FROM logistics_tracking_events
        WHERE tenant_id = $1
          AND occurred_at > NOW() - INTERVAL '15 minutes'`,
      args.tenantId,
    ),
    prisma.$queryRawUnsafe<Array<{ count: bigint | number | string }>>(
      `SELECT COUNT(*) AS count
         FROM logistics_change_history
        WHERE tenant_id = $1
          AND created_at > NOW() - INTERVAL '15 minutes'`,
      args.tenantId,
    ),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    recommendedPollMs: 20000,
    summary: controlTower.summary,
    latestEventAt: iso(latestEvents[0]?.latest_event_at ?? null),
    recentEventCount: Number(latestEvents[0]?.event_count ?? 0),
    recentChangeCount: Number(changeCount[0]?.count ?? 0),
  };
}

export async function getShipmentControlTower(args: {
  tenantId: string;
  limit?: number;
}) {
  await ensureLogisticsDomainTables();
  const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
  const rows = await prisma.$queryRawUnsafe<Array<LogisticsShipmentRow & {
    carrier_name: string | null;
    assignment_id: string | null;
    assignment_status: string | null;
    latest_latitude: string | number | null;
    latest_longitude: string | number | null;
    latest_eta_at: Date | null;
    latest_event_at: Date | null;
    open_exception_count: bigint | number | string;
    high_exception_count: bigint | number | string;
  }>>(
    `WITH latest_telematics AS (
       SELECT DISTINCT ON (shipment_order_id)
              shipment_order_id, latitude, longitude, eta_at, event_time
         FROM logistics_telematics_events
        WHERE tenant_id = $1
        ORDER BY shipment_order_id, event_time DESC
     ),
     active_assignment AS (
       SELECT DISTINCT ON (shipment_order_id)
              shipment_order_id, id, status
         FROM logistics_assignments
        WHERE tenant_id = $1
        ORDER BY shipment_order_id, created_at DESC
     ),
     exception_counts AS (
       SELECT shipment_order_id,
              COUNT(*) FILTER (WHERE status <> 'RESOLVED') AS open_exception_count,
              COUNT(*) FILTER (WHERE status <> 'RESOLVED' AND severity IN ('HIGH','CRITICAL')) AS high_exception_count
         FROM logistics_shipment_exceptions
        WHERE tenant_id = $1
        GROUP BY shipment_order_id
     )
     SELECT so.*, c.name AS carrier_name,
            aa.id AS assignment_id,
            aa.status AS assignment_status,
            lt.latitude AS latest_latitude,
            lt.longitude AS latest_longitude,
            lt.eta_at AS latest_eta_at,
            lt.event_time AS latest_event_at,
            COALESCE(ec.open_exception_count, 0) AS open_exception_count,
            COALESCE(ec.high_exception_count, 0) AS high_exception_count
       FROM logistics_shipment_orders so
       LEFT JOIN logistics_carriers c
         ON c.id = so.assigned_carrier_id
        AND c.tenant_id = so.tenant_id
       LEFT JOIN active_assignment aa
         ON aa.shipment_order_id = so.id
       LEFT JOIN latest_telematics lt
         ON lt.shipment_order_id = so.id
       LEFT JOIN exception_counts ec
         ON ec.shipment_order_id = so.id
      WHERE so.tenant_id = $1
        AND so.deleted_at IS NULL
      ORDER BY so.updated_at DESC
      LIMIT $2`,
    args.tenantId,
    limit,
  );

  const now = Date.now();
  const shipments = rows.map(row => {
    const deliveryDue = row.delivery_window_to ? new Date(row.delivery_window_to).getTime() : null;
    const pickupDue = row.pickup_window_to ? new Date(row.pickup_window_to).getTime() : null;
    const isTerminal = TERMINAL_SHIPMENT_STATUSES.has((row.status ?? '').toUpperCase());
    const overdueDelivery = Boolean(deliveryDue && deliveryDue < now && !isTerminal);
    const pickupAtRisk = Boolean(pickupDue && pickupDue - now < 4 * 60 * 60 * 1000 && pickupDue > now && ['DRAFT', 'PENDING', 'APPROVED', 'ASSIGNED'].includes(row.status));
    const etaLate = Boolean(row.latest_eta_at && deliveryDue && new Date(row.latest_eta_at).getTime() > deliveryDue && !isTerminal);
    const openExceptions = Number(row.open_exception_count ?? 0);
    const highExceptions = Number(row.high_exception_count ?? 0);
    const slaStatus = overdueDelivery || etaLate || highExceptions > 0
      ? 'BREACHED'
      : pickupAtRisk || openExceptions > 0
        ? 'AT_RISK'
        : 'ON_TRACK';
    return {
      id: row.id,
      shipmentNo: row.shipment_no,
      customerName: row.cargo_owner_name,
      status: row.status,
      priority: row.priority,
      originName: row.origin_name,
      destinationName: row.destination_name,
      requestedVehicleType: row.requested_vehicle_type,
      carrierId: row.assigned_carrier_id,
      carrierName: row.carrier_name,
      assignmentId: row.assignment_id,
      assignmentStatus: row.assignment_status,
      pickupWindowFrom: iso(row.pickup_window_from),
      pickupWindowTo: iso(row.pickup_window_to),
      deliveryWindowFrom: iso(row.delivery_window_from),
      deliveryWindowTo: iso(row.delivery_window_to),
      latestLatitude: numberOrNull(row.latest_latitude),
      latestLongitude: numberOrNull(row.latest_longitude),
      latestEtaAt: iso(row.latest_eta_at),
      latestEventAt: iso(row.latest_event_at),
      openExceptions,
      highExceptions,
      slaStatus,
      flags: {
        overdueDelivery,
        pickupAtRisk,
        etaLate,
      },
      updatedAt: iso(row.updated_at),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalShipments: shipments.length,
      activeShipments: shipments.filter(row => !TERMINAL_SHIPMENT_STATUSES.has(row.status?.toUpperCase?.() ?? '')).length,
      breached: shipments.filter(row => row.slaStatus === 'BREACHED').length,
      atRisk: shipments.filter(row => row.slaStatus === 'AT_RISK').length,
      openExceptions: shipments.reduce((sum, row) => sum + row.openExceptions, 0),
      highExceptions: shipments.reduce((sum, row) => sum + row.highExceptions, 0),
      trackedShipments: shipments.filter(row => row.latestEventAt).length,
    },
    shipments,
  };
}

export async function getCustomerShipmentPortal(args: {
  tenantId: string;
  shipmentNo?: string | null;
  customerId?: string | null;
  trackingToken?: string | null;
  limit?: number;
}) {
  await ensureLogisticsDomainTables();
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
  const rows = await prisma.$queryRawUnsafe<Array<LogisticsShipmentRow & {
    latest_event_type: string | null;
    latest_event_status: string | null;
    latest_latitude: string | number | null;
    latest_longitude: string | number | null;
    latest_eta_at: string | null;
    latest_event_at: Date | null;
    pod_status: string | null;
    pod_delivered_at: Date | null;
  }>>(
    `WITH latest_event AS (
       SELECT DISTINCT ON (shipment_order_id)
              shipment_order_id, event_type, status, latitude, longitude,
              metadata->>'etaAt' AS eta_at, occurred_at
         FROM logistics_tracking_events
        WHERE tenant_id = $1
        ORDER BY shipment_order_id, occurred_at DESC, created_at DESC
     ),
     latest_pod AS (
       SELECT DISTINCT ON (shipment_order_id)
              shipment_order_id, status, delivered_at
         FROM logistics_pod_events
        WHERE tenant_id = $1
        ORDER BY shipment_order_id, created_at DESC
     )
     SELECT so.*, le.event_type AS latest_event_type, le.status AS latest_event_status,
            le.latitude AS latest_latitude, le.longitude AS latest_longitude,
            le.eta_at AS latest_eta_at, le.occurred_at AS latest_event_at,
            pod.status AS pod_status, pod.delivered_at AS pod_delivered_at
       FROM logistics_shipment_orders so
       LEFT JOIN latest_event le
         ON le.shipment_order_id = so.id
       LEFT JOIN latest_pod pod
         ON pod.shipment_order_id = so.id
      WHERE so.tenant_id = $1
        AND so.deleted_at IS NULL
        AND ($2::text IS NULL OR so.shipment_no = $2)
        AND ($3::text IS NULL OR so.cargo_owner_customer_id = $3)
        AND ($4::text IS NULL OR so.metadata->>'trackingToken' = $4)
      ORDER BY so.updated_at DESC
      LIMIT $5`,
    args.tenantId,
    args.shipmentNo ?? null,
    args.customerId ?? null,
    args.trackingToken ?? null,
    limit,
  );

  return {
    generatedAt: new Date().toISOString(),
    shipments: rows.map(row => ({
      id: row.id,
      shipmentNo: row.shipment_no,
      customerName: row.cargo_owner_name,
      status: row.status,
      originName: row.origin_name,
      destinationName: row.destination_name,
      pickupWindowFrom: iso(row.pickup_window_from),
      deliveryWindowTo: iso(row.delivery_window_to),
      latestEventType: row.latest_event_type,
      latestEventStatus: row.latest_event_status,
      latestLatitude: numberOrNull(row.latest_latitude),
      latestLongitude: numberOrNull(row.latest_longitude),
      latestEtaAt: iso(row.latest_eta_at),
      latestEventAt: iso(row.latest_event_at),
      podStatus: row.pod_status,
      podDeliveredAt: iso(row.pod_delivered_at),
    })),
  };
}

export async function getLogisticsFinanceReconciliation(args: {
  tenantId: string;
  limit?: number;
}) {
  await ensureLogisticsDomainTables();
  const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
  const rows = await prisma.$queryRawUnsafe<Array<{
    shipment_order_id: string;
    shipment_no: string;
    cargo_owner_name: string | null;
    status: string;
    currency: string;
    customer_charge_total: string | number | null;
    carrier_charge_total: string | number | null;
    accessorial_total: string | number | null;
    posted_customer_invoice_total: string | number | null;
    posted_carrier_payable_total: string | number | null;
    reversed_total: string | number | null;
    active_posting_count: bigint | number | string;
    reversed_posting_count: bigint | number | string;
  }>>(
    `SELECT so.id AS shipment_order_id,
            so.shipment_no,
            so.cargo_owner_name,
            so.status,
            so.currency,
            COALESCE(SUM(fc.total_amount) FILTER (WHERE fc.charge_side = 'CUSTOMER'), 0) AS customer_charge_total,
            COALESCE(SUM(fc.total_amount) FILTER (WHERE fc.charge_side = 'CARRIER'), 0) AS carrier_charge_total,
            COALESCE(SUM(fc.total_amount) FILTER (WHERE fc.charge_type NOT IN ('CUSTOMER_FREIGHT','CARRIER_FREIGHT')), 0) AS accessorial_total,
            COALESCE(SUM(fp.amount) FILTER (WHERE fp.posting_type = 'CUSTOMER_INVOICE' AND fp.status = 'POSTED'), 0) AS posted_customer_invoice_total,
            COALESCE(SUM(fp.amount) FILTER (WHERE fp.posting_type IN ('CARRIER_PAYABLE','CARRIER_SETTLEMENT') AND fp.status = 'POSTED'), 0) AS posted_carrier_payable_total,
            COALESCE(SUM(fp.amount) FILTER (WHERE fp.status = 'REVERSED'), 0) AS reversed_total,
            COUNT(DISTINCT fp.id) FILTER (WHERE fp.status = 'POSTED') AS active_posting_count,
            COUNT(DISTINCT fp.id) FILTER (WHERE fp.status = 'REVERSED') AS reversed_posting_count
       FROM logistics_shipment_orders so
       LEFT JOIN logistics_freight_charges fc
         ON fc.shipment_order_id = so.id
        AND fc.tenant_id = so.tenant_id
       LEFT JOIN logistics_finance_postings fp
         ON fp.shipment_order_id = so.id
        AND fp.tenant_id = so.tenant_id
      WHERE so.tenant_id = $1
        AND so.deleted_at IS NULL
      GROUP BY so.id
      ORDER BY so.updated_at DESC
      LIMIT $2`,
    args.tenantId,
    limit,
  );

  const shipments = rows.map(row => {
    const customerCharges = numberOrNull(row.customer_charge_total) ?? 0;
    const carrierCharges = numberOrNull(row.carrier_charge_total) ?? 0;
    const customerPosted = numberOrNull(row.posted_customer_invoice_total) ?? 0;
    const carrierPosted = numberOrNull(row.posted_carrier_payable_total) ?? 0;
    return {
      shipmentOrderId: row.shipment_order_id,
      shipmentNo: row.shipment_no,
      customerName: row.cargo_owner_name,
      status: row.status,
      currency: row.currency,
      customerCharges,
      carrierCharges,
      accessorialTotal: numberOrNull(row.accessorial_total) ?? 0,
      postedCustomerInvoiceTotal: customerPosted,
      postedCarrierPayableTotal: carrierPosted,
      reversedTotal: numberOrNull(row.reversed_total) ?? 0,
      activePostingCount: Number(row.active_posting_count ?? 0),
      reversedPostingCount: Number(row.reversed_posting_count ?? 0),
      customerReconciled: Math.abs(customerCharges - customerPosted) < 0.01,
      carrierReconciled: Math.abs(carrierCharges - carrierPosted) < 0.01,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      shipments: shipments.length,
      customerChargeTotal: shipments.reduce((sum, row) => sum + row.customerCharges, 0),
      carrierChargeTotal: shipments.reduce((sum, row) => sum + row.carrierCharges, 0),
      accessorialTotal: shipments.reduce((sum, row) => sum + row.accessorialTotal, 0),
      unreconciledCustomer: shipments.filter(row => !row.customerReconciled).length,
      unreconciledCarrier: shipments.filter(row => !row.carrierReconciled).length,
      reversedPostings: shipments.reduce((sum, row) => sum + row.reversedPostingCount, 0),
    },
    shipments,
  };
}

export async function awardCarrierBid(args: {
  tenantId: string;
  rfqId: string;
  bidId: string;
  vehicleId?: string | null;
  driverId?: string | null;
  overrideCompliance?: boolean;
  overrideReason?: string | null;
  actorRole?: string | null;
  actorUserId?: string | null;
  notes?: string | null;
}) {
  await ensureLogisticsDomainTables();
  const bidRows = await prisma.$queryRawUnsafe<LogisticsCarrierBidRow[]>(
    `SELECT b.*
       FROM logistics_carrier_bids b
       INNER JOIN logistics_freight_rfqs rfq
         ON rfq.id = b.rfq_id
        AND rfq.tenant_id = b.tenant_id
      WHERE b.id = $1
        AND b.rfq_id = $2
        AND b.tenant_id = $3
      LIMIT 1`,
    args.bidId,
    args.rfqId,
    args.tenantId,
  );
  const bid = bidRows[0];
  if (!bid) throw new Error('Bid not found for this RFQ');

  const shipment = await fetchShipmentById(bid.shipment_order_id, args.tenantId);
  if (!shipment) throw new Error('Shipment not found for this tenant');
  await assertGovernedShipmentWrite({
    tenantId: args.tenantId,
    shipmentOrderId: bid.shipment_order_id,
    action: 'Carrier award',
  });
  const selectedVehicle = args.vehicleId
    ? (await prisma.$queryRawUnsafe<LogisticsCarrierVehicleRow[]>(
      `SELECT *
         FROM logistics_carrier_vehicles
        WHERE tenant_id = $1
          AND carrier_id = $2
          AND id = $3
          AND deleted_at IS NULL
        LIMIT 1`,
      args.tenantId,
      bid.carrier_id,
      args.vehicleId,
    ))[0] ?? null
    : null;
  const resolvedDriverId = args.driverId ?? selectedVehicle?.owner_driver_id ?? null;
  const complianceBlockers = await getCarrierAwardComplianceBlockers({
    tenantId: args.tenantId,
    carrierId: bid.carrier_id,
    vehicleId: args.vehicleId ?? null,
    driverId: resolvedDriverId,
    requireVehicle: true,
  });
  const overrideAllowed = Boolean(args.overrideCompliance && args.actorRole === 'SUPER_ADMIN');
  if (complianceBlockers.length > 0 && !overrideAllowed) {
    throw complianceBlockedError('Carrier compliance blocks this award', complianceBlockers);
  }

  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe(
      `UPDATE logistics_carrier_bids
          SET status = CASE WHEN id = $1 THEN 'AWARDED' ELSE 'REJECTED' END,
              updated_at = NOW()
        WHERE tenant_id = $2
          AND rfq_id = $3`,
      args.bidId,
      args.tenantId,
      args.rfqId,
    );
    await tx.$executeRawUnsafe(
      `UPDATE logistics_freight_rfqs
          SET status = 'AWARDED',
              awarded_bid_id = $1,
              updated_at = NOW()
        WHERE tenant_id = $2
          AND id = $3`,
      args.bidId,
      args.tenantId,
      args.rfqId,
    );
    await tx.$executeRawUnsafe(
      `UPDATE logistics_shipment_orders
          SET marketplace_status = 'AWARDED',
              status = CASE
                WHEN status IN ('DRAFT','PENDING','APPROVED') THEN 'ASSIGNED'
                ELSE status
              END,
              assigned_carrier_id = $1,
              assigned_driver_id = COALESCE($7, assigned_driver_id),
              assigned_vehicle_id = COALESCE($8, assigned_vehicle_id),
              carrier_cost_amount = $2,
              updated_at = NOW(),
              updated_by = $3,
              metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb
        WHERE tenant_id = $5
          AND id = $6`,
      bid.carrier_id,
      bid.amount,
      args.actorUserId ?? 'freight-marketplace',
      jsonParam({
        awardedRfqId: args.rfqId,
        awardedBidId: args.bidId,
        awardedVehicleId: args.vehicleId ?? null,
        awardedDriverId: resolvedDriverId,
        complianceOverride: overrideAllowed,
        complianceOverrideReason: overrideAllowed ? args.overrideReason ?? null : null,
        complianceBlockers: overrideAllowed ? complianceBlockers : [],
      }),
      args.tenantId,
      bid.shipment_order_id,
      resolvedDriverId,
      args.vehicleId ?? null,
    );
  });

  const assignment = await createShipmentAssignment({
    tenantId: args.tenantId,
    shipmentOrderId: bid.shipment_order_id,
    carrierId: bid.carrier_id,
    driverId: resolvedDriverId,
    vehicleId: args.vehicleId ?? null,
    assignmentType: 'CARRIER',
    status: 'ASSIGNED',
    costAmount: numberOrNull(bid.amount),
    currency: bid.currency,
    metadata: {
      source: 'rfq-award',
      rfqId: args.rfqId,
      bidId: args.bidId,
      vehicleId: args.vehicleId ?? null,
      driverId: resolvedDriverId,
      awardedBy: args.actorUserId ?? null,
      actorRole: args.actorRole ?? null,
      overrideCompliance: overrideAllowed,
      overrideReason: overrideAllowed ? args.overrideReason ?? null : null,
      complianceOverride: overrideAllowed,
      complianceBlockers: overrideAllowed ? complianceBlockers : [],
    },
  });

  const settlement = await prepareFreightFinancialSettlement({
    tenantId: args.tenantId,
    shipmentOrderId: bid.shipment_order_id,
    rfqId: args.rfqId,
    bidId: args.bidId,
    assignmentId: assignment?.id ?? null,
    carrierId: bid.carrier_id,
    driverId: assignment?.driverId ?? resolvedDriverId,
    carrierAmount: numberOrNull(bid.amount) ?? 0,
    currency: bid.currency,
    actorUserId: args.actorUserId ?? null,
  });

  await addTrackingEvent({
    tenantId: args.tenantId,
    shipmentOrderId: bid.shipment_order_id,
    assignmentId: assignment?.id ?? null,
    eventType: 'RFQ_AWARDED',
    status: 'ASSIGNED',
    source: 'FREIGHT_MARKETPLACE',
    notes: args.notes ?? 'Carrier bid awarded and shipment assigned',
    metadata: {
      rfqId: args.rfqId,
      bidId: args.bidId,
      carrierId: bid.carrier_id,
      vehicleId: args.vehicleId ?? null,
      driverId: resolvedDriverId,
      amount: numberOrNull(bid.amount),
      currency: bid.currency,
      complianceOverride: overrideAllowed,
      complianceBlockers: overrideAllowed ? complianceBlockers : [],
    },
  });

  if (overrideAllowed && complianceBlockers.length > 0) {
    await addTrackingEvent({
      tenantId: args.tenantId,
      shipmentOrderId: bid.shipment_order_id,
      assignmentId: assignment?.id ?? null,
      eventType: 'CARRIER_COMPLIANCE_OVERRIDE_APPROVED',
      status: 'ASSIGNED',
      source: 'FREIGHT_MARKETPLACE',
      notes: args.overrideReason ?? 'Super Admin override allowed award despite compliance blockers',
      metadata: {
        rfqId: args.rfqId,
        bidId: args.bidId,
        carrierId: bid.carrier_id,
        vehicleId: args.vehicleId ?? null,
        driverId: resolvedDriverId,
        blockers: complianceBlockers,
        actorUserId: args.actorUserId ?? null,
      },
    });
  }

  await addTrackingEvent({
    tenantId: args.tenantId,
    shipmentOrderId: bid.shipment_order_id,
    assignmentId: assignment?.id ?? null,
    eventType: 'SHIPMENT_EXECUTION_STARTED',
    status: 'ASSIGNED',
    source: 'FREIGHT_MARKETPLACE',
    notes: 'Awarded bid moved the shipment into execution',
    metadata: {
      rfqId: args.rfqId,
      bidId: args.bidId,
      carrierId: bid.carrier_id,
      settlementId: settlement.settlement?.id ?? null,
    },
  });

  const rfq = (await listFreightRfqs({
    tenantId: args.tenantId,
    shipmentOrderId: bid.shipment_order_id,
    limit: 50,
  })).find(row => row.id === args.rfqId) ?? null;
  const awardedBid = (await listCarrierBids({
    tenantId: args.tenantId,
    rfqId: args.rfqId,
    limit: 100,
  })).find(row => row.id === args.bidId) ?? null;
  const refreshedShipment = await fetchShipmentById(bid.shipment_order_id, args.tenantId);

  return {
    rfq,
    bid: awardedBid,
    assignment,
    shipment: refreshedShipment,
    settlement,
  };
}
