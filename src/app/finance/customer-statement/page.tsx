'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FileText, Mail, Printer, RefreshCw, Search } from 'lucide-react';
import SmartDataGridHeader from '@/components/ui/SmartDataGridHeader';
import { KpiCard, KpiGrid, PageHeader } from '@/components/ui/page-theme';
import { downloadXLSX } from '@/lib/exportUtils';

type CustomerOption = {
  key: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  invoiceCount: number;
  outstandingAmount: number;
  active: boolean;
};

type LedgerEntry = {
  id: string;
  date: string;
  voucherType: string;
  voucherNo: string;
  description: string;
  age: number;
  poNo: string;
  debit: number;
  credit: number;
  runningBalance: number;
  sourceModule: string;
  branch: string;
  note: string;
};

type OutstandingRow = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  sourceModule: string;
  branch: string;
  description: string;
  totalAmount: number;
  paidAmount: number;
  creditNoteAmount: number;
  outstandingAmount: number;
  ageDays: number;
  status: string;
};

type DepositRow = {
  id: string;
  depositNo: string;
  type: string;
  date: string;
  agreement: string;
  amount: number;
  used: number;
  refunded: number;
  refundDate: string;
  status: string;
  branch: string;
  vehicleNo: string;
};

type StatementPayload = {
  customer: CustomerOption;
  filters: {
    from: string;
    to: string;
    includeInactive: boolean;
    view: 'ledger' | 'outstanding';
    module: string;
    branch: string;
  };
  availableFilters: {
    modules: string[];
    branches: string[];
  };
  ledger: {
    entries: LedgerEntry[];
    openingBalance: number;
    totalDebit: number;
    totalCredit: number;
    endingBalance: number;
  };
  outstanding: {
    invoices: OutstandingRow[];
    summary: {
      totalOutstanding: number;
      current: number;
      d1to30: number;
      d31to60: number;
      d61to90: number;
      d90plus: number;
    };
  };
  deposits: DepositRow[];
};

const fmtMoney = (value: number) =>
  `AED ${Number(value ?? 0).toLocaleString('en-AE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fmtDate = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString('en-GB') : '-';

const currentDate = new Date().toISOString().slice(0, 10);
const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);

export default function FinanceCustomerStatementPage() {
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [availableFilters, setAvailableFilters] = useState<{ modules: string[]; branches: string[] }>({ modules: [], branches: [] });
  const [selectedCustomerKey, setSelectedCustomerKey] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [mode, setMode] = useState<'ledger' | 'outstanding'>('ledger');
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(currentDate);
  const [selectedModule, setSelectedModule] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('');
  const [query, setQuery] = useState('');
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [loadingStatement, setLoadingStatement] = useState(false);
  const [statement, setStatement] = useState<StatementPayload | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadCustomers = useCallback(async () => {
    setLoadingCustomers(true);
    try {
      const params = new URLSearchParams({
        includeInactive: includeInactive ? 'true' : 'false',
        from,
        to,
        view: mode,
      });
      if (selectedModule) params.set('module', selectedModule);
      if (selectedBranch) params.set('branch', selectedBranch);
      const res = await fetch(`/api/finance/customer-statement?${params}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load customers');
      setCustomers(Array.isArray(data.customers) ? data.customers : []);
      setAvailableFilters({
        modules: Array.isArray(data.availableFilters?.modules) ? data.availableFilters.modules : [],
        branches: Array.isArray(data.availableFilters?.branches) ? data.availableFilters.branches : [],
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load customers');
    } finally {
      setLoadingCustomers(false);
    }
  }, [from, includeInactive, mode, selectedBranch, selectedModule, to]);

  const loadStatement = useCallback(async (customerKey: string) => {
    if (!customerKey) {
      setStatement(null);
      return;
    }
    setLoadingStatement(true);
    setMessage(null);
    try {
      const params = new URLSearchParams({
        customer: customerKey,
        includeInactive: includeInactive ? 'true' : 'false',
        from,
        to,
        view: mode,
      });
      if (selectedModule) params.set('module', selectedModule);
      if (selectedBranch) params.set('branch', selectedBranch);
      const res = await fetch(`/api/finance/customer-statement?${params}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load statement');
      setStatement(data);
    } catch (error) {
      setStatement(null);
      setMessage(error instanceof Error ? error.message : 'Failed to load statement');
    } finally {
      setLoadingStatement(false);
    }
  }, [from, includeInactive, mode, selectedBranch, selectedModule, to]);

  useEffect(() => {
    void loadCustomers();
  }, [loadCustomers]);

  useEffect(() => {
    if (selectedCustomerKey) {
      void loadStatement(selectedCustomerKey);
    }
  }, [loadStatement, selectedCustomerKey]);

  const filteredCustomers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return customers;
    return customers.filter((customer) =>
      customer.name.toLowerCase().includes(needle) ||
      (customer.email ?? '').toLowerCase().includes(needle) ||
      (customer.phone ?? '').toLowerCase().includes(needle),
    );
  }, [customers, query]);

  const selectedCustomer = statement?.customer
    ?? customers.find((customer) => customer.key === selectedCustomerKey)
    ?? null;

  const exportCurrentView = async () => {
    if (!statement) return;
    if (mode === 'ledger') {
      await downloadXLSX(
        `${selectedCustomer?.name ?? 'customer'}-ledger`,
        statement.ledger.entries.map((entry) => ({
          Date: entry.date,
          'Voucher Type': entry.voucherType,
          'Voucher No': entry.voucherNo,
          Description: entry.description,
          Module: entry.sourceModule,
          Branch: entry.branch,
          Age: entry.age,
          Debit: entry.debit,
          Credit: entry.credit,
          'Running Balance': entry.runningBalance,
        })),
      );
      return;
    }
    await downloadXLSX(
      `${selectedCustomer?.name ?? 'customer'}-outstanding`,
      statement.outstanding.invoices.map((row) => ({
        'Invoice No': row.invoiceNumber,
        'Invoice Date': row.invoiceDate,
        'Due Date': row.dueDate,
        Module: row.sourceModule,
        Branch: row.branch,
        Description: row.description,
        Total: row.totalAmount,
        Paid: row.paidAmount,
        'Credit Notes': row.creditNoteAmount,
        Outstanding: row.outstandingAmount,
        'Age (Days)': row.ageDays,
        Status: row.status,
      })),
    );
  };

  const emailStatement = () => {
    if (!selectedCustomer?.email) {
      setMessage('No customer email is available for this account.');
      return;
    }
    const subject = encodeURIComponent(`Statement of Account - ${selectedCustomer.name}`);
    const body = encodeURIComponent(
      `Please find the statement details for ${selectedCustomer.name}.\nPeriod: ${from} to ${to}\nCurrent outstanding: ${statement ? fmtMoney(statement.outstanding.summary.totalOutstanding) : 'AED 0.00'}`,
    );
    window.location.href = `mailto:${selectedCustomer.email}?subject=${subject}&body=${body}`;
  };

  const downloadPdf = () => {
    if (!selectedCustomerKey) return;
    const params = new URLSearchParams({
      customer: selectedCustomerKey,
      includeInactive: includeInactive ? 'true' : 'false',
      from,
      to,
      download: '1',
      lang: 'en',
    });
    if (selectedModule) params.set('module', selectedModule);
    if (selectedBranch) params.set('branch', selectedBranch);
    window.open(`/api/finance/customer-statement/pdf?${params.toString()}`, '_blank', 'noopener,noreferrer');
  };

  const ledgerOpeningBalance = statement?.ledger.openingBalance ?? 0;
  const ledgerEndingBalance = statement?.ledger.endingBalance ?? 0;
  const currentOutstanding = statement?.outstanding.summary.totalOutstanding ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customer Statement of Account"
        subtitle="Tenant-scoped finance ledger and outstanding report across invoices, receipts, and deposits."
      />

      <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.28)]">
        <div className="grid gap-4 xl:grid-cols-[220px_220px_220px_220px_auto]">
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-200">Date From</span>
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-200">Date To</span>
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-200">Module</span>
            <select
              value={selectedModule}
              onChange={(event) => setSelectedModule(event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white focus:border-blue-500 focus:outline-none"
            >
              <option value="">All modules</option>
              {availableFilters.modules.map((moduleName) => (
                    <option key={moduleName} value={moduleName}>
                      {moduleName}
                    </option>
                  ))}
            </select>
          </label>
          <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-200">Branch</span>
            <select
              value={selectedBranch}
              onChange={(event) => setSelectedBranch(event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white focus:border-blue-500 focus:outline-none"
            >
              <option value="">All branches</option>
              {availableFilters.branches.map((branchName) => (
                    <option key={branchName} value={branchName}>
                      {branchName}
                    </option>
                  ))}
            </select>
          </label>
          <div className="flex items-end">
            <label className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(event) => setIncludeInactive(event.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-slate-900"
              />
              Include inactive
            </label>
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="rounded-2xl border border-white/10 bg-slate-950/70 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
              <Search className="h-3.5 w-3.5" />
              Customer Contact
            </div>
            <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search customer..."
                className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
              />
              <select
                value={selectedCustomerKey}
                onChange={(event) => setSelectedCustomerKey(event.target.value)}
                className="rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-white focus:border-blue-500 focus:outline-none"
              >
                <option value="">{loadingCustomers ? 'Loading customers...' : 'Select customer'}</option>
                {filteredCustomers.map((customer) => (
                  <option key={customer.key} value={customer.key}>
                    {customer.name} - {fmtMoney(customer.outstandingAmount)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              disabled={!statement}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/70 px-4 text-sm font-semibold text-slate-100 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Printer className="h-4 w-4" />
              Print
            </button>
            <button
              type="button"
              onClick={emailStatement}
              disabled={!statement}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/70 px-4 text-sm font-semibold text-slate-100 transition hover:border-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Mail className="h-4 w-4" />
              Email
            </button>
            <button
              type="button"
              onClick={downloadPdf}
              disabled={!statement}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-violet-400/30 bg-violet-500/12 px-4 text-sm font-semibold text-violet-200 transition hover:border-violet-300/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FileText className="h-4 w-4" />
              PDF
            </button>
            <button
              type="button"
              onClick={exportCurrentView}
              disabled={!statement}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-500/12 px-4 text-sm font-semibold text-emerald-200 transition hover:border-emerald-300/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              Export Excel
            </button>
            <button
              type="button"
              onClick={() => {
                void loadCustomers();
                if (selectedCustomerKey) void loadStatement(selectedCustomerKey);
              }}
              className="inline-flex h-11 items-center gap-2 rounded-2xl bg-sky-500 px-4 text-sm font-semibold text-white transition hover:bg-sky-400"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setMode('ledger')}
            className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
              mode === 'ledger'
                ? 'border-cyan-300/40 bg-cyan-500/14 text-cyan-200'
                : 'border-white/10 bg-slate-950/60 text-slate-300 hover:text-white'
            }`}
          >
            Ledger Report
          </button>
          <button
            type="button"
            onClick={() => setMode('outstanding')}
            className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
              mode === 'outstanding'
                ? 'border-amber-300/40 bg-amber-500/14 text-amber-200'
                : 'border-white/10 bg-slate-950/60 text-slate-300 hover:text-white'
            }`}
          >
            Outstanding
          </button>
        </div>

        {message && (
          <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            {message}
          </div>
        )}
      </div>

      <KpiGrid>
        <KpiCard label="Beginning Balance" value={fmtMoney(ledgerOpeningBalance)} accent="slate" sub="Opening position" />
        <KpiCard label="Total Debit" value={fmtMoney(statement?.ledger.totalDebit ?? 0)} accent="blue" sub="Invoices in period" />
        <KpiCard label="Total Credit" value={fmtMoney(statement?.ledger.totalCredit ?? 0)} accent="emerald" sub="Receipts in period" />
        <KpiCard label="Ending Balance" value={fmtMoney(ledgerEndingBalance)} accent="violet" sub="End of selected period" />
        <KpiCard label="Current Outstanding" value={fmtMoney(currentOutstanding)} accent="amber" sub={`${statement?.outstanding.invoices.length ?? 0} open invoice(s)`} />
      </KpiGrid>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">{mode === 'ledger' ? 'Ledger Report' : 'Outstanding Invoices'}</h2>
              <p className="mt-1 text-sm text-slate-400">
                {selectedCustomer ? `${selectedCustomer.name} · ${from} to ${to}` : 'Select a customer to view statement details.'}
              </p>
            </div>
            {selectedCustomer && (
              <div className="text-right text-sm">
                <div className="text-slate-400">Current Balance</div>
                <div className="text-lg font-semibold text-white">{fmtMoney(currentOutstanding)}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {selectedModule || 'All modules'} / {selectedBranch || 'All branches'}
                </div>
              </div>
            )}
          </div>

          {loadingStatement ? (
            <div className="py-16 text-center text-slate-400">Loading statement...</div>
          ) : !statement ? (
            <div className="py-16 text-center text-slate-500">Choose a customer to load the statement of account.</div>
          ) : mode === 'ledger' ? (
            <div className="smart-data-grid-surface overflow-hidden">
              <table className="w-full min-w-[1200px]">
                <SmartDataGridHeader
                  columnResizeStorageKey="finance-customer-statement-ledger-widths"
                  columns={[
                    { key: 'date', label: 'Date', width: 130 },
                    { key: 'voucherType', label: 'Voucher Type', width: 150 },
                    { key: 'voucherNo', label: 'Voucher No', width: 170 },
                    { key: 'description', label: 'Description', width: 290 },
                    { key: 'branch', label: 'Branch', width: 150 },
                    { key: 'age', label: 'Age', width: 90, headerClassName: 'text-right', filterClassName: 'text-right' },
                    { key: 'poNo', label: 'PO No', width: 120 },
                    { key: 'debit', label: 'Debit', width: 150, headerClassName: 'text-right', filterClassName: 'text-right' },
                    { key: 'credit', label: 'Credit', width: 150, headerClassName: 'text-right', filterClassName: 'text-right' },
                    { key: 'runningBalance', label: 'Running Balance', width: 170, headerClassName: 'text-right', filterClassName: 'text-right' },
                  ]}
                />
                <tbody>
                  {statement.ledger.entries.map((entry) => (
                    <tr key={entry.id}>
                      <td className="smart-data-grid-cell px-4 py-3">{fmtDate(entry.date)}</td>
                      <td className="smart-data-grid-cell px-4 py-3">{entry.voucherType}</td>
                      <td className="smart-data-grid-cell px-4 py-3 font-medium">{entry.voucherNo}</td>
                      <td className="smart-data-grid-cell px-4 py-3">
                        <div>{entry.description}</div>
                        <div className="mt-1 text-xs text-slate-500">{entry.sourceModule}</div>
                      </td>
                      <td className="smart-data-grid-cell px-4 py-3">{entry.branch}</td>
                      <td className="smart-data-grid-cell px-4 py-3 text-right">{entry.age}</td>
                      <td className="smart-data-grid-cell px-4 py-3">{entry.poNo || '-'}</td>
                      <td className="smart-data-grid-cell px-4 py-3 text-right font-semibold">{entry.debit ? fmtMoney(entry.debit) : '-'}</td>
                      <td className="smart-data-grid-cell px-4 py-3 text-right font-semibold">{entry.credit ? fmtMoney(entry.credit) : '-'}</td>
                      <td className="smart-data-grid-cell px-4 py-3 text-right font-semibold">{fmtMoney(entry.runningBalance)}</td>
                    </tr>
                  ))}
                  {statement.ledger.entries.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-6 py-12 text-center text-slate-500">
                        No ledger activity in the selected period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-5">
                <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Current</div>
                  <div className="mt-2 text-base font-semibold text-white">{fmtMoney(statement.outstanding.summary.current)}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">1-30</div>
                  <div className="mt-2 text-base font-semibold text-amber-200">{fmtMoney(statement.outstanding.summary.d1to30)}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">31-60</div>
                  <div className="mt-2 text-base font-semibold text-orange-200">{fmtMoney(statement.outstanding.summary.d31to60)}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">61-90</div>
                  <div className="mt-2 text-base font-semibold text-rose-200">{fmtMoney(statement.outstanding.summary.d61to90)}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">90+</div>
                  <div className="mt-2 text-base font-semibold text-red-200">{fmtMoney(statement.outstanding.summary.d90plus)}</div>
                </div>
              </div>

              <div className="smart-data-grid-surface overflow-hidden">
                <table className="w-full min-w-[1100px]">
                  <SmartDataGridHeader
                    columnResizeStorageKey="finance-customer-statement-outstanding-widths"
                    columns={[
                      { key: 'invoiceNumber', label: 'Invoice No', width: 160 },
                      { key: 'invoiceDate', label: 'Invoice Date', width: 130 },
                      { key: 'dueDate', label: 'Due Date', width: 130 },
                      { key: 'description', label: 'Description', width: 320 },
                      { key: 'branch', label: 'Branch', width: 150 },
                      { key: 'ageDays', label: 'Age', width: 90, headerClassName: 'text-right', filterClassName: 'text-right' },
                      { key: 'totalAmount', label: 'Invoice Amount', width: 160, headerClassName: 'text-right', filterClassName: 'text-right' },
                      { key: 'paidAmount', label: 'Paid', width: 150, headerClassName: 'text-right', filterClassName: 'text-right' },
                      { key: 'creditNoteAmount', label: 'Credit Notes', width: 150, headerClassName: 'text-right', filterClassName: 'text-right' },
                      { key: 'outstandingAmount', label: 'Outstanding', width: 160, headerClassName: 'text-right', filterClassName: 'text-right' },
                    ]}
                  />
                  <tbody>
                    {statement.outstanding.invoices.map((row) => (
                      <tr key={row.id}>
                        <td className="smart-data-grid-cell px-4 py-3 font-medium">{row.invoiceNumber}</td>
                        <td className="smart-data-grid-cell px-4 py-3">{fmtDate(row.invoiceDate)}</td>
                        <td className="smart-data-grid-cell px-4 py-3">{fmtDate(row.dueDate)}</td>
                        <td className="smart-data-grid-cell px-4 py-3">
                          <div>{row.description}</div>
                          <div className="mt-1 text-xs text-slate-500">{row.sourceModule}</div>
                        </td>
                        <td className="smart-data-grid-cell px-4 py-3">{row.branch}</td>
                        <td className="smart-data-grid-cell px-4 py-3 text-right">{row.ageDays}</td>
                        <td className="smart-data-grid-cell px-4 py-3 text-right font-semibold">{fmtMoney(row.totalAmount)}</td>
                        <td className="smart-data-grid-cell px-4 py-3 text-right font-semibold">{fmtMoney(row.paidAmount)}</td>
                        <td className="smart-data-grid-cell px-4 py-3 text-right font-semibold text-cyan-300">{row.creditNoteAmount ? fmtMoney(row.creditNoteAmount) : '-'}</td>
                        <td className="smart-data-grid-cell px-4 py-3 text-right font-semibold text-amber-600">{fmtMoney(row.outstandingAmount)}</td>
                      </tr>
                    ))}
                    {statement.outstanding.invoices.length === 0 && (
                      <tr>
                        <td colSpan={10} className="px-6 py-12 text-center text-slate-500">
                          No outstanding invoices for this customer.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
            <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-400">Contact Details</h3>
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-400">Customer</span>
                <span className="text-right font-semibold text-white">{selectedCustomer?.name ?? '-'}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-400">Email</span>
                <span className="text-right text-slate-200">{selectedCustomer?.email ?? '-'}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-400">Phone</span>
                <span className="text-right text-slate-200">{selectedCustomer?.phone ?? '-'}</span>
              </div>
              <div className="flex items-start justify-between gap-3">
                <span className="text-slate-400">Address</span>
                <span className="max-w-[190px] text-right text-slate-200">{selectedCustomer?.address ?? '-'}</span>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
            <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-400">Balance Snapshot</h3>
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Beginning Balance</span>
                <span className="font-semibold text-white">{fmtMoney(ledgerOpeningBalance)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Ending Balance</span>
                <span className="font-semibold text-white">{fmtMoney(ledgerEndingBalance)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Current Outstanding</span>
                <span className="font-semibold text-amber-200">{fmtMoney(currentOutstanding)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Module Scope</span>
                <span className="font-semibold text-slate-200">{selectedModule || 'All modules'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Branch Scope</span>
                <span className="font-semibold text-slate-200">{selectedBranch || 'All branches'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Deposits</h2>
            <p className="mt-1 text-sm text-slate-400">Security deposits collected against this customer account.</p>
          </div>
          <div className="text-sm text-slate-400">{statement?.deposits.length ?? 0} record(s)</div>
        </div>
        {statement ? (
          <div className="smart-data-grid-surface overflow-hidden">
            <table className="w-full min-w-[1100px]">
              <SmartDataGridHeader
                columnResizeStorageKey="finance-customer-statement-deposits-widths"
                columns={[
                  { key: 'depositNo', label: 'Deposit No', width: 150 },
                  { key: 'type', label: 'Type', width: 120 },
                  { key: 'date', label: 'Date', width: 130 },
                  { key: 'agreement', label: 'Agreement', width: 150 },
                  { key: 'amount', label: 'Amount', width: 150, headerClassName: 'text-right', filterClassName: 'text-right' },
                  { key: 'used', label: 'Used', width: 140, headerClassName: 'text-right', filterClassName: 'text-right' },
                  { key: 'refunded', label: 'Refunded', width: 150, headerClassName: 'text-right', filterClassName: 'text-right' },
                  { key: 'refundDate', label: 'Refund Date', width: 130 },
                  { key: 'status', label: 'Status', width: 130 },
                ]}
              />
              <tbody>
                {statement.deposits.map((deposit) => (
                  <tr key={deposit.id}>
                    <td className="smart-data-grid-cell px-4 py-3 font-medium">{deposit.depositNo}</td>
                    <td className="smart-data-grid-cell px-4 py-3">{deposit.type}</td>
                    <td className="smart-data-grid-cell px-4 py-3">{fmtDate(deposit.date)}</td>
                    <td className="smart-data-grid-cell px-4 py-3">
                      <div>{deposit.agreement}</div>
                      <div className="mt-1 text-xs text-slate-500">{deposit.vehicleNo || deposit.branch}</div>
                    </td>
                    <td className="smart-data-grid-cell px-4 py-3 text-right font-semibold">{fmtMoney(deposit.amount)}</td>
                    <td className="smart-data-grid-cell px-4 py-3 text-right font-semibold">{fmtMoney(deposit.used)}</td>
                    <td className="smart-data-grid-cell px-4 py-3 text-right font-semibold">{fmtMoney(deposit.refunded)}</td>
                    <td className="smart-data-grid-cell px-4 py-3">{fmtDate(deposit.refundDate)}</td>
                    <td className="smart-data-grid-cell px-4 py-3">
                      <span className="rounded-full border border-white/10 bg-slate-950/70 px-3 py-1 text-xs font-semibold text-slate-200">
                        {deposit.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {statement.deposits.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-6 py-12 text-center text-slate-500">
                      No deposits found for this customer.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-10 text-center text-slate-500">Select a customer to view deposit history.</div>
        )}
      </div>
    </div>
  );
}
