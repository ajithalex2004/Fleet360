'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { downloadXLSX } from '@/lib/exportUtils';
import { DrawerPortal } from '@/components/ui/DrawerPortal';

/**
 * Finance > Accounts Payable: vendor bills from Maintenance (created when an
 * estimate or quotation is approved) and ones entered here.
 * DRAFT → SUBMITTED → APPROVED → POSTED (to the ledger); a returned payable
 * goes back to DRAFT. With a Purchase / Payable Approval workflow in Admin >
 * Workflows, submitting starts it and Approve / Return act on its waiting level.
 */

interface Line { description: string; amount: number }
interface Payable {
  id: string; payable_number: string; vendor_name: string; vendor_email: string | null; vendor_phone: string | null;
  module: string | null; source_type: string | null; source_id: string | null; description: string | null;
  line_items: Line[] | string | null; subtotal: string; vat_amount: string; total_amount: string; paid_amount: string;
  currency: string; issue_date: string; due_date: string | null; payment_status: string; status: string;
  cost_centre: string | null; journal_entry_id: string | null; prepared_by: string | null;
  approved_by: string | null; approved_at: string | null; posted_by: string | null; posted_at: string | null;
  notes: string | null; created_at: string;
}
interface StatusSummary { status: string; count: string; total: string; overdue: string }
interface WorkflowInfo { name?: string; status?: string; level?: string | null; nextLevel?: string | null; waitingFor?: string[] }

const fmtAED  = (n: string | number | null | undefined) => `AED ${Number(n ?? 0).toLocaleString('en-AE', { minimumFractionDigits: 2 })}`;
const fmtDate = (s: string | null | undefined) => s ? new Date(s).toLocaleDateString('en-AE') : '—';
const fmtDateTime = (s: string | null | undefined) => s ? new Date(s).toLocaleString('en-AE', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const today = () => new Date().toISOString().slice(0, 10);
const isOverdue = (p: Payable) => !!p.due_date && p.due_date.slice(0, 10) < today() && !['PAID', 'VOID'].includes(p.payment_status);
const linesOf = (p: Payable): Line[] => {
  const raw = typeof p.line_items === 'string' ? (() => { try { return JSON.parse(p.line_items as string); } catch { return []; } })() : p.line_items;
  return Array.isArray(raw) ? raw : [];
};

const MODULES = ['MAINTENANCE', 'LOGISTICS', 'LEASING', 'GENERAL'];
const SOURCE_LABELS: Record<string, string> = {
  MAINTENANCE_REQUEST: 'Maintenance request', MAINTENANCE_ESTIMATE: 'Maintenance estimate',
  QUOTATION_APPROVAL: 'Garage quotation', VENDOR_INVOICE: 'Vendor invoice', MANUAL: 'Manual entry',
};
const CENTRES = ['RAC', 'LEASING', 'LOGISTICS', 'STAFF', 'SCHOOL', 'ADMIN'];
const STATUSES = ['ALL', 'DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'VOID'];
const STATUS_LABEL: Record<string, string> = { SUBMITTED: 'AWAITING APPROVAL' };
const STATUS_STYLE: Record<string, string> = {
  DRAFT:     'bg-slate-500/20 text-[var(--text-muted)] border-slate-500/30',
  SUBMITTED: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  APPROVED:  'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  POSTED:    'bg-purple-500/20 text-purple-300 border-purple-500/30',
  VOID:      'bg-red-500/20 text-red-400 border-red-500/30',
};
const PAY_STYLE: Record<string, string> = {
  UNPAID: 'text-amber-400', PARTIALLY_PAID: 'text-blue-400', PAID: 'text-emerald-400', OVERDUE: 'text-red-400', VOID: 'text-[var(--text-faint)]',
};

/** What a submit / approve / return did, from the API's workflow details. */
function workflowNote(body: { message?: string; workflow?: WorkflowInfo } | null): string | null {
  if (!body) return null;
  if (body.message) return body.message;
  const wf = body.workflow;
  if (!wf?.name) return null;
  if (wf.status === 'IN_PROGRESS') return `Sent for approval through "${wf.name}"${wf.level ? `, waiting for "${wf.level}"` : ''}.`;
  if (wf.status === 'APPROVED') return `"${wf.name}": no approval level applies, so the payable is approved.`;
  return null;
}

async function patchPayable(id: string, payload: Record<string, unknown>) {
  const res = await fetch(`/api/finance/payables/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) { alert(body?.error ?? 'Action failed'); return false; }
  const note = workflowNote(body);
  if (note) alert(note);
  return true;
}

function askReturnReason() {
  const reason = prompt('Why is this payable being returned? It goes back to Draft for correction.');
  return reason === null ? null : reason.trim() || 'Review required';
}

/* ── Create / Edit Payable Modal ── */
function PayableFormModal({ payable, onClose, onSaved }: { payable?: Payable; onClose: () => void; onSaved: () => void }) {
  const editing = !!payable;
  const initialLines = payable ? linesOf(payable) : [];
  const [form, setForm] = useState({
    vendorName:  payable?.vendor_name ?? '',
    vendorEmail: payable?.vendor_email ?? '',
    vendorPhone: payable?.vendor_phone ?? '',
    module:      payable?.module ?? 'GENERAL',
    sourceType:  payable?.source_type ?? 'VENDOR_INVOICE',
    description: payable?.description ?? '',
    issueDate:   payable?.issue_date ? String(payable.issue_date).slice(0, 10) : today(),
    dueDate:     payable?.due_date ? String(payable.due_date).slice(0, 10) : '',
    costCentre:  payable?.cost_centre ?? '',
    notes:       payable?.notes ?? '',
  });
  const [lines, setLines] = useState<{ description: string; amount: string }[]>(
    initialLines.length ? initialLines.map(l => ({ description: l.description ?? '', amount: String(l.amount ?? '') }))
      : [{ description: '', amount: '' }],
  );
  const [vatMode, setVatMode] = useState<'STANDARD' | 'CUSTOM'>(
    payable && Math.abs(Number(payable.vat_amount) - Math.round(Number(payable.subtotal) * 5) / 100) > 0.01 ? 'CUSTOM' : 'STANDARD',
  );
  const [customVat, setCustomVat] = useState(payable ? String(Number(payable.vat_amount)) : '0');
  const [saving, setSaving] = useState(false);
  const s = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const subtotal = lines.reduce((t, l) => t + (parseFloat(l.amount) > 0 ? parseFloat(l.amount) : 0), 0);
  const vat = vatMode === 'STANDARD' ? Math.round(subtotal * 5) / 100 : Math.max(0, parseFloat(customVat) || 0);
  const total = subtotal + vat;

  const setLine = (i: number, k: 'description' | 'amount', v: string) =>
    setLines(ls => ls.map((l, j) => j === i ? { ...l, [k]: v } : l));

  const save = async () => {
    if (!form.vendorName.trim()) return alert('Vendor name is required');
    if (!(subtotal > 0)) return alert('Add at least one line with an amount');
    setSaving(true);
    const lineItems = lines
      .filter(l => parseFloat(l.amount) > 0)
      .map(l => ({ description: l.description.trim() || form.description.trim() || 'Line', amount: parseFloat(l.amount) }));
    const payload = { ...form, lineItems, vatAmount: vat };
    const res = editing
      ? await fetch(`/api/finance/payables/${payable!.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        })
      : await fetch('/api/finance/payables', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
    setSaving(false);
    if (res.ok) { onSaved(); onClose(); }
    else alert((await res.json().catch(() => ({}))).error ?? 'Failed to save payable');
  };

  const inp = 'w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)] focus:outline-none focus:border-emerald-500';
  const lbl = 'block text-xs text-[var(--text-muted)] mb-1';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border-subtle)]">
          <h2 className="text-lg font-bold text-[var(--text-main)]">{editing ? `Edit ${payable!.payable_number}` : 'New Payable'}</h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-xl">×</button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-1">
              <label className={lbl}>Vendor *</label>
              <input value={form.vendorName} onChange={s('vendorName')} placeholder="Vendor / garage name" className={inp} />
            </div>
            <div>
              <label className={lbl}>Vendor email</label>
              <input type="email" value={form.vendorEmail} onChange={s('vendorEmail')} className={inp} />
            </div>
            <div>
              <label className={lbl}>Vendor phone</label>
              <input value={form.vendorPhone} onChange={s('vendorPhone')} className={inp} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className={lbl}>Source module</label>
              <select value={form.module} onChange={s('module')} className={inp}>
                {MODULES.map(m => <option key={m} value={m}>{m.charAt(0) + m.slice(1).toLowerCase()}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Source type</label>
              <select value={form.sourceType} onChange={s('sourceType')} className={inp} disabled={editing}>
                {(editing && !['VENDOR_INVOICE', 'MANUAL'].includes(form.sourceType) ? [form.sourceType] : ['VENDOR_INVOICE', 'MANUAL'])
                  .map(t => <option key={t} value={t}>{SOURCE_LABELS[t] ?? t}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Cost centre</label>
              <select value={form.costCentre} onChange={s('costCentre')} className={inp}>
                <option value="">— Select —</option>
                {[...CENTRES, ...(form.costCentre && !CENTRES.includes(form.costCentre) ? [form.costCentre] : [])]
                  .map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={lbl}>Description</label>
            <input value={form.description} onChange={s('description')} placeholder="e.g. Brake overhaul, invoice INV-2291" className={inp} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Invoice date</label>
              <input type="date" value={form.issueDate} onChange={s('issueDate')} className={inp} />
            </div>
            <div>
              <label className={lbl}>Due date</label>
              <input type="date" value={form.dueDate} onChange={s('dueDate')} className={inp} />
            </div>
          </div>

          <div className="rounded-xl border border-[var(--border-subtle)] p-3 space-y-2">
            <p className="text-xs font-semibold text-[var(--text-muted)]">Lines</p>
            {lines.map((l, i) => (
              <div key={i} className="flex gap-2">
                <input value={l.description} onChange={e => setLine(i, 'description', e.target.value)} placeholder="Item / service" className={`${inp} flex-1`} />
                <input type="number" min="0" step="0.01" value={l.amount} onChange={e => setLine(i, 'amount', e.target.value)} placeholder="0.00" className={`${inp} w-32 text-right`} />
                <button onClick={() => setLines(ls => ls.length > 1 ? ls.filter((_, j) => j !== i) : ls)} disabled={lines.length === 1}
                  className="px-2 text-[var(--text-muted)] hover:text-red-400 disabled:opacity-30" title="Remove line">×</button>
              </div>
            ))}
            <button onClick={() => setLines(ls => [...ls, { description: '', amount: '' }])} className="text-xs text-emerald-400 hover:underline">+ Add line</button>
            <div className="border-t border-[var(--border-subtle)] pt-2 space-y-1 text-sm">
              <div className="flex justify-between text-[var(--text-muted)]"><span>Subtotal</span><span>{fmtAED(subtotal)}</span></div>
              <div className="flex justify-between items-center text-[var(--text-muted)] gap-2">
                <span className="flex items-center gap-2">
                  VAT
                  <select value={vatMode} onChange={e => setVatMode(e.target.value as 'STANDARD' | 'CUSTOM')}
                    className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-1.5 py-0.5 text-xs text-[var(--text-main)]">
                    <option value="STANDARD">5%</option>
                    <option value="CUSTOM">Other amount</option>
                  </select>
                </span>
                {vatMode === 'CUSTOM'
                  ? <input type="number" min="0" step="0.01" value={customVat} onChange={e => setCustomVat(e.target.value)} className="w-28 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-2 py-1 text-right text-sm text-[var(--text-main)]" />
                  : <span>{fmtAED(vat)}</span>}
              </div>
              <div className="flex justify-between font-semibold text-emerald-400"><span>Total</span><span>{fmtAED(total)}</span></div>
            </div>
          </div>

          <div>
            <label className={lbl}>Notes</label>
            <textarea value={form.notes} onChange={s('notes')} rows={2}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--text-main)] resize-none focus:outline-none focus:border-emerald-500" />
          </div>
        </div>
        <div className="flex gap-2 p-5 border-t border-[var(--border-subtle)]">
          <button onClick={onClose} className="flex-1 py-2 rounded-xl border border-[var(--border-subtle)] text-sm text-[var(--text-muted)] hover:text-[var(--text-main)]">Cancel</button>
          <button onClick={save} disabled={saving}
            className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm disabled:opacity-50">
            {saving ? 'Saving…' : editing ? '✓ Save Changes' : '✓ Create Payable'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Payable Detail Drawer ── */
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] text-[var(--text-faint)] uppercase tracking-wide">{label}</p>
      <p className="text-sm text-[var(--text-main)] mt-0.5 break-words">{value || '—'}</p>
    </div>
  );
}

function PayableDrawer({ payableId, onClose, onChanged }: { payableId: string; onClose: () => void; onChanged: () => void }) {
  const [p, setP]             = useState<Payable | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [busy, setBusy]       = useState(false);
  const [editing, setEditing] = useState(false);

  const fetchOne = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/finance/payables/${payableId}`, { cache: 'no-store' });
    if (res.ok) setP(await res.json());
    else setError(res.status === 404 ? 'Payable not found' : 'Could not load payable');
  }, [payableId]);

  useEffect(() => { fetchOne(); }, [fetchOne]);

  const act = async (payload: Record<string, unknown>) => {
    setBusy(true);
    const ok = await patchPayable(payableId, payload);
    setBusy(false);
    if (ok) { await fetchOne(); onChanged(); }
  };

  const remove = async () => {
    if (!p || !confirm(`Delete payable ${p.payable_number}? This cannot be undone.`)) return;
    setBusy(true);
    const res = await fetch(`/api/finance/payables/${payableId}`, { method: 'DELETE' });
    setBusy(false);
    if (!res.ok) return alert((await res.json().catch(() => ({}))).error ?? 'Delete failed');
    onChanged();
    onClose();
  };

  const card = 'bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-xl p-4';
  const lines = p ? linesOf(p) : [];
  const trail = p ? [
    { label: 'Created', who: p.prepared_by, at: p.created_at, tone: 'bg-slate-400' },
    ...(p.approved_at ? [{ label: 'Approved', who: p.approved_by, at: p.approved_at, tone: 'bg-emerald-400' }] : []),
    ...(p.posted_at ? [{ label: 'Posted to ledger', who: p.posted_by, at: p.posted_at, tone: 'bg-purple-400' }] : []),
  ] : [];
  const btn = 'py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50';

  return (
    <DrawerPortal>
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onClick={onClose}>
      <div className="w-full max-w-[520px] h-full bg-[var(--bg-surface)] border-l border-[var(--border-subtle)] overflow-y-auto"
        onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 z-10 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] px-5 py-4 flex items-start justify-between">
          <div>
            <p className="text-xs text-[var(--text-faint)]">Payable</p>
            <h2 className="text-lg font-bold text-[var(--text-main)] font-mono">{p?.payable_number ?? '…'}</h2>
            {p && (
              <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLE[p.status] ?? ''}`}>
                {STATUS_LABEL[p.status] ?? p.status}
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-2xl leading-none">×</button>
        </div>

        {error ? (
          <p className="p-5 text-sm text-red-400">{error}</p>
        ) : !p ? (
          <div className="p-5 space-y-3">
            {[0, 1, 2].map(i => <div key={i} className="h-24 rounded-xl bg-[var(--bg-surface-hover)] animate-pulse" />)}
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <div className={card}>
              <p className="text-sm text-[var(--text-main)] font-medium">{p.vendor_name}</p>
              {p.description && <p className="text-xs text-[var(--text-muted)] mt-0.5">{p.description}</p>}
              <div className="grid grid-cols-3 gap-3 mt-3">
                <Field label="Subtotal" value={fmtAED(p.subtotal)} />
                <Field label="VAT" value={fmtAED(p.vat_amount)} />
                <div>
                  <p className="text-[11px] text-[var(--text-faint)] uppercase tracking-wide">Total</p>
                  <p className="text-sm text-emerald-400 font-bold mt-0.5">{fmtAED(p.total_amount)}</p>
                </div>
              </div>
            </div>

            {lines.length > 0 && (
              <div className={card}>
                <p className="text-[11px] text-[var(--text-faint)] uppercase tracking-wide mb-2">Lines</p>
                <table className="w-full text-sm">
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={i} className="border-b border-[var(--border-subtle)] last:border-0">
                        <td className="py-1.5 text-[var(--text-muted)]">{l.description || '—'}</td>
                        <td className="py-1.5 text-right text-[var(--text-main)]">{fmtAED(l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className={`${card} grid grid-cols-2 gap-4`}>
              <Field label="Source" value={[p.module, SOURCE_LABELS[p.source_type ?? ''] ?? p.source_type].filter(Boolean).join(' · ')} />
              <Field label="Cost centre" value={p.cost_centre} />
              <Field label="Invoice date" value={fmtDate(p.issue_date)} />
              <Field label="Due date" value={p.due_date
                ? <span className={isOverdue(p) ? 'text-red-400 font-medium' : ''}>{fmtDate(p.due_date)}{isOverdue(p) ? ' (overdue)' : ''}</span>
                : null} />
              <Field label="Payment" value={<span className={PAY_STYLE[p.payment_status] ?? ''}>{p.payment_status.replace('_', ' ')}</span>} />
              <Field label="Paid" value={fmtAED(p.paid_amount)} />
              <Field label="Vendor email" value={p.vendor_email} />
              <Field label="Vendor phone" value={p.vendor_phone} />
              {p.journal_entry_id && <Field label="Journal entry" value={<span className="font-mono text-xs">{p.journal_entry_id}</span>} />}
            </div>

            {p.notes && (
              <div className={card}>
                <p className="text-[11px] text-[var(--text-faint)] uppercase tracking-wide">Notes</p>
                <p className="text-sm text-[var(--text-muted)] mt-1 whitespace-pre-wrap">{p.notes}</p>
              </div>
            )}

            <div className={card}>
              <p className="text-[11px] text-[var(--text-faint)] uppercase tracking-wide mb-3">History</p>
              <ol className="space-y-3">
                {trail.map((t, i) => (
                  <li key={i} className="flex gap-3">
                    <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${t.tone}`} />
                    <div>
                      <p className="text-sm text-[var(--text-main)]">{t.label}{t.who ? ` by ${t.who}` : ''}</p>
                      <p className="text-xs text-[var(--text-faint)]">{fmtDateTime(t.at)}</p>
                    </div>
                  </li>
                ))}
              </ol>
              {p.status === 'SUBMITTED' && (
                <p className="text-xs text-blue-300 mt-3">Awaiting approval. With an approval workflow, each level&apos;s approvers also see it in their Approvals Inbox.</p>
              )}
            </div>

            <div className="space-y-2">
              {p.status === 'DRAFT' && (
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setEditing(true)} disabled={busy}
                    className={`${btn} border border-[var(--border-subtle)] text-[var(--text-main)] font-normal hover:bg-[var(--bg-surface-hover)]`}>✎ Edit</button>
                  <button onClick={() => act({ action: 'submit' })} disabled={busy}
                    className={`${btn} bg-blue-600 hover:bg-blue-500 text-white`}>Submit for approval</button>
                </div>
              )}
              {p.status === 'SUBMITTED' && (
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => act({ action: 'approve' })} disabled={busy}
                    className={`${btn} bg-emerald-600 hover:bg-emerald-500 text-white`}>✓ Approve</button>
                  <button onClick={() => { const reason = askReturnReason(); if (reason !== null) act({ action: 'reject', reason }); }} disabled={busy}
                    className={`${btn} border border-red-500/30 text-red-400 font-normal hover:bg-red-500/10`}>↩ Return</button>
                </div>
              )}
              {p.status === 'APPROVED' && (
                <button onClick={() => { if (confirm(`Post ${p.payable_number} to the ledger? A journal entry (expense / accounts payable) is created.`)) act({ action: 'post' }); }} disabled={busy}
                  className={`${btn} w-full bg-purple-600 hover:bg-purple-500 text-white`}>📒 Post to ledger</button>
              )}
              {['DRAFT', 'SUBMITTED', 'APPROVED'].includes(p.status) && (
                <button onClick={() => { if (confirm(`Void ${p.payable_number}? It will no longer be payable.`)) act({ action: 'void' }); }} disabled={busy}
                  className={`${btn} w-full border border-red-500/30 text-red-400 font-normal hover:bg-red-500/10`}>⊘ Void</button>
              )}
              {['DRAFT', 'VOID'].includes(p.status) && (
                <button onClick={remove} disabled={busy}
                  className={`${btn} w-full border border-[var(--border-subtle)] text-[var(--text-muted)] font-normal hover:text-red-400`}>🗑 Delete</button>
              )}
              {!['DRAFT'].includes(p.status) && (
                <p className="text-xs text-[var(--text-faint)] text-center">Only draft payables can be edited. Return a submitted payable to correct it.</p>
              )}
            </div>
          </div>
        )}
      </div>
      {editing && p && (
        <div onClick={e => e.stopPropagation()}>
          <PayableFormModal payable={p} onClose={() => setEditing(false)} onSaved={() => { fetchOne(); onChanged(); }} />
        </div>
      )}
    </div>
    </DrawerPortal>
  );
}

/* ── Main Page ── */
export default function PayablesPage() {
  const [rows, setRows]         = useState<Payable[]>([]);
  const [summary, setSummary]   = useState<StatusSummary[]>([]);
  const [loading, setLoading]   = useState(true);
  const [tab, setTab]           = useState('ALL');
  const [moduleFilter, setModuleFilter] = useState('');
  const [overdueOnly, setOverdueOnly]   = useState(false);
  const [search, setSearch]     = useState('');
  const [query, setQuery]       = useState('');
  const [showAdd, setShowAdd]   = useState(false);
  const [actioning, setActioning] = useState<string | null>(null);
  const [openId, setOpenId]     = useState<string | null>(null);

  useEffect(() => { const t = setTimeout(() => setQuery(search.trim()), 300); return () => clearTimeout(t); }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '100' });
    if (tab !== 'ALL')  params.set('status', tab);
    if (moduleFilter)   params.set('module', moduleFilter);
    if (overdueOnly)    params.set('overdue', 'true');
    if (query)          params.set('search', query);
    const res = await fetch(`/api/finance/payables?${params}`, { cache: 'no-store' });
    if (res.ok) { const d = await res.json(); setRows(d.data ?? []); setSummary(d.statusSummary ?? []); }
    setLoading(false);
  }, [tab, moduleFilter, overdueOnly, query]);

  useEffect(() => { load(); }, [load]);

  const action = async (id: string, payload: Record<string, unknown>) => {
    setActioning(id);
    await patchPayable(id, payload);
    setActioning(null);
    load();
  };

  const summOf = (s: string) => summary.find(x => x.status === s);
  const count = (s: string) => parseInt(summOf(s)?.count ?? '0');
  const overdueCount = summary.reduce((t, x) => t + parseInt(x.overdue ?? '0'), 0);
  const kpis = [
    { key: 'DRAFT',     label: 'Draft',             tone: 'text-[var(--text-main)]' },
    { key: 'SUBMITTED', label: 'Awaiting approval', tone: 'text-blue-300' },
    { key: 'APPROVED',  label: 'Approved, to post', tone: 'text-emerald-300' },
    { key: 'POSTED',    label: 'Posted',            tone: 'text-purple-300' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-main)]">Accounts Payable</h1>
          <p className="text-[var(--text-muted)] text-xs mt-0.5">Vendor bills: submit for approval, approve, and post to the ledger</p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => downloadXLSX(`Payables-${today()}.xls`, rows.map(p => ({
            'Payable No': p.payable_number, 'Vendor': p.vendor_name, 'Module': p.module ?? '',
            'Source': SOURCE_LABELS[p.source_type ?? ''] ?? p.source_type ?? '', 'Description': p.description ?? '',
            'Subtotal (AED)': Number(p.subtotal), 'VAT (AED)': Number(p.vat_amount), 'Total (AED)': Number(p.total_amount),
            'Paid (AED)': Number(p.paid_amount), 'Invoice Date': p.issue_date?.slice(0, 10) ?? '', 'Due Date': p.due_date?.slice(0, 10) ?? '',
            'Status': p.status, 'Payment': p.payment_status, 'Cost Centre': p.cost_centre ?? '', 'Approved By': p.approved_by ?? '',
          })))}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--bg-surface-hover)] text-[var(--text-muted)] text-sm border border-[var(--border-subtle)]">
            ⬇ Export XLSX
          </button>
          <button onClick={() => setShowAdd(true)}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl text-sm">
            + New Payable
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {kpis.map(k => (
          <button key={k.key} onClick={() => { setTab(k.key); setOverdueOnly(false); }}
            className="text-left bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-xl p-3 hover:border-[var(--border-strong)]">
            <p className="text-xs text-[var(--text-faint)]">{k.label}</p>
            <p className={`text-xl font-bold mt-0.5 ${k.tone}`}>{count(k.key)}</p>
            <p className="text-xs text-[var(--text-faint)]">{fmtAED(summOf(k.key)?.total ?? '0')}</p>
          </button>
        ))}
        <button onClick={() => { setTab('ALL'); setOverdueOnly(true); }}
          className="text-left bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-xl p-3 hover:border-[var(--border-strong)]">
          <p className="text-xs text-[var(--text-faint)]">Overdue, unpaid</p>
          <p className={`text-xl font-bold mt-0.5 ${overdueCount ? 'text-red-400' : 'text-[var(--text-main)]'}`}>{overdueCount}</p>
          <p className="text-xs text-[var(--text-faint)]">past due date</p>
        </button>
      </div>

      {count('SUBMITTED') > 0 && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl px-4 py-3 flex items-center gap-3">
          <span className="text-blue-400 text-lg">📥</span>
          <p className="text-sm text-blue-300 font-medium">
            {count('SUBMITTED')} payable{count('SUBMITTED') > 1 ? 's' : ''} awaiting approval: {fmtAED(summOf('SUBMITTED')?.total ?? '0')}
          </p>
          <button onClick={() => { setTab('SUBMITTED'); setOverdueOnly(false); }} className="ml-auto text-xs px-3 py-1 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30">
            Review →
          </button>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-xl p-1 gap-1 flex-wrap">
          {STATUSES.map(s => (
            <button key={s} onClick={() => setTab(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${tab === s ? 'bg-emerald-600 text-white' : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}>
              {STATUS_LABEL[s] ?? s} {s !== 'ALL' && `(${count(s)})`}
            </button>
          ))}
        </div>
        <select value={moduleFilter} onChange={e => setModuleFilter(e.target.value)}
          className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-sm text-[var(--text-main)]">
          <option value="">All sources</option>
          {MODULES.map(m => <option key={m} value={m}>{m.charAt(0) + m.slice(1).toLowerCase()}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] px-2">
          <input type="checkbox" checked={overdueOnly} onChange={e => setOverdueOnly(e.target.checked)} className="accent-red-500" /> Overdue only
        </label>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search number, vendor, description"
          className="flex-1 min-w-[200px] bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl px-3 py-2 text-sm text-[var(--text-main)]" />
      </div>

      {loading ? (
        <div className="h-64 bg-[var(--bg-surface)]/60 rounded-2xl animate-pulse" />
      ) : rows.length === 0 ? (
        <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl p-12 text-center">
          <div className="text-4xl mb-3">🧾</div>
          <p className="text-[var(--text-muted)]">No payables found</p>
          <p className="text-xs text-[var(--text-faint)] mt-1">Maintenance creates draft payables when estimates and quotations are approved. Use + New Payable for other vendor bills.</p>
        </div>
      ) : (
        <div className="bg-[var(--bg-surface)]/60 border border-[var(--border-subtle)] rounded-2xl overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-[var(--border-subtle)] text-[var(--text-muted)] text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3">Payable #</th>
                <th className="text-left px-4 py-3">Vendor</th>
                <th className="text-left px-4 py-3">Source</th>
                <th className="text-left px-4 py-3">Description</th>
                <th className="text-left px-4 py-3">Due</th>
                <th className="text-right px-4 py-3">Total</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Payment</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => (
                <tr key={p.id} onClick={() => setOpenId(p.id)}
                  className="border-b border-[var(--border-subtle)] last:border-0 hover:bg-[var(--bg-surface)]/40 transition-colors cursor-pointer">
                  <td className="px-4 py-3 text-[var(--text-main)] font-mono text-xs font-medium">{p.payable_number}</td>
                  <td className="px-4 py-3 text-[var(--text-main)] text-xs">{p.vendor_name}</td>
                  <td className="px-4 py-3 text-[var(--text-muted)] text-xs">
                    {p.module ? p.module.charAt(0) + p.module.slice(1).toLowerCase() : '—'}
                    {p.source_type && <span className="block text-[var(--text-faint)]">{SOURCE_LABELS[p.source_type] ?? p.source_type}</span>}
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)] text-xs max-w-xs truncate">{p.description ?? '—'}</td>
                  <td className={`px-4 py-3 text-xs ${isOverdue(p) ? 'text-red-400 font-medium' : 'text-[var(--text-muted)]'}`}>{fmtDate(p.due_date)}</td>
                  <td className="px-4 py-3 text-right font-medium text-[var(--text-main)] text-xs">{fmtAED(p.total_amount)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap ${STATUS_STYLE[p.status] ?? ''}`}>
                      {STATUS_LABEL[p.status] ?? p.status}
                    </span>
                  </td>
                  <td className={`px-4 py-3 text-xs ${PAY_STYLE[p.payment_status] ?? ''}`}>{p.payment_status.replace('_', ' ')}</td>
                  <td className="px-4 py-3 text-right" onClick={ev => ev.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      {p.status === 'DRAFT' && (
                        <button onClick={() => action(p.id, { action: 'submit' })} disabled={actioning === p.id}
                          className="text-xs px-2 py-1 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 disabled:opacity-50">
                          {actioning === p.id ? '…' : 'Submit'}
                        </button>
                      )}
                      {p.status === 'SUBMITTED' && (
                        <>
                          <button onClick={() => action(p.id, { action: 'approve' })} disabled={actioning === p.id}
                            className="text-xs px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 disabled:opacity-50">
                            {actioning === p.id ? '…' : '✓ Approve'}
                          </button>
                          <button onClick={() => { const reason = askReturnReason(); if (reason !== null) action(p.id, { action: 'reject', reason }); }}
                            disabled={actioning === p.id} title="Return to draft"
                            className="text-xs px-2 py-1 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50">
                            ↩
                          </button>
                        </>
                      )}
                      {p.status === 'APPROVED' && (
                        <button onClick={() => { if (confirm(`Post ${p.payable_number} to the ledger?`)) action(p.id, { action: 'post' }); }}
                          disabled={actioning === p.id}
                          className="text-xs px-2 py-1 rounded-lg bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 disabled:opacity-50">
                          {actioning === p.id ? '…' : '📒 Post'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showAdd && <PayableFormModal onClose={() => setShowAdd(false)} onSaved={load} />}
      {openId && <PayableDrawer payableId={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}
