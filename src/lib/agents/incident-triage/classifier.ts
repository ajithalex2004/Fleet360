/**
 * Incident Triage Classifier
 * ---------------------------
 * Rules-engine that classifies incident severity, computes a triage score,
 * and identifies required response type — all in <1ms, zero API calls.
 *
 * GPT-4o is called separately in agent.ts for the human-readable recommendation.
 */

export type AiSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type DispatchPriority = 'P1' | 'P2' | 'P3' | 'URGENT' | 'STANDARD';
export type ResponseType = 'AMBULANCE_ALS' | 'AMBULANCE_BLS' | 'POLICE' | 'FIRE' | 'FLEET_RESPONSE' | 'MONITOR';

export interface IncidentInput {
  incidentType: string;          // e.g. 'ACCIDENT', 'MEDICAL', 'FIRE', 'BREAKDOWN'
  reportedSeverity: string;      // what the reporter said: CRITICAL/HIGH/MEDIUM/LOW
  description?: string;
  injuriesReported?: boolean;
  fatalitiesReported?: boolean;
  vehiclesInvolved?: number;
  locationDescription?: string;
  hazmatInvolved?: boolean;
  timeOfDay?: number;            // hour 0-23
}

export interface TriageResult {
  aiSeverity: AiSeverity;
  severityChanged: boolean;
  triageScore: number;           // 0.000–1.000
  dispatchPriority: DispatchPriority;
  responseTypes: ResponseType[];
  riskFactors: string[];
  actionsSuggested: string[];
  ambulanceRequired: boolean;
  estimatedResponseTargetMin: number; // target response time
}

// ── Incident Type Severity Map ─────────────────────────────────────────────────
const TYPE_BASE_SEVERITY: Record<string, AiSeverity> = {
  CARDIAC_ARREST:    'CRITICAL',
  UNCONSCIOUS:       'CRITICAL',
  FIRE:              'CRITICAL',
  MULTI_VEHICLE:     'HIGH',
  ACCIDENT:          'HIGH',
  MEDICAL:           'HIGH',
  HAZMAT:            'CRITICAL',
  VEHICLE_ROLLOVER:  'CRITICAL',
  PEDESTRIAN_HIT:    'CRITICAL',
  BREAKDOWN:         'LOW',
  FLAT_TYRE:         'LOW',
  THEFT:             'MEDIUM',
  VANDALISM:         'MEDIUM',
  NEAR_MISS:         'LOW',
  FUEL_SPILLAGE:     'HIGH',
  DRIVER_ASSAULT:    'HIGH',
  WEATHER_INCIDENT:  'MEDIUM',
};

// ── Escalation Rules ──────────────────────────────────────────────────────────
function escalate(base: AiSeverity): AiSeverity {
  if (base === 'LOW') return 'MEDIUM';
  if (base === 'MEDIUM') return 'HIGH';
  if (base === 'HIGH') return 'CRITICAL';
  return 'CRITICAL';
}

// ── Severity → Score ──────────────────────────────────────────────────────────
const SEVERITY_SCORES: Record<AiSeverity, number> = {
  CRITICAL: 0.90,
  HIGH:     0.65,
  MEDIUM:   0.40,
  LOW:      0.15,
};

// ── Severity → Dispatch Priority ──────────────────────────────────────────────
const SEVERITY_PRIORITY: Record<AiSeverity, DispatchPriority> = {
  CRITICAL: 'P1',
  HIGH:     'P2',
  MEDIUM:   'P3',
  LOW:      'STANDARD',
};

// ── Response Types by Incident ─────────────────────────────────────────────────
function getResponseTypes(type: string, severity: AiSeverity): ResponseType[] {
  const responses: ResponseType[] = [];
  const upper = type.toUpperCase();

  if (['CARDIAC_ARREST', 'UNCONSCIOUS', 'MEDICAL'].includes(upper) || severity === 'CRITICAL') {
    responses.push(severity === 'CRITICAL' ? 'AMBULANCE_ALS' : 'AMBULANCE_BLS');
  }
  if (['FIRE', 'HAZMAT', 'FUEL_SPILLAGE'].includes(upper)) responses.push('FIRE');
  if (['THEFT', 'VANDALISM', 'DRIVER_ASSAULT', 'ACCIDENT', 'MULTI_VEHICLE', 'PEDESTRIAN_HIT'].includes(upper)) {
    responses.push('POLICE');
  }
  if (['BREAKDOWN', 'FLAT_TYRE', 'NEAR_MISS'].includes(upper)) responses.push('FLEET_RESPONSE');

  if (responses.length === 0) responses.push('MONITOR');

  return responses;
}

// ── Response Time Targets ──────────────────────────────────────────────────────
const RESPONSE_TIME_TARGETS: Record<DispatchPriority, number> = {
  P1:       8,   // 8 min — life-threatening
  P2:       15,  // 15 min — serious
  P3:       30,  // 30 min — non-urgent
  URGENT:   20,
  STANDARD: 60,
};

// ── Main Classifier ───────────────────────────────────────────────────────────
export function classifyIncident(input: IncidentInput): TriageResult {
  const upperType = (input.incidentType ?? 'UNKNOWN').toUpperCase();
  let aiSeverity: AiSeverity = TYPE_BASE_SEVERITY[upperType] ?? (input.reportedSeverity as AiSeverity) ?? 'MEDIUM';

  const riskFactors: string[] = [];
  const actionsSuggested: string[] = [];

  // ── Hard escalation rules ────────────────────────────────────────────────
  if (input.fatalitiesReported) {
    aiSeverity = 'CRITICAL';
    riskFactors.push('Fatalities reported — immediate CRITICAL classification');
    actionsSuggested.push('Dispatch ALS ambulance immediately');
    actionsSuggested.push('Notify police and NOK protocol');
  }

  if (input.injuriesReported && aiSeverity !== 'CRITICAL') {
    aiSeverity = escalate(aiSeverity);
    riskFactors.push('Injuries confirmed — severity escalated');
    actionsSuggested.push('Dispatch medical response');
  }

  if (input.hazmatInvolved) {
    aiSeverity = 'CRITICAL';
    riskFactors.push('Hazmat / chemical spill — full emergency protocol');
    actionsSuggested.push('Evacuate 200m radius');
    actionsSuggested.push('Notify hazmat team and fire brigade');
  }

  if ((input.vehiclesInvolved ?? 0) >= 3) {
    if (aiSeverity === 'LOW' || aiSeverity === 'MEDIUM') aiSeverity = escalate(aiSeverity);
    riskFactors.push(`${input.vehiclesInvolved} vehicles involved — multi-vehicle incident`);
    actionsSuggested.push('Request additional response units');
  }

  // Night-time escalation (higher risk between 22:00–05:00)
  const hour = input.timeOfDay ?? new Date().getHours();
  if (hour >= 22 || hour <= 5) {
    riskFactors.push('Night-time incident — reduced visibility, delayed response risk');
    actionsSuggested.push('Activate night-shift supervisor notification');
  }

  // ── Severity change detection ────────────────────────────────────────────
  const reportedNorm = (input.reportedSeverity ?? 'MEDIUM').toUpperCase() as AiSeverity;
  const severityChanged = reportedNorm !== aiSeverity;
  if (severityChanged) {
    riskFactors.push(`AI severity (${aiSeverity}) differs from reported (${reportedNorm})`);
  }

  // ── Standard actions by severity ─────────────────────────────────────────
  if (aiSeverity === 'CRITICAL' || aiSeverity === 'HIGH') {
    actionsSuggested.push('Notify fleet operations manager');
    actionsSuggested.push('Document for insurance and compliance');
  }
  if (aiSeverity === 'LOW') {
    actionsSuggested.push('Log in maintenance register');
    actionsSuggested.push('Schedule follow-up inspection');
  }

  const dispatchPriority = SEVERITY_PRIORITY[aiSeverity];
  const responseTypes = getResponseTypes(upperType, aiSeverity);
  const triageScore = SEVERITY_SCORES[aiSeverity];

  return {
    aiSeverity,
    severityChanged,
    triageScore,
    dispatchPriority,
    responseTypes,
    riskFactors,
    actionsSuggested,
    ambulanceRequired: responseTypes.includes('AMBULANCE_ALS') || responseTypes.includes('AMBULANCE_BLS'),
    estimatedResponseTargetMin: RESPONSE_TIME_TARGETS[dispatchPriority],
  };
}
