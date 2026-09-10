/**
 * Document Lifecycle & Versioning Engine
 * ---------------------------------------
 * Manages document status state machines (UPLOADED -> ACTIVE -> SUPERSEDED / EXPIRED)
 * and automatically retires obsolete document versions upon renewal approval.
 */

import { prisma } from '@/lib/prisma';
import { DocIntelligenceCategory, DocumentLifecycleStatus } from '../../types';
import { dispatchDocumentWebhook } from './webhook-dispatcher';

export interface TransitionInput {
  tenantId: string;
  documentId: string;
  newStatus: DocumentLifecycleStatus;
  entityType?: string;
  entityId?: string;
  category?: DocIntelligenceCategory;
}

export async function transitionDocumentLifecycle(input: TransitionInput): Promise<{
  success: boolean;
  supersededCount: number;
  message: string;
}> {
  const { tenantId, documentId, newStatus, entityType, entityId, category } = input;
  let supersededCount = 0;

  try {
    // 1. Update target document status
    await prisma.$queryRawUnsafe(`
      UPDATE document_intelligence_extractions
      SET lifecycle_status = $1,
          updated_at = NOW()
      WHERE id = $2::uuid AND tenant_id = $3
    `,
      newStatus,
      documentId,
      tenantId
    );

    // 2. If becoming ACTIVE, supersede any previous active documents for the same entity & category
    if (newStatus === 'ACTIVE' && entityType && entityId && category) {
      const supersededRows = await prisma.$queryRawUnsafe<any[]>(`
        UPDATE document_intelligence_extractions
        SET lifecycle_status = 'SUPERSEDED',
            updated_at = NOW()
        WHERE tenant_id = $1
          AND linked_entity_type = $2
          AND linked_entity_id = $3
          AND doc_category = $4
          AND id != $5::uuid
          AND lifecycle_status = 'ACTIVE'
        RETURNING id
      `,
        tenantId,
        entityType,
        entityId,
        category,
        documentId
      );

      supersededCount = supersededRows ? supersededRows.length : 0;
    }

    return {
      success: true,
      supersededCount,
      message: `Document transitioned to ${newStatus}${supersededCount > 0 ? ` (${supersededCount} older version(s) marked SUPERSEDED)` : ''}.`,
    };
  } catch (err: any) {
    console.warn('[LifecycleManager] Transition warning:', err);
    return {
      success: false,
      supersededCount: 0,
      message: err.message || 'Failed to update lifecycle status.',
    };
  }
}

export interface ExpirySweepResult {
  sweptCount: number;
  expiredCount: number;
  expiringCount: number;
  details: Array<{
    id: string;
    category: string;
    expiryDate: string;
    newStatus: string;
  }>;
}

/**
 * Daily Lifecycle Expiry Sweeper
 * -------------------------------
 * Scans active and validated documents in document_intelligence_extractions:
 *  - Flags docs with expiry_date <= CURRENT_DATE as EXPIRED
 *  - Flags docs with expiry_date within 30 days as EXPIRING
 * 
 * Can be run across all tenants (via scheduled cron) or scoped to a specific tenant.
 */
export async function sweepDocumentExpiries(tenantId?: string): Promise<ExpirySweepResult> {
  const details: Array<{ id: string; category: string; expiryDate: string; newStatus: string }> = [];
  let expiredCount = 0;
  let expiringCount = 0;

  try {
    // 1. Transition past-expiry documents to EXPIRED
    const expiredQuery = tenantId
      ? `UPDATE document_intelligence_extractions
         SET lifecycle_status = 'EXPIRED', updated_at = NOW()
         WHERE tenant_id = $1
           AND lifecycle_status IN ('ACTIVE', 'EXPIRING', 'VALIDATED')
           AND expiry_date IS NOT NULL
           AND expiry_date <= CURRENT_DATE
         RETURNING id, doc_category, expiry_date::text, lifecycle_status;`
      : `UPDATE document_intelligence_extractions
         SET lifecycle_status = 'EXPIRED', updated_at = NOW()
         WHERE lifecycle_status IN ('ACTIVE', 'EXPIRING', 'VALIDATED')
           AND expiry_date IS NOT NULL
           AND expiry_date <= CURRENT_DATE
         RETURNING id, doc_category, expiry_date::text, lifecycle_status;`;

    const expiredRows = tenantId
      ? await prisma.$queryRawUnsafe<any[]>(expiredQuery, tenantId)
      : await prisma.$queryRawUnsafe<any[]>(expiredQuery);

    if (expiredRows && expiredRows.length > 0) {
      expiredCount = expiredRows.length;
      for (const r of expiredRows) {
        details.push({
          id: String(r.id),
          category: r.doc_category,
          expiryDate: r.expiry_date,
          newStatus: 'EXPIRED',
        });
      }
    }

    // 2. Transition upcoming expiries (within 30 days) to EXPIRING
    const expiringQuery = tenantId
      ? `UPDATE document_intelligence_extractions
         SET lifecycle_status = 'EXPIRING', updated_at = NOW()
         WHERE tenant_id = $1
           AND lifecycle_status IN ('ACTIVE', 'VALIDATED')
           AND expiry_date IS NOT NULL
           AND expiry_date > CURRENT_DATE
           AND expiry_date <= (CURRENT_DATE + INTERVAL '30 days')
         RETURNING id, doc_category, expiry_date::text, lifecycle_status;`
      : `UPDATE document_intelligence_extractions
         SET lifecycle_status = 'EXPIRING', updated_at = NOW()
         WHERE lifecycle_status IN ('ACTIVE', 'VALIDATED')
           AND expiry_date IS NOT NULL
           AND expiry_date > CURRENT_DATE
           AND expiry_date <= (CURRENT_DATE + INTERVAL '30 days')
         RETURNING id, doc_category, expiry_date::text, lifecycle_status;`;

    const expiringRows = tenantId
      ? await prisma.$queryRawUnsafe<any[]>(expiringQuery, tenantId)
      : await prisma.$queryRawUnsafe<any[]>(expiringQuery);

    if (expiringRows && expiringRows.length > 0) {
      expiringCount = expiringRows.length;
      for (const r of expiringRows) {
        details.push({
          id: String(r.id),
          category: r.doc_category,
          expiryDate: r.expiry_date,
          newStatus: 'EXPIRING',
        });
      }
    }

    // 3. Dispatch webhooks for expired and expiring documents
    if (tenantId && details.length > 0) {
      for (const doc of details) {
        const event = doc.newStatus === 'EXPIRED' ? 'DOCUMENT_EXPIRED' : 'DOCUMENT_EXPIRING_ALERT';
        dispatchDocumentWebhook(tenantId, event, {
          documentId: doc.id,
          docCategory: doc.category,
          expiryDate: doc.expiryDate,
          status: doc.newStatus,
        }).catch((err) => console.warn('[LifecycleManager] Webhook dispatch warning:', err));
      }
    }
  } catch (err) {
    console.warn('[LifecycleManager] Expiry sweeper error:', err);
  }

  return {
    sweptCount: expiredCount + expiringCount,
    expiredCount,
    expiringCount,
    details,
  };
}
