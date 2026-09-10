/**
 * Fleet360 Document Intelligence & Control Pipeline
 * --------------------------------------------------
 * Master multi-stage specialist pipeline coordinator:
 *  1. Intake & Duplicate Fingerprint Hashing
 *  2. Tiered Cost-Aware Extraction Router (Tier 0 -> Tier 3)
 *  3. Field-Level Source Grounding Engine
 *  4. Master Data Cross-Validation (Vehicles, Drivers, Partners)
 *  5. Cross-Document Relationship Reconciler (Quote -> PO -> WO -> Invoice)
 *  6. Compliance & Regulatory Rules Engine
 *  7. Document Risk Scoring (0–100) & STP Decision
 *  8. Lifecycle State Transition & Auto-Population
 */

import { prisma } from '@/lib/prisma';
import {
  DocumentExtractionResult,
  DocumentRiskEvaluation,
  MasterDataCrossCheckResult,
  CrossDocRelationshipResult,
} from '../../types';
import { processDocumentWithRouter, ExtractionInput } from './router';
import { crossCheckWithMasterData } from './cross-checker';
import {
  reconcileCrossDocumentChain,
  resolveLinkedDocumentsFromDb,
  escalateToFinanceAnomaly,
} from './cross-doc-intelligence';
import { evaluateComplianceRules } from './compliance-rules';
import { evaluateDocumentRisk, computeDocumentFingerprint } from './risk-scorer';
import { autoPopulateFleet360Record } from '../auto-populator';
import { transitionDocumentLifecycle } from './lifecycle-manager';
import { ensureAgentSchema } from '../../schema';
import { dispatchDocumentWebhook } from './webhook-dispatcher';

export interface PipelineExecutionInput extends ExtractionInput {
  tenantId: string;
  autoApply?: boolean;
  linkedQuotation?: { reference: string; amountAed: number; date: string };
  linkedPo?: { reference: string; amountAed: number; date: string };
  linkedWorkOrder?: { reference: string; amountAed: number; date: string };
}

export interface PipelineExecutionResult {
  extractionId: string;
  extraction: DocumentExtractionResult;
  masterCheck: MasterDataCrossCheckResult;
  crossDocResult?: CrossDocRelationshipResult;
  riskEvaluation: DocumentRiskEvaluation;
  autoPopulate: {
    status: 'APPLIED' | 'PENDING_REVIEW' | 'REJECTED';
    linkedEntityType: string;
    linkedEntityId?: string;
    message: string;
  };
  lifecycleStatus: string;
  timeSavedMinutes: number;
  estimatedSavingsAed: number;
}

export async function executeDocumentControlPipeline(
  input: PipelineExecutionInput
): Promise<PipelineExecutionResult> {
  await ensureAgentSchema();
  const { tenantId, fileName, documentText = '', autoApply = true } = input;

  // 1. Compute Document Fingerprint & Check for Duplicates
  const duplicateHash = computeDocumentFingerprint(documentText, fileName);
  let existingDuplicateDocId: string | undefined;

  try {
    const dupRows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT id FROM document_intelligence_extractions
      WHERE tenant_id = $1 AND duplicate_hash = $2
      LIMIT 1
    `, tenantId, duplicateHash);

    if (dupRows && dupRows.length > 0) {
      existingDuplicateDocId = dupRows[0].id;
    }
  } catch (err) {
    // Ignore db read error
  }

  // 2. Run Tiered Cost-Aware Extraction Router (Tier 0 to Tier 3)
  const extraction = await processDocumentWithRouter(input);

  // 3. Run Master Data Cross-Checker
  const masterCheck = await crossCheckWithMasterData(tenantId, extraction);

  // 4. Run Cross-Document Relationship Intelligence
  let linkedPo = input.linkedPo;
  let linkedWorkOrder = input.linkedWorkOrder;
  const linkedQuotation = input.linkedQuotation;

  if (!linkedPo || !linkedWorkOrder) {
    try {
      const resolved = await resolveLinkedDocumentsFromDb(tenantId, extraction, documentText);
      if (!linkedPo && resolved.linkedPo) {
        linkedPo = resolved.linkedPo;
      }
      if (!linkedWorkOrder && resolved.linkedWorkOrder) {
        linkedWorkOrder = resolved.linkedWorkOrder;
      }
    } catch (lookupErr) {
      console.warn('[PipelineExecution] Autonomous DB lookup error:', lookupErr);
    }
  }

  const crossDocResult = reconcileCrossDocumentChain({
    currentExtraction: extraction,
    linkedQuotation,
    linkedPo,
    linkedWorkOrder,
  });

  // 5. Run Compliance & Expiry Rules
  const compliance = evaluateComplianceRules(extraction);

  // 6. Compute 0–100 Document Risk Score & STP Gate
  const riskEvaluation = evaluateDocumentRisk({
    extraction,
    masterCheck,
    crossDocResult,
    compliance,
    existingDuplicateDocId,
  });

  // Embed results into extraction object
  extraction.masterCrossCheck = masterCheck;
  extraction.crossDocRelationship = crossDocResult;
  extraction.riskEvaluation = riskEvaluation;

  // 7. Straight-Through Processing (STP) & Auto-Population Decision
  const shouldAutoProcess = autoApply && riskEvaluation.decision === 'AUTO_PROCESS';
  let autoPopulateStatus: 'APPLIED' | 'PENDING_REVIEW' | 'REJECTED' = shouldAutoProcess ? 'APPLIED' : 'PENDING_REVIEW';
  let linkedEntityType: 'VEHICLE' | 'DRIVER' | 'INVOICE' | 'WORK_ORDER' | 'SHIPMENT' | 'NONE' = 'NONE';
  let linkedEntityId: string | undefined;
  let populateMessage = '';
  let lifecycleStatus = shouldAutoProcess ? 'ACTIVE' : 'VALIDATED';

  if (shouldAutoProcess) {
    const popRes = await autoPopulateFleet360Record(tenantId, extraction);
    linkedEntityType = popRes.linkedEntityType;
    linkedEntityId = popRes.linkedEntityId;
    autoPopulateStatus = popRes.success ? 'APPLIED' : 'PENDING_REVIEW';
    populateMessage = popRes.message;
    lifecycleStatus = popRes.success ? 'ACTIVE' : 'VALIDATED';
  } else {
    linkedEntityType = masterCheck.entityType || 'NONE';
    linkedEntityId = masterCheck.matchedEntityId;
    populateMessage = `Staged for Human-in-the-Loop Review. Reason: ${riskEvaluation.factors.map((f) => f.label).join(', ') || 'Manual review required'}.`;
  }

  // 8. Persist to Database with full audit metadata
  let extractionRecordId = `DOC-${Date.now()}`;
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(`
      INSERT INTO document_intelligence_extractions (
        tenant_id, file_name, mime_type, doc_category, template_family,
        confidence, confidence_score, risk_score, risk_level, lifecycle_status,
        reference_number, issue_date, expiry_date,
        extracted_data, source_grounding, master_data_validation, cross_doc_validation,
        contract_obligations, duplicate_hash, auto_populate_status,
        linked_entity_type, linked_entity_id
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12::DATE, $13::DATE,
        $14::jsonb, $15::jsonb, $16::jsonb, $17::jsonb,
        $18::jsonb, $19, $20,
        $21, $22
      )
      RETURNING id
    `,
      tenantId,
      fileName,
      input.mimeType || 'application/pdf',
      extraction.docCategory,
      extraction.templateFamily || 'GENERIC_UAE_FORMAT',
      extraction.confidence,
      extraction.confidenceScore,
      riskEvaluation.riskScore,
      riskEvaluation.riskLevel,
      lifecycleStatus,
      extraction.referenceNumber || null,
      extraction.issueDate || null,
      extraction.expiryDate || null,
      JSON.stringify(extraction),
      JSON.stringify(extraction.grounding || {}),
      JSON.stringify(masterCheck),
      JSON.stringify(crossDocResult),
      JSON.stringify(extraction.contractObligations || []),
      duplicateHash,
      autoPopulateStatus,
      linkedEntityType !== 'NONE' ? linkedEntityType : null,
      linkedEntityId || null
    );

    if (rows && rows[0]?.id) {
      extractionRecordId = rows[0].id;

      // If becoming active, manage version superseding
      if (lifecycleStatus === 'ACTIVE' && linkedEntityId) {
        await transitionDocumentLifecycle({
          tenantId,
          documentId: extractionRecordId,
          newStatus: 'ACTIVE',
          entityType: linkedEntityType,
          entityId: linkedEntityId,
          category: extraction.docCategory,
        });
      }
    }
  } catch (err) {
    console.warn('[PipelineExecution] Persistence warning:', err);
  }

  // 9. Finance Anomaly Direct Escalation (if >5% commercial variance detected)
  if (crossDocResult.anomalyDetected) {
    try {
      await escalateToFinanceAnomaly(tenantId, extractionRecordId, crossDocResult);
      // Dispatch Webhook Event for Commercial Anomaly
      dispatchDocumentWebhook(tenantId, 'COMMERCIAL_ANOMALY_FLAGGED', {
        documentId: extractionRecordId,
        fileName,
        docCategory: extraction.docCategory,
        anomalySummary: crossDocResult.summary,
        financialVarianceAed: crossDocResult.discrepancies.reduce((acc, d) => acc + (d.delta || 0), 0),
        discrepancies: crossDocResult.discrepancies,
      }).catch((whErr) => console.warn('[PipelineExecution] Webhook error:', whErr));
    } catch (escalateErr) {
      console.warn('[PipelineExecution] Anomaly escalation warning:', escalateErr);
    }
  }

  // 10. Dispatch Webhook Event for Completed Document Extraction
  dispatchDocumentWebhook(tenantId, 'DOCUMENT_EXTRACTED', {
    documentId: extractionRecordId,
    fileName,
    docCategory: extraction.docCategory,
    confidence: extraction.confidence,
    riskScore: riskEvaluation.riskScore,
    riskLevel: riskEvaluation.riskLevel,
    autoPopulateStatus,
    linkedEntityType,
    linkedEntityId,
    extractedData: extraction,
  }).catch((whErr) => console.warn('[PipelineExecution] Webhook error:', whErr));

  return {
    extractionId: extractionRecordId,
    extraction,
    masterCheck,
    crossDocResult,
    riskEvaluation,
    autoPopulate: {
      status: autoPopulateStatus,
      linkedEntityType,
      linkedEntityId,
      message: populateMessage,
    },
    lifecycleStatus,
    timeSavedMinutes: 15,
    estimatedSavingsAed: 45.0,
  };
}
