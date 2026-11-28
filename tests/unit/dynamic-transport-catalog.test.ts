/**
 * Dynamic Transport Catalogue Builder tests:
 *  - Per-field defaultValue overrides (including on core fields)
 *  - Tenant custom sections and custom fields inside built-in & custom sections
 *  - Dynamic SERVICE_MODULE_MAP resolution & custom category codes
 *  - Dual-portal adapter (SERVICE_CARDS, SCHEMAS, default value merging)
 */
import { describe, it, expect } from 'vitest';
import {
  allFields,
  applyOverrides,
  cleanCustomFormConfig,
  cleanDefaultValue,
  cleanOverrides,
  cleanSelectOptions,
  extractDefaultValues,
  sameOptionsList,
  slugifyFieldKey,
  slugifySectionKey,
  validateRequestValues,
  type CustomFormConfig,
} from '@/lib/transport-catalog/form-schema';
import {
  CATEGORY_DEFINITIONS,
  buildBlankCustomForm,
  cloneTemplateToCustomForm,
} from '@/lib/transport-catalog/default-forms';
import {
  categoryLabel,
  isValidCategoryCode,
  normalizeCategoryCode,
  parseTenantCategories,
} from '@/lib/customer-portal/catalog';
import {
  SERVICE_MODULE_MAP,
  resolveBookingServiceType,
  resolveCatalogCategory,
  resolveRequiredModule,
} from '@/lib/booking-portal/service-module-map';
import {
  buildDynamicServiceCards,
  mergeCatalogDefaults,
  resolveDynamicBookingSchema,
  type BookingCatalogCategory,
  type BookingSectionDef,
} from '@/lib/booking-portal/catalog-adapter';

const RAC = CATEGORY_DEFINITIONS.RAC.form;
const LOGISTICS = CATEGORY_DEFINITIONS.LOGISTICS.form;

describe('custom category codes & dynamic SERVICE_MODULE_MAP', () => {
  it('normalizes and validates custom category codes', () => {
    expect(normalizeCategoryCode('VIP Airport Concierge')).toBe('VIP_AIRPORT_CONCIERGE');
    expect(normalizeCategoryCode('123 Medical-Courier!!')).toBe('MEDICAL_COURIER');
    expect(isValidCategoryCode('VIP_AIRPORT_CONCIERGE')).toBe(true);
    expect(isValidCategoryCode('RAC')).toBe(true);
    expect(isValidCategoryCode('bad-code')).toBe(false);
    expect(isValidCategoryCode('')).toBe(false);
  });

  it('parses built-in and custom category lists in deterministic order', () => {
    expect(parseTenantCategories(['VIP_CONCIERGE', 'LOGISTICS', 'RAC', 'VIP_CONCIERGE']))
      .toEqual(['RAC', 'LOGISTICS', 'VIP_CONCIERGE']);
    expect(parseTenantCategories(['RAC', 'invalid-code'])).toBeNull();
    expect(categoryLabel('VIP_CONCIERGE')).toBe('Vip Concierge');
    expect(categoryLabel('VIP_CONCIERGE', { VIP_CONCIERGE: 'VIP Concierge' })).toBe('VIP Concierge');
  });

  it('bridges RENTAL <-> RAC and supports dynamic module overrides', () => {
    expect(resolveCatalogCategory('RENTAL')).toBe('RAC');
    expect(resolveBookingServiceType('RAC')).toBe('RENTAL');
    expect(resolveRequiredModule('RAC', null)).toBe(SERVICE_MODULE_MAP.RENTAL);
    expect(resolveRequiredModule('RAC', '')).toBeNull(); // Explicitly unlocked for all staff
    expect(resolveRequiredModule('VIP_CONCIERGE', 'dispatch')).toBe('dispatch');
    expect(resolveRequiredModule('VIP_CONCIERGE', null)).toBeNull();
  });
});

describe('defaultValue overrides & custom sections/fields', () => {
  it('validates default values strictly by field type and select options', () => {
    expect(cleanDefaultValue({ type: 'select', options: ['Economy', 'SUV'] }, 'SUV')).toEqual({ ok: true, value: 'SUV' });
    expect(cleanDefaultValue({ type: 'select', options: ['Economy', 'SUV'] }, 'Helicopter')).toEqual({ ok: false });
    expect(cleanDefaultValue({ type: 'number' }, '42')).toEqual({ ok: true, value: 42 });
    expect(cleanDefaultValue({ type: 'number' }, -5)).toEqual({ ok: false });
    expect(cleanDefaultValue({ type: 'toggle' }, true)).toEqual({ ok: true, value: true });
    expect(cleanDefaultValue({ type: 'email' }, 'Ops@Company.AE')).toEqual({ ok: true, value: 'ops@company.ae' });
    expect(cleanDefaultValue({ type: 'email' }, 'not-an-email')).toEqual({ ok: false });
    expect(cleanDefaultValue({ type: 'time' }, '08:30')).toEqual({ ok: true, value: '08:30' });
    expect(cleanDefaultValue({ type: 'time' }, '25:99')).toEqual({ ok: false });
  });

  it('allows defaultValue on core fields while still locking hidden/required on core fields', () => {
    const cleaned = cleanOverrides(RAC, {
      origin: { hidden: true, required: false, defaultValue: 'Dubai Airport Terminal 3' },
      vehicleCategory: { defaultValue: 'SUV' },
      phone: { required: true, defaultValue: '+971 50 111 2222' },
    });
    expect(cleaned).toEqual({
      origin: { defaultValue: 'Dubai Airport Terminal 3' },
      vehicleCategory: { defaultValue: 'SUV' },
      phone: { required: true, defaultValue: '+971 50 111 2222' },
    });

    const effective = applyOverrides(RAC, cleaned);
    const defaults = extractDefaultValues(effective);
    expect(defaults).toMatchObject({
      origin: 'Dubai Airport Terminal 3',
      vehicleCategory: 'SUV',
      phone: '+971 50 111 2222',
    });
    const byKey = new Map(allFields(effective).map((f) => [f.key, f]));
    expect(byKey.get('origin')?.required).toBe(true);
  });

  it('validates and merges custom sections and custom fields into built-in and new sections', () => {
    const rawCustom: CustomFormConfig = {
      sections: [{ key: slugifySectionKey('Project Billing'), title: 'Project Billing' }],
      fields: [
        {
          sectionKey: 'cargo',
          key: slugifyFieldKey('Gate Pass Number'),
          label: 'Gate Pass Number',
          type: 'text',
          required: true,
          defaultValue: 'GP-DXB-01',
          custom: true,
        },
        {
          sectionKey: 'project_billing',
          key: 'billingTier',
          label: 'Billing Tier',
          type: 'select',
          options: ['Standard', 'Priority SLA'],
          defaultValue: 'Priority SLA',
          required: true,
          custom: true,
        },
      ],
    };

    const cleaned = cleanCustomFormConfig(LOGISTICS, rawCustom);
    expect(cleaned).not.toBeNull();
    expect(cleaned?.sections).toHaveLength(1);
    expect(cleaned?.fields).toHaveLength(2);

    const effective = applyOverrides(LOGISTICS, {}, cleaned);
    const cargoSec = effective.sections.find((s) => s.key === 'cargo');
    expect(cargoSec?.fields.some((f) => f.key === 'gatePassNumber' && f.custom === true)).toBe(true);
    const customSec = effective.sections.find((s) => s.key === 'project_billing');
    expect(customSec?.fields.some((f) => f.key === 'billingTier' && f.defaultValue === 'Priority SLA')).toBe(true);

    expect(extractDefaultValues(effective)).toMatchObject({
      gatePassNumber: 'GP-DXB-01',
      billingTier: 'Priority SLA',
    });

    // Server validation enforces required custom fields
    const missingCustom = validateRequestValues(effective, {
      companyName: 'Gulf', requestorName: 'Ali', requestorEmail: 'ali@gulf.ae',
      shipmentType: 'FTL – Full Truck Load', origin: 'Jebel Ali', destination: 'Abu Dhabi',
      startDate: '2026-12-01', cargoType: 'General Goods', cargo: 'Pallets',
    });
    expect(missingCustom.ok).toBe(false);
    expect(missingCustom.errors).toHaveProperty('gatePassNumber');
    expect(missingCustom.errors).toHaveProperty('billingTier');
  });

  it('rejects colliding custom field keys or unknown section keys', () => {
    expect(cleanCustomFormConfig(RAC, {
      fields: [{ sectionKey: 'location', key: 'origin', label: 'Duplicate', type: 'text', custom: true }],
    })).toBeNull();
    expect(cleanCustomFormConfig(RAC, {
      fields: [{ sectionKey: 'nonexistent', key: 'myField', label: 'Bad Section', type: 'text', custom: true }],
    })).toBeNull();
    expect(cleanCustomFormConfig(RAC, {
      fields: [{ sectionKey: 'location', key: 'badSelect', label: 'No Options', type: 'select', options: [], custom: true }],
    })).toBeNull();
  });
});

describe('dual-portal Booking Portal adapter', () => {
  const baseCards = [
    { type: 'RENTAL', title: 'Rent-a-Car', desc: 'Short term', icon: '🚗', gradient: 'from-emerald-600 to-teal-700', badge: 'RENTAL', accent: 'emerald' },
    { type: 'LEASING', title: 'Vehicle Leasing', desc: 'Long term', icon: '📋', gradient: 'from-blue-600 to-indigo-700', badge: 'LEASING', accent: 'blue' },
    { type: 'LOGISTICS', title: 'Logistics Trip', desc: 'Freight', icon: '🚛', gradient: 'from-orange-600 to-amber-700', badge: 'LOGISTICS', accent: 'orange' },
  ];

  const customCat: BookingCatalogCategory = {
    category: 'VIP_CONCIERGE',
    bookingServiceType: 'VIP_CONCIERGE',
    isCustom: true,
    title: 'VIP Airport Concierge',
    description: 'Meet & greet with tarmac transfer',
    icon: '✈️',
    badge: 'CONCIERGE',
    accent: 'violet',
    moduleKey: null,
    customModuleKey: '',
    enabled: true,
    bookingPortalEnabled: true,
    approvalRequired: true,
    fieldOverrides: {},
    customFormConfig: { baseTemplate: 'BLANK' },
    effectiveForm: buildBlankCustomForm(),
    defaultValues: { origin: 'DXB Terminal 3 VIP Lounge' },
  };

  it('filters categories per tenant and appends custom categories respecting dynamic module gates', () => {
    const racCat: BookingCatalogCategory = {
      ...customCat,
      category: 'RAC',
      bookingServiceType: 'RENTAL',
      isCustom: false,
      title: 'Corporate Car Rental',
      moduleKey: 'rental',
      customModuleKey: null,
      bookingPortalEnabled: true,
      effectiveForm: RAC,
      defaultValues: {},
    };
    const leasingOff: BookingCatalogCategory = {
      ...racCat,
      category: 'LEASING',
      bookingServiceType: 'LEASING',
      bookingPortalEnabled: false,
    };
    const logisticsLocked: BookingCatalogCategory = {
      ...racCat,
      category: 'LOGISTICS',
      bookingServiceType: 'LOGISTICS',
      moduleKey: 'logistics',
      bookingPortalEnabled: true,
    };

    const cards = buildDynamicServiceCards(
      baseCards,
      [racCat, leasingOff, logisticsLocked, customCat],
      (mod) => mod === 'rental', // tenant only subscribes to rental (not logistics)
      true,
    );

    expect(cards.map((c) => c.type)).toEqual(['RENTAL', 'VIP_CONCIERGE']);
    expect(cards[0].title).toBe('Corporate Car Rental');
    expect(cards[1].isCustom).toBe(true);
    expect(cards[1].icon).toBe('✈️');
  });

  it('injects custom fields into built-in sections, hides overridden fields, and merges defaults', () => {
    const builtInSections: BookingSectionDef[] = [
      {
        title: 'Cargo, Packaging & Dimensions',
        icon: '📦',
        fields: [
          { key: 'cargoType', label: 'Cargo Category', type: 'select', required: true, options: ['General Goods'] },
          { key: 'cargoValueAed', label: 'Declared Cargo Value', type: 'number' },
        ],
      },
    ];
    const logCat: BookingCatalogCategory = {
      ...customCat,
      category: 'LOGISTICS',
      bookingServiceType: 'LOGISTICS',
      isCustom: false,
      fieldOverrides: { cargoValueAed: { hidden: true } },
      customFormConfig: {
        sections: [{ key: 'custom_dock', title: 'Dock Clearance' }],
        fields: [
          { sectionKey: 'cargo', key: 'sealNo', label: 'Container Seal No.', type: 'text', required: true, defaultValue: 'SEAL-001', custom: true },
          { sectionKey: 'custom_dock', key: 'dockBay', label: 'Dock Bay', type: 'text', defaultValue: 'Bay 4', custom: true },
        ],
      },
      effectiveForm: LOGISTICS,
      defaultValues: { sealNo: 'SEAL-001', dockBay: 'Bay 4' },
    };

    const resolved = resolveDynamicBookingSchema('LOGISTICS', builtInSections, logCat);
    expect(resolved).toHaveLength(2);
    expect(resolved[0].fields.map((f) => f.key)).toEqual(['cargoType', 'sealNo']);
    expect(resolved[1].title).toBe('Dock Clearance');
    expect(resolved[1].fields[0].key).toBe('dockBay');

    const defaults = mergeCatalogDefaults('RENTAL', { renterAccountType: 'PERSONAL', costCenter: '' }, {
      ...customCat,
      defaultValues: { renterAccountType: 'Corporate Account (B2B)', origin: 'Jebel Ali Branch' },
    });
    expect(defaults.renterAccountType).toBe('CORPORATE');
    expect(defaults.origin).toBe('Jebel Ali Branch');
    expect(defaults.costCenter).toBe('CC-OPS-3003');
  });

  it('clones built-in template forms cleanly for new custom categories', () => {
    const cloned = cloneTemplateToCustomForm('EXECUTIVE');
    expect(cloned.sections.length).toBe(CATEGORY_DEFINITIONS.EXECUTIVE.form.sections.length);
    expect(allFields(cloned).some((f) => f.key === 'tripType')).toBe(true);
  });

  it('supports adding, editing, reordering, and validating custom dropdown options on built-in select fields', () => {
    expect(cleanSelectOptions(['  Apple Pay ', 'Corporate Account', 'Apple Pay', ''])).toEqual([
      'Apple Pay',
      'Corporate Account',
    ]);
    expect(cleanSelectOptions([])).toBeNull();
    expect(cleanSelectOptions(['x'.repeat(81)])).toBeNull();
    expect(sameOptionsList(['A', 'B'], ['A', 'B'])).toBe(true);
    expect(sameOptionsList(['A', 'B'], ['B', 'A'])).toBe(false);

    const racPaymentField = allFields(RAC).find((f) => f.key === 'paymentMethod');
    expect(racPaymentField?.type).toBe('select');
    const builtInOpts = racPaymentField?.options ?? [];
    const extendedOpts = [...builtInOpts, 'Apple Pay', 'PO Invoice'];

    // Accepts custom options AND setting one of the brand-new options as defaultValue in the same save
    const cleaned = cleanOverrides(RAC, {
      paymentMethod: {
        options: extendedOpts,
        defaultValue: 'Apple Pay',
      },
    });
    expect(cleaned).toEqual({
      paymentMethod: {
        options: extendedOpts,
        defaultValue: 'Apple Pay',
      },
    });

    // Omits redundant options override when identical to built-in options
    const identical = cleanOverrides(RAC, {
      paymentMethod: { options: [...builtInOpts] },
    });
    expect(identical).toEqual({});

    // Rejects options override on non-select fields or empty options
    expect(cleanOverrides(RAC, { costCenter: { options: ['A', 'B'] } })).toBeNull();
    expect(cleanOverrides(RAC, { paymentMethod: { options: [] } })).toBeNull();

    // Applies custom options to effectiveForm and validates newly added value cleanly
    const effective = applyOverrides(RAC, cleaned);
    const effPayment = allFields(effective).find((f) => f.key === 'paymentMethod');
    expect(effPayment?.options).toEqual(extendedOpts);
    expect(effPayment?.defaultValue).toBe('Apple Pay');

    const validCheck = validateRequestValues(effective, {
      origin: 'DXB Terminal 3',
      neededFrom: '2026-12-01',
      paymentMethod: 'Apple Pay',
      requestorName: 'Aisha',
    });
    expect(validCheck.errors.paymentMethod).toBeUndefined();
    expect(validCheck.values.paymentMethod).toBe('Apple Pay');

    // Clears stale defaultValue if the removed option was previously selected
    const narrowed = applyOverrides(RAC, {
      paymentMethod: { options: ['PO Invoice'], defaultValue: 'PO Invoice' },
    });
    const narrowedField = allFields(narrowed).find((f) => f.key === 'paymentMethod');
    expect(narrowedField?.options).toEqual(['PO Invoice']);
    const removedOldCheck = validateRequestValues(narrowed, {
      origin: 'DXB',
      neededFrom: '2026-12-01',
      paymentMethod: builtInOpts[0],
    });
    expect(removedOldCheck.errors.paymentMethod).toBeDefined();
  });

  it('propagates custom select options overrides into Internal Booking Portal built-in schemas', () => {
    const builtInSections: BookingSectionDef[] = [
      {
        title: 'Cargo, Packaging & Dimensions',
        icon: '📦',
        fields: [
          { key: 'cargoType', label: 'Cargo Category', type: 'select', required: true, options: ['General Goods'] },
        ],
      },
    ];
    const logCat: BookingCatalogCategory = {
      ...customCat,
      category: 'LOGISTICS',
      bookingServiceType: 'LOGISTICS',
      isCustom: false,
      fieldOverrides: {
        cargoType: { options: ['General Goods', 'Pharma Cold Chain', 'High-Value Electronics'] },
      },
      customFormConfig: {},
      effectiveForm: LOGISTICS,
      defaultValues: {},
    };

    const resolved = resolveDynamicBookingSchema('LOGISTICS', builtInSections, logCat);
    expect(resolved[0].fields[0].options).toEqual([
      'General Goods',
      'Pharma Cold Chain',
      'High-Value Electronics',
    ]);
  });
});
