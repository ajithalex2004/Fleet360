/**
 * src/lib/exchange/reconciliation-service.ts
 *
 * 3-Way Financial Reconciliation Engine for Fleet360 Exchange (Phase 2 P0).
 * Compares:
 * 1. Awarded Commercial Commitment + Immutable SHA-256 RateCardSnapshot
 * 2. Execution Proof (POD + PartnerAssignment timestamps: reachedAt, startedAt, completedAt)
 * 3. Itemized Partner Invoice (Base + WAITING_TIME, TOLL, EXTRA_KM, etc.)
 */

import { prisma } from '@/lib/prisma';
import { DeductionType } from '@prisma/client';
import {
  RateCardService,
  DEFAULT_ANCILLARY_CHARGES,
  type RateCardSnapshot,
  type RateCardAncillaryCharges,
} from './rate-card-service';

export interface ThreeWayMatchResult {
  matchStatus: 'MATCHED' | 'VARIANCE_DETECTED';
  awardedAmount: number;
  invoicedAmount: number;
  varianceAmount: number;
  snapshotIntegrityVerified: boolean;
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
    const varianceAmount = Math.round((invoicedAmount - awardedAmount) * 100) / 100;

    const suggestedDeductions: Array<{ type: DeductionType; description: string; amount: number }> = [];
    const discrepancies: string[] = [];

    // 0. Extract and verify frozen RateCardSnapshot from award.commercialSnapshot
    const snapshotContainer = (award.commercialSnapshot || {}) as Record<string, unknown>;
    const rateCardSnapshot = snapshotContainer.rateCardSnapshot as RateCardSnapshot | undefined;
    let snapshotIntegrityVerified = true;
    let ancillary: RateCardAncillaryCharges = DEFAULT_ANCILLARY_CHARGES;

    if (rateCardSnapshot) {
      snapshotIntegrityVerified = RateCardService.verifySnapshotIntegrity(rateCardSnapshot);
      if (!snapshotIntegrityVerified) {
        discrepancies.push('CRITICAL: Rate-card commercial snapshot SHA-256 hash mismatch detected');
      }
      if (rateCardSnapshot.ancillaryCharges) {
        ancillary = { ...DEFAULT_ANCILLARY_CHARGES, ...rateCardSnapshot.ancillaryCharges };
      }
    }

    // 1. Check Passenger Headcount Shortfall (for Passenger Transport) & Multi-Vertical POD Evidence
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

    // 1b. Parse structured multi-vertical POD metadata if present in pod.completionNotes
    if (pod?.completionNotes) {
      try {
        const parsed = JSON.parse(pod.completionNotes) as {
          notes?: string;
          podMetadata?: {
            deliveredWeightKg?: number;
            sealIntact?: boolean;
            temperatureCelsius?: number;
            vipGuestConfirmed?: boolean;
            actualWaitingMinutes?: number;
            tollGateCount?: number;
            hookupPhotoVerified?: boolean;
            towDestinationWorkshop?: string;
          };
        };
        const meta = parsed?.podMetadata;
        if (meta && typeof meta === 'object') {
          if (award.request.domain === 'FREIGHT') {
            if (meta.sealIntact === false) {
              const sealPenalty = Math.round(awardedAmount * 0.1 * 100) / 100;
              suggestedDeductions.push({
                type: DeductionType.CARGO_DAMAGE,
                description: 'Freight POD violation: Container/trailer seal reported broken upon delivery',
                amount: sealPenalty,
              });
              discrepancies.push('Freight POD violation: Container/trailer seal broken at delivery');
            }
            if (
              meta.deliveredWeightKg != null &&
              award.request.requiredCapacity > 0 &&
              meta.deliveredWeightKg < award.request.requiredCapacity * 0.9
            ) {
              const shortagePenalty = Math.round(awardedAmount * 0.1 * 100) / 100;
              suggestedDeductions.push({
                type: DeductionType.CARGO_DAMAGE,
                description: `Cargo weight shortage: delivered ${meta.deliveredWeightKg} kg vs expected ${award.request.requiredCapacity} kg`,
                amount: shortagePenalty,
              });
              discrepancies.push(
                `Cargo weight shortage: ${meta.deliveredWeightKg} kg / ${award.request.requiredCapacity} kg`
              );
            }
          } else if (award.request.domain === 'LIMOUSINE') {
            if (meta.vipGuestConfirmed === false) {
              suggestedDeductions.push({
                type: DeductionType.UNFULFILLED_SERVICE,
                description: 'Limousine POD violation: VIP passenger drop-off confirmation missing',
                amount: Math.round(awardedAmount * 0.1 * 100) / 100,
              });
              discrepancies.push('Limousine POD violation: VIP guest sign-off not confirmed');
            }
          } else if (award.request.domain === 'RECOVERY') {
            if (meta.hookupPhotoVerified === false) {
              suggestedDeductions.push({
                type: DeductionType.OTHER,
                description: 'Recovery POD violation: Mandatory 4-corner pre-tow condition & hookup photo not verified',
                amount: Math.round(awardedAmount * 0.05 * 100) / 100,
              });
              discrepancies.push('Recovery POD violation: Missing 4-corner pre-tow condition / hookup photo');
            }
          }
        }
      } catch {
        // Plain-text completionNotes; no structured JSON metadata to parse
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

    // 3. Validate Invoice Variance Items against Frozen RateCardSnapshot & Execution Timestamps
    const varianceItems = invoice.items.filter((item) => item.varianceReason !== null);
    let authorizedAncillaryTotal = 0;

    for (const v of varianceItems) {
      const itemTotal = Number(v.totalAmount);
      const itemBase = Number(v.amount);
      const isFuelSurchargeClaim =
        String(v.varianceReason) === 'FUEL_SURCHARGE' ||
        (v.varianceReason === 'OTHER' && /fuel\s*surcharge/i.test(v.description || ''));

      if (isFuelSurchargeClaim) {
        const contractedBase =
          rateCardSnapshot?.baseRate != null
            ? Number(rateCardSnapshot.baseRate)
            : Math.round((awardedAmount / 1.05) * 100) / 100;
        const fuelAllowance = RateCardService.calculateFuelSurchargeAllowance(
          contractedBase,
          ancillary.fuelSurchargePct
        );

        if (fuelAllowance.fuelSurchargePct <= 0) {
          suggestedDeductions.push({
            type: DeductionType.OTHER,
            description: `Disallowed fuel surcharge: frozen rate card specifies fuelSurchargePct=0%`,
            amount: Math.round(itemTotal * 100) / 100,
          });
          discrepancies.push(
            `Disallowed fuel surcharge (AED ${itemTotal.toFixed(2)}): fuelSurchargePct is 0% in frozen rate card`
          );
        } else if (itemTotal > fuelAllowance.totalWithVat + 0.05) {
          const excess = Math.round((itemTotal - fuelAllowance.totalWithVat) * 100) / 100;
          suggestedDeductions.push({
            type: DeductionType.OTHER,
            description: `Fuel surcharge exceeds contracted indexation of ${fuelAllowance.fuelSurchargePct}% (max allowed AED ${fuelAllowance.totalWithVat.toFixed(2)} incl. VAT)`,
            amount: excess,
          });
          discrepancies.push(
            `Fuel surcharge overcharge: billed AED ${itemTotal.toFixed(2)} vs allowed AED ${fuelAllowance.totalWithVat.toFixed(2)} (${fuelAllowance.fuelSurchargePct}% indexation)`
          );
        } else {
          // Within contracted fuelSurchargePct indexation -> authorized ancillary allowance
          authorizedAncillaryTotal += itemTotal;
        }
      } else if (v.varianceReason === 'WAITING_TIME') {
        if (assignment?.reachedAt && assignment?.startedAt) {
          const actualWaitMinutes = Math.max(
            0,
            (new Date(assignment.startedAt).getTime() - new Date(assignment.reachedAt).getTime()) / 60000
          );
          const billableWaitMinutes = Math.max(0, actualWaitMinutes - ancillary.freeWaitingMinutes);
          const maxAllowedWaitBase = (billableWaitMinutes / 60) * ancillary.waitingFeePerHour;
          const maxAllowedWaitTotal = Math.round(maxAllowedWaitBase * 1.05 * 100) / 100;

          if (itemTotal > maxAllowedWaitTotal + 0.05) {
            const excess = Math.round((itemTotal - maxAllowedWaitTotal) * 100) / 100;
            suggestedDeductions.push({
              type: DeductionType.OTHER,
              description: `Waiting time overcharge: billed AED ${itemTotal.toFixed(2)}, but actual wait was ${Math.round(actualWaitMinutes)}m (${ancillary.freeWaitingMinutes}m free, max allowed AED ${maxAllowedWaitTotal.toFixed(2)} incl. VAT)`,
              amount: excess,
            });
            discrepancies.push(
              `Waiting time variance overcharge: billed AED ${itemTotal.toFixed(2)} vs allowed AED ${maxAllowedWaitTotal.toFixed(2)} (actual wait ${Math.round(actualWaitMinutes)}m)`
            );
          } else {
            discrepancies.push(
              `Additional variance item: ${v.description} (AED ${itemTotal.toFixed(2)}) - ${v.varianceReason}`
            );
          }
        } else {
          discrepancies.push(
            `Unverified waiting time claim: ${v.description} (AED ${itemTotal.toFixed(2)}) - missing reachedAt/startedAt execution timestamps`
          );
        }
      } else if (v.varianceReason === 'TOLL') {
        if (ancillary.tollTreatment === 'INCLUDED') {
          suggestedDeductions.push({
            type: DeductionType.OTHER,
            description: `Disallowed toll surcharge: frozen rate card specifies tollTreatment=INCLUDED`,
            amount: Math.round(itemTotal * 100) / 100,
          });
          discrepancies.push(
            `Disallowed toll claim (AED ${itemTotal.toFixed(2)}): tolls are INCLUDED in contracted base rate`
          );
        } else if (
          ancillary.tollTreatment === 'CAPPED' &&
          ancillary.tollCapAmount != null &&
          itemBase > ancillary.tollCapAmount
        ) {
          const capTotal = Math.round(ancillary.tollCapAmount * 1.05 * 100) / 100;
          const excess = Math.max(0, Math.round((itemTotal - capTotal) * 100) / 100);
          if (excess > 0) {
            suggestedDeductions.push({
              type: DeductionType.OTHER,
              description: `Toll surcharge exceeds contracted cap of AED ${ancillary.tollCapAmount.toFixed(2)}`,
              amount: excess,
            });
          }
          discrepancies.push(
            `Toll claim exceeds cap: billed AED ${itemBase.toFixed(2)} vs cap AED ${ancillary.tollCapAmount.toFixed(2)}`
          );
        } else {
          discrepancies.push(
            `Additional variance item: ${v.description} (AED ${itemTotal.toFixed(2)}) - ${v.varianceReason}`
          );
        }
      } else {
        discrepancies.push(
          `Additional variance item: ${v.description} (AED ${itemTotal.toFixed(2)}) - ${v.varianceReason}`
        );
      }
    }

    const effectiveVarianceAmount =
      Math.round((invoicedAmount - (awardedAmount + authorizedAncillaryTotal)) * 100) / 100;

    const matchStatus =
      Math.abs(effectiveVarianceAmount) < 0.01 && discrepancies.length === 0 && snapshotIntegrityVerified
        ? 'MATCHED'
        : 'VARIANCE_DETECTED';

    return {
      matchStatus,
      awardedAmount,
      invoicedAmount,
      varianceAmount,
      snapshotIntegrityVerified,
      suggestedDeductions,
      discrepancies,
    };
  }
}
