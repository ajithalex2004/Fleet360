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
  // Run src/instrumentation.ts on server startup (pre-warms Neon connection)
  instrumentationHook: true,

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

  // Compress responses
  compress: true,

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
