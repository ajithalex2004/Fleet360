'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { NuiReasonMasterView } from '@/components/fleet/NuiReasonMasterView';

function AdminNuiReasonMasterContent() {
  const searchParams = useSearchParams();
  const scopeParam = (searchParams?.get('scope') || searchParams?.get('type') || '').toUpperCase();
  const scope = scopeParam === 'MAINTENANCE' ? 'MAINTENANCE' : 'ALL';
  return <NuiReasonMasterView scope={scope} />;
}

export default function AdminNuiReasonMasterPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-[var(--text-faint)]">Loading NUI Reason Master...</div>}>
      <AdminNuiReasonMasterContent />
    </Suspense>
  );
}
