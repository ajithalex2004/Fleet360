'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, ShieldCheck, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-theme';
import { COMPLIANCE_CATALOG, EMIRATE_LABELS, type Emirate } from '@/lib/exchange/partner-activation';

/**
 * Partner onboarding — the onboarding tenant's review of its transport
 * partners. A partner starts Pending Activation; it uploads its mandatory
 * compliance documents (which depend on its service areas and emirate) and
 * submits them; the tenant's administrators approve or reject each document
 * and then activate the partner, ask for more information, or reject it.
 * Tenant administrators see the partners their tenant onboarded; platform
 * administrators see every partner.
 */

interface PartnerRow {
  id: string;
  legalName: string;
  partnerCode: string;
  emirate: Emirate | null;
  domains: string[];
  onboardingStatus: string;
  onboardingLabel: string;
  onboardedByTenantName: string | null;
  memberCount: number;
  required: number;
  approved: number;
  awaitingReview: number;
  readyToActivate: boolean;
  createdAt: string;
}

interface ChecklistItem {
  docType: string;
  label: string;
  hint: string;
  reason: string;
  status: string;
  document: { id: string } | null;
}

interface Doc {
  id: string;
  docType: string;
  docNumber: string | null;
  expiryDate: string | null;
  status: string;
  reviewNote: string | null;
  hasFile: boolean;
  createdAt: string;
}

interface Detail {
  partner: {
    id: string;
    legalName: string;
    tradeName: string | null;
    partnerCode: string;
    city: string | null;
    emirate: Emirate | null;
    domains: string[];
    tradeLicenseNumber: string | null;
    taxRegistrationNumber: string | null;
    primaryContactName: string | null;
    primaryContactEmail: string | null;
    primaryContactPhone: string | null;
    onboardingStatus: string;
    onboardingLabel: string;
    rejectionReason: string | null;
    approvedAt: string | null;
  };
  documents: Doc[];
  checklist: { items: ChecklistItem[]; allApproved: boolean };
}

const DOMAIN_LABELS: Record<string, string> = {
  PASSENGER_TRANSPORT: 'Passenger transport',
  LIMOUSINE: 'Limousine',
  SCHOOL_TRANSPORT: 'School transport',
  FREIGHT: 'Freight',
  RECOVERY: 'Recovery',
};

const DOC_STATUS: Record<string, { label: string; style: string }> = {
  MISSING: { label: 'Not uploaded', style: 'bg-slate-500/15 text-[var(--text-muted)]' },
  PENDING: { label: 'Awaiting review', style: 'bg-amber-500/15 text-amber-400' },
  VALID: { label: 'Approved', style: 'bg-emerald-500/15 text-emerald-400' },
  EXPIRING: { label: 'Expiring soon', style: 'bg-amber-500/15 text-amber-400' },
  EXPIRED: { label: 'Expired', style: 'bg-rose-500/15 text-rose-400' },
  REJECTED: { label: 'Rejected', style: 'bg-rose-500/15 text-rose-400' },
};

const STAGE_STYLE: Record<string, string> = {
  APPROVED: 'bg-emerald-500/15 text-emerald-400',
  UNDER_REVIEW: 'bg-cyan-500/15 text-cyan-400',
  APPLICATION_SUBMITTED: 'bg-cyan-500/15 text-cyan-400',
  REJECTED: 'bg-rose-500/15 text-rose-400',
};

const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed';

async function readJson(r: Response): Promise<Record<string, unknown>> {
  return (await r.json().catch(() => ({}))) as Record<string, unknown>;
}

function Pill({ text, style }: { text: string; style: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${style}`}>{text}</span>;
}

export default function PartnerOnboardingPage() {
  const [partners, setPartners] = useState<PartnerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadPartners = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/exchange/onboarding');
      const d = await readJson(r);
      if (!r.ok) { setPageError((d.error as string) ?? `Could not load partners (${r.status})`); return; }
      setPageError(null);
      const list = (d.partners as PartnerRow[]) ?? [];
      setPartners(list);
      setSelectedId((cur) => cur ?? list.find((p) => p.onboardingStatus !== 'APPROVED')?.id ?? list[0]?.id ?? null);
    } catch {
      setPageError('Could not load partners');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setDetailError(null);
    try {
      const r = await fetch(`/api/admin/exchange/onboarding/${id}`);
      const d = await readJson(r);
      if (!r.ok) { setDetail(null); setDetailError((d.error as string) ?? 'Could not load the partner'); return; }
      setDetail(d as unknown as Detail);
    } catch {
      setDetailError('Could not load the partner');
    }
  }, []);

  useEffect(() => { void loadPartners(); }, [loadPartners]);
  useEffect(() => {
    setNotice(null);
    if (selectedId) void loadDetail(selectedId); else setDetail(null);
  }, [selectedId, loadDetail]);

  const refresh = async () => {
    await Promise.all([loadPartners(), selectedId ? loadDetail(selectedId) : Promise.resolve()]);
  };

  const reviewDoc = async (doc: Doc, decision: 'APPROVE' | 'REJECT') => {
    if (!selectedId) return;
    let note: string | null = null;
    if (decision === 'REJECT') {
      note = window.prompt('Why is this document rejected? The partner will see this note.');
      if (!note?.trim()) return;
    }
    setBusy(doc.id); setDetailError(null);
    try {
      const r = await fetch(`/api/admin/exchange/onboarding/${selectedId}/documents/${doc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note }),
      });
      const d = await readJson(r);
      if (!r.ok) { setDetailError((d.error as string) ?? 'Could not save the review'); return; }
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const decide = async (decision: 'ACTIVATE' | 'MORE_INFO' | 'REJECT') => {
    if (!selectedId || !detail) return;
    let note: string | null = null;
    if (decision === 'ACTIVATE') {
      if (!window.confirm(`Activate ${detail.partner.legalName}? It will be able to see and quote on your jobs.`)) return;
    } else {
      note = window.prompt(
        decision === 'MORE_INFO'
          ? 'What does the partner need to provide? It will be emailed this note.'
          : 'Why is the partner rejected? It will be emailed this note.',
      );
      if (!note?.trim()) return;
    }
    setBusy(decision); setDetailError(null);
    try {
      const r = await fetch(`/api/admin/exchange/onboarding/${selectedId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note }),
      });
      const d = await readJson(r);
      if (!r.ok) { setDetailError((d.error as string) ?? 'Could not save the decision'); return; }
      setNotice(
        decision === 'ACTIVATE' ? `${detail.partner.legalName} is now active.`
        : decision === 'MORE_INFO' ? 'The partner was asked for more information.'
        : 'The partner was rejected.',
      );
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const docsById = new Map(detail?.documents.map((d) => [d.id, d]) ?? []);
  const requiredIds = new Set(detail?.checklist.items.map((i) => i.document?.id).filter(Boolean) as string[]);
  const otherDocs = detail?.documents.filter((d) => !requiredIds.has(d.id)) ?? [];
  const activated = detail?.partner.onboardingStatus === 'APPROVED';

  const docRow = (doc: Doc, title: string, sub?: string) => (
    <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{title}</span>
          <Pill text={DOC_STATUS[doc.status]?.label ?? doc.status} style={DOC_STATUS[doc.status]?.style ?? DOC_STATUS.MISSING.style} />
        </div>
        <div className="text-xs text-[var(--text-muted)]">
          {sub ? `${sub} · ` : ''}
          {doc.docNumber ? `No. ${doc.docNumber}` : 'No number'}
          {doc.expiryDate ? ` · expires ${new Date(doc.expiryDate).toLocaleDateString()}` : ' · no expiry'}
          {` · uploaded ${new Date(doc.createdAt).toLocaleDateString()}`}
        </div>
        {doc.reviewNote && <div className="text-xs text-rose-400">Note: {doc.reviewNote}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {doc.hasFile && selectedId && (
          <a
            href={`/api/admin/exchange/onboarding/${selectedId}/documents/${doc.id}/file`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-cyan-500 hover:underline"
          >
            View <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {(doc.status === 'PENDING' || doc.status === 'REJECTED') && (
          <button type="button" disabled={busy === doc.id} onClick={() => reviewDoc(doc, 'APPROVE')}
            className={`${btn} bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-500`}>
            <CheckCircle2 className="h-3.5 w-3.5" /> Approve
          </button>
        )}
        {doc.status !== 'REJECTED' && doc.status !== 'EXPIRED' && (
          <button type="button" disabled={busy === doc.id} onClick={() => reviewDoc(doc, 'REJECT')}
            className={`${btn} border border-rose-500/40 px-2 py-1 text-xs text-rose-400 hover:bg-rose-500/10`}>
            <XCircle className="h-3.5 w-3.5" /> Reject
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Partner onboarding"
        subtitle="Review transport partners' compliance documents and activate them for your network"
        icon={ShieldCheck}
        accent="cyan"
      />

      {pageError && <div className="rounded-xl border border-amber-700 bg-amber-950/40 px-4 py-3 text-sm text-amber-300">{pageError}</div>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(260px,360px)_1fr]">
        <section className="space-y-2">
          {loading && partners.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">Loading…</p>
          ) : partners.length === 0 ? (
            <p className="rounded-xl border border-[var(--border-subtle)] p-4 text-sm text-[var(--text-muted)]">
              No transport partners have been onboarded by your company yet.
            </p>
          ) : partners.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelectedId(p.id)}
              className={`w-full rounded-xl border p-3 text-left transition ${
                p.id === selectedId ? 'border-cyan-500 bg-cyan-500/5' : 'border-[var(--border-subtle)] hover:border-cyan-500/50'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold">{p.legalName}</span>
                <Pill text={p.onboardingLabel} style={STAGE_STYLE[p.onboardingStatus] ?? 'bg-amber-500/15 text-amber-400'} />
              </div>
              <div className="mt-1 text-xs text-[var(--text-muted)]">
                {p.partnerCode}{p.emirate ? ` · ${EMIRATE_LABELS[p.emirate]}` : ''}
                {p.onboardedByTenantName ? ` · ${p.onboardedByTenantName}` : ''}
              </div>
              <div className="mt-1 text-xs text-[var(--text-muted)]">
                Documents approved {p.approved}/{p.required}
                {p.awaitingReview > 0 ? ` · ${p.awaitingReview} awaiting review` : ''}
              </div>
            </button>
          ))}
        </section>

        <section className="space-y-4">
          {detailError && <div className="rounded-xl border border-rose-700 bg-rose-950/40 px-4 py-3 text-sm text-rose-300">{detailError}</div>}
          {notice && <div className="rounded-xl border border-emerald-700 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-300">{notice}</div>}
          {detail && (
            <>
              <div className="space-y-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">{detail.partner.legalName}</h2>
                    <p className="text-xs text-[var(--text-muted)]">
                      {detail.partner.partnerCode}
                      {detail.partner.tradeName ? ` · ${detail.partner.tradeName}` : ''}
                      {detail.partner.city ? ` · ${detail.partner.city}` : ''}
                      {detail.partner.emirate ? ` · ${EMIRATE_LABELS[detail.partner.emirate]}` : ' · emirate not set'}
                    </p>
                  </div>
                  <Pill text={detail.partner.onboardingLabel} style={STAGE_STYLE[detail.partner.onboardingStatus] ?? 'bg-amber-500/15 text-amber-400'} />
                </div>
                <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                  <div><span className="text-[var(--text-muted)]">Services: </span>{detail.partner.domains.map((d) => DOMAIN_LABELS[d] ?? d).join(', ') || 'not set'}</div>
                  <div><span className="text-[var(--text-muted)]">Contact: </span>{[detail.partner.primaryContactName, detail.partner.primaryContactEmail, detail.partner.primaryContactPhone].filter(Boolean).join(' · ') || '—'}</div>
                  <div><span className="text-[var(--text-muted)]">Trade licence no.: </span>{detail.partner.tradeLicenseNumber ?? '—'}</div>
                  <div><span className="text-[var(--text-muted)]">TRN: </span>{detail.partner.taxRegistrationNumber ?? '—'}</div>
                </div>
                {detail.partner.rejectionReason && !activated && (
                  <p className="text-xs text-rose-400">Last note to the partner: {detail.partner.rejectionReason}</p>
                )}
                {activated ? (
                  <p className="text-xs text-emerald-400">
                    Active{detail.partner.approvedAt ? ` since ${new Date(detail.partner.approvedAt).toLocaleDateString()}` : ''}. It sees and quotes on your network&rsquo;s jobs.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2 border-t border-[var(--border-subtle)] pt-3">
                    <button type="button" onClick={() => decide('ACTIVATE')}
                      disabled={!!busy || !detail.checklist.allApproved || detail.partner.domains.length === 0}
                      title={detail.checklist.allApproved ? undefined : 'Approve every mandatory document first'}
                      className={`${btn} bg-emerald-600 text-white hover:bg-emerald-500`}>
                      <CheckCircle2 className="h-4 w-4" /> Activate partner
                    </button>
                    <button type="button" onClick={() => decide('MORE_INFO')} disabled={!!busy}
                      className={`${btn} border border-amber-500/40 text-amber-400 hover:bg-amber-500/10`}>
                      Ask for more information
                    </button>
                    <button type="button" onClick={() => decide('REJECT')} disabled={!!busy || detail.partner.onboardingStatus === 'REJECTED'}
                      className={`${btn} border border-rose-500/40 text-rose-400 hover:bg-rose-500/10`}>
                      Reject
                    </button>
                    {!detail.checklist.allApproved && (
                      <p className="basis-full text-xs text-[var(--text-muted)]">
                        Activation needs every mandatory document approved and in date
                        {detail.partner.domains.length === 0 ? ', and the partner’s service areas set by the platform administrator' : ''}.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Mandatory documents</h3>
                <ul className="divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)]">
                  {detail.checklist.items.map((item) => {
                    const doc = item.document ? docsById.get(item.document.id) : undefined;
                    return (
                      <li key={item.docType}>
                        {doc ? docRow({ ...doc, status: item.status }, item.label, `Required for ${item.reason}`) : (
                          <div className="flex items-center justify-between gap-2 p-3">
                            <div>
                              <div className="text-sm font-medium">{item.label}</div>
                              <div className="text-xs text-[var(--text-muted)]">Required for {item.reason}</div>
                            </div>
                            <Pill text="Not uploaded" style={DOC_STATUS.MISSING.style} />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>

              {otherDocs.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Other uploads</h3>
                  <ul className="divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)]">
                    {otherDocs.map((doc) => <li key={doc.id}>{docRow(doc, COMPLIANCE_CATALOG[doc.docType]?.label ?? doc.docType)}</li>)}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
