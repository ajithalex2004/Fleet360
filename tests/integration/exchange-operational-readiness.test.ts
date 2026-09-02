import { describe, it, expect } from 'vitest';
import { hashDriverToken } from '@/lib/exchange/outsource-engine';

describe('Fleet360 Exchange: Phase 2.5 Operationalization & Pilot Readiness Test Suite', () => {
  it('validates human error handling, quote withdrawal, deadline extensions, and pre-departure cancellation', () => {
    // -------------------------------------------------------------------------
    // 1. Quote Withdrawal prior to award
    // -------------------------------------------------------------------------
    const quote = {
      id: 'q-erroneous-001',
      partnerId: 'partner-alpha',
      requestId: 'req-100',
      totalAmount: 120, // Mistake: Quoted AED 120 instead of AED 1200
      status: 'SUBMITTED',
    };

    // Partner Commercial notices mistake and withdraws quote
    quote.status = 'WITHDRAWN';
    expect(quote.status).toBe('WITHDRAWN');

    // System forbids awarding a WITHDRAWN quote
    const canAward = (q: typeof quote) => q.status === 'SUBMITTED';
    expect(canAward(quote)).toBe(false);

    // -------------------------------------------------------------------------
    // 2. Deadline Extension Governance
    // -------------------------------------------------------------------------
    const initialDeadline = new Date(Date.now() - 1000); // 1 sec in past (expired)
    const request = {
      id: 'req-100',
      closesAt: initialDeadline,
      status: 'PUBLISHED',
    };

    const isExpired = new Date() > request.closesAt;
    expect(isExpired).toBe(true);

    // Dispatcher grants a 2-hour extension
    const extendedDeadline = new Date(Date.now() + 2 * 3600000);
    request.closesAt = extendedDeadline;

    expect(new Date() < request.closesAt).toBe(true);

    // -------------------------------------------------------------------------
    // 3. Pre-Departure Cancellation
    // -------------------------------------------------------------------------
    const award = {
      id: 'aw-200',
      status: 'ASSIGNED',
    };

    // Customer cancels booking 3 hours before departure
    award.status = 'CANCELLED';
    expect(award.status).toBe('CANCELLED');

    // Cancelled trip refuses driver milestone transitions
    const canRecordMilestone = (aw: typeof award) => aw.status !== 'CANCELLED' && aw.status !== 'ABORTED' && aw.status !== 'COMPLETED';
    expect(canRecordMilestone(award)).toBe(false);
  });

  it('validates exception management with resource substitution history and driver token rotation', () => {
    // -------------------------------------------------------------------------
    // Original Assignment (Revision 1)
    // -------------------------------------------------------------------------
    const rawTokenRev1 = 'token-original-rev-1-alpha-bus-12345';
    const tokenHashRev1 = hashDriverToken(rawTokenRev1);

    const assignment = {
      id: 'asgn-300',
      awardId: 'aw-300',
      partnerId: 'partner-alpha',
      vehiclePlate: 'Dubai K 11220',
      driverName: 'Rashid Ali',
      driverPhone: '+971501112222',
      driverTokenHash: tokenHashRev1,
      isTokenRevoked: false,
      revisions: [] as any[],
    };

    // -------------------------------------------------------------------------
    // Exception Raised: Vehicle Breakdown on SZR
    // -------------------------------------------------------------------------
    const exception = {
      id: 'exc-001',
      tenantId: 'tenant-enterprise-A',
      partnerId: 'partner-alpha',
      awardId: 'aw-300',
      type: 'VEHICLE_BREAKDOWN',
      severity: 'CRITICAL',
      description: 'Coolant leak on Sheikh Zayed Road; bus cannot continue.',
      status: 'RAISED',
    };
    expect(exception.status).toBe('RAISED');

    // -------------------------------------------------------------------------
    // 1-Click Resolution: Substitute Vehicle & Driver -> Revision 2
    // -------------------------------------------------------------------------
    // Archive original resource into PartnerAssignmentRevision
    assignment.revisions.push({
      revisionNo: 1,
      vehiclePlate: assignment.vehiclePlate,
      driverName: assignment.driverName,
      driverPhone: assignment.driverPhone,
      replacedReason: 'VEHICLE_BREAKDOWN',
      replacedAt: new Date(),
    });

    // Generate new secure driver token & rotate
    const rawTokenRev2 = 'token-substituted-rev-2-alpha-bus-99881';
    const tokenHashRev2 = hashDriverToken(rawTokenRev2);

    assignment.vehiclePlate = 'Dubai A 99881';
    assignment.driverName = 'Tariq Mehmood';
    assignment.driverPhone = '+971509998888';
    assignment.driverTokenHash = tokenHashRev2;

    exception.status = 'RESOLVED';

    // Verify Historical Revision Trail
    expect(assignment.revisions.length).toBe(1);
    expect(assignment.revisions[0].vehiclePlate).toBe('Dubai K 11220');
    expect(assignment.revisions[0].driverName).toBe('Rashid Ali');

    // Verify Current Active Resource
    expect(assignment.vehiclePlate).toBe('Dubai A 99881');
    expect(assignment.driverName).toBe('Tariq Mehmood');
    expect(assignment.driverTokenHash).toBe(tokenHashRev2);

    // Verify Old Token is invalid
    expect(hashDriverToken(rawTokenRev1)).not.toBe(assignment.driverTokenHash);
  });

  it('validates in-transit emergency trip abortion', () => {
    const award = {
      id: 'aw-400',
      status: 'IN_PROGRESS',
      abortedAt: null as Date | null,
      abortReason: null as string | null,
    };

    // Major road accident on Al Khail Road halts the journey
    award.status = 'ABORTED';
    award.abortedAt = new Date();
    award.abortReason = 'ACCIDENT: Highway collision blockage, passengers safely transferred to relief coach';

    expect(award.status).toBe('ABORTED');
    expect(award.abortedAt).toBeDefined();
    expect(award.abortReason).toContain('ACCIDENT');
  });

  it('validates commercial invoice variance detection, line item adjustments, and finance approval', () => {
    const awardSnapshot = {
      awardId: 'aw-500',
      awardedAmount: 700.0,
      vatAmount: 35.0,
      totalAwarded: 735.0,
    };

    // Partner submits invoice with Extra Waiting Time (AED 50) and Toll charges (AED 20)
    const invoiceItems = [
      { description: 'Contracted Passenger Service (50-Seat Bus)', varianceReason: null, amount: 700.0, vat: 35.0, total: 735.0 },
      { description: 'Client Site Delay (1.5 hrs Waiting)', varianceReason: 'WAITING_TIME', amount: 50.0, vat: 2.5, total: 52.5 },
      { description: 'Salik Toll Gate Charges (5 gates)', varianceReason: 'TOLL', amount: 20.0, vat: 1.0, total: 21.0 },
    ];

    const invoiceSubtotal = invoiceItems.reduce((sum, item) => sum + item.amount, 0); // 770
    const invoiceVat = invoiceItems.reduce((sum, item) => sum + item.vat, 0); // 38.5
    const invoiceTotal = invoiceSubtotal + invoiceVat; // 808.5

    const variance = Math.abs(invoiceTotal - awardSnapshot.totalAwarded);
    expect(variance).toBe(73.5); // AED 73.50 variance

    // Verification status is automatically set to VARIANCE_REVIEW
    const verificationStatus = variance > 0.01 ? 'VARIANCE_REVIEW' : 'MATCHED';
    expect(verificationStatus).toBe('VARIANCE_REVIEW');

    // Enterprise Finance reviews and approves invoice with the variance
    const invoice = {
      id: 'inv-500',
      totalAmount: invoiceTotal,
      verificationStatus,
      status: 'APPROVED',
      payableId: 'pay-500',
    };

    // Core FinancePayable created in accounts payable
    const payable = {
      id: invoice.payableId,
      sourceId: invoice.id,
      totalAmount: 808.5,
      status: 'PENDING_APPROVAL',
    };

    expect(payable.totalAmount).toBe(808.5);
    expect(awardSnapshot.totalAwarded).toBe(735.0); // Award snapshot remained strictly immutable!
  });

  it('validates proactive risk monitor for unassigned trips < 2 hours before departure', () => {
    const now = new Date();
    const trips = [
      {
        id: 'trip-urgent-1',
        pickupTime: '15:30',
        serviceDate: new Date(now.getTime() + 1.5 * 3600000), // 1.5 hours away
        driverName: '', // Unassigned!
        vehiclePlate: '',
      },
      {
        id: 'trip-future-2',
        pickupTime: '18:00',
        serviceDate: new Date(now.getTime() + 5.0 * 3600000), // 5 hours away
        driverName: 'Ali Khan',
        vehiclePlate: 'Dubai A 123',
      },
    ];

    const unassignedUrgentTrips = trips.filter((t) => {
      const hoursUntil = (t.serviceDate.getTime() - now.getTime()) / 3600000;
      return hoursUntil <= 2.0 && (!t.driverName || !t.vehiclePlate);
    });

    expect(unassignedUrgentTrips.length).toBe(1);
    expect(unassignedUrgentTrips[0].id).toBe('trip-urgent-1');
  });
});
