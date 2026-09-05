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
}

/** Global Shared Benchmark Runner Singleton */
export const benchmarkRunner = new BenchmarkRunner();
