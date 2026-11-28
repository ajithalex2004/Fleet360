/**
 * Maps a booking serviceType to its owning module route segment, and bridges
 * Internal Booking Portal service types (`RENTAL`, `LEASING`, …) with
 * Transport Services Catalogue categories (`RAC`, `LEASING`, … + custom codes).
 *
 * Split out of page.tsx so both portals, APIs, and unit tests can import it.
 */
export const SERVICE_MODULE_MAP: Record<string, string> = {
  RENTAL:          'rental',
  LEASING:         'leasing',
  STAFF_TRANSPORT: 'bus-ops',
  EXECUTIVE:       'dispatch',
  LOGISTICS:       'logistics',
  SCHOOL_BUS:      'school-bus',
  LIMOUSINE:       'dispatch',
  RECOVERY:        'dispatch',
};

/** Built-in Booking Portal service types enabled by default when no tenant override exists. */
export const DEFAULT_BOOKING_PORTAL_CATEGORIES = new Set<string>([
  'RAC', 'LEASING', 'STAFF_TRANSPORT', 'EXECUTIVE', 'LOGISTICS', 'SCHOOL_BUS',
]);

export const BOOKING_TO_CATALOG_CATEGORY: Record<string, string> = {
  RENTAL:          'RAC',
  LEASING:         'LEASING',
  STAFF_TRANSPORT: 'STAFF_TRANSPORT',
  EXECUTIVE:       'EXECUTIVE',
  LOGISTICS:       'LOGISTICS',
  SCHOOL_BUS:      'SCHOOL_BUS',
  LIMOUSINE:       'LIMOUSINE',
  RECOVERY:        'RECOVERY',
};

export const CATALOG_TO_BOOKING_SERVICE: Record<string, string> = {
  RAC:             'RENTAL',
  LEASING:         'LEASING',
  STAFF_TRANSPORT: 'STAFF_TRANSPORT',
  EXECUTIVE:       'EXECUTIVE',
  LOGISTICS:       'LOGISTICS',
  SCHOOL_BUS:      'SCHOOL_BUS',
  LIMOUSINE:       'LIMOUSINE',
  RECOVERY:        'RECOVERY',
};

/** Selectable modules for dynamic SERVICE_MODULE_MAP assignment in the Catalogue Builder. */
export const LINKABLE_MODULES: ReadonlyArray<{ key: string; label: string }> = [
  { key: '',           label: 'All Staff (No module restriction)' },
  { key: 'rental',     label: 'Rent-a-Car (rental)' },
  { key: 'leasing',    label: 'Vehicle Leasing (leasing)' },
  { key: 'bus-ops',    label: 'Staff Transport / Bus Ops (bus-ops)' },
  { key: 'dispatch',   label: 'Dispatch / Chauffeur (dispatch)' },
  { key: 'logistics',  label: 'Logistics & Freight (logistics)' },
  { key: 'school-bus', label: 'School Bus (school-bus)' },
];

export const VALID_MODULE_KEYS = new Set<string>(LINKABLE_MODULES.map((m) => m.key).filter(Boolean));

/** Convert a Booking Portal serviceType (e.g. RENTAL) to its Transport Catalogue code (e.g. RAC). */
export function resolveCatalogCategory(serviceType: string): string {
  const upper = String(serviceType || '').trim().toUpperCase();
  return BOOKING_TO_CATALOG_CATEGORY[upper] ?? upper;
}

/** Convert a Transport Catalogue code (e.g. RAC) to its Booking Portal serviceType (e.g. RENTAL). */
export function resolveBookingServiceType(category: string): string {
  const upper = String(category || '').trim().toUpperCase();
  return CATALOG_TO_BOOKING_SERVICE[upper] ?? upper;
}

/**
 * Resolve the required tenant module for a category/serviceType.
 * - `customModuleKey === ''` explicitly unlocks the category for all staff (no module gate).
 * - `customModuleKey` non-empty overrides `SERVICE_MODULE_MAP`.
 * - `customModuleKey === null | undefined` falls back to `SERVICE_MODULE_MAP`.
 */
export function resolveRequiredModule(categoryOrServiceType: string, customModuleKey?: string | null): string | null {
  if (customModuleKey === '') return null;
  if (typeof customModuleKey === 'string' && customModuleKey.trim().length > 0) {
    return customModuleKey.trim();
  }
  const bookingType = resolveBookingServiceType(categoryOrServiceType);
  return SERVICE_MODULE_MAP[bookingType] ?? null;
}

export type CategoryAccent = 'emerald' | 'blue' | 'purple' | 'amber' | 'orange' | 'yellow' | 'cyan' | 'rose' | 'violet';

export const CATEGORY_ACCENTS: ReadonlyArray<{ key: CategoryAccent; label: string; gradient: string; badgeColor: string }> = [
  { key: 'emerald', label: 'Emerald', gradient: 'from-emerald-600 to-teal-700',   badgeColor: 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400' },
  { key: 'blue',    label: 'Blue',    gradient: 'from-blue-600 to-indigo-700',    badgeColor: 'bg-blue-500/20 border-blue-500/30 text-blue-400' },
  { key: 'purple',  label: 'Purple',  gradient: 'from-purple-600 to-violet-700',  badgeColor: 'bg-purple-500/20 border-purple-500/30 text-purple-400' },
  { key: 'amber',   label: 'Amber',   gradient: 'from-amber-600 to-yellow-700',   badgeColor: 'bg-amber-500/20 border-amber-500/30 text-amber-400' },
  { key: 'orange',  label: 'Orange',  gradient: 'from-orange-600 to-amber-700',   badgeColor: 'bg-orange-500/20 border-orange-500/30 text-orange-400' },
  { key: 'yellow',  label: 'Yellow',  gradient: 'from-yellow-500 to-amber-600',   badgeColor: 'bg-yellow-500/20 border-yellow-500/30 text-yellow-400' },
  { key: 'cyan',    label: 'Cyan',    gradient: 'from-cyan-600 to-sky-700',       badgeColor: 'bg-cyan-500/20 border-cyan-500/30 text-cyan-400' },
  { key: 'violet',  label: 'Violet',  gradient: 'from-violet-600 to-fuchsia-700', badgeColor: 'bg-violet-500/20 border-violet-500/30 text-violet-400' },
  { key: 'rose',    label: 'Rose',    gradient: 'from-rose-600 to-pink-700',      badgeColor: 'bg-rose-500/20 border-rose-500/30 text-rose-400' },
];

export function accentStyle(accent?: string | null) {
  return CATEGORY_ACCENTS.find((a) => a.key === accent) ?? CATEGORY_ACCENTS[1];
}
