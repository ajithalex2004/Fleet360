/**
 * Trip Merge Recommendation Engine
 *
 * Three-stage approach:
 *   Stage 1 — Haversine pre-filter   : instant, rejects obviously too-far pairs
 *   Stage 2 — Routing API road dist  : GOOGLE_MAPS | OSRM | MAPBOX | STRAIGHT_LINE
 *   Stage 3 — Score & rank           : weighted merge score (0-100)
 *
 * Hard constraints (all must pass before scoring):
 *   - Same service type
 *   - Pickup road distance ≤ config.pickupDistanceKm
 *   - Pickup time difference ≤ config.pickupTimeWindowMin
 *   - Combined passenger count ≤ config.maxPassengers
 *   - If requireDropoffMatch: dropoff road distance ≤ config.dropoffDistanceKm
 *
 * Scoring weights:
 *   40% — pickup proximity score
 *   30% — time window score
 *   20% — dropoff proximity score (or 0 if not required)
 *   10% — capacity headroom score
 */

import { prisma } from '@/lib/prisma';

/* ─────────────── Types ─────────────── */
export type RoutingEngine = 'GOOGLE_MAPS' | 'OSRM' | 'MAPBOX' | 'STRAIGHT_LINE';

export interface GeoPoint { lat: number; lng: number; }

export interface MergeConfig {
  pickupDistanceKm:     number;   // max road km between pickup points
  pickupTimeWindowMin:  number;   // max minutes between scheduled pickups
  requireDropoffMatch:  boolean;
  dropoffDistanceKm:    number;
  dropoffTimeWindowMin: number;
  maxPassengers:        number;
  travelSpeedKmh:       number;
  roadDistanceMultiplier: number; // used as fallback multiplier
  routingEngine:        RoutingEngine;
  googleMapsApiKey?:    string;
  mapboxToken?:         string;
  osrmBaseUrl?:         string;   // defaults to public OSRM
}

export interface MergeJob {
  id:                  string;
  service_type:        string;
  priority:            string;
  status:              string;
  origin_lat?:         number;
  origin_lng?:         number;
  dest_lat?:           number;
  dest_lng?:           number;
  origin_address?:     string;
  destination_address?: string;
  scheduled_pickup?:   string;   // ISO datetime
  passenger_count?:    number;
  created_at:          string;
}

export interface MergeCandidate {
  targetJobId:          string;
  candidateJobId:       string;
  candidateJob:         MergeJob;
  eligible:             boolean;
  mergeScore:           number;       // 0–100
  pickupRoadDistKm:     number;
  pickupTimeDiffMin:    number;
  dropoffRoadDistKm?:   number;
  dropoffTimeDiffMin?:  number;
  combinedPassengers:   number;
  estimatedSavingKm:    number;       // estimated km saved by merging
  failReasons:          string[];     // why ineligible (if !eligible)
  mergeReasons:         string[];     // human-readable merge benefits
  routingSource:        RoutingEngine;
}

/* ─────────────── In-memory road distance cache (1 h TTL) ─────────────── */
const _cache = new Map<string, { km: number; ts: number; source: RoutingEngine }>();
const CACHE_TTL = 3_600_000; // 1 hour

function _cacheKey(a: GeoPoint, b: GeoPoint) {
  return `${a.lat.toFixed(4)},${a.lng.toFixed(4)}|${b.lat.toFixed(4)},${b.lng.toFixed(4)}`;
}

/* ─────────────── Stage 1: Haversine ─────────────── */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R    = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const h    = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) *
    Math.cos(b.lat * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

/* ─────────────── Stage 2: Routing API road distance ─────────────── */
export async function getRoadDistanceKm(
  origin: GeoPoint,
  dest:   GeoPoint,
  engine: RoutingEngine,
  opts: {
    googleMapsApiKey?: string;
    mapboxToken?:      string;
    osrmBaseUrl?:      string;
    multiplier?:       number;
  } = {}
): Promise<{ km: number; source: RoutingEngine }> {
  const key = _cacheKey(origin, dest);
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return { km: hit.km, source: hit.source };

  let km: number;
  let source: RoutingEngine = engine;

  try {
    if (engine === 'GOOGLE_MAPS' && opts.googleMapsApiKey) {
      /* ── Google Maps Distance Matrix API ── */
      const url = `https://maps.googleapis.com/maps/api/distancematrix/json` +
        `?origins=${origin.lat},${origin.lng}` +
        `&destinations=${dest.lat},${dest.lng}` +
        `&mode=driving&units=metric` +
        `&key=${opts.googleMapsApiKey}`;
      const res  = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      const elem = data?.rows?.[0]?.elements?.[0];
      if (elem?.status === 'OK') {
        km = elem.distance.value / 1000;          // metres → km
      } else {
        throw new Error(`Google Maps: ${elem?.status ?? 'no element'}`);
      }

    } else if (engine === 'MAPBOX' && opts.mapboxToken) {
      /* ── Mapbox Directions API ── */
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving` +
        `/${origin.lng},${origin.lat};${dest.lng},${dest.lat}` +
        `?geometries=geojson&overview=false` +
        `&access_token=${opts.mapboxToken}`;
      const res  = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      if (data?.routes?.[0]) {
        km = data.routes[0].distance / 1000;      // metres → km
      } else {
        throw new Error('Mapbox: no route returned');
      }

    } else {
      /* ── OSRM (default — free, no API key) ── */
      const base = opts.osrmBaseUrl ?? 'https://router.project-osrm.org';
      const url  = `${base}/route/v1/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}` +
        `?overview=false&geometries=geojson`;
      const res  = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const data = await res.json();
      if (data?.routes?.[0]) {
        km     = data.routes[0].distance / 1000;  // metres → km
        source = 'OSRM';
      } else {
        throw new Error('OSRM: no route returned');
      }
    }
  } catch (err) {
    /* ── Fallback: Haversine × multiplier ── */
    console.warn(`[merge] Routing API failed (${engine}), using straight-line fallback:`, err);
    km     = haversineKm(origin, dest) * (opts.multiplier ?? 1.5);
    source = 'STRAIGHT_LINE';
  }

  _cache.set(key, { km, ts: Date.now(), source });
  return { km, source };
}

/* ─────────────── Time difference helper ─────────────── */
function timeDiffMin(a?: string, b?: string): number {
  if (!a || !b) return 0;
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 60_000;
}

/* ─────────────── Estimated distance saving ─────────────── */
function estimateSavingKm(
  pickupDistKm: number,
  dropoffDistKm: number | undefined,
): number {
  // Heuristic: merging two separate trips saves roughly:
  //   (pickup detour) + 0.5 × (dropoff detour, if routes overlap)
  return parseFloat(
    (pickupDistKm * 0.8 + (dropoffDistKm ?? 0) * 0.4).toFixed(1)
  );
}

/* ─────────────── Core eligibility + scoring for one pair ─────────────── */
export async function evaluatePair(
  target:    MergeJob,
  candidate: MergeJob,
  config:    MergeConfig,
): Promise<MergeCandidate> {
  const failReasons: string[]  = [];
  const mergeReasons: string[] = [];

  /* ── Service type must match ── */
  if (target.service_type !== candidate.service_type) {
    failReasons.push(`Service type mismatch: ${target.service_type} vs ${candidate.service_type}`);
  }

  /* ── Coordinates available? ── */
  const hasOriginA = target.origin_lat    && target.origin_lng;
  const hasOriginB = candidate.origin_lat && candidate.origin_lng;
  if (!hasOriginA || !hasOriginB) {
    failReasons.push('Missing GPS coordinates for pickup distance check');
  }

  /* ── Stage 1: Haversine pre-filter (fast reject) ── */
  let pickupHaversine = 0;
  if (hasOriginA && hasOriginB) {
    pickupHaversine = haversineKm(
      { lat: target.origin_lat!,    lng: target.origin_lng! },
      { lat: candidate.origin_lat!, lng: candidate.origin_lng! },
    );
    // Reject if Haversine already > 2× the configured distance (can't possibly pass road check)
    if (pickupHaversine > config.pickupDistanceKm * 2) {
      failReasons.push(`Pickup too far: ${pickupHaversine.toFixed(1)} km Haversine (limit × 2 = ${(config.pickupDistanceKm * 2).toFixed(1)} km)`);
    }
  }

  /* ── Pickup time window ── */
  const pickupTimeDiff = timeDiffMin(target.scheduled_pickup, candidate.scheduled_pickup);
  if (pickupTimeDiff > config.pickupTimeWindowMin) {
    failReasons.push(`Pickup time gap ${pickupTimeDiff.toFixed(0)} min exceeds window ${config.pickupTimeWindowMin} min`);
  }

  /* ── Passenger capacity ── */
  const combinedPax = (target.passenger_count ?? 1) + (candidate.passenger_count ?? 1);
  if (combinedPax > config.maxPassengers) {
    failReasons.push(`Combined ${combinedPax} passengers exceeds max ${config.maxPassengers}`);
  }

  /* ── If already failing on fast checks, skip the expensive API call ── */
  if (failReasons.length > 0) {
    return {
      targetJobId: target.id, candidateJobId: candidate.id, candidateJob: candidate,
      eligible: false, mergeScore: 0,
      pickupRoadDistKm: pickupHaversine, pickupTimeDiffMin: pickupTimeDiff,
      combinedPassengers: combinedPax, estimatedSavingKm: 0,
      failReasons, mergeReasons: [], routingSource: 'STRAIGHT_LINE',
    };
  }

  /* ── Stage 2: Routing API road distance for pickup ── */
  const { km: pickupRoadKm, source: routeSource } = await getRoadDistanceKm(
    { lat: target.origin_lat!,    lng: target.origin_lng! },
    { lat: candidate.origin_lat!, lng: candidate.origin_lng! },
    config.routingEngine,
    {
      googleMapsApiKey: config.googleMapsApiKey,
      mapboxToken:      config.mapboxToken,
      osrmBaseUrl:      config.osrmBaseUrl,
      multiplier:       config.roadDistanceMultiplier,
    },
  );

  if (pickupRoadKm > config.pickupDistanceKm) {
    failReasons.push(`Pickup road distance ${pickupRoadKm.toFixed(1)} km exceeds limit ${config.pickupDistanceKm} km (via ${routeSource})`);
  } else {
    mergeReasons.push(`Pickup locations ${pickupRoadKm.toFixed(1)} km apart (within ${config.pickupDistanceKm} km)`);
  }

  /* ── Dropoff check (if required) ── */
  let dropoffRoadKm: number | undefined;
  let dropoffTimeDiff: number | undefined;
  const hasDropoffA = target.dest_lat    && target.dest_lng;
  const hasDropoffB = candidate.dest_lat && candidate.dest_lng;

  if (config.requireDropoffMatch) {
    if (hasDropoffA && hasDropoffB) {
      const res = await getRoadDistanceKm(
        { lat: target.dest_lat!,    lng: target.dest_lng! },
        { lat: candidate.dest_lat!, lng: candidate.dest_lng! },
        config.routingEngine,
        {
          googleMapsApiKey: config.googleMapsApiKey,
          mapboxToken:      config.mapboxToken,
          osrmBaseUrl:      config.osrmBaseUrl,
          multiplier:       config.roadDistanceMultiplier,
        },
      );
      dropoffRoadKm = res.km;

      if (dropoffRoadKm > config.dropoffDistanceKm) {
        failReasons.push(`Dropoff road distance ${dropoffRoadKm.toFixed(1)} km exceeds limit ${config.dropoffDistanceKm} km`);
      } else {
        mergeReasons.push(`Dropoffs ${dropoffRoadKm.toFixed(1)} km apart (within ${config.dropoffDistanceKm} km)`);
      }
    } else {
      failReasons.push('Dropoff match required but coordinates missing');
    }
  }

  if (pickupTimeDiff === 0) {
    mergeReasons.push('Same departure time — ideal merge candidate');
  } else if (pickupTimeDiff <= config.pickupTimeWindowMin / 2) {
    mergeReasons.push(`Only ${pickupTimeDiff.toFixed(0)} min time gap — well within window`);
  } else {
    mergeReasons.push(`${pickupTimeDiff.toFixed(0)} min time gap (limit ${config.pickupTimeWindowMin} min)`);
  }

  if (combinedPax <= config.maxPassengers) {
    mergeReasons.push(`${combinedPax} passengers total — capacity OK`);
  }

  const eligible = failReasons.length === 0;

  /* ── Stage 3: Score calculation ── */
  let score = 0;
  if (eligible) {
    const proxScore  = Math.max(0, 1 - pickupRoadKm  / config.pickupDistanceKm)  * 40;
    const timeScore  = Math.max(0, 1 - pickupTimeDiff / config.pickupTimeWindowMin) * 30;
    const dropScore  = config.requireDropoffMatch && dropoffRoadKm !== undefined
      ? Math.max(0, 1 - dropoffRoadKm / config.dropoffDistanceKm) * 20
      : 20; // full score if no dropoff match required
    const capScore   = Math.max(0, 1 - combinedPax / config.maxPassengers) * 10;
    score = Math.round(proxScore + timeScore + dropScore + capScore);
  }

  return {
    targetJobId:      target.id,
    candidateJobId:   candidate.id,
    candidateJob:     candidate,
    eligible,
    mergeScore:       score,
    pickupRoadDistKm: parseFloat(pickupRoadKm.toFixed(2)),
    pickupTimeDiffMin: parseFloat(pickupTimeDiff.toFixed(1)),
    dropoffRoadDistKm: dropoffRoadKm !== undefined ? parseFloat(dropoffRoadKm.toFixed(2)) : undefined,
    dropoffTimeDiffMin: dropoffTimeDiff,
    combinedPassengers: combinedPax,
    estimatedSavingKm: estimateSavingKm(pickupRoadKm, dropoffRoadKm),
    failReasons,
    mergeReasons,
    routingSource: routeSource,
  };
}

/* ─────────────── Main: get all merge candidates for a job ─────────────── */
export async function getMergeCandidates(
  jobId:    string,
  tenantId: string,
): Promise<{ candidates: MergeCandidate[]; config: MergeConfig; targetJob: MergeJob }> {
  type Row = Record<string, unknown>;

  /* Load target job */
  const [targetRow] = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT id, service_type, priority, status,
           origin_lat, origin_lng, dest_lat, dest_lng,
           origin_address, destination_address,
           scheduled_pickup, passenger_count, created_at
    FROM dispatch_jobs
    WHERE id = $1::uuid AND tenant_id = $2
  `, jobId, tenantId);

  if (!targetRow) throw new Error(`Job ${jobId} not found`);

  const target = rowToJob(targetRow);

  /* Load tenant trip merging config */
  const config = await loadMergeConfig(tenantId);

  if (!config.tripMergingEnabled) {
    return { candidates: [], config, targetJob: target };
  }

  /* Load candidate jobs — same tenant, same service type, PENDING/SEARCHING, created last 6h */
  const rows = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT id, service_type, priority, status,
           origin_lat, origin_lng, dest_lat, dest_lng,
           origin_address, destination_address,
           scheduled_pickup, passenger_count, created_at
    FROM dispatch_jobs
    WHERE tenant_id = $1
      AND id != $2::uuid
      AND service_type = $3
      AND status IN ('PENDING', 'SEARCHING')
      AND created_at >= NOW() - INTERVAL '6 hours'
    ORDER BY created_at DESC
    LIMIT 30
  `, tenantId, jobId, target.service_type);

  const candidateJobs = rows.map(rowToJob);

  /* Evaluate each pair in parallel (cap at 20 to avoid API rate limits) */
  const toEvaluate = candidateJobs.slice(0, 20);
  const results    = await Promise.all(
    toEvaluate.map(c => evaluatePair(target, c, config))
  );

  /* Return eligible candidates sorted by score desc, then all ineligible */
  const eligible   = results.filter(r => r.eligible).sort((a, b) => b.mergeScore - a.mergeScore);
  const ineligible = results.filter(r => !r.eligible);

  return {
    targetJob:  target,
    config,
    candidates: [...eligible, ...ineligible],
  };
}

/* ─────────────── Load tenant merge config from DB (public export) ─────────────── */
export const loadMergeConfigPublic = loadMergeConfig;

async function loadMergeConfig(tenantId: string): Promise<MergeConfig & { tripMergingEnabled: boolean }> {
  type Row = Record<string, unknown>;

  // Try tenant settings API (platform_settings table or tenant metadata)
  const rows = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT settings FROM tenant_settings
    WHERE tenant_id = $1
    LIMIT 1
  `, tenantId).catch(() => [] as Row[]);

  let s: Record<string, unknown> = {};
  if (rows[0]?.settings && typeof rows[0].settings === 'object') {
    s = rows[0].settings as Record<string, unknown>;
  }

  // Also check platform_settings for routing engine config
  const pRows = await prisma.$queryRawUnsafe<Row[]>(`
    SELECT value FROM platform_settings WHERE key = 'routing_config' LIMIT 1
  `).catch(() => [] as Row[]);
  const pCfg: Record<string, unknown> = pRows[0]?.value
    ? (typeof pRows[0].value === 'object' ? pRows[0].value as Record<string, unknown> : {})
    : {};

  return {
    tripMergingEnabled:    Boolean(s.tripMergingEnabled    ?? false),
    pickupDistanceKm:      Number(s.pickupDistanceKm       ?? 7),
    pickupTimeWindowMin:   Number(s.pickupTimeWindowMin    ?? 30),
    requireDropoffMatch:   Boolean(s.requireDropoffMatch   ?? true),
    dropoffDistanceKm:     Number(s.dropoffDistanceKm      ?? 25),
    dropoffTimeWindowMin:  Number(s.dropoffTimeWindowMin   ?? 30),
    maxPassengers:         Number(s.maxPassengers          ?? 5),
    travelSpeedKmh:        Number(s.travelSpeedKmh         ?? 40),
    roadDistanceMultiplier: Number(s.roadDistanceMultiplier ?? 1.5),
    routingEngine:         (String(s.routingEngine ?? pCfg.routingEngine ?? 'OSRM')) as RoutingEngine,
    googleMapsApiKey:      (s.googleMapsApiKey as string)  ?? undefined,
    mapboxToken:           (s.mapboxToken      as string)  ?? undefined,
    osrmBaseUrl:           (s.osrmBaseUrl      as string)  ?? undefined,
  };
}

/* ─────────────── Row → MergeJob ─────────────── */
function rowToJob(r: Record<string, unknown>): MergeJob {
  return {
    id:                  String(r.id),
    service_type:        String(r.service_type ?? ''),
    priority:            String(r.priority ?? 'NORMAL'),
    status:              String(r.status ?? ''),
    origin_lat:          r.origin_lat != null ? Number(r.origin_lat) : undefined,
    origin_lng:          r.origin_lng != null ? Number(r.origin_lng) : undefined,
    dest_lat:            r.dest_lat   != null ? Number(r.dest_lat)   : undefined,
    dest_lng:            r.dest_lng   != null ? Number(r.dest_lng)   : undefined,
    origin_address:      r.origin_address      ? String(r.origin_address)      : undefined,
    destination_address: r.destination_address ? String(r.destination_address) : undefined,
    scheduled_pickup:    r.scheduled_pickup     ? String(r.scheduled_pickup)    : undefined,
    passenger_count:     r.passenger_count != null ? Number(r.passenger_count) : undefined,
    created_at:          String(r.created_at ?? new Date().toISOString()),
  };
}
