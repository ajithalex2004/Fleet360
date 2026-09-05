'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function LegacyTripDocumentsRedirect() {
  const { id } = useParams<{ id: string }>() ?? {};
  const router = useRouter();

  useEffect(() => {
    if (id) router.replace(`/logistics/shipments/${id}/documents`);
  }, [id, router]);

  return <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]/70 p-6 text-sm text-[var(--text-muted)]">Redirecting to shipment documents...</div>;
}
