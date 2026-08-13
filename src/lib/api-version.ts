/**
 * API version constants for Fleet360.
 *
 * Current stable API version: 1
 *
 * Version is surfaced in:
 *  - All JSON error responses (via middleware + route helpers)
 *  - X-API-Version response header (set by middleware)
 *  - /api/version endpoint
 *  - /api/v1/* rewrite prefix in next.config.ts
 *
 * When a breaking change is needed, bump CURRENT_API_VERSION, add a
 * deprecation notice in DEPRECATED_VERSIONS, and keep the old /api/v{n}
 * rewrite pointing at a compatibility shim until clients migrate.
 */

export const CURRENT_API_VERSION = 1;
export const API_VERSION_HEADER  = 'X-API-Version';
export const API_VERSION_PREFIX  = `/api/v${CURRENT_API_VERSION}`;

/** Versions that are still accepted but will be removed. */
export const DEPRECATED_VERSIONS: number[] = [];

/**
 * Parse the client-requested version from:
 *  1. Accept-Version header  (preferred)
 *  2. X-API-Version header   (legacy)
 *  3. URL prefix /api/v{n}/  (next.config.ts rewrite adds x-api-version)
 *
 * Returns the integer version, or null if none supplied (treat as current).
 */
export function parseRequestedVersion(headers: Headers): number | null {
  const raw =
    headers.get('accept-version') ??
    headers.get('x-api-version')  ??
    headers.get('x-api-version-path'); // injected by next.config.ts rewrite

  if (!raw) return null;
  const n = parseInt(raw.replace(/^v/i, ''), 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Build a standard API error body that includes the API version.
 */
export function apiError(
  status: number,
  message: string,
  extra?: Record<string, unknown>,
): { body: Record<string, unknown>; status: number } {
  return {
    status,
    body: {
      error:      httpStatusText(status),
      message,
      apiVersion: CURRENT_API_VERSION,
      ...extra,
    },
  };
}

function httpStatusText(status: number): string {
  const map: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    409: 'Conflict',
    422: 'Unprocessable Entity',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
  };
  return map[status] ?? 'Error';
}
