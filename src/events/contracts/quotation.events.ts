/**
 * Quotation domain event contracts
 */

export const QUOTATION_APPROVED = 'quotation.approved' as const;

export interface QuotationApprovedPayload {
  quotationId:         string;
  maintenanceRequestId: string | null;
  garageId:            string | null;
  garageName:          string | null;
  /** grandTotal ?? totalCost in AED */
  amount:              number;
  currency:            string;
  approvedAt:          string; // ISO 8601
}
