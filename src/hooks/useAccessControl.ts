/**
 * useAccessControl — client-side hook for plan + role based access control.
 *
 * Usage in any page/component:
 *
 *   const { canWrite, isReadOnly, isTrial, isSuperAdmin } = useAccessControl('fleet');
 *
 *   // Disable write buttons:
 *   <button disabled={!canWrite} ...>Add Vehicle</button>
 *
 *   // Show upgrade prompt:
 *   {isReadOnly && <ReadOnlyBanner module="fleet" />}
 *
 * ReadOnlyBanner is exported from @/components/ReadOnlyBanner (JSX lives there).
 */

'use client';

import { useEffect, useState } from 'react';
import type { AppModule } from '@/lib/access-control';
import { canWrite as canWriteUtil } from '@/lib/access-control';

export interface AccessState {
  plan:          string;
  role:          string;
  isSuperAdmin:  boolean;
  isTrial:       boolean;
  canWrite:      boolean;   // for the specified module
  isReadOnly:    boolean;   // inverse of canWrite
  loading:       boolean;
}

const DEFAULT: AccessState = {
  plan: 'TRIAL', role: 'TENANT_ADMIN',
  isSuperAdmin: false, isTrial: true,
  canWrite: false, isReadOnly: true, loading: true,
};

// Module-level session cache — avoids re-fetching on every hook call in the same page
let _cached: { plan: string; role: string } | null = null;
let _fetchPromise: Promise<void> | null = null;

async function fetchSession(): Promise<{ plan: string; role: string }> {
  if (_cached) return _cached;
  if (!_fetchPromise) {
    _fetchPromise = fetch('/api/auth/me')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) _cached = { plan: d.plan, role: d.role }; })
      .catch(() => {});
  }
  await _fetchPromise;
  return _cached ?? { plan: 'TRIAL', role: 'TENANT_ADMIN' };
}

export function useAccessControl(module: AppModule): AccessState {
  const [state, setState] = useState<AccessState>(DEFAULT);

  useEffect(() => {
    let cancelled = false;
    fetchSession().then(({ plan, role }) => {
      if (cancelled) return;
      const isSuperAdmin = role === 'SUPER_ADMIN';
      const isTrial      = plan === 'TRIAL';
      const write        = canWriteUtil(plan, role, module);
      setState({
        plan, role, isSuperAdmin, isTrial,
        canWrite: write, isReadOnly: !write, loading: false,
      });
    });
    return () => { cancelled = true; };
  }, [module]);

  return state;
}
