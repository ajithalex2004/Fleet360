/**
 * 360° Asset Knowledge Graph Engine
 * ----------------------------------
 * Aggregates all live and historical documents, compliance health scores,
 * cross-document commercial lineages, and forensic credentials into a
 * comprehensive Dossier for any Vehicle or Driver in the Fleet360 registry.
 */

import { prisma } from '@/lib/prisma';
import { DocIntelligenceCategory, DocumentLifecycleStatus } from '../../types';

export interface DossierDocumentItem {
  id: string;
  category: DocIntelligenceCategory;
  fileName: string;
  referenceNumber?: string;
  lifecycleStatus: DocumentLifecycleStatus;
  issueDate?: string;
  expiryDate?: string;
  daysUntilExpiry?: number;
  riskScore: number;
  riskLevel: string;
  extractedData: any;
  sourceGroundingAvailable: boolean;
  createdAt: string;
}

export interface AssetDocumentDossier {
  entityType: 'VEHICLE' | 'DRIVER';
  entityId: string;
  entityName: string;
  identifier: string;
  masterDetails: Record<string, any>;
  complianceSummary: {
    status: 'COMPLIANT' | 'EXPIRING_SOON' | 'NON_COMPLIANT';
    complianceScore: number; // 0.0 to 1.0
    activeCount: number;
    expiringCount: number;
    expiredCount: number;
    supersededCount: number;
    totalDocuments: number;
    earliestExpiryDate?: string;
    daysUntilEarliestExpiry?: number;
    alerts: string[];
  };
  activeDocuments: DossierDocumentItem[];
  expiringDocuments: DossierDocumentItem[];
  expiredDocuments: DossierDocumentItem[];
  supersededDocuments: DossierDocumentItem[];
  commercialLineage?: {
    totalSpendAed: number;
    invoicesCount: number;
    purchaseOrdersCount: number;
    workOrdersCount: number;
  };
}

export interface DossierQueryInput {
  tenantId: string;
  entityType: 'VEHICLE' | 'DRIVER';
  entityId?: string;
  plateNumber?: string;
  vin?: string;
  licenseNumber?: string;
  emiratesId?: string;
}

export async function getAssetDocumentDossier(
  input: DossierQueryInput
): Promise<AssetDocumentDossier | null> {
  const { tenantId, entityType, entityId, plateNumber, vin, licenseNumber, emiratesId } = input;

  if (entityType === 'VEHICLE') {
    return getVehicleDossier(tenantId, { entityId, plateNumber, vin });
  } else {
    return getDriverDossier(tenantId, { entityId, licenseNumber, emiratesId });
  }
}

async function getVehicleDossier(
  tenantId: string,
  query: { entityId?: string; plateNumber?: string; vin?: string }
): Promise<AssetDocumentDossier | null> {
  // 1. Resolve vehicle from master table
  let vehicle = query.entityId
    ? await prisma.vehicle.findFirst({
        where: { tenantId, id: query.entityId },
      }).catch(() => null)
    : null;

  if (!vehicle && (query.plateNumber || query.vin)) {
    vehicle = await prisma.vehicle.findFirst({
      where: {
        tenantId,
        OR: [
          ...(query.plateNumber ? [{ licensePlate: query.plateNumber }] : []),
          ...(query.vin ? [{ vin: query.vin }] : []),
        ],
      },
    }).catch(() => null);
  }

  const vId = vehicle?.id || query.entityId || 'UNKNOWN-VEHICLE';
  const vVin = vehicle?.vin || query.vin || '';
  const vPlate = vehicle?.licensePlate || query.plateNumber || '';
  const vName = vehicle ? `${vehicle.make || ''} ${vehicle.model || ''} (${vPlate || vVin})`.trim() : `Vehicle (${vPlate || vVin})`;

  // 2. Fetch all linked document extractions
  let rows: any[] = [];
  try {
    rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        id,
        file_name,
        doc_category,
        lifecycle_status,
        reference_number,
        issue_date::text,
        expiry_date::text,
        risk_score,
        risk_level,
        extracted_data,
        source_grounding,
        created_at::text
      FROM document_intelligence_extractions
      WHERE tenant_id = $1
        AND (
          (linked_entity_type = 'VEHICLE' AND linked_entity_id = $2)
          OR ($3 != '' AND extracted_data->'vehicle'->>'vin' = $3)
          OR ($4 != '' AND (
            extracted_data->'vehicle'->>'licensePlate' = $4 OR
            extracted_data->'vehicle'->>'plateNumber' = $4
          ))
        )
      ORDER BY created_at DESC
    `,
      tenantId,
      vId,
      vVin,
      vPlate
    );
  } catch (err) {
    console.warn('[AssetDossier] Vehicle query warning:', err);
  }

  return assembleDossier({
    entityType: 'VEHICLE',
    entityId: vId,
    entityName: vName,
    identifier: vPlate || vVin || vId,
    masterDetails: vehicle ? {
      id: vehicle.id,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      vin: vehicle.vin,
      licensePlate: vehicle.licensePlate,
      status: vehicle.status,
    } : { vin: vVin, plateNumber: vPlate },
    rows,
  });
}

async function getDriverDossier(
  tenantId: string,
  query: { entityId?: string; licenseNumber?: string; emiratesId?: string }
): Promise<AssetDocumentDossier | null> {
  // 1. Resolve driver from master table
  let driver = query.entityId
    ? await prisma.driver.findFirst({
        where: { tenantId, id: query.entityId },
      }).catch(() => null)
    : null;

  if (!driver && query.licenseNumber) {
    driver = await prisma.driver.findFirst({
      where: { tenantId, licenseNumber: query.licenseNumber },
    }).catch(() => null);
  }

  const dId = driver?.id || query.entityId || 'UNKNOWN-DRIVER';
  const dLic = driver?.licenseNumber || query.licenseNumber || '';
  const dEid = query.emiratesId || '';
  const dName = driver?.name || `Driver (${dLic || dId})`;

  // 2. Fetch all linked document extractions
  let rows: any[] = [];
  try {
    rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        id,
        file_name,
        doc_category,
        lifecycle_status,
        reference_number,
        issue_date::text,
        expiry_date::text,
        risk_score,
        risk_level,
        extracted_data,
        source_grounding,
        created_at::text
      FROM document_intelligence_extractions
      WHERE tenant_id = $1
        AND (
          (linked_entity_type = 'DRIVER' AND linked_entity_id = $2)
          OR ($3 != '' AND extracted_data->'driver'->>'licenseNumber' = $3)
          OR ($4 != '' AND extracted_data->'driver'->>'emiratesId' = $4)
        )
      ORDER BY created_at DESC
    `,
      tenantId,
      dId,
      dLic,
      dEid
    );
  } catch (err) {
    console.warn('[AssetDossier] Driver query warning:', err);
  }

  return assembleDossier({
    entityType: 'DRIVER',
    entityId: dId,
    entityName: dName,
    identifier: dLic || dEid || dId,
    masterDetails: driver ? {
      id: driver.id,
      name: driver.name,
      licenseNumber: driver.licenseNumber,
      status: driver.status,
    } : { licenseNumber: dLic, emiratesId: dEid },
    rows,
  });
}

function assembleDossier(opts: {
  entityType: 'VEHICLE' | 'DRIVER';
  entityId: string;
  entityName: string;
  identifier: string;
  masterDetails: Record<string, any>;
  rows: any[];
}): AssetDocumentDossier {
  const { entityType, entityId, entityName, identifier, masterDetails, rows } = opts;

  const activeDocuments: DossierDocumentItem[] = [];
  const expiringDocuments: DossierDocumentItem[] = [];
  const expiredDocuments: DossierDocumentItem[] = [];
  const supersededDocuments: DossierDocumentItem[] = [];

  let totalSpendAed = 0;
  let invoicesCount = 0;
  let purchaseOrdersCount = 0;
  let workOrdersCount = 0;

  const alerts: string[] = [];
  let earliestExpiryDate: string | undefined;
  let minDaysRemaining: number | undefined;

  const now = new Date();

  for (const r of rows) {
    let daysUntilExpiry: number | undefined;
    if (r.expiry_date) {
      const exp = new Date(r.expiry_date);
      daysUntilExpiry = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    }

    const item: DossierDocumentItem = {
      id: String(r.id),
      category: r.doc_category,
      fileName: r.file_name,
      referenceNumber: r.reference_number || undefined,
      lifecycleStatus: r.lifecycle_status,
      issueDate: r.issue_date || undefined,
      expiryDate: r.expiry_date || undefined,
      daysUntilExpiry,
      riskScore: r.risk_score || 0,
      riskLevel: r.risk_level || 'LOW',
      extractedData: typeof r.extracted_data === 'string' ? JSON.parse(r.extracted_data) : (r.extracted_data || {}),
      sourceGroundingAvailable: Boolean(r.source_grounding && Object.keys(r.source_grounding).length > 0),
      createdAt: r.created_at,
    };

    // Commercial metrics
    if (r.doc_category === 'INVOICE' || r.doc_category === 'TAX_INVOICE') {
      invoicesCount++;
      const amt = item.extractedData?.financials?.totalAmount || item.extractedData?.financials?.totalAmountAed || 0;
      totalSpendAed += Number(amt);
    } else if (r.doc_category === 'PURCHASE_ORDER') {
      purchaseOrdersCount++;
    } else if (r.doc_category === 'WORK_ORDER' || r.doc_category === 'INSPECTION_SHEET') {
      workOrdersCount++;
    }

    // Partition by lifecycle status
    if (r.lifecycle_status === 'SUPERSEDED' || r.lifecycle_status === 'ARCHIVED') {
      supersededDocuments.push(item);
    } else if (r.lifecycle_status === 'EXPIRED' || (daysUntilExpiry !== undefined && daysUntilExpiry <= 0)) {
      expiredDocuments.push(item);
      alerts.push(`Critical: ${item.category} (${item.referenceNumber || item.fileName}) expired on ${item.expiryDate}.`);
    } else if (r.lifecycle_status === 'EXPIRING' || (daysUntilExpiry !== undefined && daysUntilExpiry <= 30)) {
      expiringDocuments.push(item);
      alerts.push(`Warning: ${item.category} expires in ${daysUntilExpiry} days (${item.expiryDate}).`);
    } else {
      activeDocuments.push(item);
    }

    // Earliest expiry tracking
    if (daysUntilExpiry !== undefined && daysUntilExpiry > 0) {
      if (minDaysRemaining === undefined || daysUntilExpiry < minDaysRemaining) {
        minDaysRemaining = daysUntilExpiry;
        earliestExpiryDate = item.expiryDate;
      }
    }
  }

  // Calculate Overall Compliance Health Score (0.0 to 1.0)
  let complianceScore = 1.0;
  if (expiredDocuments.length > 0) {
    complianceScore = Math.max(0.1, 1.0 - expiredDocuments.length * 0.4);
  } else if (expiringDocuments.length > 0) {
    complianceScore = Math.max(0.6, 1.0 - expiringDocuments.length * 0.15);
  }

  const complianceStatus: 'COMPLIANT' | 'EXPIRING_SOON' | 'NON_COMPLIANT' =
    expiredDocuments.length > 0 ? 'NON_COMPLIANT' : expiringDocuments.length > 0 ? 'EXPIRING_SOON' : 'COMPLIANT';

  return {
    entityType,
    entityId,
    entityName,
    identifier,
    masterDetails,
    complianceSummary: {
      status: complianceStatus,
      complianceScore: Math.round(complianceScore * 100) / 100,
      activeCount: activeDocuments.length,
      expiringCount: expiringDocuments.length,
      expiredCount: expiredDocuments.length,
      supersededCount: supersededDocuments.length,
      totalDocuments: rows.length,
      earliestExpiryDate,
      daysUntilEarliestExpiry: minDaysRemaining,
      alerts,
    },
    activeDocuments,
    expiringDocuments,
    expiredDocuments,
    supersededDocuments,
    commercialLineage: {
      totalSpendAed: Math.round(totalSpendAed * 100) / 100,
      invoicesCount,
      purchaseOrdersCount,
      workOrdersCount,
    },
  };
}
