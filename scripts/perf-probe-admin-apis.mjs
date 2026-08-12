/**
 * perf-probe-admin-apis.mjs
 *
 * Quick before/after measurement for the admin read APIs after the
 * caching pass. Hits each endpoint twice in a row and prints the
 * latency of each call. The second call should be dramatically faster
 * because:
 *   - first call: hits the DB, populates the in-memory unstable_cache
 *   - second call: served from the in-memory cache (microseconds)
 *
 * Also prints the Cache-Control header so you can verify the CDN
 * caching directive is in place.
 *
 * Usage:
 *   node scripts/perf-probe-admin-apis.mjs
 *
 * Requires a logged-in session cookie. The script uses the same
 * env-var-driven DB URL as the app, but it can't easily impersonate
 * an admin user — run this against a local dev server where you're
 * already logged in and paste the cookie if needed.
 */

const BASE = process.env.PERF_BASE ?? 'http://localhost:3000';
const COOKIE = process.env.PERF_COOKIE ?? ''; // e.g. "session=abc123"

const ENDPOINTS = [
  '/api/admin/roles',
  '/api/admin/permissions',
  '/api/admin/tenants',
  '/api/platform/plans',
];

async function hit(url) {
  const t0 = performance.now();
  const res = await fetch(BASE + url, {
    headers: COOKIE ? { Cookie: COOKIE } : {},
  });
  const t1 = performance.now();
  const len = (await res.text()).length;
  return {
    status: res.status,
    ms: Math.round(t1 - t0),
    bytes: len,
    cache: res.headers.get('cache-control') ?? '-',
  };
}

async function probe(url) {
  const a = await hit(url);
  const b = await hit(url);
  const speedup = a.ms > 0 ? (a.ms / Math.max(b.ms, 1)).toFixed(1) : '∞';
  console.log(
    `${url.padEnd(30)} ` +
    `1st=${String(a.ms).padStart(4)}ms (${a.status}, ${a.bytes}b)  ` +
    `2nd=${String(b.ms).padStart(4)}ms  ` +
    `speedup=${speedup}×  ` +
    `cache="${a.cache}"`
  );
}

console.log(`Probing ${BASE} ...\n`);
for (const url of ENDPOINTS) {
  await probe(url);
}
console.log('\nExpectation: 2nd call is much faster (cache hit). ' +
  'Cache-Control should include s-maxage + stale-while-revalidate.');
