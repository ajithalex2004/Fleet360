'use client';
/**
 * Dispatch › School Bus — redirects to the School Bus Transportation Module.
 *
 * School Bus operates on a completely different model from general dispatch:
 *  • Pre-planned routes, not on-demand jobs
 *  • Student manifests, RFID attendance, guardian notifications
 *  • UAE Ministry of Education compliance requirements
 *  • Morning / Afternoon session coordination
 *
 * Its dedicated Dispatch Board lives at /school-bus/dispatch
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function DispatchSchoolBusRedirect() {
  const router = useRouter();

  useEffect(() => {
    const id = setTimeout(() => router.push('/school-bus/dispatch'), 1500);
    return () => clearTimeout(id);
  }, [router]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
      {/* Icon */}
      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-amber-500 to-yellow-500 flex items-center justify-center text-4xl shadow-xl shadow-amber-500/30">
        🚌
      </div>

      <div className="text-center space-y-2 max-w-md">
        <h1 className="text-white text-2xl font-bold">School Bus has its own Dispatch Board</h1>
        <p className="text-slate-400 text-sm">
          School Bus operations — route assignment, departure management, student attendance,
          and UAE compliance — are handled in the dedicated School Bus module, not the general
          Dispatch Command Centre.
        </p>
        <p className="text-slate-500 text-xs mt-2">Redirecting in 1.5 seconds…</p>
      </div>

      {/* Why separated */}
      <div className="grid grid-cols-2 gap-3 max-w-lg w-full">
        {[
          { icon:'📋', text:'Pre-planned routes, not on-demand jobs' },
          { icon:'👧', text:'Student manifests & RFID attendance' },
          { icon:'🇦🇪', text:'UAE Ministry of Education compliance' },
          { icon:'📱', text:'Guardian notifications per stop' },
        ].map(r => (
          <div key={r.text} className="flex items-start gap-2 bg-slate-900 border border-white/10 rounded-xl px-3 py-2.5">
            <span className="text-base flex-shrink-0">{r.icon}</span>
            <p className="text-slate-400 text-xs leading-relaxed">{r.text}</p>
          </div>
        ))}
      </div>

      {/* CTAs */}
      <div className="flex items-center gap-3">
        <Link href="/school-bus/dispatch"
          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 text-slate-900 font-bold text-sm hover:opacity-90 transition-all shadow-lg shadow-amber-500/20">
          🚦 Go to School Bus Dispatch
        </Link>
        <Link href="/school-bus"
          className="flex items-center gap-2 px-5 py-3 rounded-xl bg-slate-800 border border-white/10 text-slate-300 text-sm font-semibold hover:bg-slate-700 transition-all">
          🏫 School Bus Module →
        </Link>
      </div>
    </div>
  );
}
