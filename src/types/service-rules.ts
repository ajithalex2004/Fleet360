/**
 * Per-service rule shapes for the Service Configuration Engine (Phase 2B).
 *
 * Each ServiceType can carry one rule-set per RuleCategory. We store them
 * in a single `service_rules` table keyed by (service_type_id, category)
 * with a JSONB rules blob so adding new categories later is a zero-DDL
 * change. Application code is the source of truth for the rules schema.
 *
 * Authority swap (modules reading these rules instead of hardcoded config)
 * is Phase 2C — these types are wired but not yet enforced anywhere.
 */

export const RULE_CATEGORIES = [
  'sla',
  'approval',
  'vehicle',
  'trip',
  'finance',
  'ticketing',
  'epod',
  'automation',
  'formFields',
] as const;
export type RuleCategory = typeof RULE_CATEGORIES[number];

import type { FormFieldDef } from './service-tickets';
export type { FormFieldDef };

// ── 1. SLA & Workflow ───────────────────────────────────────────────────────
export interface EscalationLevel {
  level: number;        // 1..N
  triggerHours: number; // hours of inactivity before escalating
  notify: string;       // email or role key
}
export interface SlaRules {
  responseSlaMinutes: number | null;
  resolutionSlaHours: number | null;
  escalationSlaHours: number | null;
  businessHoursOnly: boolean;
  businessHoursStart: string;  // "08:00"
  businessHoursEnd: string;    // "18:00"
  businessDays: number[];      // ISO weekday numbers, 1=Mon..7=Sun
  holidayCalendarKey: string | null;
  autoEscalationEnabled: boolean;
  escalationLevels: EscalationLevel[];
}
export const DEFAULT_SLA_RULES: SlaRules = {
  responseSlaMinutes: 60,
  resolutionSlaHours: 24,
  escalationSlaHours: 8,
  businessHoursOnly: false,
  businessHoursStart: '08:00',
  businessHoursEnd: '18:00',
  businessDays: [1, 2, 3, 4, 5],
  holidayCalendarKey: null,
  autoEscalationEnabled: false,
  escalationLevels: [],
};

// ── 2. Approval ─────────────────────────────────────────────────────────────
export interface ApprovalRules {
  approvalRequired: boolean;
  approvalLevels: number;            // 1..5
  departmentApprovalRequired: boolean;
  financialThresholdAed: number | null;
  emergencyBypassEnabled: boolean;
  autoApproveBelowThreshold: boolean;
  approverRoles: string[];           // free-form role keys
  workflowId: string | null;         // optional /admin/workflows row link
}
export const DEFAULT_APPROVAL_RULES: ApprovalRules = {
  approvalRequired: false,
  approvalLevels: 1,
  departmentApprovalRequired: false,
  financialThresholdAed: null,
  emergencyBypassEnabled: false,
  autoApproveBelowThreshold: false,
  approverRoles: [],
  workflowId: null,
};

// ── 3. Vehicle ──────────────────────────────────────────────────────────────
export const VEHICLE_CLASSES = [
  'Sedan', 'SUV', 'Premium', 'Bus', 'Van', 'Mini-Van',
  'Ambulance', 'Recovery Truck', 'Heavy Truck', 'Light Commercial',
] as const;
export const VEHICLE_USAGES = [
  'Lease', 'Rent-a-Car', 'Staff Transport', 'School Bus',
  'Logistics', 'Ambulance', 'Limousine', 'Internal',
] as const;
export interface VehicleRules {
  /** When true, requests of this service must reference a vehicle. Used
   *  by /api/service-tickets POST to block submission without vehicleId. */
  vehicleRequired: boolean;
  vehicleClasses: string[];
  vehicleTypes: string[];
  vehicleGroups: string[];
  vehicleUsage: string[];
  minSeatCapacity: number | null;
  maxSeatCapacity: number | null;
  specialRequirements: string[]; // wheelchair, oxygen, child seat, etc.
}
export const DEFAULT_VEHICLE_RULES: VehicleRules = {
  vehicleRequired: false,
  vehicleClasses: [],
  vehicleTypes: [],
  vehicleGroups: [],
  vehicleUsage: [],
  minSeatCapacity: null,
  maxSeatCapacity: null,
  specialRequirements: [],
};

// ── 4. Trip & Dispatch ──────────────────────────────────────────────────────
export const DISPATCH_STRATEGIES = [
  'NEAREST', 'ROUND_ROBIN', 'CHEAPEST', 'PREFERRED_VENDOR', 'MANUAL',
] as const;
export type DispatchStrategy = typeof DISPATCH_STRATEGIES[number];
export interface TripRules {
  autoTripCreation: boolean;
  autoDispatch: boolean;
  dispatchStrategy: DispatchStrategy;
  tripMergeAllowed: boolean;
  tripSplitAllowed: boolean;
  poolingAllowed: boolean;
  nearestVehicleRadiusKm: number | null;
  driverAutoAssignment: boolean;
  vendorAutoAssignment: boolean;
}
export const DEFAULT_TRIP_RULES: TripRules = {
  autoTripCreation: false,
  autoDispatch: false,
  dispatchStrategy: 'MANUAL',
  tripMergeAllowed: false,
  tripSplitAllowed: false,
  poolingAllowed: false,
  nearestVehicleRadiusKm: null,
  driverAutoAssignment: false,
  vendorAutoAssignment: false,
};

// ── 5. Finance ──────────────────────────────────────────────────────────────
export const PRICING_SOURCES = [
  'NONE', 'RATE_CARD', 'CONTRACT', 'DYNAMIC', 'INTERNAL_COST_CENTER',
] as const;
export type PricingSource = typeof PRICING_SOURCES[number];
export const BILLING_TYPES = [
  'IMMEDIATE', 'MONTHLY', 'CONTRACT', 'INTERNAL', 'NONE',
] as const;
export type BillingType = typeof BILLING_TYPES[number];
export const TAX_RULES = [
  'STANDARD_VAT', 'EXEMPT', 'ZERO_RATED', 'CUSTOM',
] as const;
export type TaxRule = typeof TAX_RULES[number];
export interface FinanceRules {
  pricingSource: PricingSource;
  rateCardId: string | null;
  dynamicPricingEnabled: boolean;
  contractPricingEnabled: boolean;
  approvalThresholdAed: number | null;
  billingType: BillingType;
  costCenter: string | null;
  taxRule: TaxRule;
  taxRatePercent: number | null;
  autoInvoiceGeneration: boolean;
}
export const DEFAULT_FINANCE_RULES: FinanceRules = {
  pricingSource: 'NONE',
  rateCardId: null,
  dynamicPricingEnabled: false,
  contractPricingEnabled: false,
  approvalThresholdAed: null,
  billingType: 'NONE',
  costCenter: null,
  taxRule: 'STANDARD_VAT',
  taxRatePercent: 5,
  autoInvoiceGeneration: false,
};

// ── 6. Ticketing ────────────────────────────────────────────────────────────
export interface PriorityMatrix {
  Low: number;     // SLA hours for Low priority
  Medium: number;
  High: number;
}
export interface TicketingEscalationStep {
  level: number;
  afterHours: number;
  escalateTo: string; // email or role
}
export interface TicketingRules {
  ticketPrefix: string;             // e.g. "MNT"
  autoAssignment: boolean;
  defaultAssignee: string | null;
  priorityMatrix: PriorityMatrix;
  categoryMapping: string | null;   // free-form slug into a future category map
  escalationMatrix: TicketingEscalationStep[];
  customerNotificationEnabled: boolean;
  internalNotesEnabled: boolean;
  /** MAINTENANCE-only bridge — when true, Acknowledging a ticket of this
   *  service auto-creates a MaintenanceRequest in the maintenance module.
   *  Migrated from TICKET_TYPE_CONFIG.autoCreatesMaintenanceRequest. */
  autoCreatesMaintenanceRequest: boolean;
}
export const DEFAULT_TICKETING_RULES: TicketingRules = {
  ticketPrefix: '',
  autoAssignment: false,
  defaultAssignee: null,
  priorityMatrix: { Low: 72, Medium: 24, High: 4 },
  categoryMapping: null,
  escalationMatrix: [],
  customerNotificationEnabled: true,
  internalNotesEnabled: true,
  autoCreatesMaintenanceRequest: false,
};

// ── 7. EPOD (Electronic Proof Of Delivery) ──────────────────────────────────
export interface EpodRules {
  epodRequired: boolean;
  photoMandatory: boolean;
  signatureRequired: boolean;
  geoLocationRequired: boolean;
  otpVerification: boolean;
  documentUploadRequired: boolean;
  minPhotoCount: number;
}
export const DEFAULT_EPOD_RULES: EpodRules = {
  epodRequired: false,
  photoMandatory: false,
  signatureRequired: false,
  geoLocationRequired: false,
  otpVerification: false,
  documentUploadRequired: false,
  minPhotoCount: 0,
};

// ── 8. Automation ───────────────────────────────────────────────────────────
export interface AutomationRules {
  autoStatusUpdate: boolean;
  autoClosure: boolean;
  autoClosureAfterHours: number | null;
  reminderNotifications: boolean;
  reminderIntervalHours: number | null;
  whatsappNotifications: boolean;
  emailNotifications: boolean;
  smsNotifications: boolean;
  aiClassification: boolean;
  aiRouting: boolean;
}
export const DEFAULT_AUTOMATION_RULES: AutomationRules = {
  autoStatusUpdate: false,
  autoClosure: false,
  autoClosureAfterHours: null,
  reminderNotifications: false,
  reminderIntervalHours: null,
  whatsappNotifications: false,
  emailNotifications: true,
  smsNotifications: false,
  aiClassification: false,
  aiRouting: false,
};

// ── 9. Form fields (per-service request form schema) ────────────────────────
// The fields shown when creating an instance of this service. Originally
// hardcoded as TICKET_TYPE_CONFIG[type].formFields; brought into rules in
// Phase 2B.formFields so admins can edit without code changes.
export interface FormFieldsRules {
  fields: FormFieldDef[];
}
export const DEFAULT_FORM_FIELDS_RULES: FormFieldsRules = {
  fields: [],
};

// ── Discriminated map ───────────────────────────────────────────────────────
export interface RuleShapes {
  sla:        SlaRules;
  approval:   ApprovalRules;
  vehicle:    VehicleRules;
  trip:       TripRules;
  finance:    FinanceRules;
  ticketing:  TicketingRules;
  epod:       EpodRules;
  automation: AutomationRules;
  formFields: FormFieldsRules;
}
export const RULE_DEFAULTS: { [K in RuleCategory]: RuleShapes[K] } = {
  sla:        DEFAULT_SLA_RULES,
  approval:   DEFAULT_APPROVAL_RULES,
  vehicle:    DEFAULT_VEHICLE_RULES,
  trip:       DEFAULT_TRIP_RULES,
  finance:    DEFAULT_FINANCE_RULES,
  ticketing:  DEFAULT_TICKETING_RULES,
  epod:       DEFAULT_EPOD_RULES,
  automation: DEFAULT_AUTOMATION_RULES,
  formFields: DEFAULT_FORM_FIELDS_RULES,
};
