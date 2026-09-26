/**
 * The partner portal's requirement cards and profile after compliance review
 * was introduced:
 *  - a renewal awaiting review shows instead of the approved document it
 *    replaces once that one has expired;
 *  - the partner profile doesn't return the reviewing administrator's user id.
 */
import { describe, it, expect, vi } from 'vitest';

const findUnique = vi.hoisted(() => vi.fn<[args: unknown], Promise<null>>(async () => null));
vi.mock('@/lib/prisma', () => ({ prisma: { transportPartner: { findUnique } } }));
vi.mock('@/lib/alerts/raise', () => ({ raiseAlert: vi.fn() }));

import { latestDoc, effectiveStatus, type ComplianceDoc } from '@/lib/exchange/compliance-requirement';
import { PartnerService } from '@/lib/exchange/partner-service';

const NOW = new Date('2026-09-26T12:00:00Z').getTime();
const doc = (status: string, expiryDate: string | null, docNumber = status): ComplianceDoc =>
  ({ docType: 'TRADE_LICENSE', status, expiryDate, docNumber });
const pick = (docs: ComplianceDoc[]) => latestDoc(docs, 'TRADE_LICENSE', NOW);

describe('requirement card document', () => {
  it('shows a renewal awaiting review once the approved document has expired', () => {
    const expired = doc('VALID', '2026-09-01', 'old');
    const renewal = doc('PENDING', '2027-09-01', 'renewal');
    const chosen = pick([expired, renewal]);
    expect(chosen?.docNumber).toBe('renewal');
    expect(effectiveStatus(chosen!, NOW)).toBe('PENDING');
  });

  it('keeps an approved, unexpired document ahead of a pending one', () => {
    expect(pick([doc('PENDING', '2027-09-01', 'new'), doc('VALID', '2026-12-01', 'current')])?.docNumber).toBe('current');
  });

  it('keeps an approved document that is only expiring soon ahead of a pending one', () => {
    const expiring = doc('VALID', '2026-10-10', 'current');
    const chosen = pick([doc('PENDING', '2027-10-10', 'new'), expiring]);
    expect(chosen?.docNumber).toBe('current');
    expect(effectiveStatus(chosen!, NOW)).toBe('EXPIRING');
  });

  it('prefers a pending document over a rejected one', () => {
    expect(pick([doc('REJECTED', '2027-09-01', 'bad'), doc('PENDING', '2027-01-01', 'waiting')])?.docNumber).toBe('waiting');
  });

  it('among expired and rejected documents, shows the one valid longest', () => {
    expect(pick([doc('VALID', '2026-01-01', 'old'), doc('REJECTED', '2027-09-01', 'bad')])?.docNumber).toBe('bad');
  });

  it('shows nothing when no document of that type exists', () => {
    expect(latestDoc([{ docType: 'TAX_CERTIFICATE', status: 'VALID' }], 'TRADE_LICENSE', NOW)).toBeUndefined();
  });
});

describe('partner profile', () => {
  it('loads compliance documents without the reviewing administrator', async () => {
    await PartnerService.getPartnerProfile('p1');
    const args = findUnique.mock.calls[0][0] as { include: { complianceDocuments: { select: Record<string, boolean> } } };
    const fields = args.include.complianceDocuments.select;
    expect(fields.reviewedBy).toBeUndefined();
    for (const f of ['docType', 'docNumber', 'fileUrl', 'expiryDate', 'status', 'reviewNote', 'reviewedAt']) {
      expect(fields[f]).toBe(true);
    }
  });
});
