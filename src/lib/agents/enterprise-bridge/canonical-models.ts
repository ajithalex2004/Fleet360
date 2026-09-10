/**
 * Canonical Data Model (CDM) & Semantic Field Mapper
 * ----------------------------------------------------
 * Pattern 1 of the Enterprise Bridge Architecture:
 * Defines universal entity schemas (Invoices, Shift Rosters, Work Orders, Shipment POs)
 * and bidirectional transformation logic for third-party ERP dialects.
 */

import {
  CanonicalInvoice,
  CanonicalRoster,
  CanonicalWorkOrder,
  CanonicalShipmentPO,
  CanonicalEntityType,
} from '../types';

/**
 * Apply customizable field mapping dictionary to a canonical object.
 * e.g. { "tripNumber": "ExternalReferenceID", "totalAmountAed": "NetPriceAmount" }
 */
export function applyFieldMappings<T extends Record<string, any>>(
  sourceObj: T,
  mappings: Record<string, string> = {}
): Record<string, any> {
  const result: Record<string, any> = { ...sourceObj };

  for (const [canonicalKey, externalKey] of Object.entries(mappings)) {
    if (canonicalKey in sourceObj && externalKey) {
      result[externalKey] = sourceObj[canonicalKey];
      // Keep original or remove if mapped to different property name
      if (canonicalKey !== externalKey) {
        delete result[canonicalKey];
      }
    }
  }

  return result;
}

/**
 * Reverse mapping: transforms external ERP payload into canonical structure.
 */
export function reverseFieldMappings(
  externalObj: Record<string, any>,
  mappings: Record<string, string> = {}
): Record<string, any> {
  const result: Record<string, any> = { ...externalObj };
  const invertedMappings: Record<string, string> = {};

  for (const [canonicalKey, externalKey] of Object.entries(mappings)) {
    if (externalKey) {
      invertedMappings[externalKey] = canonicalKey;
    }
  }

  for (const [extKey, canonicalKey] of Object.entries(invertedMappings)) {
    if (extKey in externalObj) {
      result[canonicalKey] = externalObj[extKey];
      if (extKey !== canonicalKey) {
        delete result[extKey];
      }
    }
  }

  return result;
}

/**
 * Validates canonical entity payloads before dispatching to external systems.
 */
export function validateCanonicalEntity(
  type: CanonicalEntityType,
  payload: any
): { valid: boolean; error?: string } {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: 'Payload must be a non-null object' };
  }

  switch (type) {
    case 'INVOICE': {
      const inv = payload as Partial<CanonicalInvoice>;
      if (!inv.invoiceNumber) return { valid: false, error: 'Invoice number is required' };
      if (!inv.clientCode) return { valid: false, error: 'Client code is required' };
      if (typeof inv.totalAmountAed !== 'number') return { valid: false, error: 'totalAmountAed is required' };
      return { valid: true };
    }
    case 'ROSTER': {
      const ros = payload as Partial<CanonicalRoster>;
      if (!ros.rosterBatchId) return { valid: false, error: 'Roster batch ID is required' };
      if (!Array.isArray(ros.passengers)) return { valid: false, error: 'Roster passengers array is required' };
      return { valid: true };
    }
    case 'WORK_ORDER': {
      const wo = payload as Partial<CanonicalWorkOrder>;
      if (!wo.workOrderNumber) return { valid: false, error: 'Work order number is required' };
      if (!wo.vehicleId) return { valid: false, error: 'Vehicle ID is required' };
      return { valid: true };
    }
    case 'SHIPMENT_PO': {
      const po = payload as Partial<CanonicalShipmentPO>;
      if (!po.poNumber) return { valid: false, error: 'PO number is required' };
      if (!po.consigneeName) return { valid: false, error: 'Consignee name is required' };
      return { valid: true };
    }
    default:
      return { valid: false, error: `Unsupported entity type: ${type}` };
  }
}
