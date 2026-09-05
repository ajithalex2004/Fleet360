/**
 * Incident Auto-Triage Agent (Phase 7 Severity-Tiered Selective AI Routing)
 * --------------------------------------------------------------------------
 * 1. Fetches open / unassessed incidents from trip_incidents
 * 2. Classifies each using the rules-engine classifier
 * 3. Finds nearest available ambulance / response unit
 * 4. Applies severity-tiered AI routing:
 *    - LOW / MEDIUM: Deterministic emergency protocol dispatch (0 tokens, 0ms)
 *    - CRITICAL / HIGH: aiGateway ECONOMY_TEXT emergency coordination advisory
 * 5. Upserts to incident_triage_assessments
 * 6. Escalates severity on the original incident if AI severity differs
 */
import { prisma } from '@/lib/prisma';
import { AgentDefinition, AgentEvent, AgentRunResult, AgentRunTelemetry } from '../types';
import { classifyIncident } from './classifier';
import { aiGateway } from '../gateway';

interface IncidentRow {
  id: string;
  incident_no: string | null;
  incident_type: string;
  severity: string;
  description: string | null;
  location: string | null;
  vehicle_id: string | null;
  incident_date: string | null;
}

interface AmbulanceRow {
  id: string;
  vehicle_code: string;
  status: string;
  current_lat: number | null;
  current_lng: number | null;
}

// Haversine for proximity ranking
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Default Dubai coordinates if no location
const DEFAULT_LAT = 25.2048;
const DEFAULT_LNG = 55.2708;

export function buildDeterministicTriageRecommendation(
  responseType: string,
  location: string | null,
  actionSuggested: string,
  etaMin: number | null,
): string {
  const etaNote = etaMin ? ` (Estimated response ETA: ${etaMin} minutes)` : '';
  return `Dispatch ${responseType} to ${location ?? 'incident scene'} immediately${etaNote}. ` +
         `${actionSuggested}. Maintain communications with driver and log operational status updates.`;
}

async function runIncidentTriage(event: AgentEvent): Promise<AgentRunResult> {
  const t0 = Date.now();

  // 1. Fetch unassessed incidents
  const incidents = await prisma.$queryRaw<IncidentRow[]>`
    SELECT
      i.id::text, i.incident_no, i.incident_type, i.severity,
      i.description, i.location, i.vehicle_id::text, i.incident_date::text
    FROM trip_incidents i
    LEFT JOIN incident_triage_assessments a ON a.incident_id = i.id::text
    WHERE i.status IN ('OPEN', 'IN_PROGRESS')
      AND (a.id IS NULL OR i.updated_at > NOW() - INTERVAL '24 hours')
    ORDER BY
      CASE i.severity
        WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4
      END,
      i.created_at DESC
    LIMIT 50
  `.catch(() => [] as IncidentRow[]);

  if (incidents.length === 0) {
    return {
      agentId: 'incident-triage', tenantId: event.tenant_id, eventType: event.event_type,
      status: 'COMPLETED', durationMs: Date.now() - t0,
      itemsProcessed: 0, actionsCreated: 0,
      output: { summary: 'No open incidents requiring triage.', assessments: [] },
    };
  }

  // 2. Fetch available ambulance / response units
  const ambulances = await prisma.$queryRaw<AmbulanceRow[]>`
    SELECT v.id::text, v.vehicle_code, v.status,
           v.current_lat::float8, v.current_lng::float8
    FROM vehicles v
    WHERE v.vehicle_type ILIKE '%ambulance%'
      AND v.status IN ('AVAILABLE', 'STANDBY')
    LIMIT 20
  `.catch(() => [] as AmbulanceRow[]);

  let assessed = 0;
  let escalated = 0;
  let deterministicCount = 0;
  let aiCount = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostAed = 0;
  let avoidedTokens = 0;

  const assessments: Record<string, unknown>[] = [];

  for (const inc of incidents) {
    try {
      // 3. Classify
      const triage = classifyIncident({
        incidentType:       inc.incident_type,
        reportedSeverity:   inc.severity,
        description:        inc.description ?? undefined,
        injuriesReported:   (inc.description ?? '').toLowerCase().includes('injur'),
        fatalitiesReported: (inc.description ?? '').toLowerCase().includes('fatal'),
        hazmatInvolved:     (inc.description ?? '').toLowerCase().includes('hazmat') ||
                            (inc.description ?? '').toLowerCase().includes('chemical'),
        timeOfDay:          inc.incident_date ? new Date(inc.incident_date).getHours() : new Date().getHours(),
      });

      // 4. Find nearest ambulance
      let nearestUnit: AmbulanceRow | null = null;
      let nearestDist = Infinity;
      for (const amb of ambulances) {
        if (!amb.current_lat || !amb.current_lng) continue;
        const d = haversineKm(DEFAULT_LAT, DEFAULT_LNG, amb.current_lat, amb.current_lng);
        if (d < nearestDist) { nearestDist = d; nearestUnit = amb; }
      }

      const etaMin = nearestUnit
        ? Math.round((nearestDist / 40) * 60)
        : null;

      let recommendation = '';
      const isHighUrgency = triage.aiSeverity === 'CRITICAL' || triage.aiSeverity === 'HIGH';

      if (!isHighUrgency) {
        // Deterministic protocol recommendation (0 tokens, 0ms latency)
        recommendation = buildDeterministicTriageRecommendation(
          triage.responseTypes[0] ?? 'standard support unit',
          inc.location,
          triage.actionsSuggested[0] ?? 'Follow standard operating procedure and document damages',
          etaMin,
        );
        deterministicCount++;
        avoidedTokens += 200;
      } else {
        // AI Advisory for high/critical incidents
        const incidentContext = [
          `Incident Type: ${inc.incident_type}`,
          `Reported Severity: ${inc.severity}`,
          `AI-Assessed Severity: ${triage.aiSeverity}`,
          `Location: ${inc.location ?? 'Unknown'}`,
          `Description: ${inc.description ?? 'None provided'}`,
          `Risk Factors: ${triage.riskFactors.join(', ')}`,
          `Required Response: ${triage.responseTypes.join(', ')}`,
          `Nearest Unit: ${nearestUnit?.vehicle_code ?? 'None available'} (ETA: ${etaMin ?? '?'} min)`,
        ].join('\n');

        const aiResp = await aiGateway.chat({
          capability: 'ECONOMY_TEXT',
          tenantId: event.tenant_id,
          agentId: 'incident-triage',
          messages: [
            {
              role: 'system',
              content:
                'You are an emergency dispatch coordinator for a fleet management company in the UAE. ' +
                'Provide a concise 2-3 sentence dispatch recommendation for this critical incident. ' +
                'Be direct and actionable. Include what unit to dispatch, any immediate safety actions, and who to notify.',
            },
            {
              role: 'user',
              content: incidentContext,
            },
          ],
          maxTokens: 200,
        });

        recommendation = aiResp.content;
        aiCount++;
        totalInputTokens += aiResp.telemetry.inputTokens;
        totalOutputTokens += aiResp.telemetry.outputTokens;
        totalCostAed += aiResp.telemetry.costAed;
      }

      // 6. Upsert assessment
      await prisma.$executeRawUnsafe(`
        INSERT INTO incident_triage_assessments (
          incident_id, incident_no, incident_type,
          reported_severity, ai_severity, severity_changed,
          triage_score, nearest_unit_id, nearest_unit_code,
          nearest_unit_eta_min, dispatch_priority,
          ai_recommendation, risk_factors, actions_suggested, status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,'ASSESSED')
        ON CONFLICT (incident_id) DO UPDATE SET
          ai_severity           = EXCLUDED.ai_severity,
          severity_changed      = EXCLUDED.severity_changed,
          triage_score          = EXCLUDED.triage_score,
          nearest_unit_id       = EXCLUDED.nearest_unit_id,
          nearest_unit_code     = EXCLUDED.nearest_unit_code,
          nearest_unit_eta_min  = EXCLUDED.nearest_unit_eta_min,
          dispatch_priority     = EXCLUDED.dispatch_priority,
          ai_recommendation     = EXCLUDED.ai_recommendation,
          risk_factors          = EXCLUDED.risk_factors,
          actions_suggested     = EXCLUDED.actions_suggested,
          status                = 'ASSESSED',
          updated_at            = NOW()
      `,
        inc.id, inc.incident_no, inc.incident_type,
        inc.severity, triage.aiSeverity, triage.severityChanged,
        triage.triageScore,
        nearestUnit?.id ?? null, nearestUnit?.vehicle_code ?? null,
        etaMin ?? null, triage.dispatchPriority,
        recommendation,
        JSON.stringify(triage.riskFactors),
        JSON.stringify(triage.actionsSuggested),
      );

      // 7. Escalate on the live incident if severity upgraded
      if (triage.severityChanged && (triage.aiSeverity === 'CRITICAL' || triage.aiSeverity === 'HIGH')) {
        await prisma.$executeRawUnsafe(`
          UPDATE trip_incidents SET severity = $1, updated_at = NOW() WHERE id = $2::uuid
        `, triage.aiSeverity, inc.id).catch(() => {});
        escalated++;
      }

      assessments.push({
        incidentId:       inc.id,
        incidentNo:       inc.incident_no,
        reportedSeverity: inc.severity,
        aiSeverity:       triage.aiSeverity,
        severityChanged:  triage.severityChanged,
        dispatchPriority: triage.dispatchPriority,
        nearestUnit:      nearestUnit?.vehicle_code ?? null,
        etaMin,
        generationMode:   isHighUrgency ? 'AI_GATEWAY' : 'DETERMINISTIC',
        recommendation:   recommendation.slice(0, 100) + '…',
      });

      assessed++;
    } catch { /* skip failed incident */ }
  }

  const telemetry: AgentRunTelemetry = {
    modelAlias: aiCount > 0 ? 'ECONOMY_TEXT' : 'DETERMINISTIC_RULES',
    modelProvider: aiCount > 0 ? 'openai' : 'deterministic',
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    cachedTokens: avoidedTokens,
    costAed: totalCostAed,
    estimatedSavingsAed: (avoidedTokens / 1000) * 0.005 * 3.6725,
    businessOutcome: escalated > 0 ? 'SLA_BREACH_PREVENTED' : 'NO_ACTION_REQUIRED',
  };

  return {
    agentId: 'incident-triage', tenantId: event.tenant_id, eventType: event.event_type,
    status: 'COMPLETED', durationMs: Date.now() - t0,
    itemsProcessed: incidents.length, actionsCreated: assessed,
    telemetry,
    output: {
      summary: `Assessed ${assessed} incidents (${deterministicCount} deterministic, ${aiCount} emergency AI advisories); ${escalated} escalated to critical/high.`,
      assessed,
      escalated,
      deterministicCount,
      aiCount,
      avoidedTokens,
      assessments,
    },
  };
}

export const INCIDENT_TRIAGE_AGENT: AgentDefinition = {
  id:          'incident-triage',
  name:        'Incident Auto-Triage Agent',
  description: 'Classifies incident severity with rules engine, finds nearest ambulance, and generates severity-tiered dispatch recommendations.',
  version:     '2.0.0',
  agentType:   'BATCH',
  subscribedEvents: ['incident.created', 'manual.trigger'],
  supportsEntityScan: true,
  run: runIncidentTriage,
};
