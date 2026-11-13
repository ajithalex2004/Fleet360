'use client';

import React, { Suspense, useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { BACK_BUTTON } from '@/lib/ui/toggle';
import { useVerifiedPortalTenant } from '../_use-verified-portal-tenant';

interface AgreementCustomer {
  fullName?: string | null;
  companyName?: string | null;
  phone?: string | null;
  email?: string | null;
}

interface Agreement {
  id: string;
  customerId?: string | null;
  customer_id?: string | null;
  customerName?: string | null;
  customer_name?: string | null;
  customerPhone?: string | null;
  customer_phone?: string | null;
  agreementNo?: string | null;
  agreement_no?: string | null;
  startDate: string;
  start_date?: string;
  endDate: string;
  end_date?: string;
  totalAmount?: number | null;
  total_amount?: number | null;
  currency: string;
  status: string | null;
  vehicleId?: string | null;
  signedAt?: string | null;
  signed_at?: string | null;
  customer?: AgreementCustomer | null;
  booking?: {
    customer?: AgreementCustomer | null;
  } | null;
}

function unwrapAgreements(payload: unknown): Agreement[] {
  if (Array.isArray(payload)) return payload as Agreement[];
  if (payload && typeof payload === 'object') {
    const rec = payload as Record<string, unknown>;
    for (const k of ['data', 'agreements', 'items', 'rows']) {
      if (Array.isArray(rec[k])) return rec[k] as Agreement[];
    }
  }
  return [];
}

const STATUS_BG: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  COMPLETED: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
  DRAFT: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  CANCELLED: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
};

function PortalRacAgreementsInner() {
  const params = useParams() ?? {};
  const search = useSearchParams() ?? new URLSearchParams();
  const tenantSlug = (params?.tenantSlug as string) ?? '';
  const customerId = search.get('customerId') ?? '';
  const guard = useVerifiedPortalTenant(tenantSlug);

  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = customerId ? `?customerId=${encodeURIComponent(customerId)}&limit=200` : '?limit=200';
      const res = await fetch(`/api/rental/agreements${qs}`, { cache: 'no-store' });
      const data = res.ok ? await res.json() : [];
      const rows = unwrapAgreements(data);
      const filtered = customerId
        ? rows.filter((a) => (a.customerId ?? a.customer_id) === customerId)
        : rows;
      setAgreements(filtered);
    } catch {
      setAgreements([]);
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    if (guard.status !== 'verified') return;
    load();
  }, [guard.status, load]);

  if (guard.status === 'checking') {
    return <div className="p-6 text-slate-500">Verifying tenant access…</div>;
  }

  if (guard.status === 'mismatch') {
    const targetPath = guard.expectedSlug
      ? `/portal/${guard.expectedSlug}/rac/agreements${customerId ? `?customerId=${encodeURIComponent(customerId)}` : ''}`
      : null;
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div role="alert" className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-6 space-y-3">
          <p className="text-rose-300 font-semibold text-base">Tenant Access Mismatch</p>
          <p className="text-slate-300 text-sm">
            Your signed-in session belongs to <span className="font-semibold text-white">{guard.tenant.name}</span>
            {guard.tenant.slug ? ` (${guard.tenant.slug})` : ''}, which does not match{' '}
            <span className="font-mono text-rose-200">/portal/{tenantSlug}/rac/agreements</span>. Cross-tenant agreement data display has been blocked.
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            {targetPath && (
              <Link
                href={targetPath}
                className="px-4 py-2 rounded-xl bg-cyan-500 text-slate-950 text-xs font-bold hover:bg-cyan-400 transition-colors"
              >
                Switch to /portal/{guard.expectedSlug}/rac/agreements →
              </Link>
            )}
            <Link
              href="/platform"
              className="px-4 py-2 rounded-xl bg-slate-800 text-slate-200 border border-white/10 text-xs font-semibold hover:bg-slate-700 transition-colors"
            >
              Back to Platform
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (guard.status === 'unauthorized') {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <div role="alert" className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-6 space-y-3">
          <p className="text-amber-300 font-semibold text-base">Authentication Required</p>
          <p className="text-slate-300 text-sm">
            Unable to verify your tenant session for <span className="font-mono text-amber-200">/portal/{tenantSlug}/rac/agreements</span>.
          </p>
          <Link
            href="/login"
            className="inline-flex items-center px-4 py-2 rounded-xl bg-amber-500 text-slate-950 text-xs font-bold hover:bg-amber-400 transition-colors"
          >
            Go to Staff Sign In →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <Link
            href={customerId ? `/portal/${tenantSlug}/rac/customers?customerId=${customerId}` : `/portal/${tenantSlug}/rac`}
            className={BACK_BUTTON}
          >
            ← {customerId ? 'Back to customer dashboard' : 'Back to RAC overview'}
          </Link>
          <h1 className="text-2xl font-bold mt-1">Rental Agreements</h1>
          <p className="text-sm text-slate-400 mt-1">
            {agreements.length} agreement{agreements.length === 1 ? '' : 's'} on record · download bilingual PDFs
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/portal/${tenantSlug}/rac/customers`}
            className="px-3.5 py-2 rounded-xl bg-slate-800 text-slate-300 border border-slate-700 text-xs font-medium hover:bg-slate-700 transition-colors"
          >
            👥 Filter by Customer
          </Link>
          <a
            href="/rac-portal"
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 rounded-xl bg-emerald-500 text-slate-950 text-xs font-bold hover:bg-emerald-400 transition-colors"
          >
            🏢 Customer B2B Portal ↗
          </a>
        </div>
      </div>

      {loading ? (
        <div className="text-slate-500">Loading…</div>
      ) : agreements.length === 0 ? (
        <div className="p-8 rounded-xl bg-slate-800/40 border border-slate-700 text-center text-slate-400">
          No agreements on record yet.
        </div>
      ) : (
        <div className="space-y-2">
          {agreements.map((a) => {
            const agNo = a.agreementNo ?? a.agreement_no ?? a.id.slice(0, 8);
            const start = a.startDate ?? a.start_date ?? '';
            const end = a.endDate ?? a.end_date ?? '';
            const total = a.totalAmount ?? a.total_amount;
            const signed = a.signedAt ?? a.signed_at;
            const custObj = a.customer ?? a.booking?.customer;
            const custName =
              custObj?.companyName ??
              custObj?.fullName ??
              a.customerName ??
              a.customer_name ??
              '—';
            const custPhone = custObj?.phone ?? a.customerPhone ?? a.customer_phone ?? null;
            return (
              <div key={a.id} className="p-4 rounded-xl bg-slate-800/40 border border-slate-700 flex items-center justify-between gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-cyan-300 text-sm">{agNo}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_BG[a.status ?? ''] ?? 'bg-slate-700 text-slate-300 border-slate-600'}`}>
                      {a.status ?? '—'}
                    </span>
                    <span className="text-xs text-slate-300">
                      · {custName}
                      {custPhone ? <span className="text-slate-500"> · {custPhone}</span> : ''}
                    </span>
                    {signed && (
                      <span className="text-xs text-emerald-300">
                        ✓ Signed {new Date(signed).toLocaleDateString('en-GB')}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-slate-300 mt-1">
                    {start ? new Date(start).toLocaleDateString('en-GB') : '—'} → {end ? new Date(end).toLocaleDateString('en-GB') : '—'}
                  </div>
                  {total != null && (
                    <div className="text-xs text-slate-500 mt-1">
                      Total: {a.currency || 'AED'} {Number(total).toLocaleString()}
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
            );
          })}
        </div>
      )}

      <p className="text-xs text-slate-500 italic">
        Read-only view. Digital signature capture and extension requests are available in the standalone B2B portal (/rac-portal/agreements).
      </p>
    </div>
  );
}

export default function PortalRacAgreementsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-slate-500">Loading agreements…</div>}>
      <PortalRacAgreementsInner />
    </Suspense>
  );
}
