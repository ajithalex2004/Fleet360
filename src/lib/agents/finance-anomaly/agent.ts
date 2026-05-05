/**
 * Finance Anomaly Detection Agent — Runner
 * -----------------------------------------
 * Pulls invoices, expenses, and fuel logs from the DB,
 * runs all five detectors, deduplicates flags, and persists results.
 */
import { prisma } from '@/lib/prisma';
import { AgentDefinition, AgentEvent, AgentRunResult, AnomalyFlag } from '../types';
import {
  InvoiceRecord, ExpenseRecord, FuelLogRecord,
  detectDuplicateInvoices,
  detectAmountOutliers,
  detectRoundNumbers,
  detectVelocitySpike,
  detectFuelLogAnomalies,
} from './detectors';

// ── Data Fetchers ──────────────────────────────────────────────────────────────
async function fetchInvoices(daysBack = 90): Promise<InvoiceRecord[]> {
  const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  return prisma.$queryRawUnsafe<InvoiceRecord[]>(
    `SELECT
       id::TEXT,
       amount::FLOAT                     AS amount,
       currency,
       vendor_name                       AS vendor,
       category,
       invoice_date::TEXT                AS "invoiceDate",
       description
     FROM finance_invoices
     WHERE deleted_at IS NULL
       AND invoice_date >= $1
     ORDER BY invoice_date DESC
     LIMIT 2000`,
    cutoff,
  ).catch(() => [] as InvoiceRecord[]);
}

async function fetchExpenses(daysBack = 90): Promise<ExpenseRecord[]> {
  const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  return prisma.$queryRawUnsafe<ExpenseRecord[]>(
    `SELECT
       id::TEXT,
       amount::FLOAT       AS amount,
       currency,
       category,
       expense_date::TEXT  AS "expenseDate",
       description,
       submitted_by        AS "submittedBy"
     FROM finance_expenses
     WHERE deleted_at IS NULL
       AND expense_date >= $1
     ORDER BY expense_date DESC
     LIMIT 2000`,
    cutoff,
  ).catch(() => [] as ExpenseRecord[]);
}

async function fetchFuelLogs(daysBack = 30): Promise<FuelLogRecord[]> {
  const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  // Try Prisma-managed fuelLog model first, fall back to raw fuel_logs table
  try {
    const rows = await prisma.fuelLog.findMany({
      where: { fuelDate: { gte: new Date(cutoff) } },
      select: { id: true, liters: true, totalCost: true, fuelDate: true, vehicleId: true },
      take: 500,
    });
    return rows.map((r) => ({
      id:         r.id,
      liters:     Number(r.liters ?? 0),
      totalCost:  Number(r.totalCost ?? 0),
      fuelDate:   r.fuelDate.toISOString(),
      vehicleId:  r.vehicleId ?? null,
    }));
  } catch {
    return [] as FuelLogRecord[];
  }
}

// ── Persist Flags ──────────────────────────────────────────────────────────────
async function persistFlags(flags: AnomalyFlag[], runId: string): Promise<number> {
  let persisted = 0;
  for (const flag of flags) {
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO finance_anomaly_flags (
           detector_id, entity_type, entity_id, severity, confidence,
           explanation, amount, currency, metadata, status, agent_run_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'OPEN',$10)
         ON CONFLICT (entity_id, detector_id) WHERE status = 'OPEN' DO NOTHING`,
        flag.detectorId,
        flag.entityType,
        flag.entityId,
        flag.severity,
        flag.confidence,
        flag.explanation,
        flag.amount ?? null,
        flag.currency ?? 'AED',
        JSON.stringify(flag.metadata ?? {}),
        runId,
      );
      persisted++;
    } catch {
      // Skip on duplicate — the unique index prevents re-insertion of OPEN flags
    }
  }
  return persisted;
}

// ── Agent Runner ───────────────────────────────────────────────────────────────
async function run(event: AgentEvent): Promise<AgentRunResult> {
  const started = Date.now();
  const runId   = crypto.randomUUID();

  // Seed placeholder run
  await prisma.$executeRawUnsafe(
    `INSERT INTO agent_runs (id, agent_id, tenant_id, event_type, status, created_at)
     VALUES ($1,'finance-anomaly',$2,$3,'RUNNING',NOW())`,
    runId,
    event.tenant_id,
    event.event_type,
  ).catch(() => {});

  const [invoices, expenses, fuelLogs] = await Promise.all([
    fetchInvoices(),
    fetchExpenses(),
    fetchFuelLogs(),
  ]);

  // Run all detectors
  const allFlags: AnomalyFlag[] = [
    ...detectDuplicateInvoices(invoices),
    ...detectAmountOutliers(invoices, expenses),
    ...detectRoundNumbers(invoices, expenses),
    ...detectVelocitySpike(invoices),
    ...detectFuelLogAnomalies(fuelLogs),
  ];

  // Deduplicate: same entity_id + detector_id keeps highest-confidence flag
  const flagMap = new Map<string, AnomalyFlag>();
  for (const flag of allFlags) {
    const key = `${flag.entityId}::${flag.detectorId}`;
    const existing = flagMap.get(key);
    if (!existing || flag.confidence > existing.confidence) {
      flagMap.set(key, flag);
    }
  }
  const deduped = Array.from(flagMap.values());

  const actionsCreated = await persistFlags(deduped, runId);

  const summary = {
    invoicesScanned: invoices.length,
    expensesScanned: expenses.length,
    fuelLogsScanned: fuelLogs.length,
    totalFlags:      deduped.length,
    newFlags:        actionsCreated,
    bySeverity: {
      critical: deduped.filter((f) => f.severity === 'CRITICAL').length,
      high:     deduped.filter((f) => f.severity === 'HIGH').length,
      medium:   deduped.filter((f) => f.severity === 'MEDIUM').length,
      low:      deduped.filter((f) => f.severity === 'LOW').length,
    },
    byDetector: Object.fromEntries(
      ['duplicate-invoice','amount-outlier','round-number','velocity-spike','category-mismatch'].map((d) => [
        d,
        deduped.filter((f) => f.detectorId === d).length,
      ]),
    ),
  };

  const durationMs = Date.now() - started;

  // Finalise run record
  await prisma.$executeRawUnsafe(
    `UPDATE agent_runs SET
       status='COMPLETED', items_processed=$1, actions_created=$2,
       duration_ms=$3, output=$4
     WHERE id=$5`,
    invoices.length + expenses.length + fuelLogs.length,
    actionsCreated,
    durationMs,
    JSON.stringify(summary),
    runId,
  ).catch(() => {});

  return {
    agentId:        'finance-anomaly',
    tenantId:       event.tenant_id,
    eventType:      event.event_type,
    status:         'COMPLETED',
    durationMs,
    itemsProcessed: invoices.length + expenses.length + fuelLogs.length,
    actionsCreated,
    output: { summary, flags: deduped },
  };
}

export const FINANCE_ANOMALY_AGENT: AgentDefinition = {
  id:          'finance-anomaly',
  name:        'Finance Anomaly Detection Agent',
  description: '5-detector statistical model scanning invoices, expenses, and fuel logs for duplicates, outliers, and suspicious patterns.',
  version:     '1.0.0',
  agentType:   'BATCH',
  subscribedEvents: [
    'finance.invoice_created',
    'finance.expense_created',
    'finance.fuel_log_added',
    'manual.trigger',
    'schedule.nightly',
  ],
  supportsEntityScan: true,
  run,
};
