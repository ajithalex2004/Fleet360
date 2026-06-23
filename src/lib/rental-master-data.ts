import { prisma } from '@/lib/prisma';

export interface RentalMasterOption {
  value: string;
  label: string;
}

export interface RentalEmirate {
  key: string;
  label: string;
  flag: string;
}

export interface RentalAncillaryPreset {
  code: string;
  nameEn: string;
  nameAr: string;
  category: string;
  pricingType: 'PER_DAY' | 'ONE_TIME';
  unitPrice: number;
}

export interface RentalRateEventPreset {
  eventCode: string;
  name: string;
  multiplier: number;
}

export interface RentalMasterCatalog {
  vehicleCategories: string[];
  availabilityVehicleCategories: string[];
  bookingChannels: string[];
  inquirySources: string[];
  staffRoles: string[];
  staffModules: string[];
  emirates: RentalEmirate[];
  insurers: string[];
  policyTypes: string[];
  fuelLabels: string[];
  rateVehicleCategories: RentalMasterOption[];
  customerTypes: string[];
  rateChannels: string[];
  currencies: string[];
  rateEventPresets: RentalRateEventPreset[];
  ancillaryPresets: RentalAncillaryPreset[];
}

export const DEFAULT_RENTAL_MASTER_DATA: RentalMasterCatalog = {
  vehicleCategories: ['Economy', 'Sedan', 'SUV', 'Luxury', 'Van', 'Bus'],
  availabilityVehicleCategories: ['', 'Economy', 'Sedan', 'SUV', 'Luxury', 'Van', 'Minibus', 'Truck'],
  bookingChannels: ['DIRECT', 'CORPORATE', 'AGENCY', 'ONLINE'],
  inquirySources: ['WALK_IN', 'PHONE', 'WEBSITE', 'WHATSAPP', 'REFERRAL'],
  staffRoles: ['BRANCH_MANAGER', 'RENTAL_AGENT', 'COORDINATOR', 'DRIVER', 'ADMIN'],
  staffModules: ['RENTAL', 'BOTH'],
  emirates: [
    { key: 'DUBAI', label: 'Dubai', flag: '🏙️' },
    { key: 'ABU_DHABI', label: 'Abu Dhabi', flag: '🏛️' },
    { key: 'SHARJAH', label: 'Sharjah', flag: '🕌' },
    { key: 'AJMAN', label: 'Ajman', flag: '⛵' },
    { key: 'RAS_AL_KHAIMAH', label: 'Ras Al Khaimah', flag: '⛰️' },
    { key: 'FUJAIRAH', label: 'Fujairah', flag: '🌊' },
    { key: 'UMM_AL_QUWAIN', label: 'Umm Al Quwain', flag: '🌿' },
  ],
  insurers: ['AXA', 'OMAN INSURANCE', 'RSA', 'ORIENT', 'DUBAI INSURANCE', 'OTHER'],
  policyTypes: ['COMPREHENSIVE', 'THIRD_PARTY', 'TPL'],
  fuelLabels: ['Empty', '1/8', '1/4', '3/8', 'Half', '5/8', '3/4', '7/8', 'Full'],
  rateVehicleCategories: [
    { value: 'ECONOMY', label: 'Economy' },
    { value: 'COMPACT', label: 'Compact' },
    { value: 'MID_SIZE', label: 'Mid-size' },
    { value: 'FULL_SIZE', label: 'Full-size' },
    { value: 'COMPACT_SUV', label: 'SUV - Compact' },
    { value: 'MID_SIZE_SUV', label: 'SUV - Mid-size' },
    { value: 'FULL_SIZE_SUV', label: 'SUV - Full-size' },
    { value: 'LUXURY', label: 'Luxury' },
    { value: 'PREMIUM', label: 'Premium' },
    { value: 'SPORTS', label: 'Sports' },
    { value: 'VAN', label: 'Van / People Mover' },
    { value: 'PICKUP', label: 'Pickup / Commercial' },
    { value: 'BUS', label: 'Bus' },
    { value: 'SPECIAL', label: 'Special / Heavy' },
  ],
  customerTypes: ['INDIVIDUAL', 'CORPORATE', 'AIRLINE', 'FREQUENT_FLYER', 'INSURANCE', 'GOVERNMENT'],
  rateChannels: ['DIRECT', 'CORPORATE', 'AGENCY', 'ONLINE'],
  currencies: ['AED', 'USD', 'EUR', 'GBP', 'SAR', 'QAR', 'KWD', 'BHD', 'OMR'],
  rateEventPresets: [
    { eventCode: 'DSF', name: 'Dubai Shopping Festival', multiplier: 1.2 },
    { eventCode: 'EID_FITR', name: 'Eid Al-Fitr', multiplier: 1.3 },
    { eventCode: 'EID_ADHA', name: 'Eid Al-Adha', multiplier: 1.3 },
    { eventCode: 'NYE', name: 'New Year holiday', multiplier: 1.4 },
    { eventCode: 'F1', name: 'Abu Dhabi Grand Prix', multiplier: 1.45 },
    { eventCode: 'NATIONAL_DAY', name: 'UAE National Day', multiplier: 1.25 },
    { eventCode: 'SUMMER_LOW', name: 'Summer low-demand period', multiplier: 0.85 },
    { eventCode: 'GITEX', name: 'GITEX Tech Week', multiplier: 1.3 },
  ],
  ancillaryPresets: [
    { code: 'GPS', nameEn: 'GPS / SatNav', nameAr: 'نظام ملاحة GPS', category: 'ACCESSORY', pricingType: 'PER_DAY', unitPrice: 25 },
    { code: 'CHILD_SEAT', nameEn: 'Child seat (4-7 yrs)', nameAr: 'مقعد أطفال', category: 'ACCESSORY', pricingType: 'PER_DAY', unitPrice: 30 },
    { code: 'BOOSTER_SEAT', nameEn: 'Booster seat (7-12 yrs)', nameAr: 'مقعد مرتفع', category: 'ACCESSORY', pricingType: 'PER_DAY', unitPrice: 25 },
    { code: 'ADDITIONAL_DRIVER', nameEn: 'Additional driver', nameAr: 'سائق إضافي', category: 'DRIVER', pricingType: 'PER_DAY', unitPrice: 50 },
    { code: 'YOUNG_DRIVER', nameEn: 'Young driver surcharge', nameAr: 'رسم سائق صغير السن', category: 'DRIVER', pricingType: 'PER_DAY', unitPrice: 70 },
    { code: 'CROSS_BORDER_OMAN', nameEn: 'Cross-border permit - Oman', nameAr: 'تصريح عبور - عُمان', category: 'PERMIT', pricingType: 'ONE_TIME', unitPrice: 200 },
    { code: 'CROSS_BORDER_SAUDI', nameEn: 'Cross-border permit - Saudi', nameAr: 'تصريح عبور - السعودية', category: 'PERMIT', pricingType: 'ONE_TIME', unitPrice: 350 },
    { code: 'CROSS_BORDER_QATAR', nameEn: 'Cross-border permit - Qatar', nameAr: 'تصريح عبور - قطر', category: 'PERMIT', pricingType: 'ONE_TIME', unitPrice: 350 },
    { code: 'SALIK_TAG', nameEn: 'Salik tag rental', nameAr: 'إيجار جهاز سالك', category: 'ACCESSORY', pricingType: 'PER_DAY', unitPrice: 15 },
    { code: 'AIRPORT_FEE', nameEn: 'Airport pickup / drop fee', nameAr: 'رسم الاستلام من المطار', category: 'OTHER', pricingType: 'ONE_TIME', unitPrice: 75 },
    { code: 'DELIVERY_PICKUP', nameEn: 'Delivery / pickup (per leg)', nameAr: 'توصيل واستلام', category: 'OTHER', pricingType: 'ONE_TIME', unitPrice: 150 },
    { code: 'EXTRA_KM_PACK', nameEn: 'Extra km pack (200/day)', nameAr: 'حزمة كيلومترات إضافية', category: 'OTHER', pricingType: 'PER_DAY', unitPrice: 50 },
    { code: 'FUEL_PRE_PAID', nameEn: 'Pre-paid full tank', nameAr: 'وقود مدفوع مسبقاً', category: 'FUEL', pricingType: 'ONE_TIME', unitPrice: 300 },
    { code: 'WIFI_HOTSPOT', nameEn: 'Wi-Fi hotspot', nameAr: 'نقطة واي فاي', category: 'ACCESSORY', pricingType: 'PER_DAY', unitPrice: 35 },
    { code: 'CDW', nameEn: 'Collision Damage Waiver', nameAr: 'تنازل عن أضرار التصادم', category: 'INSURANCE', pricingType: 'PER_DAY', unitPrice: 40 },
    { code: 'LDW', nameEn: 'Loss Damage Waiver', nameAr: 'تنازل عن خسارة الأضرار', category: 'INSURANCE', pricingType: 'PER_DAY', unitPrice: 55 },
    { code: 'SUPER_CDW', nameEn: 'Super CDW (zero excess)', nameAr: 'تنازل شامل', category: 'INSURANCE', pricingType: 'PER_DAY', unitPrice: 110 },
    { code: 'PAI', nameEn: 'Personal Accident Insurance', nameAr: 'تأمين الحوادث الشخصية', category: 'INSURANCE', pricingType: 'PER_DAY', unitPrice: 25 },
  ],
};

let ensured = false;
let ensurePromise: Promise<void> | null = null;

function normalizeCatalog(input: unknown): Partial<RentalMasterCatalog> {
  if (!input || typeof input !== 'object') return {};
  const raw = input as Record<string, unknown>;
  const out: Partial<RentalMasterCatalog> = {};
  for (const key of Object.keys(DEFAULT_RENTAL_MASTER_DATA) as Array<keyof RentalMasterCatalog>) {
    const value = raw[key];
    if (value !== undefined) {
      out[key] = value as never;
    }
  }
  return out;
}

export function mergeRentalMasterData(
  base: RentalMasterCatalog,
  override?: Partial<RentalMasterCatalog> | null,
): RentalMasterCatalog {
  if (!override) return { ...base };
  return {
    ...base,
    ...Object.fromEntries(
      Object.entries(override).filter(([, value]) => value !== undefined && value !== null),
    ),
  } as RentalMasterCatalog;
}

export async function ensureRentalMasterDataStorage() {
  if (ensured) return;
  if (ensurePromise) {
    await ensurePromise;
    return;
  }

  ensurePromise = (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS platform_settings (
        key         TEXT PRIMARY KEY,
        value       TEXT NOT NULL DEFAULT '',
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE tenant_settings
      ADD COLUMN IF NOT EXISTS rental_master_overrides JSONB NOT NULL DEFAULT '{}'::jsonb
    `).catch(() => {});

    await prisma.$executeRawUnsafe(
      `INSERT INTO platform_settings (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO NOTHING`,
      'rental_master_defaults',
      JSON.stringify(DEFAULT_RENTAL_MASTER_DATA),
    );
  })();

  try {
    await ensurePromise;
    ensured = true;
  } finally {
    ensurePromise = null;
  }
}

export async function loadPlatformRentalMasterData(): Promise<RentalMasterCatalog> {
  await ensureRentalMasterDataStorage();
  const rows = await prisma.$queryRawUnsafe<Array<{ value: string }>>(
    `SELECT value FROM platform_settings WHERE key = 'rental_master_defaults' LIMIT 1`,
  ).catch(() => []);
  let parsed: Partial<RentalMasterCatalog> = {};
  if (rows[0]?.value) {
    try {
      parsed = normalizeCatalog(JSON.parse(rows[0].value));
    } catch {
      parsed = {};
    }
  }
  return mergeRentalMasterData(DEFAULT_RENTAL_MASTER_DATA, parsed);
}

export async function loadTenantRentalMasterData(tenantId: string): Promise<Partial<RentalMasterCatalog>> {
  await ensureRentalMasterDataStorage();
  const rows = await prisma.$queryRawUnsafe<Array<{ rental_master_overrides: unknown }>>(
    `SELECT rental_master_overrides
       FROM tenant_settings
      WHERE tenant_id::text = $1
      LIMIT 1`,
    tenantId,
  ).catch(() => []);
  return normalizeCatalog(rows[0]?.rental_master_overrides);
}

export async function loadResolvedRentalMasterData(tenantId: string): Promise<RentalMasterCatalog> {
  const [platform, tenant] = await Promise.all([
    loadPlatformRentalMasterData(),
    loadTenantRentalMasterData(tenantId),
  ]);
  return mergeRentalMasterData(platform, tenant);
}

export async function savePlatformRentalMasterData(input: Partial<RentalMasterCatalog>) {
  const current = await loadPlatformRentalMasterData();
  const next = mergeRentalMasterData(current, normalizeCatalog(input));
  await prisma.$executeRawUnsafe(
    `INSERT INTO platform_settings (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    'rental_master_defaults',
    JSON.stringify(next),
  );
  return next;
}

export async function saveTenantRentalMasterData(tenantId: string, input: Partial<RentalMasterCatalog>) {
  await ensureRentalMasterDataStorage();
  const current = await loadTenantRentalMasterData(tenantId);
  const override = {
    ...current,
    ...normalizeCatalog(input),
  };
  await prisma.$executeRawUnsafe(
    `INSERT INTO tenant_settings (tenant_id, rental_master_overrides, created_at, updated_at)
     VALUES ($1, $2::jsonb, NOW(), NOW())
     ON CONFLICT (tenant_id) DO UPDATE
       SET rental_master_overrides = $2::jsonb,
           updated_at = NOW()`,
    tenantId,
    JSON.stringify(override),
  );
  return override;
}
