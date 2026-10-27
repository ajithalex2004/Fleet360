/**
 * src/lib/phone-format.ts
 *
 * Uniform Country Code & Phone Number utilities for Fleet360.
 * Complies with E.164 international standard and formats numbers with flag icons.
 */

export interface CountryMeta {
  iso: string;
  name: string;
  dialCode: string;
  flag: string;
  placeholder: string;
  priority?: number;
}

export const COUNTRIES: CountryMeta[] = [
  // ── GCC Countries (Top Priority) ──────────────────────────────
  { iso: 'AE', name: 'United Arab Emirates', dialCode: '+971', flag: '🇦🇪', placeholder: '50 123 4567', priority: 1 },
  { iso: 'OM', name: 'Oman', dialCode: '+968', flag: '🇴🇲', placeholder: '9123 4567', priority: 2 },
  { iso: 'SA', name: 'Saudi Arabia', dialCode: '+966', flag: '🇸🇦', placeholder: '50 123 4567', priority: 3 },
  { iso: 'QA', name: 'Qatar', dialCode: '+974', flag: '🇶🇦', placeholder: '3312 3456', priority: 4 },
  { iso: 'KW', name: 'Kuwait', dialCode: '+965', flag: '🇰🇼', placeholder: '9123 4567', priority: 5 },
  { iso: 'BH', name: 'Bahrain', dialCode: '+973', flag: '🇧🇭', placeholder: '3912 3456', priority: 6 },

  // ── Major Expat & Trade Partners ──────────────────────────────
  { iso: 'IN', name: 'India', dialCode: '+91', flag: '🇮🇳', placeholder: '98765 43210', priority: 10 },
  { iso: 'PK', name: 'Pakistan', dialCode: '+92', flag: '🇵🇰', placeholder: '300 1234567', priority: 11 },
  { iso: 'PH', name: 'Philippines', dialCode: '+63', flag: '🇵🇭', placeholder: '917 123 4567', priority: 12 },
  { iso: 'EG', name: 'Egypt', dialCode: '+20', flag: '🇪🇬', placeholder: '10 1234 5678', priority: 13 },
  { iso: 'BD', name: 'Bangladesh', dialCode: '+880', flag: '🇧🇩', placeholder: '1712 345678', priority: 14 },
  { iso: 'LK', name: 'Sri Lanka', dialCode: '+94', flag: '🇱🇰', placeholder: '71 234 5678', priority: 15 },
  { iso: 'NP', name: 'Nepal', dialCode: '+977', flag: '🇳🇵', placeholder: '984 1234567', priority: 16 },
  { iso: 'JO', name: 'Jordan', dialCode: '+962', flag: '🇯🇴', placeholder: '7 9123 4567', priority: 17 },
  { iso: 'LB', name: 'Lebanon', dialCode: '+961', flag: '🇱🇧', placeholder: '70 123 456', priority: 18 },
  { iso: 'SY', name: 'Syria', dialCode: '+963', flag: '🇸🇾', placeholder: '944 123 456', priority: 19 },
  { iso: 'IQ', name: 'Iraq', dialCode: '+964', flag: '🇮🇶', placeholder: '770 123 4567', priority: 20 },
  { iso: 'YE', name: 'Yemen', dialCode: '+967', flag: '🇾🇪', placeholder: '712 345 678', priority: 21 },
  { iso: 'KE', name: 'Kenya', dialCode: '+254', flag: '🇰🇪', placeholder: '712 345678', priority: 22 },
  { iso: 'ZA', name: 'South Africa', dialCode: '+27', flag: '🇿🇦', placeholder: '82 123 4567', priority: 23 },
  { iso: 'GB', name: 'United Kingdom', dialCode: '+44', flag: '🇬🇧', placeholder: '7911 123456', priority: 24 },
  { iso: 'US', name: 'United States', dialCode: '+1', flag: '🇺🇸', placeholder: '(555) 123-4567', priority: 25 },
  { iso: 'CA', name: 'Canada', dialCode: '+1', flag: '🇨🇦', placeholder: '(555) 123-4567', priority: 26 },
  { iso: 'DE', name: 'Germany', dialCode: '+49', flag: '🇩🇪', placeholder: '151 12345678', priority: 27 },
  { iso: 'FR', name: 'France', dialCode: '+33', flag: '🇫🇷', placeholder: '6 12 34 56 78', priority: 28 },
  { iso: 'TR', name: 'Turkey', dialCode: '+90', flag: '🇹🇷', placeholder: '532 123 4567', priority: 29 },
  { iso: 'CN', name: 'China', dialCode: '+86', flag: '🇨🇳', placeholder: '138 0000 0000', priority: 30 },
  { iso: 'AU', name: 'Australia', dialCode: '+61', flag: '🇦🇺', placeholder: '412 345 678', priority: 31 },
  { iso: 'SG', name: 'Singapore', dialCode: '+65', flag: '🇸🇬', placeholder: '8123 4567', priority: 32 },
  { iso: 'MY', name: 'Malaysia', dialCode: '+60', flag: '🇲🇾', placeholder: '12 345 6789', priority: 33 },
];

export const DEFAULT_COUNTRY = COUNTRIES[0]; // UAE (+971)

/**
 * Normalizes any dial code into standard "+XYZ" format
 */
export function normalizeDialCode(code: string): string {
  const digits = code.replace(/\D/g, '');
  return digits ? `+${digits}` : '+971';
}

/**
 * Parses an arbitrary phone string into a CountryMeta and clean national number.
 */
export function parsePhoneNumber(
  rawInput: string | null | undefined,
  defaultIso = 'AE'
): { country: CountryMeta; nationalNumber: string; fullE164: string } {
  const fallbackCountry = COUNTRIES.find((c) => c.iso === defaultIso) || DEFAULT_COUNTRY;

  if (!rawInput || typeof rawInput !== 'string') {
    return { country: fallbackCountry, nationalNumber: '', fullE164: '' };
  }

  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { country: fallbackCountry, nationalNumber: '', fullE164: '' };
  }

  // Check if string starts with '+' or dial digits
  let matchedCountry: CountryMeta | undefined;
  let remainingNumber = trimmed;

  // Clean starting plus
  const cleanStr = trimmed.startsWith('+') ? trimmed : `+${trimmed.replace(/^00/, '')}`;

  // Sort countries by dial code length descending (to match +971 before +9)
  const sortedCountries = [...COUNTRIES].sort((a, b) => b.dialCode.length - a.dialCode.length);

  for (const c of sortedCountries) {
    if (cleanStr.startsWith(c.dialCode)) {
      matchedCountry = c;
      remainingNumber = cleanStr.slice(c.dialCode.length);
      break;
    }
  }

  // If no international code matched, check if it starts with local leading zero (e.g. 0501234567)
  if (!matchedCountry) {
    matchedCountry = fallbackCountry;
    remainingNumber = trimmed.replace(/^0+/, '');
  }

  // Clean national number to digits only
  const cleanDigits = remainingNumber.replace(/\D/g, '');
  const fullE164 = cleanDigits ? `${matchedCountry.dialCode}${cleanDigits}` : '';

  return {
    country: matchedCountry,
    nationalNumber: cleanDigits,
    fullE164,
  };
}

/**
 * Formats a raw number for uniform UI table / view display.
 * E.g. "+971501234567" -> "🇦🇪 +971 50 123 4567"
 */
export function formatPhoneNumberDisplay(rawNumber: string | null | undefined): string {
  if (!rawNumber || typeof rawNumber !== 'string') return '—';
  const { country, nationalNumber } = parsePhoneNumber(rawNumber);
  if (!nationalNumber) return rawNumber;

  // Pretty spacing for common GCC numbers (e.g., 50 123 4567)
  let formattedNational = nationalNumber;
  if (nationalNumber.length === 9) {
    formattedNational = `${nationalNumber.slice(0, 2)} ${nationalNumber.slice(2, 5)} ${nationalNumber.slice(5)}`;
  } else if (nationalNumber.length === 8) {
    formattedNational = `${nationalNumber.slice(0, 4)} ${nationalNumber.slice(4)}`;
  } else if (nationalNumber.length === 10) {
    formattedNational = `${nationalNumber.slice(0, 5)} ${nationalNumber.slice(5)}`;
  }

  return `${country.flag} ${country.dialCode} ${formattedNational}`;
}
