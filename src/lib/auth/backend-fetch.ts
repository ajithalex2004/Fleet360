/**
 * Authenticated fetch wrapper for the Go backend (`http://localhost:8080`
 * in dev / configured host in prod). The Go backend's /api/v1/* surface
 * requires `Authorization: Bearer <jwt>`; the JWT is the `backendToken`
 * returned by `/api/auth/login` and stashed in localStorage.
 *
 * Browser code should NEVER call the Go backend with a bare `fetch(...)` —
 * use `backendFetch(...)` so:
 *   - the token is attached automatically
 *   - missing-token cases are surfaced uniformly (a clear error rather
 *     than the Go side's 401 JSON, which a typical caller wouldn't parse)
 *
 * Token rotation: on /api/auth/login success, the login page rewrites
 * localStorage[`xl_backend_token`]. We read on every call (no caching) so
 * a tenant switch or re-login propagates immediately.
 */

const TOKEN_KEY = 'xl_backend_token';

/**
 * Wraps fetch, attaching `Authorization: Bearer <jwt>` from localStorage.
 *
 * Throws BackendUnauthenticatedError if no token is available — caller can
 * catch this and redirect the user to /login. (We intentionally throw
 * rather than letting the request go out unauthenticated; the Go backend
 * would reject with 401 anyway, but the error message would be opaque.)
 */
export async function backendFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = typeof window === 'undefined' ? null : window.localStorage.getItem(TOKEN_KEY);
  if (!token) {
    throw new BackendUnauthenticatedError(
      'No Go-backend token found in localStorage. Sign in again so /api/auth/login can issue a fresh token.',
    );
  }
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

/** Returns true when a backend token is stashed (login has issued one). */
export function hasBackendToken(): boolean {
  if (typeof window === 'undefined') return false;
  return !!window.localStorage.getItem(TOKEN_KEY);
}

/** Clear the stashed token. Call on logout / forced sign-out. */
export function clearBackendToken(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TOKEN_KEY);
}

export class BackendUnauthenticatedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackendUnauthenticatedError';
  }
}
