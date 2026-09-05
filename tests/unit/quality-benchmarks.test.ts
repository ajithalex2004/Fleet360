import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculateClassificationMetrics,
  benchmarkRunner,
} from '@/lib/agents/eval/benchmark-runner';
import { scoreVehicleComprehensive } from '@/lib/agents/predictive-maintenance/scoring';
import { scoreCandidate } from '@/lib/agents/dispatch-optimiser/scoring';
import {
  MAINTENANCE_GROUND_TRUTH_VEHICLE,
  DISPATCH_BENCHMARK_JOB,
  DISPATCH_BENCHMARK_CANDIDATES,
} from '@/lib/agents/eval/datasets';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/lib/agents/schema', () => ({
  ensureAgentSchema: vi.fn().mockResolvedValue(undefined),
}));

describe('Phase 9: AI Quality Evaluation, Regression Testing & Ground-Truth Benchmarks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Classification Metric Engine', () => {
    it('computes precision, recall, F1, and Decision Quality Score correctly', () => {
      const metrics = calculateClassificationMetrics(10, 0, 10, 0);
      expect(metrics.precision).toBe(1.0);
      expect(metrics.recall).toBe(1.0);
      expect(metrics.falsePositiveRate).toBe(0.0);
      expect(metrics.f1Score).toBe(1.0);
      expect(metrics.accuracy).toBe(1.0);
      expect(metrics.decisionQualityScore).toBe(1.0);
    });

    it('correctly reflects false positive penalties in decision quality score', () => {
      const metrics = calculateClassificationMetrics(8, 2, 8, 2);
      expect(metrics.precision).toBe(0.8);
      expect(metrics.recall).toBe(0.8);
      expect(metrics.falsePositiveRate).toBe(0.2);
      expect(metrics.decisionQualityScore).toBe(0.8);
    });
  });

  describe('Finance Anomaly Detection Ground-Truth Benchmark', () => {
    it('achieves >= 0.95 Decision Quality Score across all 8 operational streams', async () => {
      const result = await benchmarkRunner.runFinanceAnomalyBenchmark();

      expect(result.passed).toBe(true);
      expect(result.metrics.decisionQualityScore).toBeGreaterThanOrEqual(0.95);
      expect(result.metrics.precision).toBeGreaterThanOrEqual(0.95);
      expect(result.metrics.recall).toBeGreaterThanOrEqual(0.95);
      expect(result.metrics.falsePositiveRate).toBeLessThanOrEqual(0.05);
      expect(result.financialExposureDetectedAed).toBeGreaterThan(4000.0);
    });
  });

  describe('Predictive Maintenance 9-Signal Benchmark', () => {
    it('correctly flags high degradation vehicle with urgent service recommendation', () => {
      const score = scoreVehicleComprehensive(MAINTENANCE_GROUND_TRUTH_VEHICLE, 1.2);

      expect(score.riskScore).toBeGreaterThanOrEqual(0.70);
      expect(['HIGH', 'CRITICAL']).toContain(score.riskLevel);
      expect(['URGENT_SERVICE', 'GROUND_VEHICLE']).toContain(score.recommendedAction);
      expect(score.predictedFailureWindow).toBeDefined();
    });
  });

  describe('Smart Dispatch 15-Factor Scoring Benchmark', () => {
    it('favors compliant, low-deadhead vehicle over distant or high-risk vehicle', () => {
      const optimalScore = scoreCandidate(DISPATCH_BENCHMARK_CANDIDATES.optimal, DISPATCH_BENCHMARK_JOB);
      const distantScore = scoreCandidate(DISPATCH_BENCHMARK_CANDIDATES.distant, DISPATCH_BENCHMARK_JOB);

      expect(optimalScore.compositeScore).toBeGreaterThan(distantScore.compositeScore);
      expect(optimalScore.isBlocked).toBe(false);
      expect(distantScore.isBlocked).toBe(true); // vehicleRiskScore >= 0.75 triggers hard blocker
    });
  });
});
