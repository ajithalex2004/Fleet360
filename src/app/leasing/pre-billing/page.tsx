'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { CheckCircle2, FileText, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import { LeasingBillingMigrationNotice } from '@/components/LeasingBillingMigrationNotice';
import { usePermissions } from '@/contexts/PermissionContext';

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

interface PreBillingStatement {
  id: string;
  statementNo: string | null;
  contractId: string;
  lesseeId: string;
  contract?: { contractNumber?: string | null };
  billingPeriod: string;
  dueDate: string;
  baseRent: number | string;
  fuelCharges?: number | string | null;
  fineCharges?: number | string | null;
  maintenanceCharges?: number | string | null;
  overageCharges?: number | string | null;
  otherCharges?: number | string | null;
  vatAmount?: number | string | null;
  totalAmount: number | string;
  currency?: string | null;
  status: string | null;
}

interface InvoiceReference {
  id: string;
  notes?: string | null;
}

interface FormData {
  contractId: string;
  billingPeriod: string;
  dueDate: string;
  baseRent: number;
  fuelCharges: number;
  fineCharges: number;
  maintenanceCharges: number;
  overageCharges: number;
  otherCharges: number;
}

type RetryRequest = { kind: 'create' | 'status' | 'invoice'; payload: Record<string, unknown>; url: string; method: string };

const STATUSES = ['All', 'DRAFT', 'SENT', 'CONFIRMED', 'DISPUTED', 'FINALIZED'];

function money(value: unknown, currency = 'AED') {
  return `${currency} ${Number(value ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
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

export default function PreBillingPage() {
  const pathname = usePathname();
  const { can } = usePermissions();
  const [statements, setStatements] = useState<PreBillingStatement[]>([]);
  const [invoiceReferences, setInvoiceReferences] = useState<InvoiceReference[]>([]);
  const [statusFilter, setStatusFilter] = useState('All');
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<ApprovalNotice | null>(null);
  const [error, setError] = useState('');
  const [pendingRetry, setPendingRetry] = useState<RetryRequest | null>(null);
  const [formData, setFormData] = useState<FormData>({
    contractId: '',
    billingPeriod: '',
    dueDate: '',
    baseRent: 0,
    fuelCharges: 0,
    fineCharges: 0,
    maintenanceCharges: 0,
    overageCharges: 0,
    otherCharges: 0,
  });

  const canManageStatements =
    can('finance', 'create', 'leasing_billing') ||
    can('finance', 'edit', 'leasing_billing') ||
    can('leasing', 'create', 'invoices');
  const canApproveStatements =
    can('finance', 'approve', 'leasing_billing') ||
    can('leasing', 'approve', 'invoices');
  const isLegacyPath = pathname.startsWith('/leasing/');
  const apiBase = isLegacyPath ? '/api/leasing' : '/api/finance/leasing-billing';
  const preBillingPdfBase = `${apiBase}/pre-billing`;

  const fetchStatements = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [statementsResponse, invoicesResponse] = await Promise.all([
        fetch(`${apiBase}/pre-billing`),
        fetch(`${apiBase}/invoices`).catch(() => null),
      ]);
      const data = await statementsResponse.json().catch(() => []);
      const errorBody = data as ApprovalResponseBody;
      if (!statementsResponse.ok) throw new Error(errorBody.error ?? 'Failed to fetch pre-billing statements');
      setStatements(Array.isArray(data) ? data : []);
      if (invoicesResponse?.ok) {
        const invoiceData = await invoicesResponse.json().catch(() => []);
        setInvoiceReferences(Array.isArray(invoiceData) ? invoiceData.map((invoice: InvoiceReference) => ({ id: invoice.id, notes: invoice.notes ?? null })) : []);
      } else {
        setInvoiceReferences([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch pre-billing statements');
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => { void fetchStatements(); }, [fetchStatements]);

  const filteredStatements = useMemo(
    () => statusFilter === 'All' ? statements : statements.filter(s => s.status === statusFilter),
    [statements, statusFilter],
  );

  const totals = useMemo(() => {
    const subtotal = formData.baseRent + formData.fuelCharges + formData.fineCharges + formData.maintenanceCharges + formData.overageCharges + formData.otherCharges;
    const vat = subtotal * 0.05;
    return { subtotal, vat, total: subtotal + vat };
  }, [formData]);

  const statusCounts = useMemo(() => Object.fromEntries(STATUSES.slice(1).map(status => [status, statements.filter(s => s.status === status).length])), [statements]);
  const invoicedStatementRefs = useMemo(() => {
    const refs = new Set<string>();
    for (const invoice of invoiceReferences) {
      for (const match of (invoice.notes ?? '').matchAll(/pre-billing:([^\s]+)/g)) {
        refs.add(match[1]);
      }
    }
    return refs;
  }, [invoiceReferences]);

  const invoiceStateFor = (statement: PreBillingStatement) => {
    if (statement.status !== 'CONFIRMED') return null;
    const ref = statement.statementNo ?? statement.id;
    return invoicedStatementRefs.has(ref) ? 'Invoiced' : 'No invoice yet';
  };

  const setApproval = (body: ApprovalResponseBody, fallback: string, retry: RetryRequest) => {
    const approval = approvalFromResponse(body, fallback);
    if (approval) {
      setNotice(approval);
      setPendingRetry(retry);
      return true;
    }
    return false;
  };

  const executeWithApprovalHandling = async (retry: NonNullable<typeof pendingRetry>, fallbackAction: string) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (notice?.status === 'APPROVED') headers['x-admin-approval-id'] = notice.id;
    const response = await fetch(retry.url, {
      method: retry.method,
      headers,
      body: retry.payload === undefined ? undefined : JSON.stringify(retry.payload),
    });
    const body = await response.json().catch(() => ({})) as ApprovalResponseBody;
    if (response.status === 428 && setApproval(body, fallbackAction, retry)) return false;
    if (!response.ok) throw new Error(body.error ?? `Request failed with ${response.status}`);
    setNotice(null);
    setPendingRetry(null);
    await fetchStatements();
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('create');
    setError('');
    const retry: RetryRequest = {
      kind: 'create' as const,
      url: `${apiBase}/pre-billing`,
      method: 'POST',
      payload: { ...formData },
    };
    try {
      if (await executeWithApprovalHandling(retry, 'leasing.prebilling.create')) {
        setFormData({ contractId: '', billingPeriod: '', dueDate: '', baseRent: 0, fuelCharges: 0, fineCharges: 0, maintenanceCharges: 0, overageCharges: 0, otherCharges: 0 });
        setShowModal(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create statement');
    } finally {
      setBusy(null);
    }
  };

  const handleStatusChange = async (id: string, status: string) => {
    setBusy(id);
    setError('');
    const retry = { kind: 'status' as const, url: `${apiBase}/pre-billing/${id}`, method: 'PATCH', payload: { status } };
    try {
      await executeWithApprovalHandling(retry, 'leasing.prebilling.status_change');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update statement');
    } finally {
      setBusy(null);
    }
  };

  const handleConvertToInvoice = async (statement: PreBillingStatement) => {
    setBusy(`invoice-${statement.id}`);
    setError('');
    const retry = { kind: 'invoice' as const, url: `${apiBase}/invoices`, method: 'POST', payload: { preBillingStatementId: statement.id } };
    try {
      await executeWithApprovalHandling(retry, 'leasing.invoice.create');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to convert to invoice');
    } finally {
      setBusy(null);
    }
  };

  const handleRetryApproved = async () => {
    if (!pendingRetry) return;
    setBusy('retry');
    setError('');
    try {
      await executeWithApprovalHandling(pendingRetry, notice?.action ?? 'approved-action');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to execute approved action');
    } finally {
      setBusy(null);
    }
  };

  if (isLegacyPath) {
    return (
      <LeasingBillingMigrationNotice
        title="Leasing pre-billing"
        financeHref="/finance/leasing-billing/pre-billing"
        description="Statement generation, confirmation, and invoice conversion now live under Finance & Billing."
      />
    );
  }

  if (loading) return <div className="flex items-center justify-center h-full"><div className="text-slate-400">Loading pre-billing...</div></div>;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold text-white mb-2">Pre-Billing Statements</h1>
          <p className="text-slate-400">Review charge sources, queue approvals, and convert confirmed statements into invoices.</p>
        </div>
        <div className="flex gap-3">
          <button onClick={fetchStatements} className="inline-flex items-center gap-2 rounded-xl bg-slate-800 border border-white/10 px-4 py-3 text-sm font-medium text-slate-200 hover:bg-slate-700">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button onClick={() => setShowModal(true)} disabled={!canManageStatements} className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
            Generate Statement
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}
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
                <button onClick={handleRetryApproved} disabled={busy === 'retry'} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs text-white hover:bg-emerald-500 disabled:opacity-50">
                  Execute approved action
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {STATUSES.slice(1).map(status => (
          <div key={status} className="bg-slate-800/50 border border-white/10 rounded-xl p-5 text-center">
            <div className="text-2xl font-bold text-white">{statusCounts[status] ?? 0}</div>
            <div className="text-xs text-slate-400 mt-2">{status}</div>
          </div>
        ))}
      </div>

      <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="px-4 py-2 rounded-lg bg-slate-800/50 border border-white/10 text-white focus:border-blue-500 focus:outline-none">
        {STATUSES.map(status => <option key={status}>{status}</option>)}
      </select>

      <div className="bg-slate-800/50 border border-white/10 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/70 text-slate-300">
            <tr>
              <th className="px-4 py-3 text-left">Statement</th>
              <th className="px-4 py-3 text-left">Contract</th>
              <th className="px-4 py-3 text-left">Lessee</th>
              <th className="px-4 py-3 text-left">Period</th>
              <th className="px-4 py-3 text-right">Rent</th>
              <th className="px-4 py-3 text-right">Charges</th>
              <th className="px-4 py-3 text-right">VAT</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredStatements.map(statement => {
              const currency = statement.currency ?? 'AED';
              const charges = Number(statement.fuelCharges ?? 0) + Number(statement.fineCharges ?? 0) + Number(statement.maintenanceCharges ?? 0) + Number(statement.overageCharges ?? 0) + Number(statement.otherCharges ?? 0);
              return (
                <tr key={statement.id} className="border-t border-white/5 hover:bg-white/5">
                  <td className="px-4 py-4 font-medium text-white">{statement.statementNo ?? statement.id.slice(0, 8)}</td>
                  <td className="px-4 py-4 text-slate-200">{statement.contract?.contractNumber ?? statement.contractId}</td>
                  <td className="px-4 py-4 text-slate-300">{statement.lesseeId}</td>
                  <td className="px-4 py-4 text-slate-300">{statement.billingPeriod}</td>
                  <td className="px-4 py-4 text-right text-white">{money(statement.baseRent, currency)}</td>
                  <td className="px-4 py-4 text-right text-slate-200">{money(charges, currency)}</td>
                  <td className="px-4 py-4 text-right text-slate-200">{money(statement.vatAmount, currency)}</td>
                  <td className="px-4 py-4 text-right font-semibold text-white">{money(statement.totalAmount, currency)}</td>
                  <td className="px-4 py-4">
                    <div className="space-y-1">
                      <StatusBadge status={statement.status ?? 'DRAFT'} />
                      {invoiceStateFor(statement) && (
                        <div className={invoiceStateFor(statement) === 'Invoiced' ? 'text-xs text-emerald-300' : 'text-xs text-amber-300'}>
                          {invoiceStateFor(statement)}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex flex-wrap justify-end gap-2">
                      <a href={`${preBillingPdfBase}/${statement.id}/pdf?lang=en&download=1`} className="inline-flex items-center gap-1 text-xs text-emerald-300 hover:text-emerald-200"><FileText className="h-3.5 w-3.5" /> EN</a>
                      <a href={`${preBillingPdfBase}/${statement.id}/pdf?lang=ar&download=1`} className="inline-flex items-center gap-1 text-xs text-emerald-300 hover:text-emerald-200"><FileText className="h-3.5 w-3.5" /> AR</a>
                      {statement.status === 'DRAFT' && canApproveStatements && <button disabled={busy === statement.id} onClick={() => handleStatusChange(statement.id, 'SENT')} className="inline-flex items-center gap-1 text-xs text-blue-300 hover:text-blue-200"><Send className="h-3.5 w-3.5" /> Send</button>}
                      {statement.status === 'SENT' && canApproveStatements && <button disabled={busy === statement.id} onClick={() => handleStatusChange(statement.id, 'CONFIRMED')} className="inline-flex items-center gap-1 text-xs text-emerald-300 hover:text-emerald-200"><CheckCircle2 className="h-3.5 w-3.5" /> Confirm</button>}
                      {statement.status === 'CONFIRMED' && canManageStatements && <button disabled={busy === `invoice-${statement.id}`} onClick={() => handleConvertToInvoice(statement)} className="text-xs text-indigo-300 hover:text-indigo-200">Convert to invoice</button>}
                    </div>
                  </td>
                </tr>
              );
            })}
            {filteredStatements.length === 0 && <tr><td colSpan={10} className="px-4 py-12 text-center text-slate-500">No pre-billing statements found.</td></tr>}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-900 border border-white/10 rounded-xl p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">Generate Pre-Billing Statement</h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white">X</button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <TextInput label="Contract ID" value={formData.contractId} onChange={value => setFormData(prev => ({ ...prev, contractId: value }))} required />
                <TextInput label="Billing Period (YYYY-MM)" value={formData.billingPeriod} onChange={value => setFormData(prev => ({ ...prev, billingPeriod: value }))} required />
                <TextInput label="Due Date" type="date" value={formData.dueDate} onChange={value => setFormData(prev => ({ ...prev, dueDate: value }))} required />
                {(['baseRent', 'fuelCharges', 'fineCharges', 'maintenanceCharges', 'overageCharges', 'otherCharges'] as const).map(key => (
                  <NumberInput key={key} label={labelFor(key)} value={formData[key]} onChange={value => setFormData(prev => ({ ...prev, [key]: value }))} required={key === 'baseRent'} />
                ))}
              </div>
              <div className="grid grid-cols-3 gap-3 rounded-xl border border-white/10 bg-slate-950/50 p-4 text-sm">
                <Summary label="Subtotal" value={money(totals.subtotal)} />
                <Summary label="VAT" value={money(totals.vat)} />
                <Summary label="Total" value={money(totals.total)} strong />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={busy === 'create' || !canManageStatements} className="flex-1 rounded-lg bg-blue-600 py-2 font-medium text-white hover:bg-blue-500 disabled:opacity-50">Queue Statement</button>
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 rounded-lg bg-slate-700 py-2 font-medium text-white hover:bg-slate-600">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === 'CONFIRMED' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
    : status === 'SENT' ? 'bg-blue-500/15 text-blue-300 border-blue-500/30'
      : status === 'DISPUTED' ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
        : status === 'FINALIZED' ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
          : 'bg-slate-500/15 text-slate-300 border-slate-500/30';
  return <span className={`rounded-full border px-2.5 py-1 text-xs ${cls}`}>{status}</span>;
}

function TextInput({ label, value, onChange, type = 'text', required = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean }) {
  return (
    <label className="block text-sm text-slate-300">
      <span className="mb-2 block">{label}</span>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} required={required} className="w-full rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-white outline-none focus:border-blue-500" />
    </label>
  );
}

function NumberInput({ label, value, onChange, required = false }: { label: string; value: number; onChange: (value: number) => void; required?: boolean }) {
  return (
    <label className="block text-sm text-slate-300">
      <span className="mb-2 block">{label}</span>
      <input type="number" value={value} onChange={e => onChange(Number(e.target.value || 0))} required={required} className="w-full rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-white outline-none focus:border-blue-500" />
    </label>
  );
}

function Summary({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div><div className="text-xs text-slate-500">{label}</div><div className={strong ? 'font-bold text-emerald-300' : 'font-semibold text-white'}>{value}</div></div>;
}

function labelFor(key: keyof FormData) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, char => char.toUpperCase());
}
