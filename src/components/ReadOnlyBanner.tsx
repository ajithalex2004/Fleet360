/**
 * ReadOnlyBanner — drop-in banner for pages that are read-only on the Free Trial plan.
 *
 * Usage:
 *   import ReadOnlyBanner from '@/components/ReadOnlyBanner';
 *   const { isReadOnly } = useAccessControl('rac');
 *   {isReadOnly && <ReadOnlyBanner module="rac" />}
 */

'use client';

import React from 'react';
import { TRIAL_FREE_MODULES } from '@/lib/access-control';

interface Props {
  module: string;
}

export default function ReadOnlyBanner({ module }: Props) {
  const isFreeModule = TRIAL_FREE_MODULES.includes(module as typeof TRIAL_FREE_MODULES[number]);
  if (isFreeModule) return null;

  return (
    <div className="mb-4 flex items-center gap-3 bg-amber-500/10 border border-amber-500/25 rounded-xl px-4 py-3">
      <span className="text-amber-400 text-lg">🔒</span>
      <div>
        <p className="text-amber-300 text-sm font-semibold">Read-Only — Free Trial</p>
        <p className="text-slate-400 text-xs">
          You can view data but cannot create, edit, or delete records on the Free Trial plan.{' '}
          <a href="/admin/billing" className="text-amber-400 hover:text-amber-300 underline">
            Upgrade to unlock full access.
          </a>
        </p>
      </div>
    </div>
  );
}
