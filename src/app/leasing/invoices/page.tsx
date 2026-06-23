'use client';

import React, { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Check, ChevronDown, ChevronRight, FileText, Plus, RefreshCw, Send, ShieldCheck, Trash2 } from 'lucide-react';
import { LeasingBillingMigrationNotice } from '@/components/LeasingBillingMigrationNotice';
import { usePermissions } from '@/contexts/PermissionContext';

type LineType = 'RENT' | 'FUEL' | 'FINE' | 'OVERAGE' | 'MAINTENANCE' | 'INSURANCE' | 'DEPOSIT' | 'OTHER';

interface ApprovalNotice {
  action: string;
  id: string;
  status: string;
  message: string;
}

interface ApprovalResponseBody {
  action?: string;
  message?: string;
  approvalRequest?: { id?: string; status?: string };
  error?: string;
}

interface InvoiceLine {
  id?: string;
  description: string;
  lineType: LineType;
  contractId?: string | null;
  vehicleRef?: string | null;
  quantity?: number | string | null;
  unitAmount: number | string;
  totalAmount?: number | string | null;
}

interface Invoice {
  id: string;
  invoiceNo: string | null;
  lessee?: { name?: string | null; id?: string | null };
  lesseeId?: string;
  billingPeriod?: string | null;
  issueDate: string;
  dueDate: string;
  lines: InvoiceLine[];
  subTotal?: number | string;
  subtotal?: number | string;
  vatAmount?: number | string | null;
  vat?: number | string | null;
  totalAmount?: number | string;
  total?: number | string;
  currency?: string | null;
  status: 'DRAFT' | 'SENT' | 'PAID' | 'OVERDUE' | 'CANCELLED';
  notes?: string | null;
}

interface Lessee {
  id: string;
  name: string;
}

interface PreBillingStatement {
  id: string;
  statementNo?: string | null;
  contractId: string;
  lesseeId: string;
  billingPeriod: string;
  totalAmount: number | string;
  currency?: string | null;
  status?: string | null;
  contract?: { contractNumber?: string | null } | null;
}

interface InvoiceFormData {
  lesseeId: string;
  billingPeriod: string;
  issueDate: string;
  dueDate: string;
  vatPct: number;
  lines: InvoiceLine[];
}

type RetryRequest = { url: string; method: string; payload: Record<string, unknown> };

function money(value: unknown, currency = 'AED') {
  return `${Number(value ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${currency}`;
}

function preBillingRef(statement: Pick<PreBillingStatement, 'statementNo' | 'id'>) {
  return statement.statementNo ?? statement.id;
}

function approvalFromResponse(body: ApprovalResponseBody, fallback: string): ApprovalNotice | null {
  if (!body?.approvalRequest?.id) return null;
  return {
    action: body.action ?? fallback,
    id: body.approvalRequest.id,
    status: body.approvalRequest.status ?? 'PENDING',
    message: body.message ?? 'This action is queued for approval.',
  };
}

const emptyLine = (): InvoiceLine => ({ description: '', lineType: 'RENT', contractId: '', vehicleRef: '', quantity: 1, unitAmount: 0 });

export default function InvoicesPage() {
  const pathname = usePathname();
  const { can } = usePermissions();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [lessees, setLessees] = useState<Lessee[]>([]);
  const [preBilling, setPreBilling] = useState<PreBillingStatement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [showNewModal, setShowNewModal] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<ApprovalNotice | null>(null);
  const [pendingRetry, setPendingRetry] = useState<RetryRequest | null>(null);
  const [preBillingStatementIds, setPreBillingStatementIds] = useState<string[]>([]);
  const [formData, setFormData] = useState<InvoiceFormData>({
    lesseeId: '',
    billingPeriod: '',
    issueDate: '',
    dueDate: '',
    vatPct: 5,
    lines: [emptyLine()],
  });

  const canManageInvoices =
    can('finance', 'create', 'leasing_billing') ||
    can('finance', 'edit', 'leasing_billing') ||
    can('leasing', 'create', 'invoices');
  const canApproveInvoices =
    can('finance', 'approve', 'leasing_billing') ||
    can('leasing', 'approve', 'invoices');
  const isLegacyPath = pathname.startsWith('/leasing/');
  const apiBase = isLegacyPath ? '/api/leasing' : '/api/finance/leasing-billing';
  const invoicePdfBase = `${apiBase}/invoices`;

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${apiBase}/invoices`);
      const data = await response.json().catch(() => []);
      const errorBody = data as ApprovalResponseBody;
      if (!response.ok) throw new Error(errorBody.error ?? 'Failed to fetch invoices');
      setInvoices(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error fetching invoices');
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  const fetchLookups = useCallback(async () => {
    const [lesseeRes, preBillingRes] = await Promise.all([
      fetch('/api/leasing/lessees').catch(() => null),
      fetch(`${apiBase}/pre-billing?status=CONFIRMED`).catch(() => null),
    ]);
    if (lesseeRes?.ok) setLessees(await lesseeRes.json());
    if (preBillingRes?.ok) setPreBilling(await preBillingRes.json());
  }, [apiBase]);

  useEffect(() => {
    void fetchInvoices();
    void fetchLookups();
  }, [fetchInvoices, fetchLookups]);

  const setApproval = (body: ApprovalResponseBody, fallback: string, retry: RetryRequest) => {
    const approval = approvalFromResponse(body, fallback);
    if (!approval) return false;
    setNotice(approval);
    setPendingRetry(retry);
    return true;
  };

  const executeWithApprovalHandling = async (retry: NonNullable<typeof pendingRetry>, fallbackAction = 'leasing.invoice.create') => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (notice?.status === 'APPROVED') headers['x-admin-approval-id'] = notice.id;
    const response = await fetch(retry.url, { method: retry.method, headers, body: JSON.stringify(retry.payload) });
    const body = await response.json().catch(() => ({})) as ApprovalResponseBody;
    if (response.status === 428 && setApproval(body, fallbackAction, retry)) return false;
    if (!response.ok) throw new Error(body.error ?? `Request failed with ${response.status}`);
    setNotice(null);
    setPendingRetry(null);
    await fetchInvoices();
    await fetchLookups();
    return true;
  };

  const handleCreateInvoice = async () => {
    setBusy('create');
    setError('');
    const payload: Record<string, unknown> = preBillingStatementIds.length > 0
      ? { preBillingStatementIds }
      : {
          lesseeId: formData.lesseeId,
          billingPeriod: formData.billingPeriod,
          issueDate: formData.issueDate,
          dueDate: formData.dueDate,
          vatPct: formData.vatPct,
          lines: formData.lines.map(line => ({
            ...line,
            quantity: Number(line.quantity ?? 1),
            unitAmount: Number(line.unitAmount ?? 0),
            totalAmount: Number(line.quantity ?? 1) * Number(line.unitAmount ?? 0),
          })),
        };
    try {
      const ok = await executeWithApprovalHandling({ url: `${apiBase}/invoices`, method: 'POST', payload });
      if (ok) {
        setFormData({ lesseeId: '', billingPeriod: '', issueDate: '', dueDate: '', vatPct: 5, lines: [emptyLine()] });
        setPreBillingStatementIds([]);
        setShowNewModal(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error creating invoice');
    } finally {
      setBusy(null);
    }
  };

  const handleRetryApproved = async () => {
    if (!pendingRetry) return;
    setBusy('retry');
    setError('');
    try {
      await executeWithApprovalHandling(pendingRetry, notice?.action ?? 'leasing.invoice.create');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to execute approved invoice action');
    } finally {
      setBusy(null);
    }
  };

  const patchInvoiceStatus = async (invoiceId: string, status: string) => {
    setBusy(invoiceId);
    setError('');
    const retry = { url: `${apiBase}/invoices/${invoiceId}`, method: 'PATCH', payload: { status } };
    try {
      await executeWithApprovalHandling(retry, 'leasing.invoice.status_change');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update invoice');
    } finally {
      setBusy(null);
    }
  };

  const filteredInvoices = statusFilter === 'All' ? invoices : invoices.filter(i => i.status === statusFilter);
  const invoicedPreBillingRefs = useMemo(() => {
    const refs = new Set<string>();
    for (const invoice of invoices) {
      for (const match of (invoice.notes ?? '').matchAll(/pre-billing:([^\s]+)/g)) {
        refs.add(match[1]);
      }
    }
    return refs;
  }, [invoices]);
  const availablePreBilling = useMemo(
    () => preBilling.filter(statement => !invoicedPreBillingRefs.has(preBillingRef(statement))),
    [invoicedPreBillingRefs, preBilling],
  );
  const selectedPreBilling = useMemo(
    () => availablePreBilling.filter(statement => preBillingStatementIds.includes(statement.id)),
    [availablePreBilling, preBillingStatementIds],
  );
  const firstSelectedPreBilling = selectedPreBilling[0] ?? null;
  const canSelectPreBilling = useCallback((statement: PreBillingStatement) => {
    if (!firstSelectedPreBilling || preBillingStatementIds.includes(statement.id)) return true;
    return statement.lesseeId === firstSelectedPreBilling.lesseeId
      && statement.billingPeriod === firstSelectedPreBilling.billingPeriod
      && (statement.currency ?? 'AED') === (firstSelectedPreBilling.currency ?? 'AED');
  }, [firstSelectedPreBilling, preBillingStatementIds]);
  const selectedPreBillingTotal = selectedPreBilling.reduce((sum, statement) => sum + Number(statement.totalAmount ?? 0), 0);
  const totals = useMemo(() => {
    const mrr = invoices.reduce((sum, invoice) => sum + Number(invoice.totalAmount ?? invoice.total ?? 0), 0);
    return { count: invoices.length, total: mrr, pending: invoices.filter(i => ['DRAFT', 'SENT', 'OVERDUE'].includes(i.status)).length };
  }, [invoices]);
  const subtotal = formData.lines.reduce((sum, line) => sum + Number(line.quantity ?? 1) * Number(line.unitAmount ?? 0), 0);
  const vat = subtotal * (formData.vatPct / 100);

  if (isLegacyPath) {
    return (
      <LeasingBillingMigrationNotice
        title="Leasing invoices"
        financeHref="/finance/leasing-billing/invoices"
        description="Invoice creation, status updates, approvals, and finance reconciliation now run from Finance & Billing."
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#0c1a3e] text-slate-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Invoice Management</h1>
            <p className="mt-1 text-sm text-slate-400">Canonical leasing invoices reconciled against pre-billing, receivables, and approval execution.</p>
          </div>
          <div className="flex gap-3">
            <button onClick={fetchInvoices} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700">
              <RefreshCw className="h-4 w-4" /> Refresh
            </button>
            <button onClick={() => setShowNewModal(true)} disabled={!canManageInvoices} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 hover:bg-blue-500 disabled:opacity-50">
              <Plus size={18} /> New Invoice
            </button>
          </div>
        </div>

        {error && <div className="rounded-lg border border-red-700 bg-red-900/30 p-4 text-red-200">{error}</div>}
        {notice && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <ShieldCheck className="h-5 w-5 mt-0.5 text-amber-300" />
                <div>
                  <div className="font-semibold">Approval {notice.status.toLowerCase()}: {notice.id}</div>
                  <div className="text-amber-100/80">{notice.message}</div>
                </div>
              </div>
              <div className="flex gap-2">
                <a href="/admin/approvals" className="rounded-lg border border-amber-400/40 px-3 py-2 text-xs hover:bg-amber-400/10">Open approvals</a>
                {notice.status === 'APPROVED' && pendingRetry && (
                  <button onClick={handleRetryApproved} disabled={busy === 'retry'} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs text-white hover:bg-emerald-500 disabled:opacity-50">Execute approved action</button>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Kpi label="Invoices" value={totals.count} />
          <Kpi label="Open workflow" value={totals.pending} />
          <Kpi label="Invoice value" value={money(totals.total)} />
        </div>

        <div className="flex flex-wrap gap-2">
          {['All', 'DRAFT', 'SENT', 'PAID', 'OVERDUE', 'CANCELLED'].map(status => (
            <button key={status} onClick={() => setStatusFilter(status)} className={`rounded-lg px-4 py-2 text-sm ${statusFilter === status ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}>{status}</button>
          ))}
        </div>

        {loading ? (
          <div className="py-12 text-center text-slate-400">Loading invoices...</div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-700 bg-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-900 text-slate-300">
                <tr>
                  <th className="w-8 px-4 py-3"></th>
                  <th className="px-4 py-3 text-left">Invoice</th>
                  <th className="px-4 py-3 text-left">Lessee</th>
                  <th className="px-4 py-3 text-left">Period</th>
                  <th className="px-4 py-3 text-right">Subtotal</th>
                  <th className="px-4 py-3 text-right">VAT</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map(invoice => {
                  const currency = invoice.currency ?? 'AED';
                  const sub = invoice.subTotal ?? invoice.subtotal ?? 0;
                  const tax = invoice.vatAmount ?? invoice.vat ?? 0;
                  const total = invoice.totalAmount ?? invoice.total ?? 0;
                  return (
                    <Fragment key={invoice.id}>
                      <tr className="border-t border-slate-700 hover:bg-slate-700/40">
                        <td className="px-4 py-3">
                          <button onClick={() => setExpandedRows(prev => toggleSet(prev, invoice.id))} className="text-slate-300 hover:text-white">
                            {expandedRows.has(invoice.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                        </td>
                        <td className="px-4 py-3 font-medium">{invoice.invoiceNo ?? invoice.id.slice(0, 8)}</td>
                        <td className="px-4 py-3">{invoice.lessee?.name ?? invoice.lesseeId ?? '-'}</td>
                        <td className="px-4 py-3">{invoice.billingPeriod ?? '-'}</td>
                        <td className="px-4 py-3 text-right">{money(sub, currency)}</td>
                        <td className="px-4 py-3 text-right">{money(tax, currency)}</td>
                        <td className="px-4 py-3 text-right font-semibold">{money(total, currency)}</td>
                        <td className="px-4 py-3"><StatusBadge status={invoice.status} /></td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <a href={`${invoicePdfBase}/${invoice.id}/pdf?lang=en&download=1`} className="text-emerald-300 hover:text-emerald-200" title="Download English PDF"><FileText className="h-4 w-4" /></a>
                            {invoice.status === 'DRAFT' && canApproveInvoices && <button disabled={busy === invoice.id} onClick={() => patchInvoiceStatus(invoice.id, 'SENT')} className="text-blue-300 hover:text-blue-200" title="Send invoice"><Send className="h-4 w-4" /></button>}
                            {invoice.status !== 'PAID' && invoice.status !== 'CANCELLED' && canApproveInvoices && <button disabled={busy === invoice.id} onClick={() => patchInvoiceStatus(invoice.id, 'PAID')} className="text-emerald-300 hover:text-emerald-200" title="Mark paid"><Check className="h-4 w-4" /></button>}
                          </div>
                        </td>
                      </tr>
                      {expandedRows.has(invoice.id) && (
                        <tr className="border-t border-slate-700 bg-slate-900/60">
                          <td colSpan={9} className="px-4 py-4">
                            <div className="overflow-x-auto">
                              <table className="w-full text-xs">
                                <thead className="text-slate-400">
                                  <tr>
                                    <th className="py-2 text-left">Description</th>
                                    <th className="py-2 text-left">Source</th>
                                    <th className="py-2 text-left">Contract</th>
                                    <th className="py-2 text-right">Qty</th>
                                    <th className="py-2 text-right">Unit</th>
                                    <th className="py-2 text-right">Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {invoice.lines.map((line, idx) => (
                                    <tr key={line.id ?? idx} className="border-t border-slate-800">
                                      <td className="py-2">{line.description}</td>
                                      <td className="py-2"><SourceBadge type={line.lineType} /></td>
                                      <td className="py-2">{line.contractId ?? '-'}</td>
                                      <td className="py-2 text-right">{line.quantity ?? 1}</td>
                                      <td className="py-2 text-right">{money(line.unitAmount, currency)}</td>
                                      <td className="py-2 text-right font-medium">{money(line.totalAmount ?? Number(line.quantity ?? 1) * Number(line.unitAmount ?? 0), currency)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {filteredInvoices.length === 0 && <tr><td colSpan={9} className="px-4 py-12 text-center text-slate-500">No invoices found.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {showNewModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-slate-700 bg-slate-800">
              <div className="flex items-center justify-between border-b border-slate-700 p-6">
                <h2 className="text-xl font-bold">New Invoice</h2>
                <button onClick={() => setShowNewModal(false)} className="text-slate-400 hover:text-white">X</button>
              </div>
              <div className="space-y-6 p-6">
                <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/10 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <label className="block text-sm font-medium text-indigo-100">Create from confirmed pre-billing</label>
                      <p className="mt-1 text-xs text-indigo-100/70">
                        Select multiple statements for the same lessee, period, and currency to create one combined invoice.
                      </p>
                    </div>
                    {preBillingStatementIds.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setPreBillingStatementIds([])}
                        className="rounded-lg border border-indigo-300/30 px-3 py-1.5 text-xs font-semibold text-indigo-100 hover:bg-indigo-400/10"
                      >
                        Clear selection
                      </button>
                    )}
                  </div>
                  <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
                    {availablePreBilling.length === 0 ? (
                      <div className="rounded-lg border border-slate-700 bg-slate-900/70 px-3 py-4 text-center text-sm text-slate-400">
                        No confirmed uninvoiced pre-billing statements available.
                      </div>
                    ) : availablePreBilling.map(statement => {
                      const checked = preBillingStatementIds.includes(statement.id);
                      const enabled = canSelectPreBilling(statement);
                      return (
                        <label
                          key={statement.id}
                          className={`flex items-start gap-3 rounded-lg border px-3 py-2 text-sm transition ${
                            checked
                              ? 'border-emerald-400/50 bg-emerald-500/10 text-emerald-50'
                              : enabled
                                ? 'border-slate-700 bg-slate-900/70 text-slate-100 hover:border-indigo-400/40'
                                : 'border-slate-800 bg-slate-950/50 text-slate-500 opacity-60'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!enabled}
                            onChange={(event) => {
                              setPreBillingStatementIds(prev => event.target.checked
                                ? [...prev, statement.id]
                                : prev.filter(id => id !== statement.id));
                            }}
                            className="mt-1 h-4 w-4 accent-emerald-500"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block font-semibold">
                              {statement.statementNo ?? statement.id.slice(0, 8)} · {statement.billingPeriod}
                            </span>
                            <span className="mt-0.5 block text-xs text-slate-400">
                              Contract {statement.contract?.contractNumber ?? statement.contractId} · Lessee {statement.lesseeId}
                            </span>
                          </span>
                          <span className="shrink-0 text-right font-semibold">
                            {money(statement.totalAmount, statement.currency ?? 'AED')}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  {selectedPreBilling.length > 0 && (
                    <div className="mt-3 grid grid-cols-3 gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm">
                      <Kpi label="Statements" value={selectedPreBilling.length} />
                      <Kpi label="Billing Period" value={firstSelectedPreBilling?.billingPeriod ?? '-'} />
                      <Kpi label="Combined Total" value={money(selectedPreBillingTotal, firstSelectedPreBilling?.currency ?? 'AED')} />
                    </div>
                  )}
                </div>

                {preBillingStatementIds.length === 0 && (
                  <>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <Field label="Lessee">
                        <select value={formData.lesseeId} onChange={e => setFormData({ ...formData, lesseeId: e.target.value })} className="w-full rounded border border-slate-600 bg-slate-900 px-3 py-2">
                          <option value="">Select lessee</option>
                          {lessees.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                        </select>
                      </Field>
                      <TextField label="Billing Period" value={formData.billingPeriod} onChange={value => setFormData({ ...formData, billingPeriod: value })} />
                      <TextField label="Issue Date" type="date" value={formData.issueDate} onChange={value => setFormData({ ...formData, issueDate: value })} />
                      <TextField label="Due Date" type="date" value={formData.dueDate} onChange={value => setFormData({ ...formData, dueDate: value })} />
                    </div>

                    <div>
                      <div className="mb-3 flex items-center justify-between">
                        <h3 className="font-semibold">Line Items</h3>
                        <button onClick={() => setFormData({ ...formData, lines: [...formData.lines, emptyLine()] })} className="text-sm text-blue-300 hover:text-blue-200">Add line</button>
                      </div>
                      <div className="space-y-3">
                        {formData.lines.map((line, idx) => (
                          <div key={idx} className="rounded-lg border border-slate-600 bg-slate-900 p-3">
                            <div className="grid grid-cols-1 gap-2 md:grid-cols-6">
                              <input value={line.description} onChange={e => updateLine(idx, 'description', e.target.value, setFormData)} placeholder="Description" className="rounded border border-slate-700 bg-slate-800 px-2 py-2 md:col-span-2" />
                              <select value={line.lineType} onChange={e => updateLine(idx, 'lineType', e.target.value, setFormData)} className="rounded border border-slate-700 bg-slate-800 px-2 py-2">
                                {['RENT', 'FUEL', 'FINE', 'OVERAGE', 'MAINTENANCE', 'INSURANCE', 'DEPOSIT', 'OTHER'].map(type => <option key={type}>{type}</option>)}
                              </select>
                              <input value={line.contractId ?? ''} onChange={e => updateLine(idx, 'contractId', e.target.value, setFormData)} placeholder="Contract" className="rounded border border-slate-700 bg-slate-800 px-2 py-2" />
                              <input type="number" value={line.quantity ?? 1} onChange={e => updateLine(idx, 'quantity', Number(e.target.value || 0), setFormData)} placeholder="Qty" className="rounded border border-slate-700 bg-slate-800 px-2 py-2" />
                              <input type="number" value={line.unitAmount} onChange={e => updateLine(idx, 'unitAmount', Number(e.target.value || 0), setFormData)} placeholder="Unit" className="rounded border border-slate-700 bg-slate-800 px-2 py-2" />
                            </div>
                            <button onClick={() => setFormData(prev => ({ ...prev, lines: prev.lines.filter((_, i) => i !== idx) }))} className="mt-2 inline-flex items-center gap-1 text-xs text-red-300 hover:text-red-200"><Trash2 className="h-3.5 w-3.5" /> Remove</button>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3 rounded-xl border border-slate-700 bg-slate-900 p-4">
                      <Kpi label="Subtotal" value={money(subtotal)} />
                      <Kpi label="VAT" value={money(vat)} />
                      <Kpi label="Total" value={money(subtotal + vat)} />
                    </div>
                  </>
                )}
              </div>
              <div className="flex gap-3 border-t border-slate-700 p-6">
                <button onClick={() => setShowNewModal(false)} className="flex-1 rounded-lg bg-slate-700 px-4 py-2 hover:bg-slate-600">Cancel</button>
                <button onClick={handleCreateInvoice} disabled={busy === 'create' || !canManageInvoices} className="flex-1 rounded-lg bg-blue-600 px-4 py-2 hover:bg-blue-500 disabled:opacity-50">Queue Invoice</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function updateLine(index: number, field: keyof InvoiceLine, value: unknown, setFormData: React.Dispatch<React.SetStateAction<InvoiceFormData>>) {
  setFormData((prev: InvoiceFormData) => {
    const lines = [...prev.lines];
    lines[index] = { ...lines[index], [field]: value };
    return { ...prev, lines };
  });
}

function toggleSet(set: Set<string>, id: string) {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-lg border border-white/10 bg-slate-900/50 p-4"><div className="text-xs uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-xl font-bold text-white">{value}</div></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm"><span className="mb-1 block text-slate-300">{label}</span>{children}</label>;
}

function TextField({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return <Field label={label}><input type={type} value={value} onChange={e => onChange(e.target.value)} className="w-full rounded border border-slate-600 bg-slate-900 px-3 py-2" /></Field>;
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === 'PAID' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
    : status === 'SENT' ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
      : status === 'OVERDUE' ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
        : 'bg-slate-500/15 text-slate-300 border-slate-500/30';
  return <span className={`rounded-full border px-2.5 py-1 text-xs ${cls}`}>{status}</span>;
}

function SourceBadge({ type }: { type: string }) {
  const cls = type === 'RENT' ? 'bg-blue-500/10 text-blue-200 border-blue-500/20'
    : ['FUEL', 'FINE', 'OVERAGE'].includes(type) ? 'bg-amber-500/10 text-amber-200 border-amber-500/20'
      : 'bg-slate-500/10 text-slate-200 border-slate-500/20';
  return <span className={`rounded-full border px-2 py-0.5 ${cls}`}>{type}</span>;
}
