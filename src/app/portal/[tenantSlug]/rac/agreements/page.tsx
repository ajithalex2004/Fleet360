'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';

interface Agreement {
  id: string;
  agreementNo: string | null;
  startDate: string;
  endDate: string;
  totalAmount: number | null;
  currency: string;
  status: string | null;
  vehicleId: string | null;
  signedAt: string | null;
}

const STATUS_BG: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  COMPLETED: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
  DRAFT: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  CANCELLED: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
};

export default function PortalRacAgreementsPage() {
  const params = useParams();
  const search = useSearchParams();
  const tenantSlug = (params?.tenantSlug as string) ?? '';
  const customerId = search.get('customerId') ?? '';

  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!customerId) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/rental/agreements');
      const data = res.ok ? await res.json() : [];
      const mine = (Array.isArray(data) ? data : []).filter((a: any) => a.customerId === customerId);
      setAgreements(mine);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => { load(); }, [load]);

  if (!customerId) {
    return (
      <div className="p-6">
        <p className="text-slate-400 text-sm">Pick a customer first.</p>
        <Link href={`/portal/${tenantSlug}/rac`} className="text-cyan-400 underline text-sm">
          ← Back to customer picker
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <Link href={`/portal/${tenantSlug}/rac/customers?customerId=${customerId}`} className="text-xs text-slate-500 hover:text-cyan-400">
          ← Back to dashboard
        </Link>
        <h1 className="text-2xl font-bold mt-1">Rental Agreements</h1>
        <p className="text-sm text-slate-400 mt-1">
          {agreements.length} agreement{agreements.length === 1 ? '' : 's'} on record · download bilingual PDFs
        </p>
      </div>

      {loading ? (
        <div className="text-slate-500">Loading…</div>
      ) : agreements.length === 0 ? (
        <div className="p-8 rounded-xl bg-slate-800/40 border border-slate-700 text-center text-slate-400">
          No agreements on record yet.
        </div>
      ) : (
        <div className="space-y-2">
          {agreements.map((a) => (
            <div key={a.id} className="p-4 rounded-xl bg-slate-800/40 border border-slate-700 flex items-center justify-between gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-cyan-300 text-sm">{a.agreementNo ?? a.id.slice(0, 8)}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_BG[a.status ?? ''] ?? 'bg-slate-700 text-slate-300 border-slate-600'}`}>
                    {a.status ?? '—'}
                  </span>
                  {a.signedAt && (
                    <span className="text-xs text-emerald-300">
                      ✓ Signed {new Date(a.signedAt).toLocaleDateString('en-GB')}
                    </span>
                  )}
                </div>
                <div className="text-sm text-slate-300 mt-1">
                  {new Date(a.startDate).toLocaleDateString('en-GB')} → {new Date(a.endDate).toLocaleDateString('en-GB')}
                </div>
                {a.totalAmount != null && (
                  <div className="text-xs text-slate-500 mt-1">
                    Total: {a.currency} {Number(a.totalAmount).toLocaleString()}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <a
                  href={`/api/rental/agreements/${a.id}/pdf?lang=en&download=1`}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium"
                >
                  PDF·EN
                </a>
                <a
                  href={`/api/rental/agreements/${a.id}/pdf?lang=ar&download=1`}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium"
                >
                  PDF·AR
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-500 italic">
        Read-only view. Agreement amendments require account manager approval.
      </p>
    </div>
  );
}
