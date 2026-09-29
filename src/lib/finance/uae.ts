/**
 * UAE company-identity helpers shared by the Company Profile screen and the
 * Peppol e-invoice generator. Pure functions: safe in the browser and on the
 * server.
 */

export const EMIRATES = ['Abu Dhabi', 'Dubai', 'Sharjah', 'Ajman', 'Umm Al Quwain', 'Ras Al Khaimah', 'Fujairah'] as const;

/** TRN with spaces and dashes removed. */
export function normalizeTrn(trn: string | null | undefined): string {
  return (trn ?? '').replace(/[-\s]/g, '');
}

/** FTA Tax Registration Number: 15 digits starting with 100. */
export function isValidTrn(trn: string | null | undefined): boolean {
  return /^100\d{12}$/.test(normalizeTrn(trn));
}

/** The emirate named in a free-text address, if any. */
export function emirateOf(address: string | null | undefined): string | undefined {
  const s = (address ?? '').toLowerCase();
  return EMIRATES.find(e => s.includes(e.toLowerCase()));
}
