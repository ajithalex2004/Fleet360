/**
 * Lease quotation stages and where approving each one moves it. Shared by
 * the approve route (src/app/api/leasing/quotations/[id]/approve) and the
 * quotations list, whose stage dropdown offers only the next stage so a
 * quotation can't skip its internal or credit approval.
 */
export const QUOTATION_NEXT_STATUS: Record<string, string> = {
  DRAFT:                   'APPROVED',
  NEW:                     'PENDING_APPROVAL',
  PENDING_APPROVAL:        'DRAFT_APPROVED',
  DRAFT_APPROVED:          'SENT_TO_CUSTOMER',
  SENT_TO_CUSTOMER:        'CUSTOMER_APPROVED',
  CUSTOMER_APPROVED:       'PENDING_CREDIT_APPROVAL',
  PENDING_CREDIT_APPROVAL: 'CREDIT_APPROVED',
  CREDIT_APPROVED:         'PO_PREPARATION',
  PO_PREPARATION:          'PO_PREPARED',
  PO_PREPARED:             'DELIVERY_IN_PROGRESS',
  DELIVERY_IN_PROGRESS:    'DELIVERED',
};

/** The stage approving a quotation in `status` moves it to, or null at the end. */
export const nextQuotationStatus = (status: string | null | undefined): string | null =>
  QUOTATION_NEXT_STATUS[status ?? ''] ?? null;
