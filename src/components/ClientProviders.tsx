'use client';

/**
 * ClientProviders — wraps every page in the permission + tenant + branch +
 * language context stack.
 *
 * History:
 *   Previously this file chose between a "lean" tree (`<PermissionProvider>`
 *   only, used on /platform and /) and a "full" tree (`<FullClientProviders>`
 *   wrapping LanguageProvider / PermissionProvider / BranchProvider) for the
 *   rest of the app. The intent was a small first-paint win on the marketing
 *   surface, but the swap had a nasty side-effect: React unmounted and
 *   remounted PermissionProvider (and all child state, including the cached
 *   session) every time the user crossed between /platform and any other
 *   module. Each remount fired `loadSession()` → /api/admin/session and
 *   /api/auth/me round-trips, and combined with unstable `setCurrentUser`
 *   identities downstream, the dev server ended up handling 70+ redundant
 *   auth probes per minute. That's what was making menu navigations feel
 *   like 20-30s.
 *
 *   This file now unconditionally renders <FullClientProviders>. The added
 *   LanguageProvider / BranchProvider wrappers are tiny (3 context objects,
 *   no extra fetches) — the cost is negligible, and we keep PermissionProvider
 *   mounted across every navigation.
 */

import FullClientProviders from '@/components/FullClientProviders';

export default function ClientProviders({ children }: { children: React.ReactNode }) {
  return <FullClientProviders>{children}</FullClientProviders>;
}
