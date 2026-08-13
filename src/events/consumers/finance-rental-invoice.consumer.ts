/**
 * Finance consumer: rental.invoice.generated → Finance
 *
 * Mirrors a newly-generated rental invoice to the finance ledger via
 * mirrorRentalInvoiceToFinance(). The bridge re-reads the invoice from
 * the DB; the payload is informational and drives the log only.
 *
 * Idempotency:
 *   - event_consumer_inbox UNIQUE(consumer_name, event_id) — inbox level
 *   - mirrorRentalInvoiceToFinance() is idempotent internally (source_type+source_id)
 */

import { BaseEventConsumer }                from '@/events/consumer-base';
import type { DomainEventEnvelope }         from '@/events/event-envelope';
import { RENTAL_INVOICE_GENERATED }         from '@/events/registry';
import type { RentalInvoiceGeneratedPayload } from '@/events/contracts/rental-invoice.events';
import { mirrorRentalInvoiceToFinance }     from '@/lib/finance/module-ledger';

export class FinanceRentalInvoiceConsumer extends BaseEventConsumer<RentalInvoiceGeneratedPayload> {
  readonly consumerName = 'finance-rental-invoice';
  readonly eventType    = RENTAL_INVOICE_GENERATED;

  protected async handle(
    envelope: DomainEventEnvelope<RentalInvoiceGeneratedPayload>,
  ): Promise<void> {
    const { data, tenantId } = envelope;

    const result = await mirrorRentalInvoiceToFinance(
      data.rentalInvoiceId,
      tenantId,
      envelope.actor ?? 'system',
    );

    if (!result) {
      console.log(
        `[finance-rental-invoice] invoice ${data.rentalInvoiceId} — no result from mirror`,
      );
      return;
    }

    console.log(
      `[finance-rental-invoice] invoice ${data.rentalInvoiceId} ` +
      `(${data.invoiceNo}) → financeInvoiceId ${result.financeInvoiceId ?? 'n/a'} ` +
      `mode=${result.mode ?? 'unknown'}`,
    );
  }
}
