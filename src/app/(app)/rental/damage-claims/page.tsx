'use client';
import React, { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { KpiCard, StatGrid } from '@/components/ui/page-theme';

interface DamageClaim {
  id: string;
  bookingId: string;
  booking?: { bookingRef?: string; customer?: { fullName: string } };
  description?: string;
  severity?: string;
  estimatedCost?: number;
  actualCost?: number;
  status?: string;
  insuranceClaim?: boolean;
  billedToCustomer?: boolean;
  photoUrl?: string | null;
  documentUrl?: string | null;
  photos?: string[] | null;
  createdAt?: string;
}

interface BookingOption {
  id: string;
  bookingRef?: string;
  customerId?: string;
  status?: string;
  customer?: { fullName?: string };
}

const STATUS_COLORS: Record<string, string> = {
  OPEN:             'bg-amber-500/20 text-amber-400 border-amber-500/30',
  ASSESSED:         'bg-blue-500/20 text-blue-400 border-blue-500/30',
  PENDING_APPROVAL: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  APPROVED:         'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  BILLED:           'bg-purple-500/20 text-purple-400 border-purple-500/30',
  CLOSED:           'bg-slate-500/20 text-[var(--text-muted)] border-slate-500/30',
};

const EMPTY_FORM = {
  bookingId: '',
  severity: '',
  description: '',
  estimatedCost: '',
  insuranceClaim: false,
  billedToCustomer: true,
};

function DamageClaimsInner() {
  const searchParams = useSearchParams();
  const fromAi = searchParams.get('from') === 'ai';
  const aiSeverity = searchParams.get('severity') ?? '';
  const aiEstimatedCost = searchParams.get('estimatedCost') ?? '';
  const aiDescription = searchParams.get('description') ?? '';
  const highlightId = searchParams.get('id') ?? '';

  const aiHandledRef = useRef(false);
  const idHandledRef = useRef('');

  const [claims, setClaims]             = useState<DamageClaim[]>([]);
  const [bookings, setBookings]         = useState<BookingOption[]>([]);
  const [statusFilter, setStatus]       = useState('All');
  const [page, setPage]                 = useState(1);
  const [total, setTotal]               = useState(0);
  const [totalPages, setTotalPages]     = useState(1);
  const limit = 20;

  const [showModal, setShowModal]       = useState(false);
  const [selectedClaim, setSelectedClaim] = useState<DamageClaim | null>(null);
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState('');
  const [modalError, setModalError]     = useState('');
  const [damagePhoto, setDamagePhoto]   = useState<File | null>(null);

  const [formData, setFormData] = useState(EMPTY_FORM);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const claimParams = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      if (statusFilter !== 'All') {
        claimParams.set('status', statusFilter);
      }
      const [cRes, bRes] = await Promise.all([
        fetch(`/api/rental/damage-claims?${claimParams}`),
        fetch('/api/rental/bookings?limit=100'),
      ]);
      const [cData, bData] = await Promise.all([
        cRes.json().catch(() => ({})),
        bRes.json().catch(() => ({})),
      ]);
      if (!cRes.ok) {
        setError(cData?.error ?? `Failed to load damage claims (HTTP ${cRes.status})`);
      }
      const claimList: DamageClaim[] = Array.isArray(cData)
        ? cData
        : Array.isArray(cData?.data)
          ? cData.data
          : [];
      const totalVal =
        typeof cData?.total === 'number'
          ? cData.total
          : typeof cData?.pagination?.total === 'number'
            ? cData.pagination.total
            : claimList.length;
      const pagesVal =
        typeof cData?.totalPages === 'number'
          ? Math.max(1, cData.totalPages)
          : typeof cData?.pagination?.totalPages === 'number'
            ? Math.max(1, cData.pagination.totalPages)
            : Math.max(1, Math.ceil(totalVal / limit));

      setClaims(claimList);
      setTotal(totalVal);
      setTotalPages(pagesVal);
      setBookings(Array.isArray(bData) ? bData : Array.isArray(bData?.data) ? bData.data : []);
    } catch {
      setError('Failed to load damage claims');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  // Handle ?from=ai&severity=...&estimatedCost=...&description=...
  useEffect(() => {
    if (!fromAi || aiHandledRef.current) return;
    aiHandledRef.current = true;
    const descPrefix = aiSeverity ? `[AI Assessment — ${aiSeverity}] ` : '';
    setFormData({
      bookingId: '',
      severity: aiSeverity,
      description: `${descPrefix}${aiDescription}`.trim(),
      estimatedCost: aiEstimatedCost,
      insuranceClaim: false,
      billedToCustomer: true,
    });
    setDamagePhoto(null);
    setModalError('');
    setShowModal(true);
  }, [fromAi, aiSeverity, aiEstimatedCost, aiDescription]);

  // Handle ?id= highlight & detail auto-open
  useEffect(() => {
    if (!highlightId || loading || claims.length === 0) return;
    if (idHandledRef.current === highlightId) return;
    const found = claims.find(c => c.id === highlightId);
    if (found) {
      idHandledRef.current = highlightId;
      setSelectedClaim(found);
    }
  }, [highlightId, loading, claims]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setModalError('');
    setError('');
    try {
      let uploadedPhotoUrl: string | null = null;
      if (damagePhoto) {
        const fd = new FormData();
        fd.append('file', damagePhoto);
        fd.append('entityType', 'DAMAGE_CLAIM');
        fd.append('entityId', formData.bookingId || '');
        fd.append('docType', 'DAMAGE_PHOTO');
        fd.append('docName', damagePhoto.name);
        const upRes = await fetch('/api/rental/documents/upload', {
          method: 'POST',
          body: fd,
        });
        const upJson = await upRes.json().catch(() => ({}));
        if (!upRes.ok) {
          throw new Error(upJson.error || `Photo upload failed (HTTP ${upRes.status})`);
        }
        uploadedPhotoUrl = upJson.url ?? upJson.fileUrl ?? null;
      }

      const res = await fetch('/api/rental/damage-claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: formData.bookingId,
          severity: formData.severity || undefined,
          description: formData.description,
          estimatedCost: parseFloat(formData.estimatedCost) || null,
          insuranceClaim: formData.insuranceClaim,
          billedToCustomer: formData.billedToCustomer,
          ...(uploadedPhotoUrl
            ? {
                photoUrl: uploadedPhotoUrl,
                documentUrl: uploadedPhotoUrl,
                photos: [uploadedPhotoUrl],
              }
            : {}),
          status: 'OPEN',
        }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Failed to create claim (HTTP ${res.status})`);
      }
      setShowModal(false);
      setFormData(EMPTY_FORM);
      setDamagePhoto(null);
      loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create claim';
      setModalError(msg);
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  // Assess / submit / approve / return / bill / close.
  const claimAction = async (c: DamageClaim, action: string) => {
    const payload: Record<string, unknown> = { action };
    if (action === 'assess') {
      const v = prompt('Actual repair cost (AED)', c.actualCost != null ? String(c.actualCost) : String(c.estimatedCost ?? ''));
      if (v === null) return;
      if (!(Number(v) >= 0) || v.trim() === '') return setError('Enter the actual cost as a number');
      payload.actualCost = Number(v);
    }
    if (action === 'reject') {
      const r = prompt('Why is this claim being returned for re-assessment?');
      if (r === null) return;
      payload.reason = r.trim() || 'Review required';
    }
    setError('');
    try {
      const res = await fetch(`/api/rental/damage-claims/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        setError(d?.error ?? `Action failed (HTTP ${res.status})`);
        return;
      }
      const wf = d?.workflow;
      const note = d?.message
        ?? (wf?.status === 'IN_PROGRESS' ? `Sent for approval through "${wf.name}"${wf.level ? `, waiting for "${wf.level}"` : ''}.` : null)
        ?? (wf?.status === 'APPROVED' ? `"${wf.name}": no approval level applies, so the claim is approved.` : null);
      if (note) alert(note);
      if (selectedClaim?.id === c.id) setSelectedClaim(null);
      loadData();
    } catch {
      setError('Failed to update the claim');
    }
  };

  const ACTIONS: Record<string, { action: string; label: string; tone: string }[]> = {
    OPEN:             [{ action: 'assess', label: 'Assess', tone: 'text-blue-400' }, { action: 'submit', label: 'Submit', tone: 'text-orange-400' }],
    ASSESSED:         [{ action: 'assess', label: 'Edit cost', tone: 'text-blue-400' }, { action: 'submit', label: 'Submit for approval', tone: 'text-orange-400' }, { action: 'bill', label: 'Bill', tone: 'text-purple-400' }, { action: 'close', label: 'Close', tone: 'text-[var(--text-muted)]' }],
    PENDING_APPROVAL: [{ action: 'approve', label: 'Approve', tone: 'text-emerald-400' }, { action: 'reject', label: 'Return', tone: 'text-rose-400' }],
    APPROVED:         [{ action: 'bill', label: 'Bill customer', tone: 'text-purple-400' }, { action: 'close', label: 'Close (no charge)', tone: 'text-[var(--text-muted)]' }],
    BILLED:           [{ action: 'close', label: 'Close', tone: 'text-[var(--text-muted)]' }],
  };

  const filtered = statusFilter === 'All' ? claims : claims.filter(c => c.status === statusFilter);
  const totalValue = claims.reduce((s, c) => s + Number(c.estimatedCost ?? 0), 0);
  const openCount  = claims.filter(c => c.status === 'OPEN').length;

  const getClaimPhoto = (c: DamageClaim): string | null =>
    c.photoUrl ?? c.documentUrl ?? (Array.isArray(c.photos) && c.photos[0] ? c.photos[0] : null);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)] mb-2">Damage Claims</h1>
          <p className="text-xs text-[var(--text-muted)]">{openCount} open claims — AED {totalValue.toLocaleString()} estimated ({total} total)</p>
        </div>
        <button
          onClick={() => {
            setFormData(EMPTY_FORM);
            setDamagePhoto(null);
            setModalError('');
            setShowModal(true);
          }}
          className="rounded-xl bg-gradient-to-r from-rose-600 to-pink-600 px-6 py-3 text-sm font-medium text-white hover:opacity-90"
        >
          + Log Damage Claim
        </button>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-rose-400 hover:text-rose-200 ml-3">✕</button>
        </div>
      )}

      {/* Summary cards */}
      <StatGrid cols={6}>
        {(['All', 'OPEN', 'ASSESSED', 'PENDING_APPROVAL', 'APPROVED', 'BILLED', 'CLOSED'] as const).map((s, idx) => {
          const accents = ['slate', 'rose', 'amber', 'amber', 'cyan', 'violet', 'emerald'] as const;
          return (
            <KpiCard
              key={s}
              label={s.replace('_', ' ')}
              value={s === 'All' ? total || claims.length : claims.filter(c => c.status === s).length}
              accent={accents[idx % accents.length]}
              active={statusFilter === s}
              onClick={() => { setStatus(s); setPage(1); }}
            />
          );
        })}
      </StatGrid>

      <div className="bg-[var(--bg-surface)]/50 border border-[var(--border-subtle)] rounded-2xl p-6 backdrop-blur-sm overflow-x-auto">
        {loading ? (
          <div className="text-center text-[var(--text-muted)] py-12 animate-pulse">Loading damage claims...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-[var(--text-muted)] py-12">No damage claims found</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border-subtle)]">
                <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--text-muted)]">Date</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--text-muted)]">Booking</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--text-muted)]">Customer</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--text-muted)]">Description</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--text-muted)]">Est. Cost</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--text-muted)]">Actual Cost</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--text-muted)]">Insurance</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--text-muted)]">Status</th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-[var(--text-muted)]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const isHighlighted = Boolean(highlightId && c.id === highlightId);
                const photoLink = getClaimPhoto(c);
                return (
                  <tr
                    key={c.id}
                    className={`border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-hover)] transition-colors ${
                      isHighlighted ? 'bg-rose-500/10 ring-1 ring-inset ring-rose-500/40' : ''
                    }`}
                  >
                    <td className="px-4 py-4 text-sm text-[var(--text-main)]">
                      {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '-'}
                    </td>
                    <td className="px-4 py-4 text-sm font-medium text-[var(--text-main)]">
                      <button
                        type="button"
                        onClick={() => setSelectedClaim(c)}
                        className="hover:underline text-rose-300 font-mono"
                      >
                        {c.booking?.bookingRef ?? c.bookingId.slice(0, 8)}
                      </button>
                    </td>
                    <td className="px-4 py-4 text-sm text-[var(--text-main)]">{c.booking?.customer?.fullName ?? '-'}</td>
                    <td className="px-4 py-4 text-sm text-[var(--text-main)] max-w-xs whitespace-pre-wrap" title={c.description}>
                      {c.description ?? '-'}
                      {photoLink && (
                        <div className="mt-1">
                          <a
                            href={photoLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-cyan-400 hover:underline"
                          >
                            View Photo ↗
                          </a>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-4 text-sm text-amber-400 font-medium">
                      {c.estimatedCost ? `AED ${Number(c.estimatedCost).toLocaleString()}` : '-'}
                    </td>
                    <td className="px-4 py-4 text-sm text-rose-400 font-medium">
                      {c.actualCost ? `AED ${Number(c.actualCost).toLocaleString()}` : '-'}
                    </td>
                    <td className="px-4 py-4 text-sm">
                      {c.insuranceClaim ? <span className="text-blue-400">Insurance</span> : <span className="text-[var(--text-muted)]">Self</span>}
                    </td>
                    <td className="px-4 py-4">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium border ${STATUS_COLORS[c.status ?? 'OPEN']}`}>
                        {(c.status ?? 'OPEN').replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {(ACTIONS[c.status ?? 'OPEN'] ?? []).map(a => (
                          <button key={a.action} onClick={() => claimAction(c, a.action)} className={`text-xs hover:underline ${a.tone}`}>
                            {a.label}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-4 mt-4 border-t border-[var(--border-subtle)]">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="px-4 py-1.5 rounded-lg border border-[var(--border-subtle)] text-sm text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-40"
            >
              ← Prev
            </button>
            <span className="text-xs text-[var(--text-muted)]">
              Page {page} of {totalPages} ({total} total)
            </span>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              className="px-4 py-1.5 rounded-lg border border-[var(--border-subtle)] text-sm text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)] disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Log Damage Claim Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto bg-[var(--bg-surface)]/95 border border-[var(--border-subtle)] rounded-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold text-[var(--text-main)]">Log Damage Claim</h2>
                {formData.severity && (
                  <p className="text-xs text-rose-300 mt-1">
                    Pre-populated from AI Damage Assessment ({formData.severity})
                  </p>
                )}
              </div>
              <button onClick={() => setShowModal(false)} className="text-[var(--text-muted)] hover:text-[var(--text-main)]">✕</button>
            </div>

            {modalError && (
              <div className="mb-4 bg-rose-500/10 border border-rose-500/30 rounded-xl px-4 py-3 text-rose-400 text-sm">
                {modalError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Booking *</label>
                <select
                  value={formData.bookingId}
                  onChange={e => setFormData(p => ({ ...p, bookingId: e.target.value }))}
                  required
                  className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-rose-500 focus:outline-none"
                >
                  <option value="">Select booking</option>
                  {bookings.filter(b => b.status !== 'CANCELLED').map(b => (
                    <option key={b.id} value={b.id}>
                      {b.bookingRef ?? b.id.slice(0, 8)} — {b.customer?.fullName ?? b.customerId}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Severity</label>
                <select
                  value={formData.severity}
                  onChange={e => setFormData(p => ({ ...p, severity: e.target.value }))}
                  className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] focus:border-rose-500 focus:outline-none"
                >
                  <option value="">Unspecified</option>
                  <option value="MINOR">Minor</option>
                  <option value="MODERATE">Moderate</option>
                  <option value="MAJOR">Major</option>
                  <option value="TOTAL_LOSS">Total Loss</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Damage Description *</label>
                <textarea
                  value={formData.description}
                  onChange={e => setFormData(p => ({ ...p, description: e.target.value }))}
                  required
                  rows={3}
                  placeholder="Describe the damage..."
                  className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-rose-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Estimated Cost (AED)</label>
                <input
                  type="number"
                  value={formData.estimatedCost}
                  onChange={e => setFormData(p => ({ ...p, estimatedCost: e.target.value }))}
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                  className="w-full px-4 py-2 rounded-lg bg-[var(--bg-surface-hover)] border border-[var(--border-subtle)] text-[var(--text-main)] placeholder-[var(--text-faint)] focus:border-rose-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text-muted)] mb-2">Damage Photo / Evidence (Optional)</label>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={e => setDamagePhoto(e.target.files?.[0] ?? null)}
                  className="w-full text-sm text-[var(--text-muted)] file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-rose-700 file:text-white hover:file:bg-rose-600"
                />
                {damagePhoto && (
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    {damagePhoto.name} ({(damagePhoto.size / 1024).toFixed(1)} KB)
                  </p>
                )}
              </div>
              <div className="flex gap-6">
                <label className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                  <input
                    type="checkbox"
                    checked={formData.insuranceClaim}
                    onChange={e => setFormData(p => ({ ...p, insuranceClaim: e.target.checked }))}
                    className="accent-blue-500 text-[var(--text-main)]"
                  />
                  Insurance Claim
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                  <input
                    type="checkbox"
                    checked={formData.billedToCustomer}
                    onChange={e => setFormData(p => ({ ...p, billedToCustomer: e.target.checked }))}
                    className="accent-rose-500 text-[var(--text-main)]"
                  />
                  Bill to Customer
                </label>
              </div>
              <div className="flex gap-4 justify-end pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-6 py-2 rounded-lg border border-[var(--border-subtle)] text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-6 py-2 rounded-lg bg-gradient-to-r from-rose-600 to-pink-600 text-white hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? 'Creating...' : 'Create Claim'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Selected Claim Detail Modal (?id= or row click) */}
      {selectedClaim && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-[var(--bg-surface)]/95 border border-[var(--border-subtle)] rounded-2xl p-8 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold text-[var(--text-main)]">Damage Claim Details</h2>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Booking {selectedClaim.booking?.bookingRef ?? selectedClaim.bookingId.slice(0, 8)} · {selectedClaim.booking?.customer?.fullName ?? 'Customer'}
                </p>
              </div>
              <button onClick={() => setSelectedClaim(null)} className="text-[var(--text-muted)] hover:text-[var(--text-main)]">✕</button>
            </div>

            <div className="bg-[var(--bg-surface-hover)]/50 border border-[var(--border-subtle)] rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Status</span>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[selectedClaim.status ?? 'OPEN']}`}>
                  {(selectedClaim.status ?? 'OPEN').replace('_', ' ')}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Estimated Cost</span>
                <span className="text-amber-400 font-semibold">
                  {selectedClaim.estimatedCost ? `AED ${Number(selectedClaim.estimatedCost).toLocaleString()}` : '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--text-muted)]">Actual Cost</span>
                <span className="text-rose-400 font-semibold">
                  {selectedClaim.actualCost ? `AED ${Number(selectedClaim.actualCost).toLocaleString()}` : '—'}
                </span>
              </div>
              <div className="pt-2 border-t border-[var(--border-subtle)]">
                <div className="text-xs text-[var(--text-faint)] mb-1">Description</div>
                <p className="text-[var(--text-main)] whitespace-pre-wrap">{selectedClaim.description ?? '—'}</p>
              </div>
              {getClaimPhoto(selectedClaim) && (
                <div className="pt-2">
                  <a
                    href={getClaimPhoto(selectedClaim)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/30 font-medium"
                  >
                    View Damage Photo ↗
                  </a>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="flex flex-wrap gap-3">
                {(ACTIONS[selectedClaim.status ?? 'OPEN'] ?? []).map(a => (
                  <button
                    key={a.action}
                    onClick={() => claimAction(selectedClaim, a.action)}
                    className={`text-xs font-medium hover:underline ${a.tone}`}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setSelectedClaim(null)}
                className="px-5 py-2 rounded-lg border border-[var(--border-subtle)] text-sm text-[var(--text-main)] hover:bg-[var(--bg-surface-hover)]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DamageClaimsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-64">
          <div className="text-[var(--text-muted)] animate-pulse">Loading damage claims...</div>
        </div>
      }
    >
      <DamageClaimsInner />
    </Suspense>
  );
}
