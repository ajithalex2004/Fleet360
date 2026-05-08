/**
 * Types for the Service Configuration Engine (Phase 2A).
 *
 * Two-level hierarchy:
 *   ServiceCategory  (L1, e.g. "Operation Support Services")
 *     └── ServiceType (L2, e.g. "Maintenance Request", "Towing & Recovery")
 *
 * Each ServiceType maps to exactly one LinkedModule (the module that owns
 * its lifecycle) plus a set of engine toggles describing which sub-engines
 * apply (workflow, notification, approval, finance, dispatch).
 *
 * 2A is the foundation. Per-type SLA / Approval / Vehicle / Trip / Finance
 * / Ticketing / EPOD / Automation rule tabs are layered on in 2B.
 */

/** Modules that can own a service type's lifecycle. Mirrors the keys
 *  used by /admin/workflows and prisma.tenantModule. */
export const LINKED_MODULES = [
  'SERVICE_TICKETING',
  'MAINTENANCE',
  'BOOKING',
  'LEASING',
  'RAC',
  'STAFF_TRANSPORT',
  'SCHOOL_BUS',
  'LOGISTICS',
  'INCIDENT',
  'FINANCE',
  'ADMIN',
] as const;
export type LinkedModule = typeof LINKED_MODULES[number];

export const LINKED_MODULE_LABEL: Record<LinkedModule, string> = {
  SERVICE_TICKETING: 'Service & Support Ticketing',
  MAINTENANCE:       'Vehicle Maintenance',
  BOOKING:           'Booking & Dispatch',
  LEASING:           'Vehicle Leasing',
  RAC:               'Rent-a-Car',
  STAFF_TRANSPORT:   'Staff Transport',
  SCHOOL_BUS:        'School Bus',
  LOGISTICS:         'Logistics',
  INCIDENT:          'Incident / Ambulance',
  FINANCE:           'Finance',
  ADMIN:             'Platform Admin',
};

/** Tone keys reused across the platform's accent system. */
export const SERVICE_TONES = [
  'gold', 'blue', 'emerald', 'amber', 'rose', 'slate', 'violet', 'cyan',
] as const;
export type ServiceTone = typeof SERVICE_TONES[number];

export interface ServiceCategory {
  id: string;
  tenantId: string;
  /** Stable key for code lookups (e.g. 'OPERATION_SUPPORT'). */
  key: string;
  name: string;
  description: string | null;
  icon: string | null;
  tone: ServiceTone;
  sortOrder: number;
  /** True when seeded by the platform — guards against accidental delete. */
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export type DefaultPriority = 'Low' | 'Medium' | 'High';

export interface ServiceType {
  id: string;
  tenantId: string;
  categoryId: string;
  /** Stable key (e.g. 'MAINTENANCE', 'TOWING'). */
  key: string;
  name: string;
  description: string | null;
  icon: string | null;
  tone: ServiceTone;
  defaultPriority: DefaultPriority;
  sortOrder: number;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Module Dependency Mapping for a single service type. One row per type. */
export interface ServiceModuleMapping {
  serviceTypeId: string;
  linkedModule: LinkedModule;
  /** Optional sub-module label (free text — e.g. "Service Tickets"). */
  subModule: string | null;
  /** Engine toggles — which sub-engines apply to this service. */
  workflowEngineEnabled: boolean;
  notificationEngineEnabled: boolean;
  approvalEngineEnabled: boolean;
  financeEngineEnabled: boolean;
  dispatchEngineEnabled: boolean;
  updatedAt: string;
}

/** Convenience: a category with its types, used by the admin tree. */
export interface ServiceCategoryWithTypes extends ServiceCategory {
  types: ServiceType[];
}

// ─── Multi-tenant scope hierarchy (Phase 2E) ────────────────────────────────
//
// Service config is organised as a tree of scopes per tenant. Every tenant
// has exactly one root scope (level=COMPANY, isRoot=true) auto-created on
// first read. Admins can carve out branches / regions / departments and
// override rules at any level. When a resolver looks up a rule for a
// scope, it walks the parent_scope_id chain until it finds a configured
// row, so a Branch sees its own override or — failing that — its Region's,
// then Company's, then Tenant Root's.
//
// The level enum is descriptive (a hierarchy hint) — the actual chain is
// driven by parent_scope_id.

export const SCOPE_LEVELS = ['COMPANY', 'BRANCH', 'REGION', 'DEPARTMENT'] as const;
export type ScopeLevel = typeof SCOPE_LEVELS[number];

export const SCOPE_LEVEL_LABEL: Record<ScopeLevel, string> = {
  COMPANY:    'Company',
  BRANCH:     'Branch',
  REGION:     'Region',
  DEPARTMENT: 'Department',
};

export interface ServiceScope {
  id: string;
  tenantId: string;
  parentScopeId: string | null;
  level: ScopeLevel;
  /** Stable code (e.g. "DXB_OPS"). */
  key: string;
  name: string;
  description: string | null;
  sortOrder: number;
  /** True for the synthesized tenant-root scope. Cannot be deleted. */
  isRoot: boolean;
  createdAt: string;
  updatedAt: string;
}

