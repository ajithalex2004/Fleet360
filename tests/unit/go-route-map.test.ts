/**
 * tests/unit/go-route-map.test.ts
 *
 * Architecture audit A10: route ownership between Next.js and Go was spread
 * over two mechanisms that disagreed. src/lib/go-routes.ts is now the one
 * map; these tests keep it identical to the routes backend/main.go registers
 * (for the areas the shim forwards), so a Go route cannot be added or removed
 * without the map following, and the shim cannot forward to a path Go does
 * not serve.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GO_ROUTES, goRouteFor, goUpstreamPath, goBackendConfigured } from '@/lib/go-routes';

/** Routes registered in backend/main.go: gin groups and verbs, as "METHOD /api/v1/path". */
function goRegisteredRoutes(): string[] {
  const src = readFileSync(join(process.cwd(), 'backend/main.go'), 'utf8');
  const groups: Record<string, string> = { r: '' };
  const routes: string[] = [];
  for (const line of src.split('\n')) {
    const g = line.match(/^\s*(\w+)\s*:=\s*(\w+)\.Group\("([^"]*)"/);
    if (g && g[2] in groups) { groups[g[1]] = groups[g[2]] + g[3]; continue; }
    const m = line.match(/^\s*(\w+)\.(GET|POST|PUT|PATCH|DELETE)\("([^"]*)"/);
    if (m && m[1] in groups) routes.push(`${m[2]} ${groups[m[1]] + m[3]}`);
  }
  return routes;
}

const FORWARDED_AREAS = /^\S+ \/api\/v1\/(logistics|files)(\/|$)/;

describe('Go route map', () => {
  const registered = goRegisteredRoutes();

  it('reads the Go route table', () => {
    expect(registered.length).toBeGreaterThan(50);
    expect(registered).toContain('POST /api/v1/fleet/vehicles');
  });

  it('lists exactly the logistics and files routes Go registers', () => {
    const mapped = GO_ROUTES.map((r) => `${r.method} ${goUpstreamPath(r.path)}`).sort();
    const goSide = registered.filter((r) => FORWARDED_AREAS.test(r)).sort();
    expect(mapped).toEqual(goSide);
  });

  it('has no duplicate entries', () => {
    const keys = GO_ROUTES.map((r) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('matches by method and path segment, nothing broader', () => {
    expect(goRouteFor('GET', '/api/logistics/shipments/123')?.path).toBe('/api/logistics/shipments/:id');
    expect(goRouteFor('get', '/api/logistics/shipments/123/')?.path).toBe('/api/logistics/shipments/:id');
    expect(goRouteFor('GET', '/api/logistics/shipments/123/pod')).toBeNull();
    expect(goRouteFor('PATCH', '/api/logistics/shipments/123')).toBeNull();
    expect(goRouteFor('GET', '/api/logistics/shipmentsX')).toBeNull();
    expect(goUpstreamPath('/api/logistics/sla')).toBe('/api/v1/logistics/sla');
  });
});

describe('goBackendConfigured', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('requires GO_BACKEND_URL in production while forwarding is on', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LOGISTICS_GO_PROXY_ENABLED', 'true');
    vi.stubEnv('GO_BACKEND_URL', '');
    expect(goBackendConfigured()).toBe(false);
    vi.stubEnv('GO_BACKEND_URL', 'http://fleet360-backend.railway.internal:8080');
    expect(goBackendConfigured()).toBe(true);
  });

  it('does not require it when forwarding is off, or outside production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('GO_BACKEND_URL', '');
    vi.stubEnv('LOGISTICS_GO_PROXY_ENABLED', 'false');
    expect(goBackendConfigured()).toBe(true);
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('LOGISTICS_GO_PROXY_ENABLED', 'true');
    expect(goBackendConfigured()).toBe(true);
  });
});
