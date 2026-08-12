/**
 * Rental invoice domain event contracts
 */

export const RENTAL_INVOICE_GENERATED = 'rental.invoice.generated' as const;

export interface RentalInvoiceGeneratedPayload {
  rentalInvoiceId: string;
  invoiceNo:       string;
  agreementId:     string;
  customerId:      string | null;
  totalAmount:     number;
  currency:        string;
  status:          string;
  generatedAt:     string; // ISO 8601
}
