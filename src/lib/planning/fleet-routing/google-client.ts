/**
 * Google Cloud API client for Route Optimization + Routes API v2.
 *
 * Auth flow:
 *   1. Parse GOOGLE_CLOUD_SA_KEY (base64 of the SA JSON key) once at cold start.
 *   2. Sign a short-lived JWT (RS256) with the SA private key, claiming the
 *      requested scope(s).
 *   3. Exchange the JWT at Google's token endpoint for an OAuth2 access token.
 *   4. Cache the access token in-memory until 5 minutes before expiry.
 *   5. Attach as `Authorization: Bearer <token>` on subsequent API calls.
 *
 * No external deps — JWT is signed with node:crypto. Tokens are per-scope
 * because different Google APIs require different scopes.
 *
 * Environment:
 *   GOOGLE_CLOUD_PROJECT_ID  — the project the SA key belongs to
 *   GOOGLE_CLOUD_SA_KEY      — base64(JSON key file)
 */

import { createSign } from 'node:crypto';
import type {
  GoogleOptimizeToursRequest,
  GoogleOptimizeToursResponse,
  RouteMatrixRequest,
  RouteMatrixElement,
  ComputeRoutesRequest,
  ComputeRoutesResponse,
} from './types';

// ── Config ──────────────────────────────────────────────────────────────────

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ROUTE_OPT_HOST = 'https://cloudoptimization.googleapis.com';
const ROUTES_HOST = 'https://routes.googleapis.com';

/** Route Optimization scope — grants optimizeTours calls. */
const SCOPE_ROUTE_OPTIMIZATION = 'https://www.googleapis.com/auth/cloud-platform';
/** Routes API scope — same cloud-platform scope covers it. */
const SCOPE_ROUTES = 'https://www.googleapis.com/auth/cloud-platform';

/** Refresh a token when it's within this many seconds of expiring. */
const TOKEN_REFRESH_BUFFER_SEC = 300;

/** Google's SA JSON key shape (only fields we consume). */
interface ServiceAccountKey {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;   // PEM
  client_email: string;
  token_uri: string;
}

// ── Cached SA key + token (module-level singletons) ────────────────────────

let cachedSaKey: ServiceAccountKey | null = null;
interface CachedToken { accessToken: string; expiresAt: number }
const cachedTokens = new Map<string, CachedToken>();  // key = scope

function getSaKey(): ServiceAccountKey {
  if (cachedSaKey) return cachedSaKey;
  const raw = process.env.GOOGLE_CLOUD_SA_KEY;
  if (!raw) {
    throw new Error(
      'GOOGLE_CLOUD_SA_KEY is not set. See src/lib/planning/fleet-routing/README setup.',
    );
  }
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64').toString('utf-8');
  } catch (e) {
    throw new Error(`GOOGLE_CLOUD_SA_KEY is not valid base64: ${(e as Error).message}`);
  }
  let parsed: ServiceAccountKey;
  try {
    parsed = JSON.parse(decoded) as ServiceAccountKey;
  } catch (e) {
    throw new Error(`GOOGLE_CLOUD_SA_KEY decoded but is not valid JSON: ${(e as Error).message}`);
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('GOOGLE_CLOUD_SA_KEY JSON is missing client_email or private_key.');
  }
  cachedSaKey = parsed;
  return parsed;
}

// ── JWT signing ─────────────────────────────────────────────────────────────

/**
 * Base64url encoder — RFC 4648 §5. Standard base64 with +/= replaced.
 */
function b64url(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf) : buf;
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Sign a Google service-account JWT for a given scope. Returns the compact
 * JWS string ready to POST as the `assertion` grant.
 */
function signJwt(sa: ServiceAccountKey, scope: string, tokenUrl: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', kid: sa.private_key_id };
  const claims = {
    iss: sa.client_email,
    scope,
    aud: tokenUrl,
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const sig = signer.sign(sa.private_key);
  return `${signingInput}.${b64url(sig)}`;
}

/**
 * Exchange a signed assertion for an access token at Google's token endpoint.
 */
async function fetchAccessToken(scope: string): Promise<CachedToken> {
  const sa = getSaKey();
  const tokenUrl = sa.token_uri || TOKEN_URL;
  const assertion = signJwt(sa, scope, tokenUrl);
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Google token exchange failed (${res.status}): ${text}`);
  }
  const json = await res.json() as { access_token: string; expires_in: number };
  return {
    accessToken: json.access_token,
    expiresAt: Math.floor(Date.now() / 1000) + json.expires_in,
  };
}

async function getAccessToken(scope: string): Promise<string> {
  const cached = cachedTokens.get(scope);
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt - TOKEN_REFRESH_BUFFER_SEC > now) {
    return cached.accessToken;
  }
  const fresh = await fetchAccessToken(scope);
  cachedTokens.set(scope, fresh);
  return fresh.accessToken;
}

// ── High-level API wrappers ─────────────────────────────────────────────────

/**
 * Call Route Optimization API's optimizeTours endpoint.
 * See: https://cloud.google.com/optimization/docs/reference/rest/v1/projects/optimizeTours
 */
export async function optimizeTours(
  req: GoogleOptimizeToursRequest,
): Promise<GoogleOptimizeToursResponse> {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  if (!projectId) throw new Error('GOOGLE_CLOUD_PROJECT_ID is not set.');
  const token = await getAccessToken(SCOPE_ROUTE_OPTIMIZATION);
  const url = `${ROUTE_OPT_HOST}/v1/projects/${projectId}:optimizeTours`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(req),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new GoogleApiError(
      `optimizeTours failed (${res.status})`,
      res.status,
      text,
    );
  }
  return JSON.parse(text) as GoogleOptimizeToursResponse;
}

/**
 * Routes API v2 — computeRouteMatrix. Streamed JSON response (array of
 * elements). We collect them into a single array before returning.
 *
 * `X-Goog-FieldMask` is REQUIRED by Routes API v2 — omit it and Google
 * refuses the request with 400.
 */
export async function computeRouteMatrix(
  req: RouteMatrixRequest,
): Promise<RouteMatrixElement[]> {
  const token = await getAccessToken(SCOPE_ROUTES);
  const url = `${ROUTES_HOST}/distanceMatrix/v2:computeRouteMatrix`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,status,condition',
    },
    body: JSON.stringify(req),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new GoogleApiError(
      `computeRouteMatrix failed (${res.status})`,
      res.status,
      text,
    );
  }
  // Routes API returns newline-delimited JSON when the matrix is large; small
  // matrices come back as a JSON array. Handle both.
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) {
    return JSON.parse(trimmed) as RouteMatrixElement[];
  }
  return trimmed
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as RouteMatrixElement);
}

/**
 * Routes API v2 — computeRoutes. Single trip with optional waypoint
 * optimization. Used by the single-route optimizer (replacing Mapbox).
 *
 * Requires `X-Goog-FieldMask` — the field list controls both the response
 * shape AND the billed API tier. We ask for the minimum: distance,
 * duration, polyline, leg summaries, and the optimized index when applicable.
 */
export async function computeRoutes(
  req: ComputeRoutesRequest,
): Promise<ComputeRoutesResponse> {
  const token = await getAccessToken(SCOPE_ROUTES);
  const url = `${ROUTES_HOST}/directions/v2:computeRoutes`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Goog-FieldMask':
        'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,' +
        'routes.legs.distanceMeters,routes.legs.duration,routes.legs.startLocation,routes.legs.endLocation,' +
        'routes.optimizedIntermediateWaypointIndex',
    },
    body: JSON.stringify(req),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new GoogleApiError(
      `computeRoutes failed (${res.status})`,
      res.status,
      text,
    );
  }
  return JSON.parse(text) as ComputeRoutesResponse;
}

/**
 * Custom error type that carries the HTTP status + Google's error body.
 * Used by the parser to distinguish INFEASIBLE (200 + skippedShipments) from
 * FAILED (non-2xx).
 */
export class GoogleApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody: string,
  ) {
    super(message);
    this.name = 'GoogleApiError';
  }
}

// ── Diagnostics — for the spike endpoint and health checks ────────────────

/**
 * Cheap ping: parses the SA key + gets an access token. Doesn't hit any
 * billed API. Returns the client_email + project on success so operators
 * can visually confirm they're pointed at the right account.
 */
export async function checkGoogleAuth(): Promise<{
  ok: true;
  clientEmail: string;
  projectId: string;
} | { ok: false; error: string }> {
  try {
    const sa = getSaKey();
    const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
    if (!projectId) return { ok: false, error: 'GOOGLE_CLOUD_PROJECT_ID not set' };
    // Force a token fetch (bypasses cache by using a throwaway scope? No —
    // just fetch normally; cache-hit is still a valid signal that auth works).
    await getAccessToken(SCOPE_ROUTE_OPTIMIZATION);
    return { ok: true, clientEmail: sa.client_email, projectId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
