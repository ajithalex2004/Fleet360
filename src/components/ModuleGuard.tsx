'use client';
/**
 * ModuleGuard — client-side gate for module-level access control.
 *
 * Drop this at the top of any module layout to block direct URL access
 * when the tenant's subscription does not include that module.
 *
 * Usage:
 *   // src/app/logistics/layout.tsx
 *   import ModuleGuard from '@/components/ModuleGuard';
 *   export default function Layout({ children }) {
 *     return <ModuleGuard moduleId="logistics">{children}</ModuleGuard>;
 *   }
 *
 * Rules:
 *  - SUPER_ADMIN          → always allowed (full access)
 *  - No enabledModules configured (empty list) → allowed (no restriction)
 *  - Module in enabledModules  → allowed
 *  - Module NOT in enabledModules → blocked — shows a friendly "Not Subscribed" wall
 *
 * While loading (isLoading=true) a neutral skeleton is shown so there is
 * no flash-of-blocked-content or flash-of-allowed-content.
 *
 * Performance: uses only usePermissions() — no extra /api/auth/me fetch.
 * isSuperAdmin is derived from user.roleCode which is already in context.
 */

import React from 'react';
import Link from 'next/link';
import { usePermissions } from '@/contexts/PermissionContext';

interface Props {
  /** Must match the module ID in ALL_MODULES (platform/page.tsx) and tenant.enabledModules */
  moduleId: string;
  /** Optional display name for the "not subscribed" wall. Defaults to moduleId. */
  moduleName?: string;
  /** Optional icon emoji for the wall card */
  moduleIcon?: string;
  children: React.ReactNode;
}

export default function ModuleGuard({ moduleId, moduleName, moduleIcon = '🔒', children }: Props) {
  const { user, tenant, isLoading, isAuthenticated } = usePermissions();
  // Derive super-admin from user.roleCode — no extra API fetch needed
  const isSuperAdmin = user?.roleCode === 'SUPER_ADMIN';

  // While loading — show a neutral spinner so nothing flashes
  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Super admin always bypasses module restrictions
  if (isSuperAdmin) return <>{children}</>;

  // No modules configured yet → no restriction applied
  if (!tenant || tenant.enabledModules.length === 0) return <>{children}</>;

  // Module is in the tenant's enabled list → allow
  if (tenant.enabledModules.includes(moduleId)) return <>{children}</>;

  // ── ACCESS DENIED WALL ─────────────────────────────────────────────────────
  const displayName = moduleName ?? moduleId;

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center">
        {/* Icon */}
        <div className="w-20 h-20 rounded-2xl bg-slate-800 border border-white/10 flex items-center justify-center text-4xl mx-auto mb-6 grayscale">
          {moduleIcon}
        </div>

        {/* Badge */}
        <div className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/60 px-3 py-1 mb-4">
          <span className="text-slate-500 text-xs">🔒</span>
          <span className="text-slate-500 text-xs font-semibold uppercase tracking-wide">Module Not Subscribed</span>
        </div>

        {/* Heading */}
        <h1 className="text-2xl font-bold text-white mb-3">
          {displayName} is not part of your plan
        </h1>
        <p className="text-slate-400 text-sm leading-relaxed mb-2">
          Your organisation&apos;s subscription does not currently include the{' '}
          <strong className="text-slate-300">{displayName}</strong> module.
        </p>
        <p className="text-slate-500 text-sm leading-relaxed mb-8">
          Contact your platform administrator to enable this module for your tenant.
        </p>

        {/* Tenant info pill */}
        {tenant && (
          <div className="inline-flex items-center gap-2 bg-slate-800/60 border border-white/10 rounded-xl px-4 py-2 mb-8">
            <span className="w-2 h-2 rounded-full bg-blue-400" />
            <span className="text-xs text-slate-400">Signed in as <strong className="text-white">{tenant.name}</strong></span>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/platform"
            className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-medium hover:opacity-90 transition-all"
          >
            ← Back to Platform
          </Link>
          <Link
            href="/admin"
            className="px-6 py-2.5 rounded-xl border border-white/10 bg-slate-800/60 text-slate-300 text-sm font-medium hover:border-white/20 hover:text-white transition-all"
          >
            Contact Administrator
          </Link>
        </div>

        {/* Enabled modules list */}
        {tenant && tenant.enabledModules.length > 0 && (
          <div className="mt-10 text-left">
            <p className="text-xs text-slate-600 font-semibold uppercase tracking-widest mb-3">Your active modules</p>
            <div className="flex flex-wrap gap-2">
              {tenant.enabledModules.map(m => (
                <span key={m} className="text-[10px] font-medium px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  {m}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
