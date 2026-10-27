'use client';
import Link from 'next/link';

/**
 * Email decision page (src/lib/workflow/decision-link.ts): an approver opens
 * the link from the approval request email, on any device, and approves or
 * rejects the level it was sent for, without signing in. Opening the page
 * changes nothing; the decision is the button press.
 */
import { use, useCallback, useEffect, useState } from 'react';

interface LinkInfo {
  approverEmail: string;
  expiresAt: string;
  referenceNumber: string | null;
  referenceType: string;
  workflowName: string;
  module: string;
  procedure: string;
  submittedBy: string | null;
  submittedAt: string;
  levelName: string;
  levelStatus: string;
  approvalStatus: string;
  canDecide: boolean;
  yourDecision: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  sla: { state: string; hoursLeft: number | null } | null;
  highlights: Array<{ label: string; value: string }>;
  levels: Array<{ order: number; name: string; status: string }>;
}

const SLA_LABEL: Record<string, { text: string; cls: string }> = {
  ESCALATED: { text: 'Escalated', cls: 'bg-red-100 text-red-800 border-red-200' },
  OVERDUE:   { text: 'Overdue', cls: 'bg-red-100 text-red-800 border-red-200' },
  DUE_SOON:  { text: 'Due soon', cls: 'bg-amber-100 text-amber-800 border-amber-200' },
  ON_TRACK:  { text: 'On track', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
};

const STEP_DOT: Record<string, string> = {
  APPROVED: 'bg-emerald-500', REJECTED: 'bg-red-500', PENDING: 'bg-amber-500',
};

const words = (v: string) => v.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const when = (d: string | null) => d
  ? new Date(d).toLocaleString('en-AE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—';

function hoursText(h: number) {
  const abs = Math.abs(h);
  const t = abs >= 48 ? `${Math.round(abs / 24)} days` : `${Math.round(abs)} h`;
  return h < 0 ? `${t} overdue` : `${t} left`;
}

export default function ApprovalLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'idle' | 'reject'>('idle');
  const [comments, setComments] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ action: 'APPROVE' | 'REJECT'; message: string } | null>(null);
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/approval-link/${encodeURIComponent(token)}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? 'This approval link could not be opened.');
      else setInfo(data);
    } catch {
      setError('Could not connect. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const decide = async (action: 'APPROVE' | 'REJECT') => {
    setBusy(true);
    setActionError('');
    try {
      const res = await fetch(`/api/approval-link/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, comments }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setActionError(data.error ?? 'Your decision could not be recorded.');
      else setDone({ action, message: data.message ?? (action === 'APPROVE' ? 'Approved.' : 'Rejected.') });
    } catch {
      setActionError('Could not connect. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900 px-4 py-6 sm:py-10">
      <div className="mx-auto w-full max-w-md space-y-4">
        <p className="text-center text-xs font-semibold uppercase tracking-widest text-slate-500">Approval request</p>

        {loading && (
          <div className="rounded-2xl bg-white p-8 text-center text-sm text-slate-500 shadow-sm animate-pulse">Loading…</div>
        )}

        {!loading && error && (
          <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
            <p className="text-base font-semibold">Can&apos;t open this approval</p>
            <p className="mt-2 text-sm text-slate-600">{error}</p>
            <a href="/approvals" className="mt-5 inline-block rounded-xl bg-violet-600 px-5 py-3 text-sm font-semibold text-white">
              Open Approvals Inbox
            </a>
          </div>
        )}

        {!loading && info && (
          <>
            <section className="rounded-2xl bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-semibold text-violet-800">
                  {words(info.module)}
                </span>
                {info.sla && SLA_LABEL[info.sla.state] && (
                  <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${SLA_LABEL[info.sla.state].cls}`}>
                    {SLA_LABEL[info.sla.state].text}
                    {info.sla.hoursLeft != null && info.sla.state !== 'ESCALATED' ? ` · ${hoursText(info.sla.hoursLeft)}` : ''}
                  </span>
                )}
              </div>
              <h1 className="mt-3 text-2xl font-bold break-words">{info.referenceNumber ?? '—'}</h1>
              <p className="text-sm text-slate-600">{info.workflowName} · {words(info.procedure)}</p>

              {info.highlights.length > 0 && (
                <dl className="mt-4 grid grid-cols-2 gap-2">
                  {info.highlights.map((h) => (
                    <div key={h.label} className="rounded-xl bg-slate-50 p-3">
                      <dt className="text-[11px] uppercase tracking-wide text-slate-500">{h.label}</dt>
                      <dd className="text-sm font-semibold break-words">{h.value}</dd>
                    </div>
                  ))}
                </dl>
              )}

              <dl className="mt-4 space-y-1.5 text-sm">
                <div className="flex justify-between gap-3"><dt className="text-slate-500">Your step</dt><dd className="text-right font-medium">{info.levelName}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-slate-500">Submitted by</dt><dd className="text-right font-medium break-all">{info.submittedBy ?? '—'}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-slate-500">Submitted</dt><dd className="text-right font-medium">{when(info.submittedAt)}</dd></div>
              </dl>

              {info.levels.length > 1 && (
                <ol className="mt-4 space-y-1.5 border-t border-slate-100 pt-4">
                  {info.levels.map((l) => (
                    <li key={l.order} className="flex items-center gap-2 text-sm">
                      <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${STEP_DOT[l.status] ?? 'bg-slate-300'}`} />
                      <span className={l.name === info.levelName ? 'font-semibold' : 'text-slate-600'}>{l.order}. {l.name}</span>
                      <span className="ml-auto text-xs text-slate-500">{words(l.status)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {done ? (
              <section className={`rounded-2xl p-5 text-center shadow-sm ${done.action === 'APPROVE' ? 'bg-emerald-50' : 'bg-red-50'}`}>
                <p className="text-3xl">{done.action === 'APPROVE' ? '✓' : '✕'}</p>
                <p className="mt-1 text-base font-semibold">{done.action === 'APPROVE' ? 'Approved' : 'Rejected'}</p>
                <p className="mt-1 text-sm text-slate-700">{done.message}</p>
                <p className="mt-3 text-xs text-slate-500">You can close this page.</p>
              </section>
            ) : info.canDecide ? (
              <section className="rounded-2xl bg-white p-5 shadow-sm space-y-3">
                <p className="text-sm text-slate-600">Deciding as <span className="font-medium text-slate-900 break-all">{info.approverEmail}</span></p>
                <textarea
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  rows={3}
                  placeholder={mode === 'reject' ? 'Reason for rejecting (required)' : 'Comments (optional)'}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base focus:border-violet-500 focus:outline-none"
                />
                {actionError && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</p>}
                {mode === 'reject' ? (
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => { setMode('idle'); setActionError(''); }} disabled={busy}
                      className="rounded-xl border border-slate-300 py-3.5 text-base font-semibold text-slate-700 disabled:opacity-50">
                      Back
                    </button>
                    <button onClick={() => decide('REJECT')} disabled={busy || comments.trim().length < 3}
                      className="rounded-xl bg-red-600 py-3.5 text-base font-semibold text-white disabled:opacity-50">
                      {busy ? 'Rejecting…' : 'Confirm reject'}
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => { setMode('reject'); setActionError(''); }} disabled={busy}
                      className="rounded-xl border border-red-300 bg-white py-3.5 text-base font-semibold text-red-700 disabled:opacity-50">
                      Reject
                    </button>
                    <button onClick={() => decide('APPROVE')} disabled={busy}
                      className="rounded-xl bg-emerald-600 py-3.5 text-base font-semibold text-white disabled:opacity-50">
                      {busy ? 'Approving…' : 'Approve'}
                    </button>
                  </div>
                )}
              </section>
            ) : (
              <section className="rounded-2xl bg-white p-5 text-center shadow-sm">
                <p className="text-base font-semibold">
                  {info.yourDecision
                    ? `You have already ${info.yourDecision === 'REJECT' || info.yourDecision === 'REJECTED' ? 'rejected' : 'approved'} this step`
                    : info.approvalStatus !== 'IN_PROGRESS'
                      ? `This approval is already ${words(info.approvalStatus).toLowerCase()}`
                      : 'This step has already been decided'}
                </p>
                {info.decidedBy && (
                  <p className="mt-1 text-sm text-slate-600">By {info.decidedBy}{info.decidedAt ? `, ${when(info.decidedAt)}` : ''}</p>
                )}
                <p className="mt-3 text-xs text-slate-500">Nothing more is needed from you here.</p>
              </section>
            )}

            <p className="text-center text-xs text-slate-500">
              This link is for {info.approverEmail} only and expires {when(info.expiresAt)}. Don&apos;t forward it.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
