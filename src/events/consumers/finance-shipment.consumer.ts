/**
 * Finance consumer: shipment.closed → Finance
 *
 * When a logistics shipment reaches CLOSED status, mirrors the customer-side
 * freight charges to the finance ledger via mirrorLogisticsShipmentToFinance().
 *
 * The bridge function re-reads the shipment from the DB; the payload is
 * informational and drives the log only.
 *
 * Idempotency:
 *   - event_consumer_inbox UNIQUE(consumer_name, event_id) — inbox level
 *   - mirrorLogisticsShipmentToFinance() is idempotent internally (source_type+source_id)
 */

import { BaseEventConsumer }         from '@/events/consumer-base';
import type { DomainEventEnvelope }  from '@/events/event-envelope';
import { SHIPMENT_CLOSED }           from '@/events/registry';
import type { ShipmentClosedPayload } from '@/events/contracts/shipment.events';
import { mirrorLogisticsShipmentToFinance } from '@/lib/finance/module-ledger';

export class FinanceShipmentConsumer extends BaseEventConsumer<ShipmentClosedPayload> {
  readonly consumerName = 'finance-shipment';
  readonly eventType    = SHIPMENT_CLOSED;

  protected async handle(
    envelope: DomainEventEnvelope<ShipmentClosedPayload>,
  ): Promise<void> {
    const { data, tenantId } = envelope;

    const result = await mirrorLogisticsShipmentToFinance(
      data.shipmentOrderId,
      tenantId,
      envelope.actor ?? 'system',
    );

    if (!result) {
      console.log(
        `[finance-shipment] shipment ${data.shipmentOrderId} — no result from mirror`,
      );
      return;
    }

    console.log(
      `[finance-shipment] shipment ${data.shipmentOrderId} ` +
      `(${data.shipmentNo ?? 'no-ref'}) → financeInvoiceId ${result.financeInvoiceId ?? 'n/a'} ` +
      `mode=${result.mode ?? 'unknown'}`,
    );
  }
}
