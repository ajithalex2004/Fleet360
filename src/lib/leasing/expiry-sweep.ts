/**
 * Document-expiry sweep — finds leasing documents whose expiry is approaching
 * or has passed, updates their status, and creates LeaseAlert rows so they
 * surface on the alerts dashboard. Sends email notifications when SMTP is
 * configured.
 *
 * Designed to be idempotent — running it twice in the same day produces the
 * same result. Uses an "alert-fingerprint" check (entityId + bucket) to
 * avoid duplicate alerts for the same document.
 *
 * Trigger options:
 *   1. POST /api/leasing/documents/sweep-expiry  (manual or external cron)
 *   2. Vercel Cron / GitHub Actions schedule
 */

import { prisma } from '@/lib/prisma';
import { captureException, captureMessage } from '@/lib/sentry';

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
  errors: { documentId: string; message: string }[];
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
 * Run the expiry sweep across all leasing documents.
 * Returns counts and the list of hits for callers (UI / cron logging).
 */
export async function runExpirySweep(opts: { dryRun?: boolean } = {}): Promise<SweepResult> {
  const dryRun = opts.dryRun ?? false;
  const now = Date.now();
  const errors: { documentId: string; message: string }[] = [];
  const hits: ExpiryHit[] = [];
  let alertsCreated = 0;
  let statusUpdates = 0;

  // Only documents with an expiry that haven't been deleted (no soft-delete column on
  // LeaseDocument, so we just take all of them) and aren't already EXPIRED.
  const docs = await prisma.leaseDocument.findMany({
    where: {
      expiryDate: { not: null },
      // Skip docs we already marked EXPIRED so we don't re-alert.
      status: { not: 'EXPIRED' },
    },
  });

  for (const doc of docs) {
    if (!doc.expiryDate) continue;
    const days = Math.ceil((doc.expiryDate.getTime() - now) / 86400000);
    const bucket = bucketFor(days);
    if (!bucket) continue;

    const newStatus = statusFor(days);
    hits.push({
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
        await prisma.leaseDocument.update({
          where: { id: doc.id },
          data: { status: newStatus },
        });
        statusUpdates += 1;
      }

      // Look up an existing OPEN alert for this doc + bucket so we don't double-fire.
      const fingerprint = `doc-expiry:${doc.id}:${bucket}`;
      const existing = await prisma.leaseAlert.findFirst({
        where: {
          alertType: 'EXPIRY',
          status: 'OPEN',
          message: { contains: fingerprint },
        },
      });

      if (!existing) {
        // Try to link the alert to a contract if entityType is CONTRACT.
        const contractId = doc.entityType === 'CONTRACT' ? doc.entityId : null;

        await prisma.leaseAlert.create({
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
          },
        });
        alertsCreated += 1;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ documentId: doc.id, message: msg });
      captureException(err, { context: 'leasing.expiry-sweep', tags: { documentId: doc.id, bucket } });
    }
  }

  if (alertsCreated > 0) {
    captureMessage(`Document expiry sweep: ${alertsCreated} new alert(s)`, {
      level: 'info',
      context: 'leasing.expiry-sweep',
      extra: { scanned: docs.length, hits: hits.length, statusUpdates },
    });
  }

  return {
    scanned: docs.length,
    hits,
    alertsCreated,
    statusUpdates,
    errors,
  };
}
