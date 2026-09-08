/**
 * Automated Salik & Darb Toll Pass-Through & Dispute Reconciliation Engine
 * Automatically reconciles Dubai Salik and Abu Dhabi Darb toll gate crossing events
 * against active vehicle shifts, trips, and rental bookings.
 */

export type TollSystem = 'SALIK' | 'DARB';

export interface TollCrossingEvent {
  id: string;
  tollSystem: TollSystem;
  gateName: string;
  gateId?: string;
  vehiclePlate: string;
  plateSource?: string;
  crossingTimestamp: string; // ISO 8601
  tollAmountAed: number;
  tagNumber?: string;
}

export interface ShiftOrTripContext {
  id: string; // Trip ID or Shift ID
  type: 'STAFF_TRANSPORT' | 'RENTAL_CONTRACT' | 'LOGISTICS_FREIGHT' | 'SCHOOL_BUS';
  vehiclePlate: string;
  driverId?: string;
  driverName?: string;
  customerName?: string;
  customerId?: string;
  startTime: string; // ISO 8601
  endTime: string; // ISO 8601
  routeCode?: string;
  contractTollsIncluded?: boolean;
}

export interface ReconciledTollItem {
  tollId: string;
  tollSystem: TollSystem;
  gateName: string;
  vehiclePlate: string;
  crossingTimestamp: string;
  tollAmountAed: number;
  reconciliationStatus: 'MATCHED_TO_TRIP' | 'MATCHED_TO_SHIFT' | 'OFF_DUTY_UNMATCHED' | 'DISPUTED_TIMING';
  assignedEntity?: {
    entityId: string;
    entityType: string;
    driverName?: string;
    customerName?: string;
    routeCode?: string;
  };
  billingDisposition: 'BILLABLE_TO_CUSTOMER' | 'ABSORBED_BY_CONTRACT' | 'DRIVER_PAYROLL_DEDUCTION' | 'PENDING_AUDIT';
  auditReason: string;
}

export interface TollReconciliationSummary {
  totalCrossings: number;
  totalTollAmountAed: number;
  matchedCount: number;
  unmatchedCount: number;
  billableToCustomerAed: number;
  absorbedByContractAed: number;
  driverDeductionsAed: number;
  salikTotalAed: number;
  darbTotalAed: number;
  items: ReconciledTollItem[];
}

/**
 * Reconciles raw toll crossing records with active trips and shifts
 */
export function reconcileTollCrossings(
  tollCrossings: TollCrossingEvent[],
  activeContexts: ShiftOrTripContext[],
  timeToleranceMinutes: number = 10
): TollReconciliationSummary {
  const toleranceMs = timeToleranceMinutes * 60 * 1000;

  let totalTollAmountAed = 0;
  let matchedCount = 0;
  let unmatchedCount = 0;
  let billableToCustomerAed = 0;
  let absorbedByContractAed = 0;
  let driverDeductionsAed = 0;
  let salikTotalAed = 0;
  let darbTotalAed = 0;

  const items: ReconciledTollItem[] = tollCrossings.map(toll => {
    totalTollAmountAed += toll.tollAmountAed;
    if (toll.tollSystem === 'SALIK') salikTotalAed += toll.tollAmountAed;
    if (toll.tollSystem === 'DARB') darbTotalAed += toll.tollAmountAed;

    const tollTime = new Date(toll.crossingTimestamp).getTime();
    const cleanPlate = toll.vehiclePlate.replace(/[-\s]/g, '').toUpperCase();

    // Search for matching active trip or shift on the vehicle
    const matched = activeContexts.find(ctx => {
      const ctxPlate = ctx.vehiclePlate.replace(/[-\s]/g, '').toUpperCase();
      if (ctxPlate !== cleanPlate) return false;

      const start = new Date(ctx.startTime).getTime() - toleranceMs;
      const end = new Date(ctx.endTime).getTime() + toleranceMs;
      return tollTime >= start && tollTime <= end;
    });

    if (matched) {
      matchedCount++;

      let disposition: ReconciledTollItem['billingDisposition'] = 'BILLABLE_TO_CUSTOMER';
      let reason = `Matched to ${matched.type} #${matched.id} (${matched.routeCode || matched.customerName || 'Active Transit'}).`;

      if (matched.contractTollsIncluded) {
        disposition = 'ABSORBED_BY_CONTRACT';
        absorbedByContractAed += toll.tollAmountAed;
        reason += ' Toll is pre-inclusive in agreed contract tariff.';
      } else {
        disposition = 'BILLABLE_TO_CUSTOMER';
        billableToCustomerAed += toll.tollAmountAed;
        reason += ' Added as billable pass-through toll surcharge to customer invoice.';
      }

      return {
        tollId: toll.id,
        tollSystem: toll.tollSystem,
        gateName: toll.gateName,
        vehiclePlate: toll.vehiclePlate,
        crossingTimestamp: toll.crossingTimestamp,
        tollAmountAed: toll.tollAmountAed,
        reconciliationStatus: 'MATCHED_TO_TRIP',
        assignedEntity: {
          entityId: matched.id,
          entityType: matched.type,
          driverName: matched.driverName,
          customerName: matched.customerName,
          routeCode: matched.routeCode,
        },
        billingDisposition: disposition,
        auditReason: reason,
      };
    } else {
      unmatchedCount++;
      driverDeductionsAed += toll.tollAmountAed;

      return {
        tollId: toll.id,
        tollSystem: toll.tollSystem,
        gateName: toll.gateName,
        vehiclePlate: toll.vehiclePlate,
        crossingTimestamp: toll.crossingTimestamp,
        tollAmountAed: toll.tollAmountAed,
        reconciliationStatus: 'OFF_DUTY_UNMATCHED',
        billingDisposition: 'DRIVER_PAYROLL_DEDUCTION',
        auditReason: `No active trip or shift found for vehicle ${toll.vehiclePlate} at ${toll.crossingTimestamp}. Flagged as unauthorized / personal mileage toll.`,
      };
    }
  });

  return {
    totalCrossings: tollCrossings.length,
    totalTollAmountAed: Number(totalTollAmountAed.toFixed(2)),
    matchedCount,
    unmatchedCount,
    billableToCustomerAed: Number(billableToCustomerAed.toFixed(2)),
    absorbedByContractAed: Number(absorbedByContractAed.toFixed(2)),
    driverDeductionsAed: Number(driverDeductionsAed.toFixed(2)),
    salikTotalAed: Number(salikTotalAed.toFixed(2)),
    darbTotalAed: Number(darbTotalAed.toFixed(2)),
    items,
  };
}
