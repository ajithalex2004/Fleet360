/**
 * Field Service Management — Service Catalog & SLA master.
 *
 * A tenant's FSM catalogue is a set of Service Categories (`service_categories`
 * rows keyed `FSM_*`), each with Service Types (`service_types` rows linked to
 * SERVICE_TICKETING). Every Service Type carries:
 *   • a default priority (P1–P4 → Critical / High / Medium / Low), which the
 *     New Request form applies as-is (priority is set here, not by the requester);
 *   • a trigger (stored in the type's description);
 *   • three SLA timers — response, on-site arrival and resolution — stored in
 *     the type's `sla` rules at the tenant root scope. The resolution timer is
 *     also written to the ticketing priority matrix so the ticket grid's SLA
 *     age / breach logic uses it.
 *
 * No new tables: this sits on the Service Configuration Engine, so the same
 * types also show in /admin/service-config. Those tables have no RLS, so every
 * query filters on tenant_id explicitly (same convention as catalogue.ts).
 */

import { prisma } from '@/lib/prisma';
import { ensureSeededForTenant } from '@/lib/service-config/schema';
import { ensureRootScope } from '@/lib/service-config/scopes-schema';
import { loadRulesForChain, saveRules, seedRulesIfAbsent } from '@/lib/service-config/rules-schema';
import { FM_LOCATION_FIELDS, FACILITIES_CATALOGUE } from '@/lib/service-config/facilities-template';
import {
  DEFAULT_APPROVAL_RULES, DEFAULT_SLA_RULES, DEFAULT_TICKETING_RULES, DEFAULT_VEHICLE_RULES,
  type SlaRules, type TicketingRules,
} from '@/types/service-rules';
import type { TicketPriority } from '@/types/service-tickets';
import { PRIORITY_TIERS } from './priority-tiers';

export const CATALOG_CATEGORY_PREFIX = 'FSM_';

// ── Priority tiers ─────────────────────────────────────────────────────────────

export { PRIORITY_TIERS, priorityLabel } from './priority-tiers';

// ── Shapes ─────────────────────────────────────────────────────────────────────

export interface CatalogSla {
  responseHours: number | null;
  onSiteHours: number | null;
  resolutionHours: number | null;
}

export interface CatalogType {
  id: string;
  key: string;
  name: string;
  categoryId: string;
  priority: TicketPriority;
  trigger: string | null;
  prefix: string;
  sortOrder: number;
  sla: CatalogSla;
}

export interface CatalogCategory {
  id: string;
  key: string;
  name: string;
  description: string | null;
  sortOrder: number;
  types: CatalogType[];
}

export class CatalogError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

// ── Standard catalogue (FSM_Service_Types_and_SLA_Timers-v2.xlsx) ─────────────

interface StdType {
  key: string; name: string; prefix: string; priority: TicketPriority;
  response: number; onSite: number; resolution: number; trigger: string;
}
interface StdCategory { key: string; name: string; description: string; types: StdType[] }

const t = (
  key: string, name: string, prefix: string, priority: TicketPriority,
  response: number, onSite: number, resolution: number, trigger: string,
): StdType => ({ key, name, prefix, priority, response, onSite, resolution, trigger });

export const STANDARD_CATALOG: StdCategory[] = [
  { key: 'FSM_INSTALLATION', name: 'Installation & Commissioning', description: 'New equipment installation, commissioning and handover.', types: [
    t('FSM_INSTALL_NEW_EQUIPMENT', 'New Equipment / Hardware Installation', 'INE', 'Medium', 4, 48, 120, 'Confirmed Sales Order / Project Milestone'),
    t('FSM_INSTALL_COMMISSIONING', 'System Commissioning & End-to-End Testing', 'ICT', 'Medium', 4, 24, 72, 'Completion of Physical Installation'),
    t('FSM_INSTALL_ACTIVATION', 'Service Activation & Customer Handover', 'IAH', 'Medium', 4, 24, 48, 'Commissioning Sign-Off'),
  ] },
  { key: 'FSM_EMERGENCY', name: 'Emergency/Urgent Maintenance', description: 'Outages, safety hazards and SLA-critical dispatch.', types: [
    t('FSM_EMERG_OUTAGE', 'Critical Outage / System Down Restoration', 'EOR', 'Critical', 0.25, 2, 4, 'Urgent Customer Call / Critical System Alarm'),
    t('FSM_EMERG_SAFETY', 'Safety Hazard / Leak Containment', 'ESH', 'Critical', 0.25, 1, 4, 'Safety Alert / Emergency Hotline'),
    t('FSM_EMERG_SLA_DISPATCH', 'SLA-Breach Imminent Dispatch', 'ESD', 'High', 1, 4, 8, 'SLA Escalation Timer / Priority Ticket'),
  ] },
  { key: 'FSM_PREVENTIVE', name: 'Preventive/Planned Maintenance', description: 'Scheduled, meter-based and seasonal servicing.', types: [
    t('FSM_PREV_ROUTINE', 'Routine Scheduled Servicing (Monthly/Quarterly/Annual)', 'PRS', 'Low', 24, 168, 336, 'Recurring Calendar Schedule'),
    t('FSM_PREV_METER', 'Usage / Meter-Based Servicing (e.g., Every 5,000 Hours)', 'PMB', 'Medium', 8, 72, 168, 'Asset Runtime / Meter Threshold Reached'),
    t('FSM_PREV_SEASONAL', 'Seasonal Startup / Shutdown', 'PSS', 'Medium', 8, 72, 168, 'Seasonal Maintenance Plan'),
  ] },
  { key: 'FSM_REACTIVE', name: 'Reactive/Corrective Maintenance', description: 'Break/fix repair, diagnostics and warranty replacement.', types: [
    t('FSM_REACT_BREAK_FIX', 'Break/Fix Component Repair', 'RBF', 'High', 1, 4, 24, 'Customer Support Ticket / Fault Report'),
    t('FSM_REACT_DIAGNOSTIC', 'On-Site Diagnostic & Fault Troubleshooting', 'RDT', 'Medium', 4, 24, 48, 'Unresolved Remote Support Case'),
    t('FSM_REACT_WARRANTY_RMA', 'Warranty / RMA Part Replacement', 'RWR', 'Medium', 4, 48, 72, 'Approved Warranty Claim'),
  ] },
  { key: 'FSM_PREDICTIVE', name: 'Predictive/IoT-Driven Maintenance', description: 'Condition-based work raised from telemetry and analytics.', types: [
    t('FSM_PRED_CONDITION', 'Condition-Based Part Replacement', 'DCR', 'High', 2, 8, 24, 'IoT Sensor Degradation / Threshold Alert'),
    t('FSM_PRED_TELEMETRY', 'Telemetry Anomaly Investigation', 'DTA', 'Medium', 4, 24, 48, 'AI / Predictive Analytics Warning'),
    t('FSM_PRED_ADJUSTMENT', 'Proactive Asset Adjustment', 'DPA', 'Low', 24, 120, 240, 'Automated Diagnostic Rule'),
  ] },
  { key: 'FSM_COMPLIANCE', name: 'Compliance Inspection/Audit', description: 'Statutory audits, QA and warranty verification.', types: [
    t('FSM_COMPL_STATUTORY', 'Statutory Safety & Regulatory Audit', 'CSR', 'High', 2, 24, 48, 'Legal / Regulatory Compliance Deadline'),
    t('FSM_COMPL_QA', 'Quality Assurance (QA) & Post-Work Audit', 'CQA', 'Low', 24, 168, 336, 'Random Sampling / Post-Install Rule'),
    t('FSM_COMPL_ASSET', 'Asset Condition & Warranty Verification', 'CAW', 'Low', 24, 168, 336, 'Contract Renewal / Warranty Check'),
  ] },
  { key: 'FSM_SITE_SURVEY', name: 'Site Survey/Assessment', description: 'Pre-installation surveys, readiness checks and scoping visits.', types: [
    t('FSM_SURVEY_PRE_INSTALL', 'Pre-Installation Technical Site Survey', 'SPI', 'Medium', 4, 48, 96, 'Pre-Sales Quote Request / Opportunity Stage'),
    t('FSM_SURVEY_FEASIBILITY', 'Feasibility & Network/Power Readiness Check', 'SFR', 'Medium', 4, 48, 96, 'Project Scoping Request'),
    t('FSM_SURVEY_ESTIMATE', 'On-Site Customer Estimate / Scoping Visit', 'SCE', 'Medium', 4, 48, 72, 'Inbound Sales Inquiry'),
  ] },
  { key: 'FSM_UPGRADE', name: 'Upgrade / Retrofit', description: 'Modernisation, patching and recall retrofits.', types: [
    t('FSM_UPG_MODERNIZATION', 'Hardware Modernization / Capacity Expansion', 'UHM', 'Low', 24, 168, 336, 'Approved Upgrade Sales Order / Campaign'),
    t('FSM_UPG_FIRMWARE', 'Field Firmware / Software Patching', 'UFP', 'Medium', 8, 72, 120, 'Vendor Security Bulletin / Release'),
    t('FSM_UPG_RECALL', 'Recall / Engineering Change Order (ECO) Retrofit', 'URE', 'High', 2, 24, 48, 'Manufacturer Recall Notice'),
  ] },
  { key: 'FSM_CALIBRATION', name: 'Calibration/Testing', description: 'Calibration, post-repair testing and certification.', types: [
    t('FSM_CAL_INSTRUMENT', 'Precision Instrument / Sensor Calibration', 'KIC', 'Medium', 8, 72, 120, 'Scheduled Calibration Interval'),
    t('FSM_CAL_POST_REPAIR', 'Post-Repair Performance & Load Testing', 'KPR', 'Medium', 4, 24, 48, 'Completion of Major Repair'),
    t('FSM_CAL_CERTIFICATION', 'Certification & Compliance Testing', 'KCT', 'High', 2, 24, 48, 'Industry Certification Expiry'),
  ] },
  { key: 'FSM_FOLLOW_UP', name: 'Follow-Up/Rework', description: 'Second visits, project continuation and rework.', types: [
    t('FSM_FOLLOW_BACKORDER', 'Backordered Part Installation (2nd Visit)', 'FBP', 'Medium', 4, 24, 48, 'Spare Part Arrival at Warehouse/Van'),
    t('FSM_FOLLOW_CONTINUATION', 'Multi-Day Project Continuation', 'FMC', 'Medium', 4, 24, 48, 'Prior Shift / Phase Completion'),
    t('FSM_FOLLOW_CALLBACK', 'Callback / First-Time-Fix Failure Rework', 'FCB', 'High', 1, 4, 24, 'Repeat Incident Within Warranty Window'),
  ] },
  { key: 'FSM_DECOMMISSION', name: 'Decommission/Removal', description: 'End-of-life shutdown, removal and secure disposal.', types: [
    t('FSM_DECOM_SHUTDOWN', 'End-of-Life Asset Shutdown & Disconnect', 'XSD', 'Low', 24, 168, 336, 'Asset Retirement / Contract Termination'),
    t('FSM_DECOM_UNINSTALL', 'Equipment Uninstallation & Haul-Away', 'XUH', 'Low', 24, 168, 336, 'Hardware Replacement / Site Closure'),
    t('FSM_DECOM_DATA_WIPE', 'Secure Data Wipe / Media Destruction', 'XDW', 'High', 2, 24, 48, 'Compliance / Security Decommission Policy'),
  ] },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** Validate the three timers. Each must be a positive number of hours. */
export function parseSla(input: unknown): CatalogSla {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const sla = { responseHours: num(o.responseHours), onSiteHours: num(o.onSiteHours), resolutionHours: num(o.resolutionHours) };
  for (const [label, v] of [['Response', sla.responseHours], ['On-site arrival', sla.onSiteHours], ['Resolution', sla.resolutionHours]] as const) {
    if (v === null || v <= 0) throw new CatalogError(`${label} time must be a positive number of hours.`);
    if (v > 8760) throw new CatalogError(`${label} time cannot exceed 8760 hours.`);
  }
  if (sla.resolutionHours! < sla.responseHours!) {
    throw new CatalogError('Resolution time cannot be shorter than the response time.');
  }
  return sla;
}

export function parsePriority(v: unknown): TicketPriority {
  const tier = PRIORITY_TIERS.find((p) => p.priority === v || p.tier === v || p.label === v);
  if (!tier) throw new CatalogError('Priority must be P1, P2, P3 or P4.');
  return tier.priority;
}

function cleanName(v: unknown, what: string): string {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (!s) throw new CatalogError(`${what} is required.`);
  if (s.length > 120) throw new CatalogError(`${what} must be 120 characters or fewer.`);
  return s;
}

function cleanText(v: unknown, max = 300): string | null {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return null;
  return s.slice(0, max);
}

function slugKey(prefix: string, name: string): string {
  const slug = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'ITEM';
  return `${prefix}${slug}`;
}

/** A key that no row (live or soft-deleted) in `table` uses yet. */
async function uniqueKey(tenantId: string, table: 'service_categories' | 'service_types', base: string): Promise<string> {
  const rows = await prisma.$queryRawUnsafe<Array<{ key: string }>>(
    `SELECT key FROM ${table} WHERE tenant_id = $1 AND key LIKE $2`,
    tenantId, `${base}%`,
  );
  const taken = new Set(rows.map((r) => r.key));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
  throw new CatalogError('Could not allocate a unique key.');
}

/** Ticket prefixes already used by any of the tenant's service types. */
async function usedPrefixes(tenantId: string): Promise<Set<string>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ prefix: string | null }>>(
    `SELECT DISTINCT r.rules->>'ticketPrefix' AS prefix
       FROM service_rules r
       JOIN service_types st ON st.id = r.service_type_id
      WHERE st.tenant_id = $1 AND r.category = 'ticketing'`,
    tenantId,
  ).catch(() => [] as Array<{ prefix: string | null }>);
  return new Set(rows.map((r) => (r.prefix ?? '').toUpperCase()).filter(Boolean));
}

/** A three-letter request prefix from the name that no other type uses. */
async function allocatePrefix(tenantId: string, name: string): Promise<string> {
  const used = await usedPrefixes(tenantId);
  const letters = name.toUpperCase().replace(/[^A-Z]/g, '');
  const words = name.toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  const candidates = [
    words.map((w) => w[0]).join('').slice(0, 3),
    letters.slice(0, 3),
    (letters[0] ?? 'X') + letters.slice(1).replace(/[AEIOU]/g, '').slice(0, 2),
  ].filter((c) => /^[A-Z]{3}$/.test(c));
  for (const c of candidates) if (!used.has(c)) return c;
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const first = letters[0] ?? 'X';
  for (const b of A) for (const c of A) {
    const p = `${first}${b}${c}`;
    if (!used.has(p)) return p;
  }
  throw new CatalogError('No request prefix is available.');
}

function ticketingRules(prefix: string, resolutionHours: number): TicketingRules {
  // Priority is fixed per type, so every tier carries the type's resolution SLA.
  const h = resolutionHours;
  return {
    ...DEFAULT_TICKETING_RULES,
    ticketPrefix: prefix,
    priorityMatrix: { Critical: h, High: h, Medium: h, Low: h },
    autoCreatesMaintenanceRequest: false,
  };
}

function slaRules(base: SlaRules, sla: CatalogSla): SlaRules {
  return {
    ...base,
    responseSlaMinutes: Math.round((sla.responseHours ?? 0) * 60),
    onSiteArrivalHours: sla.onSiteHours,
    resolutionSlaHours: sla.resolutionHours,
  };
}

async function activeRootRules<T>(typeId: string, category: 'sla' | 'ticketing', rootScopeId: string): Promise<T | null> {
  const hit = await loadRulesForChain<T>(typeId, category, [rootScopeId]);
  return hit?.rules ?? null;
}

async function getCategoryRow(tenantId: string, id: string) {
  const [row] = await prisma.$queryRawUnsafe<Array<{ id: string; key: string; name: string }>>(
    `SELECT id::text, key, name FROM service_categories
      WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL AND key LIKE '${CATALOG_CATEGORY_PREFIX}%'`,
    id, tenantId,
  ).catch(() => []);
  if (!row) throw new CatalogError('Service category not found.', 404);
  return row;
}

async function getTypeRow(tenantId: string, id: string) {
  const [row] = await prisma.$queryRawUnsafe<Array<{ id: string; key: string; name: string; category_id: string }>>(
    `SELECT st.id::text, st.key, st.name, st.category_id::text
       FROM service_types st
       JOIN service_categories c ON c.id = st.category_id AND c.tenant_id = st.tenant_id
      WHERE st.id = $1::uuid AND st.tenant_id = $2 AND st.deleted_at IS NULL
        AND c.deleted_at IS NULL AND c.key LIKE '${CATALOG_CATEGORY_PREFIX}%'`,
    id, tenantId,
  ).catch(() => []);
  if (!row) throw new CatalogError('Service type not found.', 404);
  return row;
}

// ── Read ───────────────────────────────────────────────────────────────────────

export async function listServiceCatalog(tenantId: string): Promise<CatalogCategory[]> {
  await ensureSeededForTenant(tenantId);
  const rootScopeId = await ensureRootScope(tenantId);

  const cats = await prisma.$queryRawUnsafe<Array<{ id: string; key: string; name: string; description: string | null; sort_order: number }>>(
    `SELECT id::text, key, name, description, sort_order
       FROM service_categories
      WHERE tenant_id = $1 AND deleted_at IS NULL AND key LIKE '${CATALOG_CATEGORY_PREFIX}%'
      ORDER BY sort_order, name`,
    tenantId,
  );
  if (cats.length === 0) return [];

  const types = await prisma.$queryRawUnsafe<Array<{
    id: string; key: string; name: string; category_id: string; default_priority: string;
    description: string | null; sort_order: number; sla: Record<string, unknown> | null; ticketing: Record<string, unknown> | null;
  }>>(
    `SELECT st.id::text, st.key, st.name, st.category_id::text, st.default_priority, st.description, st.sort_order,
            (SELECT r.rules FROM service_rules r
              WHERE r.service_type_id = st.id AND r.category = 'sla' AND r.scope_id = $2::uuid AND r.effective_to IS NULL
              ORDER BY r.effective_from DESC LIMIT 1) AS sla,
            (SELECT r.rules FROM service_rules r
              WHERE r.service_type_id = st.id AND r.category = 'ticketing' AND r.scope_id = $2::uuid AND r.effective_to IS NULL
              ORDER BY r.effective_from DESC LIMIT 1) AS ticketing
       FROM service_types st
      WHERE st.tenant_id = $1 AND st.deleted_at IS NULL
        AND st.category_id = ANY($3::uuid[])
      ORDER BY st.sort_order, st.name`,
    tenantId, rootScopeId, cats.map((c) => c.id),
  );

  const byCat = new Map<string, CatalogType[]>();
  for (const r of types) {
    const sla = r.sla ?? {};
    const responseMin = num(sla.responseSlaMinutes);
    const entry: CatalogType = {
      id: r.id, key: r.key, name: r.name, categoryId: r.category_id,
      priority: (PRIORITY_TIERS.find((p) => p.priority === r.default_priority)?.priority ?? 'Medium'),
      trigger: r.description, prefix: String(r.ticketing?.ticketPrefix ?? ''), sortOrder: r.sort_order ?? 0,
      sla: {
        responseHours: responseMin === null ? null : Math.round((responseMin / 60) * 100) / 100,
        onSiteHours: num(sla.onSiteArrivalHours),
        resolutionHours: num(sla.resolutionSlaHours),
      },
    };
    const list = byCat.get(r.category_id) ?? [];
    list.push(entry);
    byCat.set(r.category_id, list);
  }

  return cats.map((c) => ({
    id: c.id, key: c.key, name: c.name, description: c.description, sortOrder: c.sort_order ?? 0,
    types: byCat.get(c.id) ?? [],
  }));
}

/** SLA timers for one service type key, or null when it isn't a catalogue type. */
export async function catalogSlaForType(tenantId: string, typeKey: string): Promise<(CatalogSla & { categoryName: string }) | null> {
  const catalog = await listServiceCatalog(tenantId);
  for (const c of catalog) {
    const hit = c.types.find((x) => x.key === typeKey);
    if (hit) return { ...hit.sla, categoryName: c.name };
  }
  return null;
}

// ── Write: categories ──────────────────────────────────────────────────────────

export async function createCategory(tenantId: string, input: { name?: unknown; description?: unknown }): Promise<string> {
  await ensureSeededForTenant(tenantId);
  const name = cleanName(input.name, 'Category name');
  const key = await uniqueKey(tenantId, 'service_categories', slugKey(CATALOG_CATEGORY_PREFIX, name));
  const [{ next }] = await prisma.$queryRawUnsafe<Array<{ next: number }>>(
    `SELECT COALESCE(MAX(sort_order), 100) + 10 AS next FROM service_categories
      WHERE tenant_id = $1 AND key LIKE '${CATALOG_CATEGORY_PREFIX}%'`,
    tenantId,
  );
  const [row] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO service_categories (tenant_id, key, name, description, icon, tone, sort_order, is_system)
     VALUES ($1, $2, $3, $4, 'Wrench', 'violet', $5, FALSE) RETURNING id::text`,
    tenantId, key, name, cleanText(input.description), Number(next),
  );
  return row.id;
}

export async function updateCategory(tenantId: string, id: string, input: { name?: unknown; description?: unknown }): Promise<void> {
  await getCategoryRow(tenantId, id);
  const name = cleanName(input.name, 'Category name');
  await prisma.$executeRawUnsafe(
    `UPDATE service_categories SET name = $3, description = $4, updated_at = NOW()
      WHERE id = $1::uuid AND tenant_id = $2`,
    id, tenantId, name, cleanText(input.description),
  );
}

/** Soft-deletes the category and its service types. Existing requests keep their type. */
export async function deleteCategory(tenantId: string, id: string): Promise<{ name: string; typesRemoved: number }> {
  const row = await getCategoryRow(tenantId, id);
  // Interactive form: the project's prisma wrapper turns raw calls into plain
  // promises, which the array form of $transaction does not accept.
  const typesRemoved = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `UPDATE service_categories SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1::uuid AND tenant_id = $2`,
      id, tenantId,
    );
    return tx.$executeRawUnsafe(
      `UPDATE service_types SET deleted_at = NOW(), updated_at = NOW()
        WHERE category_id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
      id, tenantId,
    );
  });
  return { name: row.name, typesRemoved };
}

// ── Write: types ───────────────────────────────────────────────────────────────

interface TypeInput { categoryId?: unknown; name?: unknown; priority?: unknown; trigger?: unknown; sla?: unknown }

async function writeTypeRules(typeId: string, prefix: string, sla: CatalogSla, rootScopeId: string, by: string | null, seedOnly: boolean) {
  const baseSla = (await activeRootRules<SlaRules>(typeId, 'sla', rootScopeId)) ?? DEFAULT_SLA_RULES;
  const sl = slaRules({ ...DEFAULT_SLA_RULES, ...baseSla }, sla);
  const tk = ticketingRules(prefix, sla.resolutionHours!);
  if (seedOnly) {
    await seedRulesIfAbsent(typeId, 'sla', sl, rootScopeId);
    await seedRulesIfAbsent(typeId, 'ticketing', tk, rootScopeId);
    await seedRulesIfAbsent(typeId, 'approval', { ...DEFAULT_APPROVAL_RULES, approvalRequired: false, emergencyBypassEnabled: true }, rootScopeId);
    await seedRulesIfAbsent(typeId, 'vehicle', { ...DEFAULT_VEHICLE_RULES, vehicleRequired: false }, rootScopeId);
    await seedRulesIfAbsent(typeId, 'formFields', { fields: [...FM_LOCATION_FIELDS] }, rootScopeId);
    return;
  }
  const baseTk = (await activeRootRules<TicketingRules>(typeId, 'ticketing', rootScopeId)) ?? DEFAULT_TICKETING_RULES;
  await saveRules(typeId, 'sla', sl, by, rootScopeId);
  await saveRules(typeId, 'ticketing', { ...DEFAULT_TICKETING_RULES, ...baseTk, ...tk, ticketPrefix: baseTk.ticketPrefix || prefix }, by, rootScopeId);
}

async function insertMapping(typeId: string) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO service_module_mapping
       (service_type_id, linked_module, sub_module,
        workflow_engine_enabled, notification_engine_enabled, approval_engine_enabled,
        finance_engine_enabled, dispatch_engine_enabled)
     VALUES ($1::uuid, 'SERVICE_TICKETING', 'Field Service', TRUE, TRUE, FALSE, FALSE, FALSE)
     ON CONFLICT (service_type_id) DO NOTHING`,
    typeId,
  );
}

export async function createType(tenantId: string, input: TypeInput, by: string | null): Promise<string> {
  const category = await getCategoryRow(tenantId, String(input.categoryId ?? ''));
  const name = cleanName(input.name, 'Service type name');
  const priority = parsePriority(input.priority);
  const sla = parseSla(input.sla);
  const rootScopeId = await ensureRootScope(tenantId);
  const key = await uniqueKey(tenantId, 'service_types', slugKey(CATALOG_CATEGORY_PREFIX, name));
  const prefix = await allocatePrefix(tenantId, name);
  const [{ next }] = await prisma.$queryRawUnsafe<Array<{ next: number }>>(
    `SELECT COALESCE(MAX(sort_order), 0) + 10 AS next FROM service_types WHERE tenant_id = $1 AND category_id = $2::uuid`,
    tenantId, category.id,
  );
  const [row] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `INSERT INTO service_types
       (tenant_id, category_id, key, name, description, icon, tone, default_priority, sort_order, is_system)
     VALUES ($1, $2::uuid, $3, $4, $5, 'Wrench', 'violet', $6, $7, FALSE) RETURNING id::text`,
    tenantId, category.id, key, name, cleanText(input.trigger), priority, Number(next),
  );
  await insertMapping(row.id);
  await writeTypeRules(row.id, prefix, sla, rootScopeId, by, true);
  return row.id;
}

export async function updateType(tenantId: string, id: string, input: TypeInput, by: string | null): Promise<void> {
  const existing = await getTypeRow(tenantId, id);
  const name = cleanName(input.name, 'Service type name');
  const priority = parsePriority(input.priority);
  const sla = parseSla(input.sla);
  const categoryId = input.categoryId ? (await getCategoryRow(tenantId, String(input.categoryId))).id : existing.category_id;
  const rootScopeId = await ensureRootScope(tenantId);
  await prisma.$executeRawUnsafe(
    `UPDATE service_types
        SET name = $3, description = $4, default_priority = $5, category_id = $6::uuid, updated_at = NOW()
      WHERE id = $1::uuid AND tenant_id = $2`,
    id, tenantId, name, cleanText(input.trigger), priority, categoryId,
  );
  const tk = await activeRootRules<TicketingRules>(id, 'ticketing', rootScopeId);
  const prefix = tk?.ticketPrefix || await allocatePrefix(tenantId, name);
  await writeTypeRules(id, prefix, sla, rootScopeId, by, false);
}

/** Soft delete. Existing requests of this type are untouched. */
export async function deleteType(tenantId: string, id: string): Promise<string> {
  const row = await getTypeRow(tenantId, id);
  await prisma.$executeRawUnsafe(
    `UPDATE service_types SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1::uuid AND tenant_id = $2`,
    id, tenantId,
  );
  return row.name;
}

// ── Standard catalogue install ─────────────────────────────────────────────────

/**
 * Installs the standard FSM catalogue and archives the earlier Facilities
 * catalogue (its categories and types are soft-deleted; tickets keep their
 * type). Idempotent: existing rows are left as the tenant edited them, and a
 * type the tenant deleted stays deleted.
 */
export async function installStandardCatalog(tenantId: string): Promise<{ categoriesAdded: number; typesAdded: number; facilitiesArchived: number }> {
  await ensureSeededForTenant(tenantId);
  const rootScopeId = await ensureRootScope(tenantId);
  let categoriesAdded = 0;
  let typesAdded = 0;

  for (const [ci, cat] of STANDARD_CATALOG.entries()) {
    categoriesAdded += await prisma.$executeRawUnsafe(
      `INSERT INTO service_categories (tenant_id, key, name, description, icon, tone, sort_order, is_system)
       VALUES ($1, $2, $3, $4, 'Wrench', 'violet', $5, FALSE)
       ON CONFLICT (tenant_id, key) DO NOTHING`,
      tenantId, cat.key, cat.name, cat.description, 110 + ci * 10,
    );
    const [category] = await prisma.$queryRawUnsafe<Array<{ id: string; deleted: boolean }>>(
      `SELECT id::text, deleted_at IS NOT NULL AS deleted FROM service_categories WHERE tenant_id = $1 AND key = $2`,
      tenantId, cat.key,
    );
    if (!category || category.deleted) continue;

    for (const [ti, st] of cat.types.entries()) {
      const added = await prisma.$executeRawUnsafe(
        `INSERT INTO service_types
           (tenant_id, category_id, key, name, description, icon, tone, default_priority, sort_order, is_system)
         VALUES ($1, $2::uuid, $3, $4, $5, 'Wrench', 'violet', $6, $7, FALSE)
         ON CONFLICT (tenant_id, key) DO NOTHING`,
        tenantId, category.id, st.key, st.name, st.trigger, st.priority, (ti + 1) * 10,
      );
      typesAdded += added;
      const [type] = await prisma.$queryRawUnsafe<Array<{ id: string; deleted: boolean }>>(
        `SELECT id::text, deleted_at IS NOT NULL AS deleted FROM service_types WHERE tenant_id = $1 AND key = $2`,
        tenantId, st.key,
      );
      if (!type || type.deleted) continue;
      await insertMapping(type.id);
      await writeTypeRules(type.id, st.prefix,
        { responseHours: st.response, onSiteHours: st.onSite, resolutionHours: st.resolution },
        rootScopeId, null, true);
    }
  }

  // Replace the Facilities catalogue: archive its categories and types.
  const fmCategoryKeys = FACILITIES_CATALOGUE.map((c) => c.key);
  const facilitiesArchived = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `UPDATE service_categories SET deleted_at = NOW(), updated_at = NOW()
        WHERE tenant_id = $1 AND key = ANY($2::text[]) AND deleted_at IS NULL`,
      tenantId, fmCategoryKeys,
    );
    return tx.$executeRawUnsafe(
      `UPDATE service_types st SET deleted_at = NOW(), updated_at = NOW()
         FROM service_categories c
        WHERE st.category_id = c.id AND c.tenant_id = $1 AND st.tenant_id = $1
          AND c.key = ANY($2::text[]) AND st.deleted_at IS NULL`,
      tenantId, fmCategoryKeys,
    );
  });

  return { categoriesAdded, typesAdded, facilitiesArchived };
}
