import { describe, it, expect } from 'vitest';
import {
  evaluateBookingApprovalPolicy,
  BookingPolicyContext,
} from '@/lib/booking-approval-policy';

describe('Multi-Level Corporate Approval & Travel Policy Engine', () => {
  it('routes standard trips (<= AED 1,000) through 2-tier approval (Line Manager -> Fleet Dispatch)', () => {
    const ctx: BookingPolicyContext = {
      id: 'book-1',
      serviceType: 'RENTAL',
      vehicleCategory: 'Compact Sedan',
      totalFareAed: 450,
      costCenter: 'CC-OPS-3003',
      budgetStatus: 'WITHIN_POLICY',
      approvalHistory: [],
    };

    const eval1 = evaluateBookingApprovalPolicy(ctx);
    expect(eval1.currentTier).toBe('TIER_1_PENDING');
    expect(eval1.requiresTier2).toBe(false);
    expect(eval1.policyViolations.length).toBe(0);

    // After Line Manager approves, skips Tier 2 and goes directly to Tier 3 (Fleet Dispatch)
    ctx.approvalHistory = [
      {
        tier: 1,
        tierName: 'Line Manager',
        approverName: 'Jane Manager',
        approverRole: 'Operations Manager',
        action: 'APPROVED',
        timestamp: new Date().toISOString(),
      },
    ];

    const eval2 = evaluateBookingApprovalPolicy(ctx);
    expect(eval2.currentTier).toBe('TIER_3_PENDING');
  });

  it('mandates Tier 2 (Dept Head / VP) escalation for high-value bookings exceeding AED 1,000', () => {
    const ctx: BookingPolicyContext = {
      id: 'book-high-val',
      serviceType: 'EXECUTIVE',
      vehicleCategory: 'Luxury SUV',
      totalFareAed: 1350,
      costCenter: 'CC-MKTG-2002',
      budgetStatus: 'WITHIN_POLICY',
      approvalHistory: [
        {
          tier: 1,
          tierName: 'Line Manager',
          approverName: 'Manager Alex',
          approverRole: 'Line Manager',
          action: 'APPROVED',
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const evalRes = evaluateBookingApprovalPolicy(ctx);
    expect(evalRes.requiresTier2).toBe(true);
    expect(evalRes.currentTier).toBe('TIER_2_PENDING');
    expect(evalRes.policyViolations.some((v) => v.code === 'HIGH_VALUE_FARE')).toBe(true);

    // After Department Head signs off, moves to Tier 3
    ctx.approvalHistory.push({
      tier: 2,
      tierName: 'Department Head',
      approverName: 'Director Robert',
      approverRole: 'Department VP',
      action: 'APPROVED',
      timestamp: new Date().toISOString(),
    });

    const evalResTier3 = evaluateBookingApprovalPolicy(ctx);
    expect(evalResTier3.currentTier).toBe('TIER_3_PENDING');
  });

  it('auto-approves routine staff transport commutes (<= AED 300) directly to Fleet Dispatch', () => {
    const ctx: BookingPolicyContext = {
      id: 'book-commute',
      serviceType: 'STAFF_TRANSPORT',
      vehicleCategory: '14-Seat Minibus',
      totalFareAed: 220,
      costCenter: 'CC-HR-5005',
      budgetStatus: 'WITHIN_POLICY',
      approvalHistory: [],
    };

    const evalRes = evaluateBookingApprovalPolicy(ctx);
    expect(evalRes.isAutoApproved).toBe(true);
    expect(evalRes.currentTier).toBe('TIER_3_PENDING');
  });

  it('flags policy violation when non-executive cost center requests Executive Limousine', () => {
    const ctx: BookingPolicyContext = {
      id: 'book-limo-check',
      serviceType: 'EXECUTIVE',
      vehicleCategory: 'Stretch Limousine',
      totalFareAed: 850,
      costCenter: 'CC-IT-4004', // Non-executive
      budgetStatus: 'WITHIN_POLICY',
      approvalHistory: [],
    };

    const evalRes = evaluateBookingApprovalPolicy(ctx);
    expect(evalRes.policyViolations.some((v) => v.code === 'EXECUTIVE_CLASS_SIGN_OFF')).toBe(true);
  });
});
