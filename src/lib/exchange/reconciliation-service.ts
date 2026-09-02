/**
 * src/lib/exchange/reconciliation-service.ts
 *
 * 3-Way Financial Reconciliation Engine for Fleet360 Exchange.
 * Compares Awarded Commercial Snapshot <-> Execution Proof (POD) <-> Itemized Partner Invoice.
 */

import { prisma } from '@/lib/prisma';
import { DeductionType } from '@prisma/client';

export interface ThreeWayMatchResult {
  matchStatus: 'MATCHED' | 'VARIANCE_DETECTED';
  awardedAmount: number;
  invoicedAmount: number;
  varianceAmount: number;
  suggestedDeductions: Array<{
    type: DeductionType;
    description: string;
    amount: number;
  }>;
  discrepancies: string[];
}

export class SettlementReconciliationService {
  /**
   * Perform automated 3-Way Financial Match on a submitted Partner Invoice
   */
  static async performThreeWayMatch(invoiceId: string): Promise<ThreeWayMatchResult> {
    const invoice = await prisma.partnerInvoice.findUnique({
      where: { id: invoiceId },
      include: {
        award: {
          include: {
            request: true,
            assignment: {
              include: { pod: true },
            },
          },
        },
        items: true,
      },
    });

    if (!invoice) throw new Error('Invoice not found');

    const award = invoice.award;
    const assignment = award.assignment;
    const pod = assignment?.pod;

    const awardedAmount = Number(award.totalAwarded);
    const invoicedAmount = Number(invoice.totalAmount);
    const varianceAmount = invoicedAmount - awardedAmount;

    const suggestedDeductions: Array<{ type: DeductionType; description: string; amount: number }> = [];
    const discrepancies: string[] = [];

    // 1. Check Passenger Headcount Shortfall (for Passenger Transport)
    if (award.request.domain === 'PASSENGER_TRANSPORT' && pod?.passengerCount != null) {
      const requiredCapacity = award.request.requiredCapacity;
      if (pod.passengerCount < requiredCapacity * 0.7) {
        const shortfallPenalty = awardedAmount * 0.15; // 15% shortfall deduction
        suggestedDeductions.push({
          type: DeductionType.HEADCOUNT_SHORTFALL,
          description: `Passenger headcount delivered (${pod.passengerCount}) was significantly below required capacity (${requiredCapacity})`,
          amount: Math.round(shortfallPenalty * 100) / 100,
        });
        discrepancies.push(`Headcount shortfall: ${pod.passengerCount} / ${requiredCapacity}`);
      }
    }

    // 2. Check Late Arrival SLA Breach (if reachedAt > pickupTime)
    if (assignment?.reachedAt && award.request.pickupTime) {
      const [scheduledHour, scheduledMin] = award.request.pickupTime.split(':').map(Number);
      const scheduledTime = new Date(award.request.serviceDate);
      scheduledTime.setHours(scheduledHour || 6, scheduledMin || 0, 0, 0);

      const arrivalTime = new Date(assignment.reachedAt);
      const delayMinutes = (arrivalTime.getTime() - scheduledTime.getTime()) / (1000 * 60);

      if (delayMinutes > 30) {
        const latePenalty = 100.0; // Standard 100 AED SLA penalty for >30m delay
        suggestedDeductions.push({
          type: DeductionType.LATE_ARRIVAL_PENALTY,
          description: `Vehicle arrived ${Math.round(delayMinutes)} minutes late at pickup location`,
          amount: latePenalty,
        });
        discrepancies.push(`Late arrival: ${Math.round(delayMinutes)}m delay`);
      }
    }

    // 3. Check Invoice Variance Items
    const varianceItems = invoice.items.filter((item) => item.varianceReason !== null);
    if (varianceItems.length > 0) {
      varianceItems.forEach((v) => {
        discrepancies.push(`Additional variance item: ${v.description} (AED ${Number(v.totalAmount).toFixed(2)}) - ${v.varianceReason}`);
      });
    }

    const matchStatus = (Math.abs(varianceAmount) < 0.01 && discrepancies.length === 0) ? 'MATCHED' : 'VARIANCE_DETECTED';

    return {
      matchStatus,
      awardedAmount,
      invoicedAmount,
      varianceAmount,
      suggestedDeductions,
      discrepancies,
    };
  }
}
