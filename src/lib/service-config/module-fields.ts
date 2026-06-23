/**
 * Module Field Registry — Phase B++ of the Service Configuration flow.
 *
 * Each LinkedModule (the value Admins pick in the Module Mapping tab —
 * Vehicle Maintenance, Booking & Dispatch, Vehicle Leasing, …) declares a
 * curated catalogue of "bindable" fields. The Form Fields tab uses this
 * to:
 *
 *   1. Show admins which downstream fields they can auto-fill when the
 *      ticket gets bridged into the linked module's domain object
 *      (e.g. a MAINTENANCE ticket auto-creates a MaintenanceRequest on
 *      Acknowledge — fields with `bindTo: 'module.estimatedCost'` flow
 *      into MaintenanceRequest.estimatedCost during that bridge).
 *
 *   2. Bulk-seed the Form Fields list with the module's "starter" fields
 *      — admins click "+ Sync from module catalog" once after picking a
 *      module and the form is pre-populated with sensible defaults
 *      (vehicleId, odometer, parts list, etc.). Idempotent — re-running
 *      only adds the missing entries.
 *
 *   3. Filter the bind-to dropdown so admins only see options that make
 *      sense for the picked module. A LEASING service type's Form Fields
 *      shouldn't surface MaintenanceRequest.parts.
 *
 * The catalogue is curated TypeScript (not introspected from Prisma) to:
 *   • hide internal columns admins shouldn't touch (deletedAt, createdAt)
 *   • give each field a friendly label + help text
 *   • carry hints (suggested type, required, default source) for the
 *     "Sync from module" auto-populate flow
 *
 * Adding a new module: extend MODULE_FIELD_CATALOG below. Adding a field
 * to an existing module: append a row to its catalogue array — Form
 * Fields tab picks it up on next load.
 */

import type { LinkedModule } from '@/types/service-config';
import type { FieldSource, FormFieldDef } from '@/types/service-tickets';

/** A single bindable field exposed by a LinkedModule. */
export interface ModuleFieldDef {
  /** Stable key — composes with bindTo as `module.<key>`. */
  key: string;
  /** Display label shown in the bind-to dropdown and module catalogue. */
  label: string;
  /** One-liner shown as help text under the dropdown. */
  description: string;
  /** Suggested form-field type for "Sync from module catalog". The admin
   *  can change it per-field after sync. */
  suggestedType: FormFieldDef['type'];
  /** Suggested required flag for sync. */
  suggestedRequired?: boolean;
  /** Optional auto-populate source the sync should pre-set (e.g. fields
   *  that are typically populated from the selected vehicle). */
  suggestedSource?: FieldSource;
  /** Group label used for sectioned dropdowns. */
  group: 'Common' | 'Identity' | 'Vehicle' | 'Cost' | 'Workflow' | 'Schedule' | 'Customer' | 'Cargo' | 'Other';
}

/** Universal fields available to every linked module — these mirror the
 *  service_tickets top-level columns plus a few customField stand-ins. */
const COMMON: ModuleFieldDef[] = [
  { key: 'requestedBy',     label: 'Requested by',          description: 'Person who raised the ticket',                  suggestedType: 'text',     suggestedSource: 'currentUser.name', group: 'Identity' },
  { key: 'requestedByEmail',label: 'Requested by (email)',  description: 'Email of the requestor',                        suggestedType: 'text',     suggestedSource: 'currentUser.email', group: 'Identity' },
  { key: 'requestedAt',     label: 'Requested at',          description: 'When the ticket was raised (ISO timestamp)',    suggestedType: 'datetime', suggestedSource: 'currentTimestamp',  group: 'Common'   },
  { key: 'department',      label: 'Department',            description: 'Department the requestor belongs to',           suggestedType: 'text',     suggestedSource: 'currentUser.department', group: 'Identity' },
  { key: 'remarks',         label: 'Remarks / Notes',       description: 'Free-form notes from the requestor',            suggestedType: 'textarea', group: 'Common' },
];

// ── Per-module catalogues ──────────────────────────────────────────────────
// Each catalogue should focus on fields the admin would PLAUSIBLY want to
// auto-fill from the ticket form. Stick to ~8-12 entries per module — more
// than that and the dropdown becomes overwhelming. Internal columns belong
// to the engineering team; customer-facing config sticks to user intent.

// MAINTENANCE catalogue is derived from the real MaintenanceRequest model
// in prisma/schema.prisma. Every entry here maps to an actual column the
// downstream auto-create-MR bridge can write to. Order roughly follows
// "most likely to fill at creation time" first.
const MAINTENANCE: ModuleFieldDef[] = [
  ...COMMON,

  // ── Vehicle (auto-populated from the vehicle dropdown) ────────────────
  { key: 'vehicleId',          label: 'Vehicle',                  description: 'The vehicle requiring maintenance — MaintenanceRequest.vehicleId', suggestedType: 'select', suggestedSource: 'vehicle.id',           suggestedRequired: true, group: 'Vehicle' },
  { key: 'vehiclePlate',       label: 'Vehicle plate',            description: 'License plate (auto-populated from selected vehicle)',              suggestedType: 'text',   suggestedSource: 'vehicle.licensePlate', group: 'Vehicle' },
  { key: 'vehicleType',        label: 'Vehicle type',             description: 'Vehicle type from the fleet master (auto-populated)',                suggestedType: 'text',   suggestedSource: 'vehicle.type',         group: 'Vehicle' },
  { key: 'odometer',           label: 'Odometer (km)',            description: 'Reading at request time — MaintenanceRequest.odometer',              suggestedType: 'number', suggestedSource: 'vehicle.lastOdometer', group: 'Vehicle' },

  // ── Job specifics ──────────────────────────────────────────────────────
  { key: 'maintenanceType',    label: 'Maintenance type',         description: 'Sub-category (Engine, Brakes, …) — MaintenanceRequest.maintenanceType', suggestedType: 'select', suggestedSource: 'maintenanceType.name',  suggestedRequired: true, group: 'Workflow' },
  { key: 'maintenanceJobs',    label: 'Maintenance Jobs',         description: 'Work items to perform — MaintenanceRequest.maintenanceJobs (text array; one per line)', suggestedType: 'textarea', suggestedRequired: true, group: 'Workflow' },
  { key: 'description',        label: 'Description',              description: 'Free-text summary of the issue — MaintenanceRequest.description',     suggestedType: 'textarea', group: 'Workflow' },
  { key: 'priority',           label: 'Priority',                 description: 'Workflow priority — MaintenanceRequest.priority',                    suggestedType: 'select', suggestedSource: 'maintenanceType.defaultPriority', group: 'Workflow' },
  { key: 'workOrderNo',        label: 'Work Order No.',           description: 'External work-order reference — MaintenanceRequest.workOrderNo',     suggestedType: 'text',   group: 'Workflow' },
  { key: 'garageId',           label: 'Garage / Workshop',        description: 'Garage where the work will be performed — MaintenanceRequest.garageId', suggestedType: 'select', group: 'Workflow' },
  { key: 'driverId',           label: 'Driver',                   description: 'Driver associated with the request — MaintenanceRequest.driverId',   suggestedType: 'select', group: 'Identity' },

  // ── Cost (typically filled at quotation / completion stage) ───────────
  { key: 'estimatedCost',      label: 'Estimated cost (AED)',     description: 'Quote amount before approval — MaintenanceRequest.estimatedCost',    suggestedType: 'number', group: 'Cost' },
  { key: 'estimatedHours',     label: 'Estimated hours',          description: 'Workshop time estimate (no schema column — stored in customFields)', suggestedType: 'number', suggestedSource: 'maintenanceType.estimatedHours', group: 'Cost' },
  { key: 'actualCost',         label: 'Actual cost (AED)',        description: 'Final amount — MaintenanceRequest.actualCost',                       suggestedType: 'number', group: 'Cost' },
  { key: 'actualPartsCost',    label: 'Actual parts cost (AED)',  description: 'Parts portion — MaintenanceRequest.actualPartsCost',                 suggestedType: 'number', group: 'Cost' },
  { key: 'actualLaborCost',    label: 'Actual labour cost (AED)', description: 'Labour portion — MaintenanceRequest.actualLaborCost',                suggestedType: 'number', group: 'Cost' },
  { key: 'actualOtherCost',    label: 'Other costs (AED)',        description: 'Misc charges — MaintenanceRequest.actualOtherCost',                  suggestedType: 'number', group: 'Cost' },

  // ── Schedule ──────────────────────────────────────────────────────────
  { key: 'requestDate',        label: 'Request date',             description: 'When the request was raised — MaintenanceRequest.requestDate',       suggestedType: 'datetime', suggestedSource: 'currentTimestamp', group: 'Schedule' },
  { key: 'expectedEndDate',    label: 'Expected end date',        description: 'Target completion date — MaintenanceRequest.expectedEndDate',        suggestedType: 'date',   group: 'Schedule' },
  { key: 'completionDate',     label: 'Completion date',          description: 'When the job actually finished — MaintenanceRequest.completionDate', suggestedType: 'date',   group: 'Schedule' },

  // ── Workshop execution (typically populated later in the lifecycle) ───
  { key: 'partsUsed',          label: 'Parts used',               description: 'Parts consumed during the job — MaintenanceRequest.partsUsed',       suggestedType: 'textarea', group: 'Workflow' },
  { key: 'workLog',            label: 'Work log',                 description: 'Technician notes — MaintenanceRequest.workLog',                      suggestedType: 'textarea', group: 'Workflow' },
  { key: 'checklistItems',     label: 'Checklist items',          description: 'Inspection checklist results — MaintenanceRequest.checklistItems',   suggestedType: 'textarea', group: 'Workflow' },
  { key: 'assignedTechnicians',label: 'Assigned technicians',     description: 'Comma-separated tech names/IDs — MaintenanceRequest.assignedTechnicians', suggestedType: 'textarea', group: 'Workflow' },
];

const DRIVERS: ModuleFieldDef[] = [
  ...COMMON,
  { key: 'driverId',          label: 'Driver ID',           description: 'Driver master identifier',                          suggestedType: 'text',   suggestedRequired: true, group: 'Identity' },
  { key: 'driverName',        label: 'Driver name',         description: 'Full driver name',                                  suggestedType: 'text',   suggestedRequired: true, group: 'Identity' },
  { key: 'licenseNumber',     label: 'Licence number',      description: 'Driving licence reference',                         suggestedType: 'text',   group: 'Identity' },
  { key: 'licenseExpiryDate', label: 'Licence expiry date', description: 'When the driver licence expires',                   suggestedType: 'date',   group: 'Schedule' },
  { key: 'visaExpiryDate',    label: 'Visa expiry date',    description: 'Visa or permit renewal date',                       suggestedType: 'date',   group: 'Schedule' },
  { key: 'assignedVehicleId', label: 'Assigned vehicle',    description: 'Vehicle currently assigned to the driver',          suggestedType: 'select', suggestedSource: 'vehicle.id', group: 'Vehicle' },
  { key: 'trainingStatus',    label: 'Training status',     description: 'Onboarding / refresher / completed training state', suggestedType: 'select', group: 'Workflow' },
  { key: 'complianceStatus',  label: 'Compliance status',   description: 'Driver document and compliance state',              suggestedType: 'select', group: 'Workflow' },
  { key: 'incidentSeverity',  label: 'Incident severity',   description: 'Severity for driver incident review or escalation', suggestedType: 'select', group: 'Workflow' },
  { key: 'scorecardRating',   label: 'Scorecard rating',    description: 'Operational performance rating for the driver',     suggestedType: 'number', group: 'Other' },
];

const BOOKING: ModuleFieldDef[] = [
  ...COMMON,
  { key: 'pickupLocation',  label: 'Pickup location',     description: 'Address or zone code',                          suggestedType: 'text',     suggestedRequired: true, group: 'Schedule' },
  { key: 'dropoffLocation', label: 'Dropoff location',    description: 'Address or zone code',                          suggestedType: 'text',     suggestedRequired: true, group: 'Schedule' },
  { key: 'pickupTime',      label: 'Pickup time',         description: 'When the booking starts',                       suggestedType: 'datetime', suggestedRequired: true, group: 'Schedule' },
  { key: 'returnTime',      label: 'Return time',         description: 'For round-trip bookings',                       suggestedType: 'datetime', group: 'Schedule' },
  { key: 'passengerCount',  label: 'Passenger count',     description: 'Number of riders',                              suggestedType: 'number',   group: 'Customer' },
  { key: 'passengerName',   label: 'Lead passenger',      description: 'Primary passenger name',                        suggestedType: 'text',     group: 'Customer' },
  { key: 'vehicleClass',    label: 'Vehicle class',        description: 'Sedan / SUV / Bus / Van',                       suggestedType: 'select',   group: 'Vehicle'  },
  { key: 'specialRequest',  label: 'Special request',     description: 'Wheelchair, child seat, etc.',                  suggestedType: 'textarea', group: 'Customer' },
];

const LEASING: ModuleFieldDef[] = [
  ...COMMON,
  { key: 'lesseeName',       label: 'Lessee name',          description: 'Customer / company name',                        suggestedType: 'text',     suggestedRequired: true, group: 'Customer' },
  { key: 'lesseeContact',    label: 'Lessee contact',       description: 'Phone or email',                                  suggestedType: 'text',     group: 'Customer' },
  { key: 'leaseDuration',    label: 'Lease duration (months)', description: 'Contract length',                             suggestedType: 'number',   group: 'Cost' },
  { key: 'monthlyRate',      label: 'Monthly rate (AED)',   description: 'Quoted monthly amount',                           suggestedType: 'number',   group: 'Cost' },
  { key: 'mileageCap',       label: 'Mileage cap (km/mo)',  description: 'Per-month inclusive mileage',                     suggestedType: 'number',   group: 'Cost' },
  { key: 'vehicleId',        label: 'Vehicle',              description: 'Vehicle being leased',                            suggestedType: 'select',   suggestedSource: 'vehicle.id', group: 'Vehicle' },
  { key: 'startDate',        label: 'Lease start date',     description: 'When the contract begins',                        suggestedType: 'date',     suggestedRequired: true, group: 'Schedule' },
  { key: 'endDate',          label: 'Lease end date',       description: 'When the contract ends',                          suggestedType: 'date',     group: 'Schedule' },
];

const RAC: ModuleFieldDef[] = [
  ...COMMON,
  { key: 'customerName',   label: 'Customer name',     description: 'Renter name',                          suggestedType: 'text',     suggestedRequired: true, group: 'Customer' },
  { key: 'customerPhone',  label: 'Customer phone',    description: 'Contact number',                       suggestedType: 'text',     group: 'Customer' },
  { key: 'pickupDate',     label: 'Pickup date',       description: 'When the rental starts',               suggestedType: 'datetime', suggestedRequired: true, group: 'Schedule' },
  { key: 'returnDate',     label: 'Return date',       description: 'When the rental ends',                 suggestedType: 'datetime', suggestedRequired: true, group: 'Schedule' },
  { key: 'vehicleClass',   label: 'Vehicle class',      description: 'Economy / Compact / Luxury / SUV',     suggestedType: 'select',   group: 'Vehicle'  },
  { key: 'dailyRate',      label: 'Daily rate (AED)',  description: 'Quoted daily amount',                  suggestedType: 'number',   group: 'Cost' },
  { key: 'mileageIncl',    label: 'Inclusive mileage', description: 'Km per day included',                  suggestedType: 'number',   group: 'Cost' },
  { key: 'pickupLocation', label: 'Pickup location',   description: 'Branch or address',                    suggestedType: 'text',     group: 'Schedule' },
];

const STAFF_TRANSPORT: ModuleFieldDef[] = [
  ...COMMON,
  { key: 'employeeId',     label: 'Employee ID',       description: 'Staff member ID',              suggestedType: 'text',     suggestedRequired: true, group: 'Customer' },
  { key: 'employeeName',   label: 'Employee name',     description: 'Staff member name',            suggestedType: 'text',     group: 'Customer' },
  { key: 'routeCode',      label: 'Route code',        description: 'Pre-defined route identifier', suggestedType: 'select',   group: 'Schedule' },
  { key: 'shiftStartTime', label: 'Shift start',       description: 'When the employee starts',     suggestedType: 'datetime', group: 'Schedule' },
  { key: 'pickupPoint',    label: 'Pickup point',      description: 'Boarding location',            suggestedType: 'text',     group: 'Schedule' },
];

const SCHOOL_BUS: ModuleFieldDef[] = [
  ...COMMON,
  { key: 'studentId',     label: 'Student ID',     description: 'Student identifier',         suggestedType: 'text',     suggestedRequired: true, group: 'Customer' },
  { key: 'studentName',   label: 'Student name',   description: 'Student full name',          suggestedType: 'text',     suggestedRequired: true, group: 'Customer' },
  { key: 'parentContact', label: 'Parent contact', description: 'Parent phone or email',      suggestedType: 'text',     group: 'Customer' },
  { key: 'routeCode',     label: 'Route code',     description: 'School bus route',           suggestedType: 'select',   group: 'Schedule' },
  { key: 'pickupStop',    label: 'Pickup stop',    description: 'Boarding stop',              suggestedType: 'text',     group: 'Schedule' },
  { key: 'schoolName',    label: 'School name',    description: 'Destination school',         suggestedType: 'text',     group: 'Customer' },
];

const LOGISTICS: ModuleFieldDef[] = [
  ...COMMON,
  { key: 'consignor',      label: 'Consignor',          description: 'Sender name / company',       suggestedType: 'text',     suggestedRequired: true, group: 'Customer' },
  { key: 'consignee',      label: 'Consignee',          description: 'Receiver name / company',     suggestedType: 'text',     suggestedRequired: true, group: 'Customer' },
  { key: 'cargoDescription',label:'Cargo description',  description: 'Goods being shipped',         suggestedType: 'textarea', group: 'Cargo' },
  { key: 'weight',         label: 'Weight (kg)',         description: 'Total weight',                suggestedType: 'number',   group: 'Cargo' },
  { key: 'dimensions',     label: 'Dimensions (LxWxH cm)',description: 'Package size',              suggestedType: 'text',     group: 'Cargo' },
  { key: 'pickupAddress',  label: 'Pickup address',     description: 'Where to collect from',       suggestedType: 'textarea', group: 'Schedule' },
  { key: 'deliveryAddress',label: 'Delivery address',   description: 'Where to deliver to',         suggestedType: 'textarea', group: 'Schedule' },
];

const INCIDENT: ModuleFieldDef[] = [
  ...COMMON,
  { key: 'incidentDate',   label: 'Incident date',      description: 'When the incident happened', suggestedType: 'datetime', suggestedRequired: true, group: 'Common' },
  { key: 'incidentLocation',label:'Incident location',  description: 'Address or coordinates',     suggestedType: 'text',     suggestedRequired: true, group: 'Common' },
  { key: 'driverId',       label: 'Driver involved',    description: 'Driver ID / name',           suggestedType: 'select',   group: 'Identity' },
  { key: 'vehicleId',      label: 'Vehicle involved',   description: 'Vehicle in the incident',     suggestedType: 'select',   suggestedSource: 'vehicle.id', group: 'Vehicle' },
  { key: 'severity',       label: 'Severity',           description: 'Minor / Major / Critical',    suggestedType: 'select',   group: 'Workflow' },
  { key: 'thirdPartyInvolved',label:'Third party involved',description: 'Other vehicle / person', suggestedType: 'checkbox', group: 'Common' },
  { key: 'policeReportNo', label: 'Police report no.',  description: 'Reference number',           suggestedType: 'text',     group: 'Workflow' },
  { key: 'incidentDescription',label:'Description',     description: 'What happened',              suggestedType: 'textarea', suggestedRequired: true, group: 'Common' },
];

const SERVICE_TICKETING: ModuleFieldDef[] = [
  ...COMMON,
  // Generic ticket fields — modules without a strong domain model land here.
  { key: 'subject',     label: 'Subject',     description: 'Short summary',                suggestedType: 'text',     suggestedRequired: true, group: 'Common' },
  { key: 'category',    label: 'Category',    description: 'Sub-category for routing',     suggestedType: 'select',   group: 'Workflow' },
  { key: 'severity',    label: 'Severity',    description: 'Impact rating',                 suggestedType: 'select',   group: 'Workflow' },
];

const FINANCE: ModuleFieldDef[] = [
  ...COMMON,
  { key: 'invoiceNumber',  label: 'Invoice number',     description: 'Reference invoice',         suggestedType: 'text',     group: 'Cost' },
  { key: 'amount',         label: 'Amount (AED)',       description: 'Transaction amount',         suggestedType: 'number',   suggestedRequired: true, group: 'Cost' },
  { key: 'currency',       label: 'Currency',           description: 'ISO currency code',          suggestedType: 'select',   group: 'Cost' },
  { key: 'costCenter',     label: 'Cost centre',        description: 'GL cost-centre code',        suggestedType: 'text',     group: 'Cost' },
  { key: 'glAccount',      label: 'GL account',         description: 'General ledger account',     suggestedType: 'text',     group: 'Cost' },
];

const ADMIN: ModuleFieldDef[] = [
  ...COMMON,
];

// ── Catalog ──────────────────────────────────────────────────────────────

export const MODULE_FIELD_CATALOG: Record<LinkedModule, ModuleFieldDef[]> = {
  SERVICE_TICKETING,
  MAINTENANCE,
  DRIVERS,
  BOOKING,
  LEASING,
  RAC,
  STAFF_TRANSPORT,
  SCHOOL_BUS,
  LOGISTICS,
  INCIDENT,
  FINANCE,
  ADMIN,
};

/** Look up a module's catalogue. Empty array if module doesn't exist
 *  (defensive — every LinkedModule should be present). */
export function getModuleFields(linkedModule: LinkedModule | null | undefined): ModuleFieldDef[] {
  if (!linkedModule) return [];
  return MODULE_FIELD_CATALOG[linkedModule] ?? [];
}

/** Compose a `bindTo` value for a module field. Pairs with the parser
 *  in field-resolver.ts. */
export function moduleBindTarget(fieldKey: string): `module.${string}` {
  return `module.${fieldKey}`;
}

/** Inverse — extract the field key from a `module.<key>` bindTo value.
 *  Returns null when the bindTo is not a module binding. */
export function parseModuleBindTarget(bindTo: string | undefined | null): string | null {
  if (!bindTo) return null;
  if (!bindTo.startsWith('module.')) return null;
  return bindTo.slice('module.'.length);
}

/**
 * Build a starter Form Fields list from a module catalogue. Used by the
 * "Sync from module catalog" button in the Form Fields tab.
 *
 *   • Only adds entries whose key isn't already present in `existing`.
 *   • Pre-fills bindTo to module.<key>, source/required from suggestion.
 *   • Hidden defaults to false; admin can choose to hide auto-filled ones
 *     after sync.
 */
export function buildSyncedFormFields(
  catalog: ModuleFieldDef[],
  existing: FormFieldDef[],
): FormFieldDef[] {
  const existingKeys = new Set(existing.map(f => f.key));
  const additions: FormFieldDef[] = [];
  for (const m of catalog) {
    if (existingKeys.has(m.key)) continue;
    additions.push({
      key:       m.key,
      label:     m.label,
      type:      m.suggestedType,
      required:  m.suggestedRequired,
      placeholder: m.description,
      source:    m.suggestedSource,
      bindTo:    moduleBindTarget(m.key),
      // Auto-sourced fields render as read-only by default — pairs cleanly
      // with the source so users see what's auto-filled and can't tamper.
      readOnly:  !!m.suggestedSource && m.suggestedSource !== 'user-input',
    });
  }
  return [...existing, ...additions];
}
