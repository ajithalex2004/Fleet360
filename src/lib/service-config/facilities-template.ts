/**
 * Field Service Management (FM) service-desk template.
 *
 * An opt-in starter catalogue an admin installs for a tenant from
 * /admin/service-config. It adds four categories, sixteen ticket types
 * (linked to SERVICE_TICKETING, so they work in Service Tickets and the
 * Booking Portal) and four forwarding departments.
 *
 * Idempotent: rows are only inserted when absent, so re-installing never
 * overwrites an admin's edits, and a tenant that deleted a type keeps it
 * deleted (soft-deleted rows still hold the key).
 *
 * SLA hours are starting points for the tenant to tune, not commitments.
 */

import { prisma } from '@/lib/prisma';
import { ensureSeededForTenant } from './schema';
import { seedRulesIfAbsent } from './rules-schema';
import { ensureRootScope } from './scopes-schema';
import { insertDepartmentIfAbsent } from '@/lib/service-tickets/departments';
import {
  DEFAULT_APPROVAL_RULES, DEFAULT_TICKETING_RULES, DEFAULT_VEHICLE_RULES,
  type ApprovalRules, type TicketingRules, type VehicleRules, type FormFieldsRules,
} from '@/types/service-rules';
import type { FormFieldDef, TicketPriority } from '@/types/service-tickets';
import type { ServiceTone } from '@/types/service-config';

export const FACILITIES_TEMPLATE_KEY = 'FACILITIES';

type Matrix = { Critical: number; High: number; Medium: number; Low: number };

interface FmType {
  key: string;
  name: string;
  description: string;
  icon: string;
  tone: ServiceTone;
  prefix: string;
  defaultPriority: TicketPriority;
  /** Resolution SLA in hours per priority. */
  sla: Matrix;
  approvalRequired?: boolean;
  /** Extra fields after the shared location fields. */
  fields?: FormFieldDef[];
}

interface FmCategory {
  key: string;
  name: string;
  description: string;
  icon: string;
  tone: ServiceTone;
  sortOrder: number;
  types: FmType[];
}

/** Where the problem is. Shared by every Facilities type. */
export const FM_LOCATION_FIELDS: FormFieldDef[] = [
  { key: 'building', label: 'Building / site', type: 'text', required: true, placeholder: 'e.g. HQ Tower', preview: true, display: 'badge' },
  { key: 'floor', label: 'Floor', type: 'text', placeholder: 'e.g. 12' },
  { key: 'area', label: 'Room / area', type: 'text', required: true, placeholder: 'e.g. Meeting room 12.04', preview: true },
];

const URGENT: Matrix = { Critical: 1, High: 2, Medium: 4, Low: 8 };
const FAULT: Matrix = { Critical: 2, High: 4, Medium: 8, Low: 24 };
const ROUTINE: Matrix = { Critical: 4, High: 8, Medium: 24, Low: 72 };
const PLANNED: Matrix = { Critical: 8, High: 24, Medium: 72, Low: 120 };

const sel = (key: string, label: string, options: string[], required = false): FormFieldDef => ({
  key, label, type: 'select', required, display: 'badge',
  options: options.map((o) => ({ value: o.toLowerCase().replace(/[^a-z0-9]+/g, '-'), label: o })),
});

export const FACILITIES_CATALOGUE: FmCategory[] = [
  {
    key: 'FM_HARD_SERVICES', name: 'Field Service — Hard services',
    description: 'Building systems: HVAC, electrical, plumbing, lifts, fire safety and fabric.',
    icon: 'Building2', tone: 'amber', sortOrder: 60,
    types: [
      { key: 'FM_HVAC', name: 'Air conditioning / HVAC', description: 'Too hot or cold, no airflow, noise or leaks from AC units.',
        icon: 'Snowflake', tone: 'cyan', prefix: 'HVC', defaultPriority: 'High', sla: FAULT,
        fields: [sel('issue', 'Issue', ['Too hot', 'Too cold', 'No airflow', 'Noise', 'Water leak', 'Not working'], true)] },
      { key: 'FM_ELECTRICAL', name: 'Electrical', description: 'Power outages, lighting, sockets and tripped breakers.',
        icon: 'Zap', tone: 'gold', prefix: 'ELE', defaultPriority: 'High', sla: FAULT,
        fields: [sel('issue', 'Issue', ['No power', 'Lighting', 'Socket', 'Tripped breaker', 'Burning smell'], true)] },
      { key: 'FM_PLUMBING', name: 'Plumbing / water leak', description: 'Leaks, blockages, no water and washroom faults.',
        icon: 'Droplets', tone: 'blue', prefix: 'PLB', defaultPriority: 'High', sla: URGENT,
        fields: [sel('issue', 'Issue', ['Leak', 'Blockage', 'No water', 'Washroom fixture', 'Water heater'], true)] },
      { key: 'FM_LIFT', name: 'Lift / escalator', description: 'Lift out of service, entrapment or escalator stopped.',
        icon: 'ArrowUpDown', tone: 'rose', prefix: 'LFT', defaultPriority: 'Critical', sla: URGENT,
        fields: [
          { key: 'liftId', label: 'Lift / escalator ID', type: 'text', placeholder: 'e.g. L3' },
          { key: 'entrapment', label: 'Someone is trapped', type: 'checkbox' },
        ] },
      { key: 'FM_FIRE_SAFETY', name: 'Fire & life safety', description: 'Alarm faults, sprinklers, extinguishers and emergency lighting.',
        icon: 'Flame', tone: 'rose', prefix: 'FLS', defaultPriority: 'Critical', sla: URGENT },
      { key: 'FM_FABRIC', name: 'Building fabric', description: 'Doors, locks, ceilings, flooring, glazing and blinds.',
        icon: 'DoorOpen', tone: 'slate', prefix: 'FAB', defaultPriority: 'Medium', sla: ROUTINE },
    ],
  },
  {
    key: 'FM_SOFT_SERVICES', name: 'Field Service — Soft services',
    description: 'Cleaning, pest control, waste and landscaping.',
    icon: 'SprayCan', tone: 'emerald', sortOrder: 61,
    types: [
      { key: 'FM_CLEANING', name: 'Cleaning', description: 'Spills, washrooms, pantry and ad-hoc cleaning.',
        icon: 'SprayCan', tone: 'emerald', prefix: 'FCL', defaultPriority: 'Medium', sla: { Critical: 1, High: 2, Medium: 8, Low: 24 } },
      { key: 'FM_PEST', name: 'Pest control', description: 'Insects, rodents and preventive treatment.',
        icon: 'Bug', tone: 'amber', prefix: 'PST', defaultPriority: 'Medium', sla: ROUTINE },
      { key: 'FM_WASTE', name: 'Waste removal', description: 'Bin collection, bulky items and recycling.',
        icon: 'Trash2', tone: 'slate', prefix: 'WST', defaultPriority: 'Low', sla: ROUTINE },
      { key: 'FM_LANDSCAPING', name: 'Landscaping', description: 'Plants, irrigation and outdoor areas.',
        icon: 'Trees', tone: 'emerald', prefix: 'LND', defaultPriority: 'Low', sla: PLANNED },
    ],
  },
  {
    key: 'FM_WORKPLACE', name: 'Field Service — Workplace services',
    description: 'Moves, meeting rooms, access cards and parking.',
    icon: 'Presentation', tone: 'blue', sortOrder: 62,
    types: [
      { key: 'FM_MOVES', name: 'Moves & furniture', description: 'Desk moves, furniture requests and office relocations.',
        icon: 'Package', tone: 'blue', prefix: 'MOV', defaultPriority: 'Low', sla: PLANNED, approvalRequired: true,
        fields: [{ key: 'requiredBy', label: 'Needed by', type: 'date', required: true }] },
      { key: 'FM_ROOM_SETUP', name: 'Meeting room setup', description: 'Layout, AV check and catering setup for an event.',
        icon: 'Presentation', tone: 'violet', prefix: 'RMS', defaultPriority: 'Medium', sla: ROUTINE,
        fields: [
          { key: 'eventStart', label: 'Event start', type: 'datetime', required: true },
          { key: 'attendees', label: 'Attendees', type: 'number', min: 1, max: 1000 },
        ] },
      { key: 'FM_ACCESS', name: 'Access card / keys', description: 'New, lost or faulty access cards and keys.',
        icon: 'KeyRound', tone: 'gold', prefix: 'ACC', defaultPriority: 'Medium', sla: ROUTINE, approvalRequired: true,
        fields: [sel('request', 'Request', ['New card', 'Lost card', 'Card not working', 'Key'], true)] },
      { key: 'FM_PARKING', name: 'Parking', description: 'Parking permits, bay allocation and access issues.',
        icon: 'CircleParking', tone: 'slate', prefix: 'PRK', defaultPriority: 'Low', sla: ROUTINE },
    ],
  },
  {
    key: 'FM_SECURITY_SAFETY', name: 'Field Service — Security & safety',
    description: 'Security incidents and health & safety hazards.',
    icon: 'ShieldAlert', tone: 'rose', sortOrder: 63,
    types: [
      { key: 'FM_SECURITY_INCIDENT', name: 'Security incident', description: 'Theft, trespass, damage or suspicious activity.',
        icon: 'ShieldAlert', tone: 'rose', prefix: 'SEC', defaultPriority: 'High', sla: URGENT },
      { key: 'FM_HSE_HAZARD', name: 'Health & safety hazard', description: 'Trip hazards, exposed wiring, blocked exits.',
        icon: 'HardHat', tone: 'amber', prefix: 'HSE', defaultPriority: 'High', sla: { Critical: 1, High: 2, Medium: 8, Low: 24 } },
    ],
  },
];

export const FACILITIES_DEPARTMENTS = [
  { key: 'FM_HARD_SERVICES', label: 'FM — Hard services', shortLabel: 'Hard FM', tone: 'amber', sortOrder: 70,
    description: 'HVAC, electrical, plumbing, lifts, fire safety and building fabric' },
  { key: 'FM_SOFT_SERVICES', label: 'FM — Soft services', shortLabel: 'Soft FM', tone: 'emerald', sortOrder: 71,
    description: 'Cleaning, pest control, waste and landscaping' },
  { key: 'FM_WORKPLACE', label: 'FM — Workplace services', shortLabel: 'Workplace', tone: 'blue', sortOrder: 72,
    description: 'Moves, meeting rooms, access cards and parking' },
  { key: 'FM_SECURITY_HSE', label: 'FM — Security & HSE', shortLabel: 'Security', tone: 'rose', sortOrder: 73,
    description: 'Security incidents and health & safety hazards' },
];

export function facilitiesTypeKeys(): string[] {
  return FACILITIES_CATALOGUE.flatMap((c) => c.types.map((t) => t.key));
}

/** How many of the template's types the tenant already has (any state). */
export async function facilitiesInstallStatus(tenantId: string): Promise<{ installed: number; total: number }> {
  const keys = facilitiesTypeKeys();
  const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT COUNT(*)::bigint AS n FROM service_types WHERE tenant_id = $1 AND key = ANY($2::text[])`,
    tenantId, keys,
  ).catch(() => [{ n: BigInt(0) }]);
  return { installed: Number(rows[0]?.n ?? 0), total: keys.length };
}

/** Install the Field Service Management catalogue for a tenant. Returns how many types were added. */
export async function installFacilitiesTemplate(tenantId: string): Promise<{ typesAdded: number; total: number }> {
  await ensureSeededForTenant(tenantId);
  const rootScopeId = await ensureRootScope(tenantId);
  let typesAdded = 0;

  for (const cat of FACILITIES_CATALOGUE) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO service_categories (tenant_id, key, name, description, icon, tone, sort_order, is_system)
       VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE)
       ON CONFLICT (tenant_id, key) DO NOTHING`,
      tenantId, cat.key, cat.name, cat.description, cat.icon, cat.tone, cat.sortOrder,
    );
    const [category] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id::text FROM service_categories WHERE tenant_id = $1 AND key = $2 LIMIT 1`,
      tenantId, cat.key,
    );
    if (!category) continue;

    for (const [i, t] of cat.types.entries()) {
      const added = await prisma.$executeRawUnsafe(
        `INSERT INTO service_types
           (tenant_id, category_id, key, name, description, icon, tone, default_priority, sort_order, is_system)
         VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, FALSE)
         ON CONFLICT (tenant_id, key) DO NOTHING`,
        tenantId, category.id, t.key, t.name, t.description, t.icon, t.tone, t.defaultPriority, (i + 1) * 10,
      );
      typesAdded += added;

      const [type] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id::text FROM service_types WHERE tenant_id = $1 AND key = $2 LIMIT 1`,
        tenantId, t.key,
      );
      if (!type) continue;

      await prisma.$executeRawUnsafe(
        `INSERT INTO service_module_mapping
           (service_type_id, linked_module, sub_module,
            workflow_engine_enabled, notification_engine_enabled, approval_engine_enabled,
            finance_engine_enabled, dispatch_engine_enabled)
         VALUES ($1::uuid, 'SERVICE_TICKETING', 'Field Service', TRUE, TRUE, $2, FALSE, FALSE)
         ON CONFLICT (service_type_id) DO NOTHING`,
        type.id, !!t.approvalRequired,
      );

      const approval: ApprovalRules = {
        ...DEFAULT_APPROVAL_RULES,
        approvalRequired: !!t.approvalRequired,
        // Urgent faults must never wait behind an approval gate.
        emergencyBypassEnabled: true,
      };
      const ticketing: TicketingRules = {
        ...DEFAULT_TICKETING_RULES,
        ticketPrefix: t.prefix,
        priorityMatrix: { ...t.sla },
        autoCreatesMaintenanceRequest: false,
      };
      const vehicle: VehicleRules = { ...DEFAULT_VEHICLE_RULES, vehicleRequired: false };
      const formFields: FormFieldsRules = { fields: [...FM_LOCATION_FIELDS, ...(t.fields ?? [])] };

      await seedRulesIfAbsent(type.id, 'approval', approval, rootScopeId);
      await seedRulesIfAbsent(type.id, 'ticketing', ticketing, rootScopeId);
      await seedRulesIfAbsent(type.id, 'vehicle', vehicle, rootScopeId);
      await seedRulesIfAbsent(type.id, 'formFields', formFields, rootScopeId);
    }
  }

  for (const d of FACILITIES_DEPARTMENTS) {
    await insertDepartmentIfAbsent(tenantId, d).catch(() => undefined);
  }

  return { typesAdded, total: facilitiesTypeKeys().length };
}
