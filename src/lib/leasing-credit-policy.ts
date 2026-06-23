import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export interface LeasingCreditGateInput {
  lesseeId?: string | null;
  proposedExposure: number;
  currency?: string | null;
  excludeContractId?: string | null;
}

function money(value: number, currency = 'AED') {
  return `${currency} ${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function evaluateLeasingCreditGate(input: LeasingCreditGateInput) {
  const currency = input.currency ?? 'AED';
  const lesseeId = input.lesseeId ?? '';
  if (!lesseeId) {
    return {
      ok: false,
      status: 400,
      code: 'LESSEE_REQUIRED',
      message: 'A lessee is required before credit approval or contract activation.',
    };
  }

  const assessment = await prisma.leaseCreditAssessment.findFirst({
    where: { lesseeId },
    orderBy: { assessmentDate: 'desc' },
  });
  if (!assessment) {
    return {
      ok: false,
      status: 409,
      code: 'CREDIT_ASSESSMENT_REQUIRED',
      message: 'Credit assessment is required before credit approval or contract activation.',
      details: { lesseeId },
    };
  }

  if ((assessment.status ?? 'ACTIVE') !== 'ACTIVE') {
    return {
      ok: false,
      status: 409,
      code: 'CREDIT_ASSESSMENT_NOT_ACTIVE',
      message: `Latest credit assessment is ${assessment.status ?? 'not active'}.`,
      details: { assessmentId: assessment.id, status: assessment.status },
    };
  }

  if (assessment.validUntil && assessment.validUntil < new Date()) {
    return {
      ok: false,
      status: 409,
      code: 'CREDIT_ASSESSMENT_EXPIRED',
      message: `Credit assessment expired on ${assessment.validUntil.toISOString().slice(0, 10)}.`,
      details: { assessmentId: assessment.id, validUntil: assessment.validUntil },
    };
  }

  const riskRating = (assessment.riskRating ?? '').toUpperCase();
  if (riskRating === 'HIGH') {
    return {
      ok: false,
      status: 409,
      code: 'CREDIT_RISK_TOO_HIGH',
      message: 'High-risk lessees require a new approved credit assessment before quotation approval or contract activation.',
      details: { assessmentId: assessment.id, riskRating },
    };
  }

  const creditLimit = numberValue(assessment.creditLimit);
  if (creditLimit <= 0) {
    return {
      ok: false,
      status: 409,
      code: 'CREDIT_LIMIT_REQUIRED',
      message: 'Credit limit must be set before quotation approval or contract activation.',
      details: { assessmentId: assessment.id },
    };
  }

  const activeContracts = await prisma.leaseContract2.findMany({
    where: {
      lesseeId,
      deletedAt: null,
      status: { in: ['ACTIVE', 'APPROVED', 'EXTENDED'] },
      ...(input.excludeContractId ? { id: { not: input.excludeContractId } } : {}),
    },
    select: { totalContractValue: true },
  });
  const activeExposure = activeContracts.reduce((sum, contract) => sum + numberValue(contract.totalContractValue), 0);
  const recordedExposure = numberValue(assessment.currentExposure);
  const currentExposure = Math.max(activeExposure, recordedExposure);
  const proposedExposure = Math.max(0, numberValue(input.proposedExposure));
  const projectedExposure = currentExposure + proposedExposure;

  if (projectedExposure > creditLimit) {
    return {
      ok: false,
      status: 409,
      code: 'CREDIT_LIMIT_EXCEEDED',
      message: `Projected exposure ${money(projectedExposure, currency)} exceeds approved credit limit ${money(creditLimit, currency)}.`,
      details: {
        assessmentId: assessment.id,
        creditLimit,
        currentExposure,
        proposedExposure,
        projectedExposure,
        riskRating: riskRating || null,
      },
    };
  }

  return {
    ok: true,
    status: 200,
    code: 'CREDIT_GATE_PASSED',
    message: `Credit gate passed. Projected exposure ${money(projectedExposure, currency)} within approved limit ${money(creditLimit, currency)}.`,
    details: {
      assessmentId: assessment.id,
      creditLimit,
      currentExposure,
      proposedExposure,
      projectedExposure,
      riskRating: riskRating || null,
      validUntil: assessment.validUntil,
    },
  };
}

export function creditGateResponse(result: Awaited<ReturnType<typeof evaluateLeasingCreditGate>>) {
  if (result.ok) return null;
  return NextResponse.json(
    {
      error: result.message,
      code: result.code,
      creditGate: result,
    },
    { status: result.status },
  );
}
