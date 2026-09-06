/**
 * AI Quality Evaluation & Benchmark Harness
 * -------------------------------------------
 * Executes ground-truth benchmark scenarios across Fleet360 agents,
 * computes Precision, Recall, False Positive Rate, and Decision Quality Scores,
 * and persists results to `agent_evaluation_metrics`.
 */

import { prisma } from '@/lib/prisma';
import { AgentEvaluationEvent, AgentId } from '../types';
import { ensureAgentSchema } from '../schema';
import {
  detectMaintenanceAnomalies,
  detectFuelAnomalies,
  detectVendorInvoiceAnomalies,
  detectTripTollAnomalies,
  detectContractAnomalies,
} from '../finance-anomaly/detectors';
import { FINANCE_GROUND_TRUTH_DATASETS } from './datasets';

export interface ClassificationMetrics {
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  falsePositiveRate: number;
  f1Score: number;
  accuracy: number;
  decisionQualityScore: number;
}

export interface BenchmarkSuiteResult {
  suiteName: string;
  agentId: AgentId;
  totalScenarios: number;
  metrics: ClassificationMetrics;
  passed: boolean;
  benchmarkDurationMs: number;
  financialExposureDetectedAed: number;
}

export function calculateClassificationMetrics(
  tp: number,
  fp: number,
  tn: number,
  fn: number,
): ClassificationMetrics {
  const precision = tp + fp > 0 ? tp / (tp + fp) : 1.0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 1.0;
  const falsePositiveRate = fp + tn > 0 ? fp / (fp + tn) : 0.0;
  const f1Score = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 1.0;
  const total = tp + fp + tn + fn;
  const accuracy = total > 0 ? (tp + tn) / total : 1.0;
  const decisionQualityScore = parseFloat(((precision * 0.5) + (recall * 0.5)).toFixed(4));

  return {
    truePositives: tp,
    falsePositives: fp,
    trueNegatives: tn,
    falseNegatives: fn,
    precision: parseFloat(precision.toFixed(4)),
    recall: parseFloat(recall.toFixed(4)),
    falsePositiveRate: parseFloat(falsePositiveRate.toFixed(4)),
    f1Score: parseFloat(f1Score.toFixed(4)),
    accuracy: parseFloat(accuracy.toFixed(4)),
    decisionQualityScore,
  };
}

export class BenchmarkRunner {
  /**
   * Persist evaluation outcome to agent_evaluation_metrics
   */
  async recordEvaluationMetric(metric: AgentEvaluationEvent): Promise<void> {
    await ensureAgentSchema();
    await prisma.$executeRawUnsafe(
      `INSERT INTO agent_evaluation_metrics (
         agent_id, tenant_id, entity_id, metric_category,
         metric_name, metric_value, is_positive_outcome, notes, recorded_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
      metric.agentId,
      metric.tenantId ?? 'benchmark_tenant',
      metric.entityId ?? null,
      metric.metricCategory,
      metric.metricName,
      metric.metricValue,
      metric.isPositiveOutcome,
      metric.notes ?? null,
    ).catch(() => {});
  }

  /**
   * Run Finance Anomaly Ground-Truth Benchmark
   */
  async runFinanceAnomalyBenchmark(): Promise<BenchmarkSuiteResult> {
    const t0 = Date.now();

    const expectedAnomalyIds = new Set([
      'maint-pos-1',
      'fuel-pos-1',
      'fuel-pos-2',
      'inv-pos-1',
      'toll-pos-1',
      'contract-pos-1',
    ]);

    const expectedCleanIds = new Set([
      'maint-clean-1',
      'fuel-clean-1',
      'inv-clean-1',
    ]);

    // Execute all detector suites
    const detectedFlags = [
      ...detectMaintenanceAnomalies(FINANCE_GROUND_TRUTH_DATASETS.maintenance),
      ...detectFuelAnomalies(FINANCE_GROUND_TRUTH_DATASETS.fuel),
      ...detectVendorInvoiceAnomalies(FINANCE_GROUND_TRUTH_DATASETS.invoices),
      ...detectTripTollAnomalies(FINANCE_GROUND_TRUTH_DATASETS.tolls),
      ...detectContractAnomalies(FINANCE_GROUND_TRUTH_DATASETS.contracts),
    ];

    const flaggedIds = new Set(detectedFlags.map((f) => f.entityId));
    let totalExposure = detectedFlags.reduce((sum, f) => sum + (f.financialExposureAed ?? 0), 0);

    let tp = 0;
    let fn = 0;
    for (const id of expectedAnomalyIds) {
      if (flaggedIds.has(id)) tp++;
      else fn++;
    }

    let tn = 0;
    let fp = 0;
    for (const id of expectedCleanIds) {
      if (!flaggedIds.has(id)) tn++;
      else fp++;
    }

    const metrics = calculateClassificationMetrics(tp, fp, tn, fn);
    const passed = metrics.decisionQualityScore >= 0.90 && metrics.falsePositiveRate <= 0.05;

    // Record Metrics
    await this.recordEvaluationMetric({
      agentId: 'finance-anomaly',
      tenantId: 'benchmark',
      metricCategory: 'ACCURACY',
      metricName: 'DECISION_QUALITY_SCORE',
      metricValue: metrics.decisionQualityScore,
      isPositiveOutcome: passed,
      notes: `TP: ${tp}, FP: ${fp}, TN: ${tn}, FN: ${fn}, Exposure: ${totalExposure.toFixed(2)} AED`,
    });

    return {
      suiteName: 'Finance Anomaly 8-Stream Ground Truth Benchmark',
      agentId: 'finance-anomaly',
      totalScenarios: tp + fp + tn + fn,
      metrics,
      passed,
      benchmarkDurationMs: Date.now() - t0,
      financialExposureDetectedAed: totalExposure,
    };
  }

  /**
   * Run Vehicle Reuse Ground-Truth Benchmark
   */
  async runVehicleReuseBenchmark(): Promise<BenchmarkSuiteResult> {
    const t0 = Date.now();
    const { evaluateVehicleReuse } = await import('../vehicle-reuse/evaluator');
    const { VEHICLE_REUSE_GROUND_TRUTH_DATASETS } = await import('./datasets');

    let tp = 0;
    let fp = 0;
    let tn = 0;
    let fn = 0;
    let totalSavingsAed = 0;

    // 1. Feasible Case (Expected: isFeasible = true)
    const res1 = await evaluateVehicleReuse(VEHICLE_REUSE_GROUND_TRUTH_DATASETS.feasibleStandard);
    if (res1.isFeasible) {
      tp++;
      totalSavingsAed += res1.financialSavingsAed;
    } else {
      fn++;
    }

    // 2. Deadhead Deficit Infeasible Case (Expected: isFeasible = false)
    const res2 = await evaluateVehicleReuse(VEHICLE_REUSE_GROUND_TRUTH_DATASETS.infeasibleDeadheadDeficit);
    if (!res2.isFeasible) {
      tn++;
    } else {
      fp++;
    }

    // 3. Capacity Deficit Infeasible Case (Expected: isFeasible = false)
    const res3 = await evaluateVehicleReuse(VEHICLE_REUSE_GROUND_TRUTH_DATASETS.infeasibleCapacityDeficit);
    if (!res3.isFeasible) {
      tn++;
    } else {
      fp++;
    }

    const metrics = calculateClassificationMetrics(tp, fp, tn, fn);
    const passed = metrics.decisionQualityScore >= 0.95 && metrics.falsePositiveRate === 0;

    await this.recordEvaluationMetric({
      agentId: 'vehicle-reuse',
      tenantId: 'benchmark',
      metricCategory: 'ACCURACY',
      metricName: 'DECISION_QUALITY_SCORE',
      metricValue: metrics.decisionQualityScore,
      isPositiveOutcome: passed,
      notes: `TP: ${tp}, FP: ${fp}, TN: ${tn}, FN: ${fn}, Savings: ${totalSavingsAed.toFixed(2)} AED`,
    });

    return {
      suiteName: 'Vehicle Reuse Inter-Trip Chaining Ground Truth Benchmark',
      agentId: 'vehicle-reuse',
      totalScenarios: tp + fp + tn + fn,
      metrics,
      passed,
      benchmarkDurationMs: Date.now() - t0,
      financialExposureDetectedAed: totalSavingsAed,
    };
  }

  /**
   * Run Compliance & Readiness Ground-Truth Benchmark
   */
  async runComplianceBenchmark(): Promise<BenchmarkSuiteResult> {
    const t0 = Date.now();
    const { evaluateFleetComplianceRisk } = await import('../compliance/fleet-risk');
    const { evaluateDriverReadiness } = await import('../compliance/driver-readiness');
    const { validateFtaInvoice } = await import('../compliance/fta-tax');
    const { COMPLIANCE_GROUND_TRUTH_DATASETS } = await import('./datasets');

    let tp = 0;
    let fp = 0;
    let tn = 0;
    let fn = 0;
    let totalRiskDetectedAed = 0;

    // 1. Fleet Risk Assessment (1 critical expired, 1 urgent, 1 upcoming, 2 compliant)
    const fleetRisk = evaluateFleetComplianceRisk(COMPLIANCE_GROUND_TRUTH_DATASETS.fleetDocuments);
    if (fleetRisk.criticalCount === 1 && fleetRisk.urgentCount === 1 && fleetRisk.upcomingCount === 1) {
      tp++;
      totalRiskDetectedAed += fleetRisk.criticalItems.reduce((s, c) => s + c.potentialFineAed, 0);
    } else {
      fn++;
    }

    // 2. Driver Readiness: Ready Driver (Expected: isEligible = true)
    const driverReadyRes = evaluateDriverReadiness(COMPLIANCE_GROUND_TRUTH_DATASETS.driverReady);
    if (driverReadyRes.isEligible) {
      tp++;
    } else {
      fn++;
    }

    // 3. Driver Readiness: Fatigued Driver (Expected: isEligible = false)
    const driverFatiguedRes = evaluateDriverReadiness(COMPLIANCE_GROUND_TRUTH_DATASETS.driverFatigued);
    if (!driverFatiguedRes.isEligible) {
      tn++;
      totalRiskDetectedAed += 2000;
    } else {
      fp++;
    }

    // 4. Driver Readiness: High Black Points (Expected: status = WARNING)
    const driverPointsRes = evaluateDriverReadiness(COMPLIANCE_GROUND_TRUTH_DATASETS.driverHighBlackPoints);
    if (driverPointsRes.status === 'WARNING') {
      tp++;
    } else {
      fn++;
    }

    // 5. FTA Tax: Valid Invoice (Expected: isValid = true)
    const invoiceValidRes = validateFtaInvoice(COMPLIANCE_GROUND_TRUTH_DATASETS.ftaInvoiceValid);
    if (invoiceValidRes.isValid) {
      tp++;
    } else {
      fn++;
    }

    // 6. FTA Tax: Invalid Invoice (Expected: isValid = false)
    const invoiceInvalidRes = validateFtaInvoice(COMPLIANCE_GROUND_TRUTH_DATASETS.ftaInvoiceInvalid);
    if (!invoiceInvalidRes.isValid) {
      tn++;
      totalRiskDetectedAed += invoiceInvalidRes.financialRiskAed;
    } else {
      fp++;
    }

    const metrics = calculateClassificationMetrics(tp, fp, tn, fn);
    const passed = metrics.decisionQualityScore >= 0.95 && metrics.falsePositiveRate === 0;

    await this.recordEvaluationMetric({
      agentId: 'compliance',
      tenantId: 'benchmark',
      metricCategory: 'ACCURACY',
      metricName: 'DECISION_QUALITY_SCORE',
      metricValue: metrics.decisionQualityScore,
      isPositiveOutcome: passed,
      notes: `TP: ${tp}, FP: ${fp}, TN: ${tn}, FN: ${fn}, Risk Detected: ${totalRiskDetectedAed.toFixed(2)} AED`,
    });

    return {
      suiteName: 'Fleet & Driver Regulatory Compliance Ground Truth Benchmark',
      agentId: 'compliance',
      totalScenarios: tp + fp + tn + fn,
      metrics,
      passed,
      benchmarkDurationMs: Date.now() - t0,
      financialExposureDetectedAed: totalRiskDetectedAed,
    };
  }
}

/** Global Shared Benchmark Runner Singleton */
export const benchmarkRunner = new BenchmarkRunner();

