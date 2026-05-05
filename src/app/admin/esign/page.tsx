'use client';

import { useState, useEffect, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────
interface EsignRow {
  id: string;
  signing_token: string;
  contract_id: string;
  contract_type: string;
  contract_ref: string;
  document_title: string;
  signer_name: string;
  signer_email: string | null;
  signer_phone: string;
  otp_expires_at: string;
  status: 'PENDING' | 'SIGNED' | 'EXPIRED' | 'CANCELLED';
  signed_at: string | null;
  signer_ip: string | null;
  sent_via: string;
  resend_count: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface Summary {
  PENDING: number;
  SIGNED: number;
  EXPIRED: number;
  CANCELLED: number;
  total: number;
}

interface ApiResponse {
  data: EsignRow[];
  summary: Summary;
  pagination: { page: number; limit: number; total: number; pages: number };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-AE', {
    timeZone: 'Asia/Dubai',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PENDING:   'bg-amber-500/15  text-amber-400  border border-amber-500/30',
    SIGNED:    'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
    EXPIRED:   'bg-red-500/15    text-red-400    border border-red-500/30',
    CANCELLED: 'bg-slate-500/15  text-slate-400  border border-slate-500/30',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${map[status] ?? map.CANCELLED}`}>
      {status}
    </span>
  );
}

function ContractTypeBadge({ type }: { type: string }) {
  const isLease  = type.startsWith('LEASE');
  const isQuote  = type.endsWith('QUOTATION');
  const base = isLease
    ? 'bg-violet-500/15 text-violet-400 border border-violet-500/30'
    : 'bg-teal-500/15 text-teal-400 border border-teal-500/30';
  const label = type.replace('_', ' ').replace('_', '\u00a0');
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${base}`}>
      {isQuote ? '📋 ' : '📄 '}{label}
    </span>
  );
}

function SentViaBadge({ via }: { via: string }) {
  const map: Record<string, string> = {
    SMS:       'bg-blue-500/10 text-blue-400',
    EMAIL:     'bg-sky-500/10  text-sky-400',
    WHATSAPP:  'bg-green-500/10 text-green-400',
  };
  const icon: Record<string, string> = { SMS: '💬', EMAIL: '📧', WHATSAPP: '📱' };
  return (
    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${map[via] ?? 'text-slate-400'}`}>
      {icon[via] ?? '📤'} {via}
    </span>
  );
}

function KpiCard({
  label, value, color, icon,
}: {
  label: string;
  value: number;
  color: string;
  icon: string;
}) {
  return (
    <div className={`bg-slate-800/60 border ${color} rounded-xl p-4`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-2xl">{icon}</span>
        <span className="text-2xl font-bold text-white">{value.toLocaleString()}</span>
      </div>
      <p className="text-slate-400 text-sm font-medium">{label}</p>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function ESignConsolePage() {
  const [data, setData]         = useState<EsignRow[]>([]);
  const [summary, setSummary]   = useState<Summary>({ PENDING: 0, SIGNED: 0, EXPIRED: 0, CANCELLED: 0, total: 0 });
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);

  const [search, setSearch]           = useState('');
  const [statusFilter, setStatus]     = useState('');
  const [typeFilter, setType]         = useState('');

  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [cancelling, setCancelling]   = useState<string | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState<string | null>(null);

  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, pages: 0 });

  const fetchData = useCallback(async (page = 1) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (statusFilter) qs.set('status', statusFilter);
      if (typeFilter)   qs.set('contractType', typeFilter);
      if (search)       qs.set('search', search);
      qs.set('page',  String(page));
      qs.set('limit', '50');

      const res = await fetch(`/api/esign?${qs}`);
      const json: ApiResponse = await res.json();
      if (!res.ok) throw new Error((json as unknown as { error?: string }).error ?? 'Failed to fetch');
      setData(json.data ?? []);
      setSummary(json.summary ?? { PENDING: 0, SIGNED: 0, EXPIRED: 0, CANCELLED: 0, total: 0 });
      setPagination(json.pagination ?? { page: 1, limit: 50, total: 0, pages: 0 });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter, search]);

  useEffect(() => {
    fetchData(1);
  }, [fetchData]);

  // Copy signing URL
  async function copySigningUrl(token: string) {
    const url = `${window.location.origin}/sign/${token}`;
    await navigator.clipboard.writeText(url);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  }

  // Cancel signing request
  async function cancelRequest(id: string) {
    setCancelling(id);
    try {
      const res = await fetch('/api/esign', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'cancel' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to cancel');
      setCancelConfirm(null);
      fetchData(pagination.page);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Failed to cancel');
    } finally {
      setCancelling(null);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">E-Signing Console</h1>
          <p className="text-slate-400 text-sm mt-0.5">Manage OTP-based digital signing requests across all contracts</p>
        </div>
        <button
          onClick={() => fetchData(pagination.page)}
          className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiCard label="Total Sent"  value={summary.total}     color="border-slate-700"        icon="✍️" />
        <KpiCard label="Signed"      value={summary.SIGNED}    color="border-emerald-500/30"   icon="✅" />
        <KpiCard label="Pending"     value={summary.PENDING}   color="border-amber-500/30"     icon="⏳" />
        <KpiCard label="Expired"     value={summary.EXPIRED}   color="border-red-500/30"       icon="⌛" />
        <KpiCard label="Cancelled"   value={summary.CANCELLED} color="border-slate-600/50"     icon="🚫" />
      </div>

      {/* Filters */}
      <div className="bg-slate-800/50 border border-white/10 rounded-xl p-4">
        <div className="flex flex-wrap gap-3">
          {/* Search */}
          <div className="flex-1 min-w-48">
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search signer name, contract ref, phone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fetchData(1)}
                className="w-full pl-9 pr-3 py-2 bg-slate-700 border border-white/10 rounded-lg text-white text-sm placeholder-slate-400 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatus(e.target.value)}
            className="px-3 py-2 bg-slate-700 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
          >
            <option value="">All Statuses</option>
            <option value="PENDING">Pending</option>
            <option value="SIGNED">Signed</option>
            <option value="EXPIRED">Expired</option>
            <option value="CANCELLED">Cancelled</option>
          </select>

          {/* Contract type filter */}
          <select
            value={typeFilter}
            onChange={(e) => setType(e.target.value)}
            className="px-3 py-2 bg-slate-700 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
          >
            <option value="">All Types</option>
            <option value="LEASE_AGREEMENT">Lease Agreement</option>
            <option value="RENTAL_AGREEMENT">Rental Agreement</option>
            <option value="LEASE_QUOTATION">Lease Quotation</option>
            <option value="RENTAL_QUOTATION">Rental Quotation</option>
          </select>

          <button
            onClick={() => fetchData(1)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors font-medium"
          >
            Search
          </button>
          <button
            onClick={() => { setSearch(''); setStatus(''); setType(''); }}
            className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-slate-200 text-sm rounded-lg transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl p-4 text-sm">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-slate-800/50 border border-white/10 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-slate-900/50">
                <th className="text-left px-4 py-3 text-slate-400 font-medium whitespace-nowrap">Token</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium whitespace-nowrap">Type</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium whitespace-nowrap">Ref</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium whitespace-nowrap">Document</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium whitespace-nowrap">Signer</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium whitespace-nowrap">Phone</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium whitespace-nowrap">Via</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium whitespace-nowrap">Status</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium whitespace-nowrap">Created</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium whitespace-nowrap">Signed At</th>
                <th className="text-right px-4 py-3 text-slate-400 font-medium whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={11} className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-8 h-8 border-2 border-slate-600 border-t-blue-400 rounded-full animate-spin" />
                      <p className="text-slate-400 text-sm">Loading signing requests...</p>
                    </div>
                  </td>
                </tr>
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={11} className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <span className="text-4xl">✍️</span>
                      <p className="text-slate-400 text-sm">No signing requests found</p>
                      <p className="text-slate-500 text-xs">Signing requests created from Leasing or RAC contracts will appear here.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                data.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-white/5 hover:bg-white/3 transition-colors"
                  >
                    {/* Token (first 8 chars) */}
                    <td className="px-4 py-3">
                      <code className="text-xs text-slate-300 bg-slate-700/60 px-2 py-0.5 rounded font-mono">
                        {row.signing_token.slice(0, 8)}…
                      </code>
                    </td>

                    {/* Contract type */}
                    <td className="px-4 py-3">
                      <ContractTypeBadge type={row.contract_type} />
                    </td>

                    {/* Contract ref */}
                    <td className="px-4 py-3">
                      <span className="text-white font-medium text-xs">{row.contract_ref}</span>
                    </td>

                    {/* Document title */}
                    <td className="px-4 py-3 max-w-[180px]">
                      <span className="text-slate-300 text-xs line-clamp-2">{row.document_title}</span>
                    </td>

                    {/* Signer name */}
                    <td className="px-4 py-3">
                      <span className="text-white text-xs font-medium">{row.signer_name}</span>
                    </td>

                    {/* Phone */}
                    <td className="px-4 py-3">
                      <span className="text-slate-300 text-xs">{row.signer_phone}</span>
                    </td>

                    {/* Sent via */}
                    <td className="px-4 py-3">
                      <SentViaBadge via={row.sent_via} />
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <StatusBadge status={row.status} />
                    </td>

                    {/* Created */}
                    <td className="px-4 py-3">
                      <span className="text-slate-400 text-xs whitespace-nowrap">{fmtDate(row.created_at)}</span>
                    </td>

                    {/* Signed at */}
                    <td className="px-4 py-3">
                      <span className={`text-xs whitespace-nowrap ${row.signed_at ? 'text-emerald-400' : 'text-slate-600'}`}>
                        {fmtDate(row.signed_at)}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {/* Copy URL */}
                        <button
                          onClick={() => copySigningUrl(row.signing_token)}
                          title="Copy signing URL"
                          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white text-xs rounded-lg transition-colors"
                        >
                          {copiedToken === row.signing_token ? (
                            <>
                              <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              <span className="text-emerald-400">Copied</span>
                            </>
                          ) : (
                            <>
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                              URL
                            </>
                          )}
                        </button>

                        {/* Cancel (only for PENDING) */}
                        {row.status === 'PENDING' && (
                          <>
                            {cancelConfirm === row.id ? (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => cancelRequest(row.id)}
                                  disabled={cancelling === row.id}
                                  className="px-2 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs rounded-lg transition-colors disabled:opacity-50"
                                >
                                  {cancelling === row.id ? '…' : 'Confirm'}
                                </button>
                                <button
                                  onClick={() => setCancelConfirm(null)}
                                  className="px-2 py-1.5 bg-slate-600 hover:bg-slate-500 text-slate-300 text-xs rounded-lg transition-colors"
                                >
                                  No
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setCancelConfirm(row.id)}
                                className="px-2.5 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 text-xs rounded-lg border border-red-500/20 transition-colors"
                              >
                                Cancel
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination footer */}
        {!loading && pagination.total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-white/10">
            <p className="text-slate-400 text-xs">
              Showing {data.length} of {pagination.total.toLocaleString()} requests
            </p>
            <div className="flex items-center gap-2">
              <button
                disabled={pagination.page <= 1}
                onClick={() => fetchData(pagination.page - 1)}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ← Prev
              </button>
              <span className="text-slate-400 text-xs">
                Page {pagination.page} / {pagination.pages}
              </span>
              <button
                disabled={pagination.page >= pagination.pages}
                onClick={() => fetchData(pagination.page + 1)}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
