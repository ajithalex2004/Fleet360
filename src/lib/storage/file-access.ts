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
 *                                          (plus parent-entity tenant ownership)
 *   rental/handover/{bookingId}/…          rental_bookings row in the caller's
 *                                          tenant (handover signature, images)
 *   rental/{entity}/{id}/…                 RAC documents/insurance/booking/
 *                                          agreement/customer/damage files
 *                                          verified in the caller's tenant
 *   tenant-attachments/{tenantId}/…        tenant_attachments row with this
 *                                          file_url (trade license, VAT
 *                                          certificate, …); staff of that
 *                                          tenant, or a platform admin
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
  | { kind: 'staff'; tenantId: string; userId: string; isPlatformAdmin?: boolean }
  | { kind: 'leasing-portal'; tenantId: string; lesseeId: string }
  | { kind: 'anonymous' };

export type FileAccessDecision =
  | {
      allowed: true;
      category:
        | 'branding'
        | 'leasing-document'
        | 'rental-handover'
        | 'rental-document'
        | 'tenant-attachment';
      imageOnly: boolean;
    }
  | { allowed: false; reason: string };

const deny = (reason: string): FileAccessDecision => ({ allowed: false, reason });

/** Decides whether `caller` may read the file stored under `key` (already normalized). */
export async function authorizeFileAccess(
  key: string,
  caller: FileCaller,
): Promise<FileAccessDecision> {
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
    if (segments.length < 4) return deny('malformed leasing document key');
    const keyEntityType = segments[1].toUpperCase();
    const keyEntityId = segments[2];
    const url = `${UPLOAD_URL_PREFIX}${key}`;

    return withTenantRls(prisma, caller.tenantId, async (tx) => {
      const doc = await tx.leaseDocument.findFirst({
        where: { tenantId: caller.tenantId, fileUrl: url },
        select: { entityType: true, entityId: true },
      });
      if (!doc) return deny('no lease document in the caller tenant');

      // Bind URL path segments strictly to the LeaseDocument's recorded entityType & entityId
      const docEntityType = String(doc.entityType ?? '').toUpperCase();
      if (doc.entityId !== keyEntityId || docEntityType !== keyEntityType) {
        return deny('lease document key does not match owning entity');
      }

      const anyTx = tx as Record<string, unknown>;

      // Verify parent-entity tenant ownership (closes legacy unverified VEHICLE/QUOTATION rows too)
      if (docEntityType === 'VEHICLE') {
        if (typeof (anyTx.vehicle as { findFirst?: unknown })?.findFirst === 'function') {
          const vehicle = await tx.vehicle.findFirst({
            where: { id: doc.entityId, tenantId: caller.tenantId, deletedAt: null },
            select: { id: true },
          });
          if (!vehicle) return deny('vehicle not in the caller tenant');
        }
      } else if (docEntityType === 'QUOTATION') {
        if (typeof (anyTx.leaseQuotation as { findFirst?: unknown })?.findFirst === 'function') {
          const quotation = await tx.leaseQuotation.findFirst({
            where: { id: doc.entityId, tenantId: caller.tenantId, deletedAt: null },
            select: { id: true },
          });
          if (!quotation) return deny('quotation not in the caller tenant');
        }
      } else if (docEntityType === 'LESSEE') {
        if (typeof (anyTx.lessee as { findFirst?: unknown })?.findFirst === 'function') {
          const lessee = await tx.lessee.findFirst({
            where: { id: doc.entityId, tenantId: caller.tenantId, deletedAt: null },
            select: { id: true },
          });
          if (!lessee) return deny('lessee not in the caller tenant');
        }
      } else if (docEntityType === 'RENTAL_BOOKING') {
        if (typeof (anyTx.rentalBooking as { findFirst?: unknown })?.findFirst === 'function') {
          const booking = await tx.rentalBooking.findFirst({
            where: { id: doc.entityId, tenantId: caller.tenantId },
            select: { id: true },
          });
          if (!booking) return deny('rental booking not in the caller tenant');
        }
      } else if (docEntityType === 'RENTAL_AGREEMENT') {
        if (typeof (anyTx.rentalAgreement as { findFirst?: unknown })?.findFirst === 'function') {
          const agreement = await tx.rentalAgreement.findFirst({
            where: { id: doc.entityId, tenantId: caller.tenantId },
            select: { id: true },
          });
          if (!agreement) return deny('rental agreement not in the caller tenant');
        }
      } else if (docEntityType === 'RENTAL_CUSTOMER') {
        if (typeof (anyTx.rentalCustomer as { findFirst?: unknown })?.findFirst === 'function') {
          const customer = await tx.rentalCustomer.findFirst({
            where: { id: doc.entityId, tenantId: caller.tenantId, deletedAt: null },
            select: { id: true },
          });
          if (!customer) return deny('rental customer not in the caller tenant');
        }
      }

      if (caller.kind === 'staff') {
        return { allowed: true, category: 'leasing-document', imageOnly: false };
      }

      // Leasing portal: the lessee's own record, or a contract they hold.
      if (docEntityType === 'LESSEE') {
        return doc.entityId === caller.lesseeId
          ? { allowed: true, category: 'leasing-document', imageOnly: false }
          : deny('lease document belongs to another lessee');
      }
      if (docEntityType === 'CONTRACT') {
        const contract = await tx.leaseContract2.findFirst({
          where: { id: doc.entityId, tenantId: caller.tenantId, lesseeId: caller.lesseeId },
          select: { id: true },
        });
        return contract
          ? { allowed: true, category: 'leasing-document', imageOnly: false }
          : deny('lease contract belongs to another lessee');
      }
      return deny('lease document type not exposed to the portal');
    });
  }

  if (root === 'rental' && segments.length >= 4) {
    if (caller.kind !== 'staff') return deny('rental files are staff-only');
    const subCategory = segments[1];
    const entityId = segments[2];

    if (subCategory === 'handover') {
      const booking = await withTenantRls(prisma, caller.tenantId, (tx) =>
        tx.rentalBooking.findFirst({
          where: { id: entityId, tenantId: caller.tenantId },
          select: { id: true },
        }),
      );
      return booking
        ? { allowed: true, category: 'rental-handover', imageOnly: true }
        : deny('rental booking not in the caller tenant');
    }

    if (subCategory === 'bookings' || subCategory === 'booking') {
      const booking = await withTenantRls(prisma, caller.tenantId, (tx) =>
        tx.rentalBooking.findFirst({
          where: { id: entityId, tenantId: caller.tenantId },
          select: { id: true },
        }),
      );
      return booking
        ? { allowed: true, category: 'rental-document', imageOnly: false }
        : deny('rental booking not in the caller tenant');
    }

    if (subCategory === 'agreements' || subCategory === 'agreement') {
      const agreement = await withTenantRls(prisma, caller.tenantId, (tx) =>
        tx.rentalAgreement.findFirst({
          where: { id: entityId, tenantId: caller.tenantId },
          select: { id: true },
        }),
      );
      return agreement
        ? { allowed: true, category: 'rental-document', imageOnly: false }
        : deny('rental agreement not in the caller tenant');
    }

    if (subCategory === 'customers' || subCategory === 'customer') {
      const customer = await withTenantRls(prisma, caller.tenantId, (tx) =>
        tx.rentalCustomer.findFirst({
          where: { id: entityId, tenantId: caller.tenantId, deletedAt: null },
          select: { id: true },
        }),
      );
      return customer
        ? { allowed: true, category: 'rental-document', imageOnly: false }
        : deny('rental customer not in the caller tenant');
    }

    if (subCategory === 'damage' || subCategory === 'damage-claims') {
      const claim = await withTenantRls(prisma, caller.tenantId, (tx) =>
        tx.damageClaim.findFirst({
          where: { id: entityId, tenantId: caller.tenantId },
          select: { id: true },
        }),
      );
      return claim
        ? { allowed: true, category: 'rental-document', imageOnly: false }
        : deny('damage claim not in the caller tenant');
    }

    if (subCategory === 'documents' || subCategory === 'document') {
      const url = `${UPLOAD_URL_PREFIX}${key}`;
      const rows = await withTenantRls(prisma, caller.tenantId, (tx) =>
        tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id::text AS id
             FROM rental_documents
            WHERE tenant_id::text = $1
              AND (file_url = $2 OR file_url = $3)
              AND deleted_at IS NULL
            LIMIT 1`,
          caller.tenantId,
          url,
          `/api/files/${key}`,
        ),
      ).catch(() => []);
      return rows.length > 0
        ? { allowed: true, category: 'rental-document', imageOnly: false }
        : deny('rental document not in the caller tenant');
    }

    if (subCategory === 'insurance') {
      const url = `${UPLOAD_URL_PREFIX}${key}`;
      const rows = await withTenantRls(prisma, caller.tenantId, (tx) =>
        tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id::text AS id
             FROM rental_insurance_policies
            WHERE tenant_id::text = $1
              AND (document_url = $2 OR document_url = $3)
              AND deleted_at IS NULL
            LIMIT 1`,
          caller.tenantId,
          url,
          `/api/files/${key}`,
        ),
      ).catch(() => []);
      return rows.length > 0
        ? { allowed: true, category: 'rental-document', imageOnly: false }
        : deny('rental insurance policy not in the caller tenant');
    }

    return deny('unknown rental storage sub-prefix');
  }

  if (root === 'tenant-attachments' && segments.length >= 3) {
    if (caller.kind !== 'staff') return deny('tenant attachments are staff-only');
    const ownerTenant = segments[1];
    if (ownerTenant !== caller.tenantId && !caller.isPlatformAdmin) {
      return deny('tenant attachment of another tenant');
    }
    const url = `${UPLOAD_URL_PREFIX}${key}`;
    const rows = await withTenantRls(prisma, ownerTenant, (tx) =>
      tx.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id::text FROM tenant_attachments WHERE tenant_id = $1 AND file_url = $2 AND deleted_at IS NULL LIMIT 1`,
        ownerTenant,
        url,
      ),
    ).catch(() => []);
    return rows.length > 0
      ? { allowed: true, category: 'tenant-attachment', imageOnly: false }
      : deny('no tenant attachment with this file');
  }

  return deny('unknown storage prefix');
}
