/**
 * Helper to resolve the correct API endpoint in Capacitor Android WebView vs Web Browser,
 * and safely parse JSON without HTML error crashes.
 */

export function getApiEndpoint(path: string): string {
  if (typeof window !== 'undefined') {
    const customHost = localStorage.getItem('fleet360_api_host');
    if (customHost) {
      return `${customHost.replace(/\/+$/, '')}${path}`;
    }
    const origin = window.location.origin;
    if (
      origin.includes(':3000') ||
      origin.includes(':3001') ||
      origin.includes('railway.app') ||
      origin.includes('vercel.app')
    ) {
      return path;
    }
  }
  return `https://fleet360-app-production.up.railway.app${path}`;
}

export function getDriverAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra || {}) };
  if (typeof window !== 'undefined') {
    try {
      const token = localStorage.getItem('fleet360_session_token');
      if (token && !headers['Authorization']) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    } catch {
      // ignore storage errors
    }
  }
  return headers;
}

// Automatically attach Authorization: Bearer <fleet360_session_token> in Capacitor WebView
// where cross-site cookies from https://localhost2 to railway.app are blocked by SameSite=Lax.
if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
  const w = window as unknown as { __fleet360FetchPatched?: boolean; fetch: typeof fetch };
  if (!w.__fleet360FetchPatched) {
    w.__fleet360FetchPatched = true;
    const origFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      try {
        const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        if (urlStr.includes('/api/')) {
          const token = localStorage.getItem('fleet360_session_token');
          if (token) {
            const headers = new Headers(init?.headers || {});
            if (!headers.has('Authorization')) {
              headers.set('Authorization', `Bearer ${token}`);
            }
            return origFetch(input, { ...init, headers });
          }
        }
      } catch {
        // fallback to normal fetch
      }
      return origFetch(input, init);
    };
  }
}

// Callers read arbitrary fields of whatever JSON the endpoint returned.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function parseJsonSafely(res: Response): Promise<any | null> {
  try {
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return null;
    }
    const text = await res.text();
    if (!text || text.trim().startsWith('<')) {
      return null;
    }
    return JSON.parse(text);
  } catch {
    return null;
  }
}
