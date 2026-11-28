/**
 * Bridges the Tenant Transport Services Catalogue (`/api/booking-portal/catalog`)
 * with the Internal Booking Portal's `SERVICE_CARDS`, `SCHEMAS`, and
 * `SERVICE_MODULE_MAP` so categories, custom sections/fields, field overrides,
 * and default values configured in `/customer-mgmt/transport-catalog` apply
 * dynamically to both portals.
 *
 * Browser-safe: no Node imports.
 */

import {
  SERVICE_MODULE_MAP,
  accentStyle,
  resolveBookingServiceType,
  resolveCatalogCategory,
  resolveRequiredModule,
  type CategoryAccent,
} from './service-module-map';
import {
  isVisible,
  type CustomFormConfig,
  type FieldOverrides,
  type RequestFieldDef,
  type RequestFormDef,
  type RequestValues,
} from '@/lib/transport-catalog/form-schema';

/** Subset of TenantCategory returned by GET /api/booking-portal/catalog. */
export interface BookingCatalogCategory {
  category: string;
  bookingServiceType: string;
  isCustom: boolean;
  title: string;
  description: string;
  icon: string;
  badge: string;
  accent: CategoryAccent;
  moduleKey: string | null;
  customModuleKey: string | null;
  enabled: boolean;
  bookingPortalEnabled: boolean;
  approvalRequired: boolean;
  fieldOverrides: FieldOverrides;
  customFormConfig: CustomFormConfig;
  effectiveForm: RequestFormDef;
  defaultValues: RequestValues;
}

export interface DynamicServiceCard {
  type: string;
  title: string;
  desc: string;
  icon: string;
  gradient: string;
  badge: string;
  badgeColor: string;
  accent: string;
  href: string;
  isCustom?: boolean;
  moduleKey: string | null;
}

export interface BookingFieldDef {
  key: string;
  label: string;
  type: 'text' | 'email' | 'tel' | 'number' | 'date' | 'time' | 'select' | 'textarea' | 'toggle';
  placeholder?: string;
  required?: boolean;
  hint?: string;
  options?: string[];
  half?: boolean;
  unit?: string;
  showIf?: (form: Record<string, string | boolean | number>) => boolean;
}

export interface BookingSectionDef {
  key?: string;
  title: string;
  icon: string;
  fields: BookingFieldDef[];
}

/**
 * Maps Customer Portal built-in section keys (from default-forms.ts) to the
 * matching Internal Booking Portal section index/title pattern so a custom
 * field added to e.g. `cargo` or `student` lands in the exact right section.
 */
const SECTION_KEY_TO_TITLE_HINT: Record<string, string[]> = {
  account:      ['rental period', 'account', 'billing'],
  requestor:    ['driver', 'employee', 'booker', 'contact', 'requestor'],
  vehicle:      ['vehicle', 'protection', 'fleet'],
  period:       ['period', 'schedule', 'term'],
  location:     ['location', 'route', 'itinerary', 'residence'],
  company:      ['company', 'procurement'],
  fleet:        ['fleet', 'vehicle'],
  lease:        ['lease', 'term', 'inclusion'],
  route:        ['route', 'shift', 'schedule'],
  commute:      ['shift', 'commute', 'route'],
  preferences:  ['preference', 'accessibility'],
  trip:         ['trip', 'itinerary', 'schedule'],
  flight:       ['flight', 'protocol', 'meet'],
  protocol:     ['protocol', 'meet', 'flight'],
  shipper:      ['shipper', 'consignee', 'company'],
  freight:      ['freight', 'route', 'dock'],
  cargo:        ['cargo', 'packaging', 'hazmat'],
  compliance:   ['hazmat', 'dangerous', 'accessorial', 'customs'],
  parent:       ['parent', 'guardian'],
  student:      ['student', 'school'],
  pickup:       ['residence', 'pickup', 'authorized'],
  medical:      ['medical', 'safety', 'consent'],
  notes:        ['notes', 'special', 'preferences', 'medical', 'inclusion', 'accessorial'],
};

function matchesSectionKey(sectionTitle: string, sectionKey: string, sectionExplicitKey?: string): boolean {
  if (sectionExplicitKey && sectionExplicitKey === sectionKey) return true;
  const lower = sectionTitle.toLowerCase();
  const hints = SECTION_KEY_TO_TITLE_HINT[sectionKey];
  if (hints?.some((h) => lower.includes(h))) return true;
  return lower.includes(sectionKey.replace(/_/g, ' '));
}

function toBookingField(f: RequestFieldDef): BookingFieldDef {
  return {
    key: f.key,
    label: f.label,
    type: f.type,
    placeholder: f.placeholder,
    required: f.required,
    hint: f.hint,
    options: f.options,
    half: f.half,
    unit: f.unit,
    showIf: f.showIf ? (form) => isVisible(f, form as RequestValues) : undefined,
  };
}

/**
 * Resolves the visible `SERVICE_CARDS` for the Internal Booking Portal:
 *  - Honors tenant `bookingPortalEnabled` toggles (so tenants can hide unused categories)
 *  - Honors dynamic `moduleKey` overrides (`SERVICE_MODULE_MAP`) against `hasModule`
 *  - Reflects tenant title/description/icon/badge/accent updates
 *  - Appends enabled extra built-ins (`LIMOUSINE`, `RECOVERY`) and tenant custom categories
 */
export function buildDynamicServiceCards(
  baseCards: ReadonlyArray<{
    type: string;
    title: string;
    desc: string;
    icon: string;
    gradient: string;
    badge: string;
    accent?: string;
    badgeColor?: string;
    href?: string;
  }>,
  catalog: BookingCatalogCategory[] | null,
  hasModule: (mod: string) => boolean,
  hasTenantModuleRestrictions: boolean,
): DynamicServiceCard[] {
  const catalogByBookingType = new Map<string, BookingCatalogCategory>();
  for (const c of catalog ?? []) {
    catalogByBookingType.set(c.bookingServiceType || resolveBookingServiceType(c.category), c);
  }

  const out: DynamicServiceCard[] = [];
  const seen = new Set<string>();

  for (const base of baseCards) {
    const cat = catalogByBookingType.get(base.type);
    if (cat && !cat.bookingPortalEnabled) continue;

    const requiredModule = cat
      ? resolveRequiredModule(cat.category, cat.customModuleKey)
      : (SERVICE_MODULE_MAP[base.type] ?? null);

    if (hasTenantModuleRestrictions && requiredModule && !hasModule(requiredModule)) {
      continue;
    }

    const style = accentStyle(cat?.accent ?? base.accent);
    seen.add(base.type);
    out.push({
      type: base.type,
      title: cat?.title || base.title,
      desc: cat?.description || base.desc,
      icon: cat?.icon || base.icon,
      gradient: cat ? style.gradient : base.gradient,
      badge: cat?.badge || base.badge,
      badgeColor: base.badgeColor || style.badgeColor,
      accent: cat?.accent || base.accent || 'blue',
      href: base.href || `/booking-portal/new?type=${encodeURIComponent(base.type)}`,
      isCustom: false,
      moduleKey: requiredModule,
    });
  }

  // Append any additional enabled categories from the catalogue (LIMOUSINE, RECOVERY, or Custom)
  for (const cat of catalog ?? []) {
    const bType = cat.bookingServiceType || resolveBookingServiceType(cat.category);
    if (seen.has(bType)) continue;
    if (!cat.bookingPortalEnabled) continue;

    const requiredModule = resolveRequiredModule(cat.category, cat.customModuleKey);
    if (hasTenantModuleRestrictions && requiredModule && !hasModule(requiredModule)) {
      continue;
    }

    const style = accentStyle(cat.accent);
    seen.add(bType);
    out.push({
      type: bType,
      title: cat.title,
      desc: cat.description,
      icon: cat.icon,
      gradient: style.gradient,
      badge: cat.badge,
      badgeColor: style.badgeColor,
      accent: cat.accent,
      href: `/booking-portal/new?type=${encodeURIComponent(bType)}`,
      isCustom: cat.isCustom,
      moduleKey: requiredModule,
    });
  }

  return out;
}

/**
 * Merges tenant catalogue overrides, custom sections, and custom fields onto
 * an Internal Booking Portal `SCHEMAS[serviceType]` (for built-in 6 domains)
 * OR converts `cat.effectiveForm` directly (for custom categories, LIMOUSINE,
 * and RECOVERY).
 */
export function resolveDynamicBookingSchema(
  serviceType: string,
  baseSchema: BookingSectionDef[] | undefined,
  catalogCat: BookingCatalogCategory | undefined,
): BookingSectionDef[] {
  // Custom categories (or LIMOUSINE / RECOVERY): render straight from effectiveForm
  if (!baseSchema) {
    if (!catalogCat) return [];
    return catalogCat.effectiveForm.sections.map((sec) => ({
      key: sec.key,
      title: sec.title,
      icon: sec.icon || '📋',
      fields: sec.fields.map(toBookingField),
    }));
  }

  if (!catalogCat) return baseSchema;

  const overrides = catalogCat.fieldOverrides ?? {};
  const customCfg = catalogCat.customFormConfig ?? {};

  // 1. Apply hide/required overrides to built-in sections
  const sections: BookingSectionDef[] = baseSchema.map((sec) => ({
    ...sec,
    fields: sec.fields
      .filter((f) => !overrides[f.key]?.hidden)
      .map((f) => {
        const ov = overrides[f.key];
        if (!ov || ov.required === undefined) return f;
        return { ...f, required: ov.required };
      }),
  }));

  // 2. Append tenant-defined custom sections
  const customSectionsByKey = new Map<string, BookingSectionDef>();
  for (const cs of customCfg.sections ?? []) {
    const added: BookingSectionDef = {
      key: cs.key,
      title: cs.title,
      icon: cs.icon || '✨',
      fields: [],
    };
    sections.push(added);
    customSectionsByKey.set(cs.key, added);
  }

  // 3. Inject custom fields into matching built-in or custom sections
  const existingKeys = new Set(sections.flatMap((s) => s.fields.map((f) => f.key)));
  let fallbackSection: BookingSectionDef | null = null;

  for (const cf of customCfg.fields ?? []) {
    if (existingKeys.has(cf.key)) continue;
    if (overrides[cf.key]?.hidden) continue;

    const fieldDef = toBookingField({
      ...cf,
      ...(overrides[cf.key]?.required !== undefined ? { required: overrides[cf.key]!.required } : {}),
    });
    existingKeys.add(cf.key);

    const customTarget = customSectionsByKey.get(cf.sectionKey);
    if (customTarget) {
      customTarget.fields.push(fieldDef);
      continue;
    }

    const matchedBuiltIn = sections.find((s) => !customSectionsByKey.has(s.key ?? '') && matchesSectionKey(s.title, cf.sectionKey, s.key));
    if (matchedBuiltIn) {
      matchedBuiltIn.fields.push(fieldDef);
      continue;
    }

    if (!fallbackSection) {
      fallbackSection = { key: 'additional_custom', title: 'Additional Details', icon: '✨', fields: [] };
      sections.push(fallbackSection);
    }
    fallbackSection.fields.push(fieldDef);
  }

  return sections.filter((s) => s.fields.length > 0);
}

/**
 * Merges tenant-configured default field values on top of static service defaults
 * for the Internal Booking Portal.
 */
export function mergeCatalogDefaults(
  serviceType: string,
  baseDefaults: Record<string, string | boolean | number>,
  catalogCat: BookingCatalogCategory | undefined,
): Record<string, string | boolean | number> {
  if (!catalogCat || !catalogCat.defaultValues || Object.keys(catalogCat.defaultValues).length === 0) {
    return baseDefaults;
  }

  const merged: Record<string, string | boolean | number> = { ...baseDefaults };
  for (const [key, val] of Object.entries(catalogCat.defaultValues)) {
    if (val === undefined || val === '') continue;
    // Translate Customer Portal RAC renterAccountType labels to Internal Booking Portal tokens
    if (serviceType === 'RENTAL' && key === 'renterAccountType' && typeof val === 'string') {
      if (val.toLowerCase().includes('corporate')) {
        merged.renterAccountType = 'CORPORATE';
        merged.billingMethod = 'CORPORATE_ACCOUNT';
        if (!merged.costCenter) merged.costCenter = 'CC-OPS-3003';
        continue;
      }
      if (val.toLowerCase().includes('personal')) {
        merged.renterAccountType = 'PERSONAL';
        merged.billingMethod = 'PERSONAL_CARD_AT_COUNTER';
        merged.costCenter = '';
        continue;
      }
    }
    merged[key] = val;
  }
  return merged;
}

/** Lookup helper finding a catalogue category by Booking Portal serviceType (e.g. RENTAL → RAC). */
export function findCatalogCategoryForBookingType(
  catalog: BookingCatalogCategory[] | null | undefined,
  serviceType: string,
): BookingCatalogCategory | undefined {
  if (!catalog?.length || !serviceType) return undefined;
  const catalogCode = resolveCatalogCategory(serviceType);
  return catalog.find(
    (c) => c.bookingServiceType === serviceType || c.category === catalogCode || c.category === serviceType
  );
}
