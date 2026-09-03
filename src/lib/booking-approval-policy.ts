export interface BookingPolicyContext {
  id: string;
  bookingRef?: string | null;
  serviceType: string;
  vehicleCategory?: string | null;
  totalFareAed?: number | null;
  costCenter?: string | null;
  budgetStatus?: string | null;
  startDate?: string | null;
  createdAt?: string | null;
  approvalHistory?: ApprovalHistoryEntry[];
}

export interface ApprovalHistoryEntry {
  tier: 1 | 2 | 3;
  tierName: string;
  approverName: string;
  approverRole: string;
  action: 'APPROVED' | 'REJECTED' | 'AUTO_APPROVED';
  timestamp: string;
  remarks?: string;
}

export interface PolicyEvaluationResult {
  requiresTier1: boolean;
  requiresTier2: boolean;
  requiresTier3: boolean;
  currentTier: 'TIER_1_PENDING' | 'TIER_2_PENDING' | 'TIER_3_PENDING' | 'AUTO_APPROVED' | 'APPROVED' | 'REJECTED';
  isAutoApproved: boolean;
  policyViolations: Array<{
    code: 'HIGH_VALUE_FARE' | 'EXECUTIVE_CLASS_SIGN_OFF' | 'BUDGET_CAP_EXCEEDED' | 'SHORT_NOTICE';
    severity: 'WARNING' | 'CRITICAL';
    message: string;
  }>;
}

export function evaluateBookingApprovalPolicy(ctx: BookingPolicyContext): PolicyEvaluationResult {
  const fare = Number(ctx.totalFareAed) || 0;
  const service = (ctx.serviceType || 'RENTAL').toUpperCase();
  const category = ctx.vehicleCategory || '';
  const costCenter = ctx.costCenter || 'CC-OPS-3003';
  const budgetStatus = ctx.budgetStatus || 'WITHIN_POLICY';

  const history = ctx.approvalHistory || [];
  const tier1Done = history.some(h => h.tier === 1 && (h.action === 'APPROVED' || h.action === 'AUTO_APPROVED'));
  const tier2Done = history.some(h => h.tier === 2 && h.action === 'APPROVED');
  const tier3Done = history.some(h => h.tier === 3 && h.action === 'APPROVED');
  const isRejected = history.some(h => h.action === 'REJECTED');

  const violations: PolicyEvaluationResult['policyViolations'] = [];

  // 1. High Value Fare Policy (> AED 1,000)
  const isHighValue = fare > 1000;
  if (isHighValue) {
    violations.push({
      code: 'HIGH_VALUE_FARE',
      severity: 'CRITICAL',
      message: `Total fare (AED ${fare.toFixed(2)}) exceeds standard AED 1,000 threshold and requires Department Head sign-off.`,
    });
  }

  // 2. Executive Limousine Grade Policy
  const isExecutiveLimo =
    service === 'EXECUTIVE' &&
    (category.includes('Luxury') || category.includes('Limousine') || category.includes('MPV'));
  const isNonExecutiveCostCenter = costCenter !== 'CC-EXEC-1001';
  if (isExecutiveLimo && isNonExecutiveCostCenter) {
    violations.push({
      code: 'EXECUTIVE_CLASS_SIGN_OFF',
      severity: 'WARNING',
      message: `Executive Limousine requested under ${costCenter}. Director / VP sign-off required.`,
    });
  }

  // 3. Department Budget Cap Policy
  if (budgetStatus === 'EXCEEDS_POLICY') {
    violations.push({
      code: 'BUDGET_CAP_EXCEEDED',
      severity: 'CRITICAL',
      message: `Trip cost exceeds departmental pre-approved budget allocation cap.`,
    });
  }

  // 4. Automated Policy Rule: Auto-Approve Routine Staff Transport (<= AED 300)
  const isAutoApproved = service === 'STAFF_TRANSPORT' && fare > 0 && fare <= 300 && violations.length === 0;

  // Determine required tiers
  const requiresTier2 = isHighValue || violations.some(v => v.severity === 'CRITICAL');
  const requiresTier1 = !isAutoApproved;
  const requiresTier3 = true; // Always requires final fleet dispatch

  // Compute Current Active Tier
  let currentTier: PolicyEvaluationResult['currentTier'] = 'TIER_1_PENDING';

  if (isRejected) {
    currentTier = 'REJECTED';
  } else if (tier3Done) {
    currentTier = 'APPROVED';
  } else if (tier2Done || (tier1Done && !requiresTier2)) {
    currentTier = 'TIER_3_PENDING';
  } else if (tier1Done && requiresTier2) {
    currentTier = 'TIER_2_PENDING';
  } else if (isAutoApproved) {
    currentTier = 'TIER_3_PENDING';
  } else {
    currentTier = 'TIER_1_PENDING';
  }

  return {
    requiresTier1,
    requiresTier2,
    requiresTier3,
    currentTier,
    isAutoApproved,
    policyViolations: violations,
  };
}
