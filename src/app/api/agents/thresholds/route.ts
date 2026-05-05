/**
 * GET  /api/agents/thresholds          — returns all agent threshold configs
 * PATCH /api/agents/thresholds         — updates one agent's thresholds
 *
 * Body (PATCH): { agentId: string; thresholds: Record<string, unknown> }
 *
 * Thresholds are stored in agent_configs.thresholds JSONB.
 * Table is created by /api/agents/ecosystem on first load.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Default thresholds per agent — used when no row exists yet
const DEFAULTS: Record<string, Record<string, unknown>> = {
  'predictive-maintenance': {
    autoWoRiskThreshold: 0.75,   // risk score ≥ this → auto-create work order
    label: 'Auto-WO risk threshold',
    min: 0.5, max: 1.0, step: 0.05, unit: '',
  },
  'finance-anomaly': {
    minConfidence: 0.70,          // confidence ≥ this → flag anomaly
    label: 'Min confidence to flag',
    min: 0.5, max: 1.0, step: 0.05, unit: '',
  },
  'route-optimiser': {
    autoApplyMinSavingsPct: 10,   // savings % ≥ this → auto-apply route
    label: 'Auto-apply min savings',
    min: 5, max: 30, step: 1, unit: '%',
  },
  'incident-triage': {
    autoEscalateAbove: 'HIGH',    // escalate if AI severity > current
    label: 'Auto-escalate severity',
    options: ['MEDIUM', 'HIGH', 'CRITICAL'],
  },
  'dispatch-optimiser': {
    minScoreDelta: 0.10,          // score advantage ≥ this → recommend
    label: 'Min score advantage',
    min: 0.05, max: 0.30, step: 0.05, unit: '',
  },
  'driver-coach': {
    ragScoreThreshold: 0.70,      // RAG score < this → generate coaching plan
    label: 'RAG score coaching trigger',
    min: 0.4, max: 0.9, step: 0.05, unit: '',
  },
  'demand-forecasting': {
    varianceAlertPct: 20,         // variance % > this → alert flag in output
    label: 'Variance alert threshold',
    min: 10, max: 50, step: 5, unit: '%',
  },
};

const DDL = `
  CREATE TABLE IF NOT EXISTS agent_configs (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id      TEXT        NOT NULL UNIQUE,
    thresholds    JSONB       NOT NULL DEFAULT '{}',
    schedule_cron TEXT,
    updated_at    TIMESTAMPTZ DEFAULT NOW()
  );
`;

export async function GET() {
  await prisma.$executeRawUnsafe(DDL).catch(() => {});

  const rows = await prisma.$queryRawUnsafe<{ agent_id: string; thresholds: string }[]>(
    `SELECT agent_id, thresholds::text FROM agent_configs`,
  ).catch(() => []);

  const stored: Record<string, Record<string, unknown>> = {};
  for (const row of rows) {
    try { stored[row.agent_id] = JSON.parse(row.thresholds); } catch { /* skip */ }
  }

  // Merge stored over defaults
  const result: Record<string, Record<string, unknown>> = {};
  for (const [agentId, defaults] of Object.entries(DEFAULTS)) {
    result[agentId] = { ...defaults, ...(stored[agentId] ?? {}) };
  }

  return NextResponse.json({ thresholds: result });
}

export async function PATCH(req: NextRequest) {
  const { agentId, thresholds } = await req.json() as {
    agentId: string;
    thresholds: Record<string, unknown>;
  };

  if (!agentId || !DEFAULTS[agentId]) {
    return NextResponse.json({ error: 'Unknown agentId' }, { status: 400 });
  }

  await prisma.$executeRawUnsafe(DDL).catch(() => {});

  // Upsert — merge incoming thresholds with existing
  await prisma.$executeRawUnsafe(
    `INSERT INTO agent_configs (agent_id, thresholds, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (agent_id) DO UPDATE
       SET thresholds = agent_configs.thresholds || $2::jsonb,
           updated_at = NOW()`,
    agentId,
    JSON.stringify(thresholds),
  );

  return NextResponse.json({ ok: true, agentId, thresholds });
}
