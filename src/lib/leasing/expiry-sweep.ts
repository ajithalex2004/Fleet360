/**
 * Document-expiry sweep — finds leasing documents whose expiry is approaching
 * or has passed, updates their status, and creates LeaseAlert rows so they
 * surface on the alerts dashboard. Emails the lessee through the tenant's
 * "Customer document expiring / expired" templates (Admin > Email
 * templates) after each tenant's transaction commits.
 *
 * Designed to be idempotent — running it twice in the same day produces the
 * same result. Uses an "alert-fingerprint" check (entityId + bucket) to
 * avoid duplicate alerts for the same document.
 *
 * Trigger options:
 *   1. POST /api/leasing/documents/sweep-expiry  (manual or external cron)
 *   2. The in-process scheduler (src/lib/jobs/scheduler.ts)
 */

import { captureException, captureMessage } from '@/lib/sentry';
import { runSweep } from '@/lib/prisma-sweep';
import type { TxClient } from '@/lib/rls';
import { appUrl, sendTemplatedEmail } from '@/lib/email-templates';

interface PendingEmail {
  tenantId: string;
  recipient: { email: string; name: string };
  expired: boolean;
  days: number;
  documentName: string;
  documentType: string;
  expiryDate: Date;
  documentId: string;
}

export type ExpiryBucket = 'EXPIRED' | 'EXPIRING_1D' | 'EXPIRING_14D' | 'EXPIRING_30D';

export interface ExpiryHit {
  documentId: string;
  docName: string;
  docType: string;
  entityType: string;
  entityId: string;
  expiryDate: Date;
  daysUntilExpiry: number;
  bucket: ExpiryBucket;
}

export interface SweepResult {
  scanned: number;
  hits: ExpiryHit[];
  alertsCreated: number;
  statusUpdates: number;
  emailsSent: number;
  errors: { documentId: string; message: string }[];
}

/** Resolve the lessee to notify for a document, given its entityType/entityId.
 *  Only LESSEE (their own KYC doc) and CONTRACT (doc attached to a specific
 *  lease) resolve to a lessee — QUOTATION/VEHICLE-attached docs have no
 *  single lessee to notify and are skipped. */
async function resolveLesseeEmail(
  tx: TxClient,
  entityType: string,
  entityId: string,
): Promise<{ email: string; name: string } | null> {
  if (entityType === 'LESSEE') {
    const lessee = await tx.lessee.findUnique({ where: { id: entityId }, select: { email: true, name: true } });
    return lessee?.email ? { email: lessee.email, name: lessee.name } : null;
  }
  if (entityType === 'CONTRACT') {
    const contract = await tx.leaseContract2.findUnique({
      where: { id: entityId },
      select: { lessee: { select: { email: true, name: true } } },
    });
    return contract?.lessee?.email ? { email: contract.lessee.email, name: contract.lessee.name } : null;
  }
  return null;
}

function bucketFor(days: number): ExpiryBucket | null {
  if (days < 0) return 'EXPIRED';
  if (days <= 1) return 'EXPIRING_1D';
  if (days <= 14) return 'EXPIRING_14D';
  if (days <= 30) return 'EXPIRING_30D';
  return null;
}

function statusFor(days: number): 'EXPIRED' | 'EXPIRING_SOON' | 'ACTIVE' {
  if (days < 0) return 'EXPIRED';
  if (days <= 30) return 'EXPIRING_SOON';
  return 'ACTIVE';
}

/**
 * Run the expiry sweep across leasing documents.
 *
 * Tenant scoping:
 *   - When `tenantId` is provided, scan only that tenant's documents.
 *   - When omitted (cron mode), iterate every active tenant so each tenant
 *     gets its own alerts under the correct tenant boundary.
 *
 * RLS: withSystemJob iterates each tenant and runs the callback in a
 * tenant-scoped transaction (app.tenant_id = tenantId). Per-document
 * updates carry `tenantId` in the payload, and RLS WITH CHECK validates
 * the row's tenantId against the GUC. The withSystemJob helper enforces
 * the cross-tenant iteration outside of the per-tenant RLS context.
 *
 * Returns counts and the list of hits for callers (UI / cron logging).
 */
export async function runExpirySweep(
  opts: { dryRun?: boolean; tenantId?: string } = {},
): Promise<SweepResult> {
  const dryRun = opts.dryRun ?? false;
  const now = Date.now();
  const errors: { documentId: string; message: string }[] = [];
  const hits: ExpiryHit[] = [];
  let alertsCreated = 0;
  let statusUpdates = 0;
  let emailsSent = 0;
  let scanned = 0;

  const perTenantResults = await runSweep(
    async ({ tx, tenantId }) => {
      // Only documents with an expiry that haven't been deleted (no
      // soft-delete column on LeaseDocument) and aren't already EXPIRED.
      const docs = await tx.leaseDocument.findMany({
        where: {
          tenantId,
          expiryDate: { not: null },
          status: { not: 'EXPIRED' },
        },
      });
      let tenantAlerts = 0;
      let tenantStatusUpdates = 0;
      const tenantHits: ExpiryHit[] = [];
      const pendingEmails: PendingEmail[] = [];

      for (const doc of docs) {
        if (!doc.expiryDate) continue;
        const days = Math.ceil((doc.expiryDate.getTime() - now) / 86400000);
        const bucket = bucketFor(days);
        if (!bucket) continue;

        const newStatus = statusFor(days);
        tenantHits.push({
          documentId: doc.id,
          docName: doc.docName,
          docType: doc.docType,
          entityType: doc.entityType,
          entityId: doc.entityId,
          expiryDate: doc.expiryDate,
          daysUntilExpiry: days,
          bucket,
        });

        if (dryRun) continue;

        try {
          // Update doc status if it changed.
          if (doc.status !== newStatus) {
            await tx.leaseDocument.update({
              where: { id: doc.id },
              data: { status: newStatus },
            });
            tenantStatusUpdates += 1;
          }

          // Look up an existing OPEN alert for this doc + bucket so we don't double-fire.
          const fingerprint = `doc-expiry:${doc.id}:${bucket}`;
          const existing = await tx.leaseAlert.findFirst({
            where: {
              alertType: 'EXPIRY',
              status: 'OPEN',
              message: { contains: fingerprint },
            },
          });

          if (!existing) {
            const contractId = doc.entityType === 'CONTRACT' ? doc.entityId : null;

            await tx.leaseAlert.create({
              data: {
                alertType: 'EXPIRY',
                severity: bucket === 'EXPIRED' ? 'ERROR' : bucket === 'EXPIRING_1D' ? 'ERROR' : 'WARNING',
                title: `${doc.docType} ${bucket === 'EXPIRED' ? 'expired' : `expiring in ${days}d`}: ${doc.docName}`,
                message:
                  `${fingerprint}\n` +
                  `Document: ${doc.docName} (${doc.docType})\n` +
                  `Entity: ${doc.entityType} ${doc.entityId}\n` +
                  `Expiry: ${doc.expiryDate.toISOString().slice(0, 10)} (${days >= 0 ? `in ${days} day${days === 1 ? '' : 's'}` : `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`})`,
                contractId,
                status: 'OPEN',
                tenantId: doc.tenantId,
              },
            });
            tenantAlerts += 1;

            // Emailed after this tenant's transaction commits (below): an
            // SMTP round-trip must not hold the transaction open, and a
            // failed send must not roll back the alert.
            const recipient = await resolveLesseeEmail(tx, doc.entityType, doc.entityId);
            if (recipient) {
              pendingEmails.push({
                tenantId, recipient, expired: bucket === 'EXPIRED', days,
                documentName: doc.docName, documentType: doc.docType, expiryDate: doc.expiryDate, documentId: doc.id,
              });
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push({ documentId: doc.id, message: msg });
          captureException(err, { context: 'leasing.expiry-sweep', tags: { documentId: doc.id, bucket } });
        }
      }
      return { scanned: docs.length, hits: tenantHits, alerts: tenantAlerts, statusUpdates: tenantStatusUpdates, pendingEmails };
    },
    { tenantHeader: opts.tenantId },
  );

  for (const r of perTenantResults) {
    scanned += r.result.scanned;
    alertsCreated += r.result.alerts;
    statusUpdates += r.result.statusUpdates;
    hits.push(...r.result.hits);
    for (const p of r.result.pendingEmails) {
      try {
        const result = await sendTemplatedEmail({
          tenantId: p.tenantId,
          key: p.expired ? 'leasing.document_expired' : 'leasing.document_expiring',
          to: p.recipient.email,
          values: {
            recipientName: p.recipient.name,
            documentName: p.documentName,
            documentType: p.documentType,
            expiryDate: p.expiryDate.toISOString().slice(0, 10),
            daysLeft: String(Math.max(p.days, 0)),
            portalUrl: appUrl('/leasing-portal'),
          },
        });
        if (result.sent) emailsSent += 1;
      } catch (emailErr) {
        captureException(emailErr, { context: 'leasing.expiry-sweep.email', tags: { documentId: p.documentId } });
      }
    }
  }

  if (alertsCreated > 0) {
    captureMessage(`Document expiry sweep: ${alertsCreated} new alert(s)`, {
      level: 'info',
      context: 'leasing.expiry-sweep',
      extra: { scanned, hits: hits.length, statusUpdates },
    });
  }

  return {
    scanned,
    hits,
    alertsCreated,
    statusUpdates,
    emailsSent,
    errors,
  };
}
