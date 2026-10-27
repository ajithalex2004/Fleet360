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
      origin.includes('localhost') ||
      origin.includes('127.0.0.1') ||
      origin.startsWith('http://') ||
      origin.startsWith('https://')
    ) {
      if (origin.includes(':3000') || origin.includes(':3001')) {
        return path;
      }
    }
  }
  return `http://192.168.1.17:3000${path}`;
}

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
