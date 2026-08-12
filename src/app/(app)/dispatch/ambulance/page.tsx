'use client';
/**
 * Redirect — Ambulance Dispatch has moved to the Incident & Ambulance Management module.
 *
 * Ambulance operations are incident-driven: every call creates a patient record,
 * hospital handover, and MOHAP/DHA compliance trail. They belong alongside that
 * clinical data, not in a generic commercial-transport Command Centre.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function AmbulanceDispatchRedirect() {
  const router = useRouter();

  useEffect(() => {
    const t = setTimeout(() => router.replace('/incidents/ambulance/dispatch'), 1500);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 text-center py-20">
      <span className="text-6xl">🚑</span>
      <div className="space-y-2">
        <h2 className="text-xl font-bold text-white">Ambulance Dispatch has moved</h2>
        <p className="text-slate-400 text-sm max-w-sm">
          Ambulance dispatch is now part of the{' '}
          <strong className="text-red-400">Incident & Ambulance Management</strong> module,
          where clinical records, compliance trails, and dispatch are co-located.
        </p>
      </div>
      <div className="flex items-center gap-2 text-slate-500 text-sm">
        <span className="w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
        Redirecting…
      </div>
      <Link href="/incidents/ambulance/dispatch"
        className="px-6 py-3 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 text-white font-bold text-sm hover:opacity-90 transition-all">
        Go Now →
      </Link>
    </div>
  );
}
