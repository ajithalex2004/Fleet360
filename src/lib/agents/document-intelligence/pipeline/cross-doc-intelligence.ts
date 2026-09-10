/**
 * Cross-Document Relationship Intelligence Engine
 * ------------------------------------------------
 * Reconciles document chains (Quotation -> Purchase Order -> Work Order -> Invoice)
 * and detects commercial variances, scope creep, and unapproved billing spikes.
 */

import {
  CrossDocRelationshipResult,
  DocumentChainItem,
  DocumentExtractionResult,
} from '../../types';
import { prisma } from '@/lib/prisma';

export interface ChainReconciliationInput {
  currentExtraction: DocumentExtractionResult;
  linkedQuotation?: { reference: string; amountAed: number; date: string };
  linkedPo?: { reference: string; amountAed: number; date: string };
  linkedWorkOrder?: { reference: string; amountAed: number; date: string };
}

export function reconcileCrossDocumentChain(
  input: ChainReconciliationInput
): CrossDocRelationshipResult {
  const { currentExtraction, linkedQuotation, linkedPo, linkedWorkOrder } = input;
  const chain: DocumentChainItem[] = [];

  const invoiceAmount =
    currentExtraction.financials?.totalAmount ||
    currentExtraction.financials?.totalAmountAed ||
    0;

  if (linkedQuotation) {
    chain.push({
      docType: 'QUOTATION',
      referenceNumber: linkedQuotation.reference,
      amountAed: linkedQuotation.amountAed,
      date: linkedQuotation.date,
      status: 'APPROVED',
    });
  }

  if (linkedPo) {
    chain.push({
      docType: 'PURCHASE_ORDER',
      referenceNumber: linkedPo.reference,
      amountAed: linkedPo.amountAed,
      date: linkedPo.date,
      status: 'ISSUED',
    });
  }

  if (linkedWorkOrder) {
    chain.push({
      docType: 'WORK_ORDER',
      referenceNumber: linkedWorkOrder.reference,
      amountAed: linkedWorkOrder.amountAed,
      date: linkedWorkOrder.date,
      status: 'COMPLETED',
    });
  }

  if (currentExtraction.docCategory === 'INVOICE' || currentExtraction.docCategory === 'TAX_INVOICE') {
    chain.push({
      docType: 'INVOICE',
      referenceNumber: currentExtraction.referenceNumber || 'INV-CURRENT',
      amountAed: invoiceAmount,
      date: currentExtraction.issueDate || new Date().toISOString().split('T')[0],
      status: 'INGESTED',
    });
  }

  if (chain.length <= 1) {
    return {
      hasRelationship: false,
      chain,
      varianceAed: 0,
      variancePct: 0,
      isVarianceAcceptable: true,
      anomalyDetected: false,
      message: 'Standalone document with no prior linked PO/Quotation in the pipeline.',
    };
  }

  // Baseline comparison against PO amount (or Quotation amount if no PO)
  const baselineAmount = linkedPo?.amountAed || linkedQuotation?.amountAed || linkedWorkOrder?.amountAed || invoiceAmount;
  const varianceAed = Math.round((invoiceAmount - baselineAmount) * 100) / 100;
  const variancePct = baselineAmount > 0 ? Math.round((varianceAed / baselineAmount) * 1000) / 10 : 0;

  const isVarianceAcceptable = Math.abs(variancePct) <= 5.0; // Allowed 5% threshold
  const anomalyDetected = !isVarianceAcceptable && invoiceAmount > baselineAmount;

  let message = `Document chain reconciled: Quoted AED ${linkedQuotation?.amountAed || 'N/A'}, PO AED ${linkedPo?.amountAed || 'N/A'}, Invoice AED ${invoiceAmount}. `;
  if (anomalyDetected) {
    message += `ALERT: Invoice exceeds PO by ${variancePct > 0 ? '+' : ''}${variancePct}% (AED ${varianceAed.toLocaleString()}). Flagged for Finance Anomaly control.`;
  } else {
    message += `Commercial amounts verified within acceptable tolerance.`;
  }

  return {
    hasRelationship: true,
    chain,
    quotedAmountAed: linkedQuotation?.amountAed,
    poAmountAed: linkedPo?.amountAed,
    workOrderAmountAed: linkedWorkOrder?.amountAed,
    invoiceAmountAed: invoiceAmount,
    varianceAed,
    variancePct,
    isVarianceAcceptable,
    anomalyDetected,
    message,
  };
}

/**
 * Autonomous PO/WO DB Lookup
 * ----------------------------
 * Inspects document text, extracted metadata, and references to identify
 * matching Purchase Orders and Work Orders in the Fleet360 database.
 */
export async function resolveLinkedDocumentsFromDb(
  tenantId: string,
  extraction: DocumentExtractionResult,
  text: string = ''
): Promise<{
  linkedPo?: { reference: string; amountAed: number; date: string };
  linkedWorkOrder?: { reference: string; amountAed: number; date: string };
}> {
  let linkedPo: { reference: string; amountAed: number; date: string } | undefined;
  let linkedWorkOrder: { reference: string; amountAed: number; date: string } | undefined;

  const combinedText = [
    text,
    extraction.referenceNumber || '',
    (extraction as any).poNumber || '',
    (extraction as any).financials?.poNumber || '',
    JSON.stringify((extraction as any).extractedData || {}),
  ].join(' ');

  // 1. Scan for PO candidates: e.g. PO-99120, PO-2026-001, PO#4819, Purchase Order: PO-1234
  const poCandidates = new Set<string>();
  const poRegex = /(?:PO|Purchase\s*Order)[#:\s-]*([A-Z0-9-]+)/gi;
  let poMatch: RegExpExecArray | null;
  while ((poMatch = poRegex.exec(combinedText)) !== null) {
    if (poMatch[1] && poMatch[1].trim().length >= 3) {
      const candidate = poMatch[1].trim();
      poCandidates.add(candidate);
      if (!candidate.toUpperCase().startsWith('PO-')) {
        poCandidates.add(`PO-${candidate}`);
      }
    }
  }

  // Also standalone PO-\d+
  const standalonePoRegex = /\bPO-[A-Z0-9-]+\b/gi;
  let sPoMatch: RegExpExecArray | null;
  while ((sPoMatch = standalonePoRegex.exec(combinedText)) !== null) {
    if (sPoMatch[0]) {
      poCandidates.add(sPoMatch[0].trim());
    }
  }

  for (const candidate of poCandidates) {
    try {
      const po = await prisma.purchaseOrder.findFirst({
        where: {
          tenantId,
          poNumber: { equals: candidate, mode: 'insensitive' },
        },
      });

      if (po) {
        linkedPo = {
          reference: po.poNumber,
          amountAed: Number(po.authorizedPoAmount),
          date: po.poDate ? po.poDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        };
        break;
      }
    } catch (poErr) {
      console.warn('[CrossDocIntelligence] PO lookup error:', poErr);
    }
  }

  // 2. Scan for Work Order candidates: e.g. WO-8812, Work Order #8812, JC-102
  const woCandidates = new Set<string>();
  const woRegex = /(?:WO|Work\s*Order|Job\s*Card|JC)[#:\s-]*([A-Z0-9-]+)/gi;
  let woMatch: RegExpExecArray | null;
  while ((woMatch = woRegex.exec(combinedText)) !== null) {
    if (woMatch[1] && woMatch[1].trim().length >= 3) {
      const candidate = woMatch[1].trim();
      woCandidates.add(candidate);
      if (!candidate.toUpperCase().startsWith('WO-')) {
        woCandidates.add(`WO-${candidate}`);
      }
    }
  }

  const standaloneWoRegex = /\b(?:WO|JC)-[A-Z0-9-]+\b/gi;
  let sWoMatch: RegExpExecArray | null;
  while ((sWoMatch = standaloneWoRegex.exec(combinedText)) !== null) {
    if (sWoMatch[0]) {
      woCandidates.add(sWoMatch[0].trim());
    }
  }

  for (const candidate of woCandidates) {
    try {
      const wo = await prisma.workOrder.findFirst({
        where: {
          tenantId,
          OR: [
            { id: candidate },
            { requestId: candidate },
          ],
        },
      });

      if (wo) {
        linkedWorkOrder = {
          reference: wo.id,
          amountAed: 0,
          date: wo.startDate ? wo.startDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        };
        break;
      }
    } catch (woErr) {
      console.warn('[CrossDocIntelligence] WO lookup error:', woErr);
    }
  }

  return { linkedPo, linkedWorkOrder };
}

/**
 * Direct Finance Anomaly Table Escalation
 * ---------------------------------------
 * When cross-document reconciliation detects a >5% commercial billing variance,
 * automatically registers a high-priority flag in ai.agent_anomaly_flags for
 * the Finance Anomaly Agent and controller review queue.
 */
export async function escalateToFinanceAnomaly(
  tenantId: string,
  documentId: string,
  crossDocResult: CrossDocRelationshipResult
): Promise<{ success: boolean; anomalyId?: string; message: string }> {
  if (!crossDocResult.anomalyDetected) {
    return { success: false, message: 'No commercial variance anomaly detected to escalate.' };
  }

  const variancePct = crossDocResult.variancePct ?? 0;
  const varianceAed = crossDocResult.varianceAed ?? 0;
  const severity = Math.abs(variancePct) > 20 ? 'CRITICAL' : 'HIGH';
  const invoiceAmount = crossDocResult.invoiceAmountAed ?? 0;
  const poAmount = crossDocResult.poAmountAed ?? 0;

  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO ai.agent_anomaly_flags (
         detector_id, entity_type, entity_id, tenant_id, stream_type,
         severity, confidence, explanation, amount, currency,
         expected_value, actual_value, variance_pct, likely_cause,
         financial_exposure_aed, recommended_action, status
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9, $10,
         $11, $12, $13, $14,
         $15, $16::jsonb, 'OPEN'
       )
       ON CONFLICT (entity_id, detector_id) WHERE status = 'OPEN'
       DO UPDATE SET
         severity               = EXCLUDED.severity,
         confidence             = EXCLUDED.confidence,
         explanation            = EXCLUDED.explanation,
         expected_value         = EXCLUDED.expected_value,
         actual_value           = EXCLUDED.actual_value,
         variance_pct           = EXCLUDED.variance_pct,
         likely_cause           = EXCLUDED.likely_cause,
         financial_exposure_aed = EXCLUDED.financial_exposure_aed,
         recommended_action     = EXCLUDED.recommended_action
       RETURNING id;`,
      'INV_02_PO_VARIANCE',
      'INVOICE',
      documentId,
      tenantId,
      'VENDOR_INVOICE',
      severity,
      0.95,
      crossDocResult.message,
      invoiceAmount,
      'AED',
      poAmount.toString(),
      invoiceAmount.toString(),
      variancePct,
      'Commercial billing exceeds authorized Purchase Order threshold (>5%).',
      varianceAed,
      JSON.stringify({
        action: 'FLAG_FOR_FINANCE_REVIEW',
        poAmount,
        invoiceAmount,
        varianceAed,
        variancePct,
        source: 'DOCUMENT_INTELLIGENCE_AGENT',
      })
    );

    const anomalyId = rows && rows[0]?.id ? String(rows[0].id) : undefined;
    return {
      success: true,
      anomalyId,
      message: `Escalated commercial variance anomaly to Finance Anomaly Agent (ID: ${anomalyId || 'RECORDED'}).`,
    };
  } catch (err: any) {
    console.warn('[CrossDocIntelligence] Failed to persist finance anomaly flag:', err);
    return {
      success: false,
      message: err.message || 'Failed to insert into ai.agent_anomaly_flags',
    };
  }
}
