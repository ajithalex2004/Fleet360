/**
 * (app) — shared authenticated app shell route group.
 *
 * Why this exists:
 *   Every module layout previously had to mount the AppShell component
 *   itself (sidebar + workspace tabs + toast slot). Navigating between
 *   /leasing/x → /rental/y unmounted the entire shell and remounted it
 *   on the destination — losing tab state, scroll position, and
 *   re-running every effect in AppShell, Sidebar, and WorkspaceTabs.
 *
 *   By lifting the shell into a parent route group, AppShell mounts
 *   ONCE when the user enters any (app)/* route and stays mounted
 *   across every child navigation. Only the `children` slot swaps.
 *
 *   URLs are unaffected: Next.js strips the (app) segment, so /leasing
 *   still resolves to src/app/(app)/leasing/page.tsx.
 *
 * Modules currently opted in (Category A — straight AppShell consumers):
 *   assets, sustainability, reports, dispatch, school-bus, bus-ops,
 *   rental, finance, driver-mgmt, customer-mgmt, maintenance, fleet,
 *   admin, approvals, logistics
 *
 * Modules intentionally NOT in this group:
 *   - Category B (custom chrome that would need a refactor to opt in):
 *       incidents   — has a special-case bypass for /incidents/ambulance/
 *                      dispatch that needs to render outside AppShell.
 *                      The (app) parent always wraps, so this special
 *                      case can't be expressed as a child layout. Needs
 *                      a separate route group or intercepting route.
 *       leasing     — has a hardcoded NAV_GROUPS sidebar and a /leasing/
 *                      field PWA bypass. Migrating means either dropping
 *                      the custom sidebar (UX change) or reworking the
 *                      field PWA bypass (small refactor). Out of scope
 *                      for the perf-only rollout.
 *       agents      — has its own cross-module sidebar that doubles as
 *                      a quick-jump nav between every module. Migrating
 *                      means either keeping it as a sibling of AppShell's
 *                      sidebar (visual duplication) or removing the
 *                      cross-module nav (UX change). Out of scope.
 *       customer    — uses a mobile-style bottom-tab nav, no AppShell
 *                      at all. The visual design intentionally differs
 *                      from the desktop modules.
 *
 *   - Category C (fully separate surfaces):
 *       booking-portal, shipper-portal, portal/[tenantSlug],
 *       school-bus/driver, school-bus/parent, bus-ops/driver,
 *       bus-ops/passenger, leasing/field
 *     These either have their own auth flow, tenant-portal chrome, or
 *     are mobile PWAs that intentionally don't share the desktop shell.
 *
 * Migration path for a Category B module:
 *   1. Decide whether to keep the custom sidebar (visual) or drop it
 *      and accept the AppShell sidebar.
 *   2. Resolve the special-case bypass (separate route group, or
 *      intercepting route).
 *   3. node scripts/migrate-to-app-shell.mjs and re-run the patch.
 *   4. Manually move the module to scripts/migrate-to-app-shell.mjs's
 *      MODULES list so future rollouts pick it up.
 */

import AppShell from '@/components/nav/AppShell';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
