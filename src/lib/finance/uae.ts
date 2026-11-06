/**
 * UAE company-identity helpers shared by the Company Profile screen and the
 * Peppol e-invoice generator. Pure functions: safe in the browser and on the
 * server.
 */

export const EMIRATES = ['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah'] as const;

export type Emirate = (typeof EMIRATES)[number];

/**
 * ISO 3166-2:AE Country Subdivision codes required by UAE PINT AE (PEPPOL)
 * for <cbc:CountrySubentity>.
 */
export const EMIRATE_ISO_CODES: Record<Emirate, string> = {
  'Abu Dhabi': 'AE-AZ',
  'Dubai': 'AE-DU',
  'Sharjah': 'AE-SH',
  'Ajman': 'AE-AJ',
  'Umm Al Quwain': 'AE-UQ',
  'Ras Al Khaimah': 'AE-RK',
  'Fujairah': 'AE-FU',
};

export const UAE_EMIRATES = [
  { code: 'AE-AZ', nameEn: 'Abu Dhabi', nameAr: 'أبوظبي' },
  { code: 'AE-AJ', nameEn: 'Ajman', nameAr: 'عجمان' },
  { code: 'AE-DU', nameEn: 'Dubai', nameAr: 'دبي' },
  { code: 'AE-FU', nameEn: 'Fujairah', nameAr: 'الفجيرة' },
  { code: 'AE-RK', nameEn: 'Ras Al Khaimah', nameAr: 'رأس الخيمة' },
  { code: 'AE-SH', nameEn: 'Sharjah', nameAr: 'الشارقة' },
  { code: 'AE-UQ', nameEn: 'Umm Al Quwain', nameAr: 'أم القيوين' },
] as const;

export type EmirateIsoCode = (typeof EMIRATE_ISO_CODES)[Emirate];

/**
 * Official PEPPOL Participant / Electronic Address Scheme ID for UAE Tax Registration Numbers
 * (MoF / FTA e-Invoicing Data Dictionary — PINT AE).
 */
export const UAE_PEPPOL_SCHEME_ID = '0235';

export const UAE_TRADE_LICENSE_AUTHORITIES = [
  'DED Dubai',
  'ADDED Abu Dhabi',
  'SEDD Sharjah',
  'DED Ajman',
  'DED Umm Al Quwain',
  'DED Ras Al Khaimah',
  'Fujairah Municipality',
  'JAFZA',
  'DMCC',
  'DIFC',
  'ADGM',
  'DAFZA',
  'RAKEZ',
  'SAIF Zone',
  'KIZAD / KEZAD',
] as const;

export const PEPPOL_ASP_PROVIDERS = [
  'SANDBOX',
  'PAGERO',
  'AVALARA',
  'SOVOS',
  'BASWARE',
  'CLEARTAX',
  'TRADESHIFT',
  'CUSTOM_AS4',
] as const;

/** TRN with spaces and dashes removed. */
export function normalizeTrn(trn: string | null | undefined): string {
  return (trn ?? '').replace(/[-\s]/g, '');
}
export const normalizeUaeTrn = normalizeTrn;

/** FTA Tax Registration Number: 15 digits starting with 100. */
export function isValidTrn(trn: string | null | undefined): boolean {
  return /^100\d{12}$/.test(normalizeTrn(trn));
}

export function validateUaeTrn(trn: string | null | undefined): { valid: boolean; error?: string } {
  const norm = normalizeTrn(trn);
  if (!norm) return { valid: true };
  if (!/^\d{15}$/.test(norm)) {
    return { valid: false, error: 'UAE VAT TRN must be exactly 15 digits.' };
  }
  if (!norm.startsWith('100')) {
    return { valid: false, error: 'UAE VAT TRN must start with 100.' };
  }
  return { valid: true };
}

/**
 * UAE Corporate Tax Registration Number (CT TRN): 9 to 15 digits issued by FTA
 * under Federal Decree-Law No. 47 of 2022.
 */
export function isValidCorporateTaxTrn(ctTrn: string | null | undefined): boolean {
  return /^\d{9,15}$/.test(normalizeTrn(ctTrn));
}

export function validateUaeCorporateTaxTrn(ctTrn: string | null | undefined): { valid: boolean; error?: string } {
  const norm = normalizeTrn(ctTrn);
  if (!norm) return { valid: true };
  if (!/^\d{9,15}$/.test(norm)) {
    return { valid: false, error: 'UAE Corporate Tax TRN must be 9 to 15 digits.' };
  }
  return { valid: true };
}

/**
 * Validates a UAE IBAN (AE + 2 check digits + 3-digit bank code + 16-digit account number = 23 chars).
 */
export function isValidUaeIban(iban: string | null | undefined): boolean {
  if (!iban) return false;
  const cleaned = iban.replace(/\s+/g, '').toUpperCase();
  return /^AE\d{21}$/.test(cleaned);
}

/** The emirate named in a free-text address, if any. */
export function emirateOf(address: string | null | undefined): string | undefined {
  const s = (address ?? '').toLowerCase();
  return EMIRATES.find(e => s.includes(e.toLowerCase()));
}

/**
 * Normalizes an emirate name, free-text address, or code (e.g. 'Dubai', 'DUBAI', 'ABU_DHABI', 'AE-DU')
 * into its ISO 3166-2:AE subdivision code (e.g. 'AE-DU').
 */
export function toEmirateIsoCode(input?: string | null, fallback: EmirateIsoCode = 'AE-DU'): EmirateIsoCode {
  if (!input) return fallback;
  const raw = input.trim();
  const upper = raw.toUpperCase();
  if (/^AE-(AZ|DU|SH|AJ|UQ|RK|FU)$/.test(upper)) {
    return upper as EmirateIsoCode;
  }
  const normalized = upper.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (normalized.includes('ABU DHABI') || normalized === 'AZ') return 'AE-AZ';
  if (normalized.includes('DUBAI') || normalized === 'DU' || normalized === 'DXB') return 'AE-DU';
  if (normalized.includes('SHARJAH') || normalized === 'SH' || normalized === 'SHJ') return 'AE-SH';
  if (normalized.includes('AJMAN') || normalized === 'AJ' || normalized === 'AJM') return 'AE-AJ';
  if (normalized.includes('UMM AL QUWAIN') || normalized.includes('UAQ') || normalized === 'UQ') return 'AE-UQ';
  if (normalized.includes('RAS AL KHAIMAH') || normalized.includes('RAK') || normalized === 'RK') return 'AE-RK';
  if (normalized.includes('FUJAIRAH') || normalized === 'FU' || normalized === 'FUJ') return 'AE-FU';
  return fallback;
}

/**
 * Resolves an ISO 3166-2:AE code or emirate string to the canonical Emirate display name.
 */
export function fromEmirateIsoCode(input?: string | null, fallback: Emirate = 'Dubai'): Emirate {
  const iso = toEmirateIsoCode(input, EMIRATE_ISO_CODES[fallback]);
  const entry = (Object.entries(EMIRATE_ISO_CODES) as [Emirate, EmirateIsoCode][]).find(([, code]) => code === iso);
  return entry ? entry[0] : fallback;
}

export interface TenantTaxAndPeppolMetadata {
  nameAr: string;
  corporateTaxTrn: string;
  tradeLicenseNo: string;
  tradeLicenseAuthority: string;
  peppolEndpointId: string;
  peppolSchemeId: string;
  streetName: string;
  additionalStreetName: string;
  cityName: string;
  postalZone: string;
  emirate: Emirate;
  emirateCode: EmirateIsoCode;
  countryCode: string;
  paymentMeansCode: string;
  payeeIban: string;
  payeeAccountName: string;
  payeeBankBic: string;
  aspProvider: string;
  aspEnvironment: 'SANDBOX' | 'PRODUCTION';
  aspEndpointUrl: string;
  aspClientId: string;
  aspApiKey: string;
  autoTransmitOnFinalized: boolean;
}

export function parseLocalizedRecord(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function extractTenantTaxMetadata(input: {
  localizedName?: string | null;
  address?: string | null;
  trn?: string | null;
  branchTradeLicenseNo?: string | null;
  branchTrn?: string | null;
}): TenantTaxAndPeppolMetadata {
  const loc = parseLocalizedRecord(input.localizedName);
  const effectiveTrn = normalizeTrn(input.trn || input.branchTrn || '');
  const detectedEmirate = fromEmirateIsoCode(
    loc.emirate || loc.emirateCode || emirateOf(input.address) || 'Dubai',
  );
  const emirateCode = toEmirateIsoCode(loc.emirateCode || detectedEmirate);
  const addressParts = (input.address ?? '')
    .split(',')
    .map(p => p.trim())
    .filter(Boolean);

  return {
    nameAr: loc.ar ?? '',
    corporateTaxTrn: normalizeTrn(loc.corporateTaxTrn ?? ''),
    tradeLicenseNo: (loc.tradeLicenseNo || input.branchTradeLicenseNo || '').trim(),
    tradeLicenseAuthority: (loc.tradeLicenseAuthority || 'DED Dubai').trim(),
    peppolEndpointId: normalizeTrn(loc.peppolEndpointId || effectiveTrn),
    peppolSchemeId: (loc.peppolSchemeId || UAE_PEPPOL_SCHEME_ID).trim(),
    streetName: (loc.streetName || addressParts[0] || input.address || 'UAE').trim(),
    additionalStreetName: (loc.additionalStreetName || '').trim(),
    cityName: (loc.cityName || detectedEmirate).trim(),
    postalZone: (loc.postalZone || '').trim(),
    emirate: detectedEmirate,
    emirateCode,
    countryCode: (loc.countryCode || 'AE').trim().toUpperCase(),
    paymentMeansCode: (loc.paymentMeansCode || '30').trim(),
    payeeIban: (loc.payeeIban || '').replace(/\s+/g, '').toUpperCase(),
    payeeAccountName: (loc.payeeAccountName || '').trim(),
    payeeBankBic: (loc.payeeBankBic || '').trim().toUpperCase(),
    aspProvider: (loc.aspProvider || 'SANDBOX').trim(),
    aspEnvironment: loc.aspEnvironment === 'PRODUCTION' ? 'PRODUCTION' : 'SANDBOX',
    aspEndpointUrl: (loc.aspEndpointUrl || '').trim(),
    aspClientId: (loc.aspClientId || '').trim(),
    aspApiKey: loc.aspApiKey ?? '',
    autoTransmitOnFinalized: loc.autoTransmitOnFinalized === 'true',
  };
}
