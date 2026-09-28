/**
 * How the partner portal decides a compliance requirement card (trade
 * licence, tax certificate, insurance) from the partner's uploaded documents.
 * Pure, so the page and its tests share it.
 */

export const EXPIRING_WITHIN_MS = 30 * 24 * 60 * 60 * 1000;

export interface ComplianceDoc {
  docType: string;
  docNumber?: string | null;
  expiryDate?: string | Date | null;
  status?: string | null;
  reviewNote?: string | null;
}

function isPastExpiry(doc: ComplianceDoc, now: number): boolean {
  return !!doc.expiryDate && new Date(doc.expiryDate).getTime() < now;
}

/** The document's stored status, overridden by its expiry date when that has passed or is near. */
export function effectiveStatus(doc: ComplianceDoc, now = Date.now()): string {
  const stored = doc.status || 'PENDING';
  if (stored === 'REJECTED' || stored === 'PENDING' || !doc.expiryDate) return stored;
  const left = new Date(doc.expiryDate).getTime() - now;
  if (left < 0) return 'EXPIRED';
  if (left < EXPIRING_WITHIN_MS) return 'EXPIRING';
  return stored;
}

/**
 * The document that decides a requirement:
 *  1. an approved document that hasn't expired,
 *  2. then one awaiting review, so a renewal uploaded after the approved
 *     document expired shows as pending instead of hiding behind it,
 *  3. then an expired or rejected one;
 * within each, the one that stays valid longest (no expiry counts as longest).
 */
export function latestDoc<T extends ComplianceDoc>(docs: readonly T[], docType: string, now = Date.now()): T | undefined {
  const rank = (d: T) => {
    if (d.status === 'PENDING') return 1;
    if (d.status === 'REJECTED' || d.status === 'EXPIRED' || isPastExpiry(d, now)) return 2;
    return 0;
  };
  const expiry = (d: T) => (d.expiryDate ? new Date(d.expiryDate).getTime() : Number.POSITIVE_INFINITY);
  return docs
    .filter((d) => d.docType === docType)
    .sort((a, b) => rank(a) - rank(b) || expiry(b) - expiry(a))[0];
}
