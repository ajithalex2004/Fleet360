/**
 * Object-level authorization for stored files (src/lib/storage/index.ts).
 *
 * Every stored file belongs to a record, and the caller must be allowed to
 * see that record. A valid session, a guessable-looking UUID in the key, or a
 * signed URL is not enough on its own. The owning record is found from the
 * key's prefix, which only the upload routes write:
 *
 *   branding/{tenantId}/…                  tenant logo; public (the login page
 *                                          shows it before sign-in), images only
 *   leasing/{entity}/{id}/…                lease_documents row with this
 *   leasing-portal/{entity}/{id}/…         file_url, in the caller's tenant
 *   rental/handover/{bookingId}/…          rental_bookings row in the caller's
 *                                          tenant (handover signature)
 *
 * Any other prefix is refused. Staff callers are identified by the identity
 * headers middleware sets from a verified session; leasing-portal callers by
 * their portal session, and only for documents on their own lessee record or
 * their own contracts. Denials are reported as "not found" so a caller cannot
 * tell another tenant's file from a missing one.
 */
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { UPLOAD_URL_PREFIX } from '@/lib/storage';

export type FileCaller =
  | { kind: 'staff'; tenantId: string; userId: string }
  | { kind: 'leasing-portal'; tenantId: string; lesseeId: string }
  | { kind: 'anonymous' };

export type FileAccessDecision =
  | { allowed: true; category: 'branding' | 'leasing-document' | 'rental-handover'; imageOnly: boolean }
  | { allowed: false; reason: string };

const deny = (reason: string): FileAccessDecision => ({ allowed: false, reason });

/** Decides whether `caller` may read the file stored under `key` (already normalized). */
export async function authorizeFileAccess(key: string, caller: FileCaller): Promise<FileAccessDecision> {
  const segments = key.split('/');
  const [root] = segments;

  if (root === 'branding') {
    // Logos are public by design; only images are served from here so the
    // prefix can't be used to publish other content.
    return segments.length >= 3
      ? { allowed: true, category: 'branding', imageOnly: true }
      : deny('malformed branding key');
  }

  if (caller.kind === 'anonymous') return deny('no verified identity');

  if (root === 'leasing' || root === 'leasing-portal') {
    const url = `${UPLOAD_URL_PREFIX}${key}`;
    const doc = await withTenantRls(prisma, caller.tenantId, (tx) =>
      tx.leaseDocument.findFirst({
        where: { tenantId: caller.tenantId, fileUrl: url },
        select: { entityType: true, entityId: true },
      }),
    );
    if (!doc) return deny('no lease document in the caller tenant');
    if (caller.kind === 'staff') return { allowed: true, category: 'leasing-document', imageOnly: false };

    // Leasing portal: the lessee's own record, or a contract they hold.
    if (doc.entityType === 'LESSEE') {
      return doc.entityId === caller.lesseeId
        ? { allowed: true, category: 'leasing-document', imageOnly: false }
        : deny('lease document belongs to another lessee');
    }
    if (doc.entityType === 'CONTRACT') {
      const contract = await withTenantRls(prisma, caller.tenantId, (tx) =>
        tx.leaseContract2.findFirst({
          where: { id: doc.entityId, tenantId: caller.tenantId, lesseeId: caller.lesseeId },
          select: { id: true },
        }),
      );
      return contract
        ? { allowed: true, category: 'leasing-document', imageOnly: false }
        : deny('lease contract belongs to another lessee');
    }
    return deny('lease document type not exposed to the portal');
  }

  if (root === 'rental' && segments[1] === 'handover' && segments.length >= 4) {
    if (caller.kind !== 'staff') return deny('rental files are staff-only');
    const bookingId = segments[2];
    const booking = await withTenantRls(prisma, caller.tenantId, (tx) =>
      tx.rentalBooking.findFirst({
        where: { id: bookingId, tenantId: caller.tenantId },
        select: { id: true },
      }),
    );
    return booking
      ? { allowed: true, category: 'rental-handover', imageOnly: true }
      : deny('rental booking not in the caller tenant');
  }

  return deny('unknown storage prefix');
}
