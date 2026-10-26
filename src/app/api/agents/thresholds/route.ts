export const dynamic = 'force-dynamic';

/**
 * GET  /api/agents/thresholds          — returns all agent threshold configs
 * PATCH /api/agents/thresholds         — updates one agent's thresholds
 *
 * Body (PATCH): { agentId: string; thresholds: Record<string, unknown> }
 *
 * Thresholds are stored in agent_configs.thresholds JSONB.
 * agent_configs is platform-global (one row per agent, no tenant_id — see
 * prisma/migrations/20260910000023_agent_configs_table), so a PATCH changes
 * the value for every tenant: it is SUPER_ADMIN only, and only the known
 * threshold key of each agent, within its min/max or options, is accepted.
 */
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
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

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
      const rows = await tx.$queryRawUnsafe<{ agent_id: string; thresholds: string }[]>(
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
  });
}

const META_KEYS = new Set(['label', 'min', 'max', 'step', 'unit', 'options']);

/** Keep only the agent's own threshold keys, each within its bounds. */
function validateThresholds(
  defaults: Record<string, unknown>,
  input: unknown,
): { ok: true; thresholds: Record<string, unknown> } | { ok: false; error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'thresholds must be an object' };
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (META_KEYS.has(key) || !(key in defaults)) {
      return { ok: false, error: `Unknown threshold '${key}'` };
    }
    const options = defaults.options as unknown[] | undefined;
    if (options) {
      if (!options.includes(value)) return { ok: false, error: `${key} must be one of ${options.join(', ')}` };
    } else {
      const min = defaults.min as number;
      const max = defaults.max as number;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
        return { ok: false, error: `${key} must be a number between ${min} and ${max}` };
      }
    }
    out[key] = value;
  }
  if (Object.keys(out).length === 0) return { ok: false, error: 'No thresholds given' };
  return { ok: true, thresholds: out };
}

export async function PATCH(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  if (authz.role !== 'SUPER_ADMIN') {
    return NextResponse.json(
      { error: 'Agent thresholds are platform-wide; only a platform admin can change them' },
      { status: 403 },
    );
  }

  return withTenantRls(prisma, tenantId, async (tx) => {
    const bodyRaw = await req.json() as {
        agentId: string;
        thresholds: Record<string, unknown>;
      };
    const body = stripTenantOwnershipFields(bodyRaw);
    const { agentId } = body;

      if (!agentId || !Object.prototype.hasOwnProperty.call(DEFAULTS, agentId)) {
        return NextResponse.json({ error: 'Unknown agentId' }, { status: 400 });
      }
      const checked = validateThresholds(DEFAULTS[agentId], body.thresholds);
      if (!checked.ok) {
        return NextResponse.json({ error: checked.error }, { status: 400 });
      }
      const { thresholds } = checked;

      // Upsert — merge incoming thresholds with existing
      await tx.$executeRawUnsafe(
        `INSERT INTO agent_configs (agent_id, thresholds, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (agent_id) DO UPDATE
           SET thresholds = agent_configs.thresholds || $2::jsonb,
               updated_at = NOW()`,
        agentId,
        JSON.stringify(thresholds),
      );

      return NextResponse.json({ ok: true, agentId, thresholds });
  });
}

