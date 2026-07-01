/**
 * Loading boundary for every (app)/* route.
 *
 * Next.js picks the closest ancestor loading.tsx when a route segment is
 * pending. (app)/* covers all module pages, so this file paints a skeleton
 * during:
 *
 *   - First-visit dev compiles (Turbopack compile 3-29s on cold routes)
 *   - Server Component data fetches blocking the first RSC payload
 *   - Client-side data fetches inside the (app) subtree
 *
 * Without this, users stare at a blank canvas during those waits. Module-
 * specific loading.tsx files (leasing/loading.tsx, (app)/maintenance/loading.tsx,
 * etc.) override this for the segments that have them.
 */

import ModuleLoadingSkeleton from '@/components/ModuleLoadingSkeleton';

export default function AppLoading() {
  return <ModuleLoadingSkeleton sidebarItems={12} />;
}
