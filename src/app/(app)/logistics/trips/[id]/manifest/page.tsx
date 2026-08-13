'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function LegacyTripManifestRedirect() {
  const { id } = useParams<{ id: string }>() ?? {};
  const router = useRouter();

  useEffect(() => {
    if (id) router.replace(`/logistics/shipments/${id}/manifest`);
  }, [id, router]);

  return <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-6 text-sm text-slate-400">Redirecting to shipment manifest...</div>;
}
