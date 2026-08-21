/**
 * Finance consumer: fuel.filled → Finance
 *
 * Mirrors a fuel log entry to finance.finance_expenses via
 * postFuelLogToFinance(). Idempotency is handled at the bridge
 * (expense_no = 'FUEL-{id}') and at the inbox level.
 */

import { BaseEventConsumer }         from '@/events/consumer-base';
import type { DomainEventEnvelope }  from '@/events/event-envelope';
import { FUEL_FILLED }               from '@/events/registry';
import type { FuelFilledPayload }    from '@/events/contracts/fuel.events';
import { postFuelLogToFinance }      from '@/lib/bus-ops/finance-bridge';

export class FinanceFuelConsumer extends BaseEventConsumer<FuelFilledPayload> {
  readonly consumerName = 'finance-fuel';
  readonly eventType    = FUEL_FILLED;

  protected async handle(
    envelope: DomainEventEnvelope<FuelFilledPayload>,
  ): Promise<void> {
    const { data, tenantId } = envelope;

    const result = await postFuelLogToFinance(
      {
        id:           data.fuelLogId,
        vehicleId:    data.vehicleId,
        driverId:     data.driverId,
        fuelDate:     new Date(data.fuelDate),
        liters:       data.liters,
        costPerLiter: data.costPerLiter,
        totalCost:    data.totalCost,
        station:      data.station,
      },
      tenantId,
    );

    if (result === null) {
      // Bridge returned null: zero-amount write (legitimate skip). Real
      // failures now throw FinanceBridgeError (R5, 2026-08-14) so this
      // branch no longer masks errors — a rejected await naturally
      // propagates to the outbox for retry.
      console.log(`[finance-fuel] fuelLog ${data.fuelLogId} — skipped (zero amount)`);
      return;
    }

    console.log(`[finance-fuel] fuelLog ${data.fuelLogId} → expense ${result.expenseId}`);
  }
}
