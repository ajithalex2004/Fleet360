import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Fix workspace root tracing
  outputFileTracingRoot: path.join(__dirname),

  // Tree-shake heavy UI libraries so only used components are bundled
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-popover",
      "@radix-ui/react-select",
      "@radix-ui/react-tooltip",
      "@radix-ui/react-tabs",
      "@radix-ui/react-slot",
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

  // TypeScript: RE-ENFORCED (KNOWN-TS-001 cleanup landed — the typecheck
  // ratchet baseline is genuinely 0 errors / 0 files as of the cleanup
  // pass; `next build` now fails on any real TS error, same as `tsc
  // --noEmit`). See scripts/typecheck-baseline.json / check-typecheck-ratchet.mjs.
  //
  // ESLint: still skipped during `next build`. The separate lint ratchet
  // baseline (scripts/lint-baseline.json) is NOT yet at 0 — ~3,014
  // pre-existing errors across 976 files remain untouched by the
  // KNOWN-TS-001 pass. Flipping this before that cleanup lands would
  // break production builds immediately. Re-enable once the lint ratchet
  // is driven to 0 the same way the typecheck ratchet was.
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },

  // Build performance & memory optimizations for large page sets
  staticPageGenerationTimeout: 180,
  productionBrowserSourceMaps: false,

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
  webpack: (config, { isServer, dev }) => {
    void isServer;
    
    if (!dev) {
      config.cache = false;
    }

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

  async redirects() {
    return [
      { source: "/leasing/fuel", destination: "/fleet/fuel", permanent: false },
      { source: "/leasing/traffic-fines", destination: "/fleet/fines", permanent: false },
      { source: "/leasing/insurance", destination: "/fleet/insurance", permanent: false },
      { source: "/leasing/branches", destination: "/admin/branches", permanent: false },
      { source: "/carrier-portal/logistics/app", destination: "/carrier-portal/loads", permanent: false },
      { source: "/carrier-portal/logistics/app/loads/:id", destination: "/carrier-portal/loads/:id", permanent: false },
      { source: "/carrier-portal/logistics/invite/:token", destination: "/carrier-portal/invite/:token", permanent: false },
      { source: "/carrier-portal/logistics/offer/:token", destination: "/carrier-portal/offer/:token", permanent: false },
      { source: "/driver/feedback", destination: "/driver-feedback", permanent: false },
    ];
  },

  async rewrites() {
    return [
      {
        // /api/v1/* → /api/* — forwards versioned clients to the current
        // Next.js routes without any route files needing to move.
        // The rewrite injects x-api-version-path so middleware can surface
        // the version in the X-API-Version response header.
        source:      '/api/v1/:path*',
        destination: '/api/:path*',
        has: [{ type: 'header', key: 'accept', missing: true }],
      },
      {
        source:      '/api/v1/:path*',
        destination: '/api/:path*',
      },
      // Requests for the Go backend are not rewritten here: the middleware
      // shim forwards exactly the routes in src/lib/go-routes.ts, with a
      // backend token (architecture audit A10).
    ];
  },

  async headers() {
    // Cache-Control for read-heavy dashboard/stats API routes.
    // private = CDN won't cache (user-specific data), but the browser does.
    // max-age=30 = serve from browser cache for 30 s without a new request.
    // stale-while-revalidate=60 = keep serving stale data for 60 s while refreshing in background.
    const CACHE_30  = 'private, max-age=30, stale-while-revalidate=60';
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

    return [
      ...statRoutes.map((source) => ({
        source,
        headers: [{ key: 'Cache-Control', value: CACHE_30 }],
      })),
    ];
  },
};

export default nextConfig;
