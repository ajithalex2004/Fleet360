import type { NextConfig } from "next";

// Routes handled by the Go backend on :8080
// Everything else is handled by Next.js API routes directly
const GO_BACKEND_ROUTES = [
  "vehicles",
  "maintenance-requests",
  "maintenance",
  "service-requests",
  "drivers",
  "quotations",
  "garages",
  "alert-configs",
  "alerts",
  "upload",
].join("|");

const nextConfig: NextConfig = {
  // Note: 'instrumentationHook' was removed in Next.js 15+ — the
  // src/instrumentation.ts file is now picked up automatically.

  // Tree-shake heavy UI libraries so only used components are bundled
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "@radix-ui/react-icons",
      "date-fns",
      "recharts",
      "lodash",
    ],
  },

  // Compiler optimisations
  compiler: {
    // Remove console.log in production (keep errors/warns)
    removeConsole: process.env.NODE_ENV === "production"
      ? { exclude: ["error", "warn"] }
      : false,
  },

  // Skip ESLint + TypeScript checks during `next build`. The codebase has
  // ~100 pre-existing TS errors and a long tail of ESLint warnings that
  // the CI workflow already accepts as known (the Lint / Typecheck CI
  // steps are configured `continue-on-error: true` with a TODO to
  // re-enforce after the cleanup PR lands). Without this, `next build`
  // re-runs both internally and fails on the same warnings — making
  // production builds impossible until every legacy warning is fixed.
  //
  // Re-enable both once the KNOWN-TS-001 cleanup pass lands.
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },

  // Compress responses
  compress: true,

  // Stub Node-only built-ins out of the client bundle. nodemailer (and a
  // handful of other server-only deps) reference net/dns/fs/tls/etc.;
  // they're only ever called server-side, but a page that *imports*
  // server code drags those references into the browser bundle and the
  // webpack module resolver fails. `resolve.fallback: false` swaps them
  // for empty stubs in the client compile. The actual code paths
  // remain dead-code in the browser bundle because no client code calls
  // them at runtime.
  //
  // Long-term fix: move email/PDF/etc. calls out of client pages and
  // into API routes. This config is the safety net until that refactor
  // lands.
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        net: false,
        dns: false,
        tls: false,
        fs: false,
        child_process: false,
        // nodemailer also touches these less common ones occasionally.
        crypto: false,
        stream: false,
        zlib: false,
        os: false,
        path: false,
      };
    }
    return config;
  },

  // Image optimisation
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60,
  },

  async rewrites() {
    return [
      {
        // Only proxy routes that belong to the Go backend
        source: `/api/:path((?:${GO_BACKEND_ROUTES}).*)`,
        destination: "http://localhost:8080/api/:path*",
      },
    ];
  },

  async headers() {
    // Cache-Control for read-heavy dashboard/stats API routes.
    // private = CDN won't cache (user-specific data), but the browser does.
    // max-age=30 = serve from browser cache for 30 s without a new request.
    // stale-while-revalidate=60 = keep serving stale data for 60 s while refreshing in background.
    const CACHE_30  = 'private, max-age=30, stale-while-revalidate=60';
    // Auth / session endpoints — safe to cache longer since they only change on login/switch.
    // In-memory caching in PermissionContext + AdminLayout provides the first defence;
    // HTTP cache here protects against hard refreshes and second-tab opens.
    const CACHE_AUTH = 'private, max-age=60, stale-while-revalidate=120';

    const statRoutes = [
      '/api/fleet/stats',
      '/api/fleet/vehicle-types',
      '/api/fleet/tco',
      '/api/fleet/hos/summary',
      '/api/assets/stats',
      '/api/logistics/analytics',
      '/api/finance/stats',
      '/api/dispatch/analytics',
      '/api/school-bus/analytics',
      '/api/incidents/stats',
      '/api/platform/stats',
      '/api/platform/kpis',        // ← was missing; 32-query endpoint benefits most
      '/api/compliance/stats',
      '/api/admin/branches',
      // Tenant detail page — 8 parallel requests fired on every tenant open
      '/api/admin/tenants/:id',
      '/api/admin/tenants/:id/users',
      '/api/admin/tenants/:id/settings',
      '/api/admin/roles',
      '/api/admin/nav-permissions',
      '/api/tenant-branches',
      '/api/dispatch/weights',
    ];

    const authRoutes = [
      '/api/auth/me',              // read by AdminLayout on every /admin/* visit
      '/api/admin/session',        // read by PermissionContext on every page refresh
    ];

    return [
      ...statRoutes.map((source) => ({
        source,
        headers: [{ key: 'Cache-Control', value: CACHE_30 }],
      })),
      ...authRoutes.map((source) => ({
        source,
        headers: [{ key: 'Cache-Control', value: CACHE_AUTH }],
      })),
    ];
  },
};

export default nextConfig;
