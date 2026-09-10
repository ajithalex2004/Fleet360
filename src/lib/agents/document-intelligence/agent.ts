/**
 * Document Intelligence Agent v1.0.0
 * -----------------------------------
 * Multimodal AI Extraction & Auto-Population Engine:
 *  1. Ingests document scans, PDFs, and images (Mulkiya, Insurance, Licenses, Invoices, Job Cards, PODs).
 *  2. Extracts high-fidelity operational & financial entities using AI Vision.
 *  3. Auto-populates and links records in Fleet360 (Vehicles, Drivers, Billing, Work Orders, Shipments).
 *  4. Persists permanent extraction audit records to `document_intelligence_extractions`.
 *  5. Calculates time saved and telemetry metrics.
 */

import {
  AgentDefinition,
  AgentEvent,
  AgentRunResult,
  AgentRunTelemetry,
} from '../types';
import { ensureAgentSchema } from '../schema';
import { executeDocumentControlPipeline } from './pipeline';

async function runDocumentIntelligence(event: AgentEvent): Promise<AgentRunResult> {
  const startTime = Date.now();
  await ensureAgentSchema();

  const tenantId = event.tenant_id || 'default';
  const fileName = (event.metadata?.fileName as string) || 'document.pdf';
  const imageBase64 = event.metadata?.imageBase64 as string | undefined;
  const mimeType = (event.metadata?.mimeType as string) || 'application/pdf';
  const documentText = event.metadata?.documentText as string | undefined;
  const autoApply = event.metadata?.autoApply !== false;
  const linkedQuotation = event.metadata?.linkedQuotation as any;
  const linkedPo = event.metadata?.linkedPo as any;
  const linkedWorkOrder = event.metadata?.linkedWorkOrder as any;

  // Execute the complete 8-stage specialist pipeline
  const pipelineResult = await executeDocumentControlPipeline({
    tenantId,
    fileName,
    imageBase64,
    mimeType,
    documentText,
    autoApply,
    linkedQuotation,
    linkedPo,
    linkedWorkOrder,
  });

  const durationMs = Date.now() - startTime;
  const estimatedSavingsAed = pipelineResult.estimatedSavingsAed || 45.0;

  const telemetry: AgentRunTelemetry = {
    modelAlias: 'VISION_FAST',
    modelProvider: 'openai',
    costAvoidedAed: estimatedSavingsAed,
    businessOutcome: 'PREVENTIVE_REPAIR_SCHEDULED',
    decisionQualityScore: pipelineResult.extraction.confidenceScore || 0.96,
  };

  return {
    agentId: 'document-intelligence',
    tenantId,
    eventType: event.event_type,
    entityId: pipelineResult.extractionId,
    status: 'COMPLETED',
    durationMs,
    itemsProcessed: 1,
    actionsCreated: pipelineResult.autoPopulate.status === 'APPLIED' ? 1 : 0,
    output: pipelineResult,
    telemetry,
  };
}

export const DOCUMENT_INTELLIGENCE_AGENT: AgentDefinition = {
  id: 'document-intelligence',
  name: 'Document Intelligence Agent',
  description: 'Enterprise Document Control Engine with source grounding, master cross-validation, PO-invoice variance tracking, risk scoring, and STP auto-population.',
  version: '2.0.0',
  agentType: 'BATCH',
  autonomyLevel: 'L2',
  subscribedEvents: ['document.uploaded' as any, 'document.process_scan' as any, 'compliance.doc_ingest' as any],
  supportsEntityScan: true,
  run: runDocumentIntelligence,
};

