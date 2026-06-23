'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Banknote, CheckCircle2, Clock3, AlertTriangle } from 'lucide-react';
import { LeasingBillingMigrationNotice } from '@/components/LeasingBillingMigrationNotice';
import RowActionMenu from '@/components/ui/RowActionMenu';
import DataTableToolbar from '@/components/ui/DataTableToolbar';
import SmartDataGridHeader from '@/components/ui/SmartDataGridHeader';
import { KpiCard, KpiGrid, PageHeader } from '@/components/ui/page-theme';
import { useDataTableColumns, type DataTableColumn } from '@/hooks/useDataTableColumns';
import { downloadXLSX } from '@/lib/exportUtils';
import { downloadTablePdf } from '@/lib/exportTablePdf';

interface Payment {
  id: string;
  contractId: string;
  lessee: string;
  dueDate: string;
  amount: number;
  status: string;
  receiptNo: string;
}

type PaymentColumnKey =
  | 'contractId'
  | 'lessee'
  | 'dueDate'
  | 'amount'
  | 'status'
  | 'receiptNo';

const DEFAULT_PAYMENT_COLUMNS: DataTableColumn<PaymentColumnKey>[] = [
  { key: 'contractId', label: 'Contract #', visible: true },
  { key: 'lessee', label: 'Lessee', visible: true },
  { key: 'dueDate', label: 'Due Date', visible: true },
  { key: 'amount', label: 'Amount', visible: true },
  { key: 'status', label: 'Status', visible: true },
  { key: 'receiptNo', label: 'Receipt No', visible: true },
];

export default function PaymentsPage() {
  const pathname = usePathname();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTableFilters, setShowTableFilters] = useState(false);
  const [showUnpaidOnly, setShowUnpaidOnly] = useState(false);
  const [sortKey, setSortKey] = useState<PaymentColumnKey>('dueDate');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [filters, setFilters] = useState<Record<PaymentColumnKey, string>>({
    contractId: '',
    lessee: '',
    dueDate: '',
    amount: '',
    status: '',
    receiptNo: '',
  });
  const isLegacyPath = pathname.startsWith('/leasing/');
  const {
    columns,
    visibleColumns,
    toggleColumn,
    moveColumn,
    resizeColumn,
  } = useDataTableColumns<PaymentColumnKey>('leasing-payments-columns', DEFAULT_PAYMENT_COLUMNS);

  const getColumnStyle = useCallback(
    (key: PaymentColumnKey) => {
      const column = visibleColumns.find((item) => item.key === key);
      return column?.width ? { width: `${column.width}px`, minWidth: `${column.width}px` } : undefined;
    },
    [visibleColumns],
  );

  useEffect(() => {
    setLoading(true);
    const mockPayments: Payment[] = [
      { id: 'PM-001', contractId: 'LC-001', lessee: 'Ahmed Al-Mansouri', dueDate: '2024-02-15', amount: 6500, status: 'Paid', receiptNo: 'RCP-2024-001' },
      { id: 'PM-002', contractId: 'LC-002', lessee: 'Fatima Al-Nakhli', dueDate: '2024-02-20', amount: 9800, status: 'Paid', receiptNo: 'RCP-2024-002' },
      { id: 'PM-003', contractId: 'LC-003', lessee: 'Global Logistics LLC', dueDate: '2024-03-01', amount: 8500, status: 'Pending', receiptNo: '' },
      { id: 'PM-004', contractId: 'LC-004', lessee: 'Mohammed Al-Qasimi', dueDate: '2024-02-10', amount: 5800, status: 'Overdue', receiptNo: '' },
      { id: 'PM-005', contractId: 'LC-001', lessee: 'Ahmed Al-Mansouri', dueDate: '2024-03-15', amount: 6500, status: 'Pending', receiptNo: '' },
      { id: 'PM-006', contractId: 'LC-002', lessee: 'Fatima Al-Nakhli', dueDate: '2024-02-01', amount: 9800, status: 'Overdue', receiptNo: '' },
      { id: 'PM-007', contractId: 'LC-005', lessee: 'Nawal Al-Maktoum', dueDate: '2024-03-05', amount: 7200, status: 'Paid', receiptNo: 'RCP-2024-003' },
    ];

    setPayments(mockPayments);
    setLoading(false);
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Paid':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      case 'Pending':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      case 'Overdue':
        return 'bg-rose-500/20 text-rose-400 border-rose-500/30';
      default:
        return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
    }
  };

  const displayedPayments = useMemo(() => {
    const filtered = payments.filter((payment) => {
      if (showUnpaidOnly && payment.status === 'Paid') return false;
      if (filters.contractId && !payment.contractId.toLowerCase().includes(filters.contractId.toLowerCase())) return false;
      if (filters.lessee && !payment.lessee.toLowerCase().includes(filters.lessee.toLowerCase())) return false;
      if (filters.dueDate && !payment.dueDate.toLowerCase().includes(filters.dueDate.toLowerCase())) return false;
      if (filters.amount && !String(payment.amount).includes(filters.amount)) return false;
      if (filters.status && payment.status !== filters.status) return false;
      if (filters.receiptNo && !(payment.receiptNo || '').toLowerCase().includes(filters.receiptNo.toLowerCase())) return false;
      return true;
    });

    return [...filtered].sort((left, right) => {
      const leftValue: Record<PaymentColumnKey, string | number> = {
        contractId: left.contractId,
        lessee: left.lessee,
        dueDate: left.dueDate,
        amount: left.amount,
        status: left.status,
        receiptNo: left.receiptNo || '',
      };
      const rightValue: Record<PaymentColumnKey, string | number> = {
        contractId: right.contractId,
        lessee: right.lessee,
        dueDate: right.dueDate,
        amount: right.amount,
        status: right.status,
        receiptNo: right.receiptNo || '',
      };
      const a = leftValue[sortKey];
      const b = rightValue[sortKey];
      const comparison =
        typeof a === 'number' && typeof b === 'number'
          ? a - b
          : String(a).localeCompare(String(b));
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [filters, payments, showUnpaidOnly, sortDirection, sortKey]);

  const paymentExportColumns = visibleColumns.map((column) => column.label);
  const paymentExportRows = displayedPayments.map((payment) =>
    visibleColumns.reduce<Record<string, string | number>>((row, column) => {
      const valueMap: Record<PaymentColumnKey, string | number> = {
        contractId: payment.contractId,
        lessee: payment.lessee,
        dueDate: payment.dueDate,
        amount: `AED ${payment.amount.toLocaleString()}`,
        status: payment.status,
        receiptNo: payment.receiptNo || '-',
      };
      row[column.label] = valueMap[column.key];
      return row;
    }, {}),
  );

  const resetFilters = () => {
    setFilters({
      contractId: '',
      lessee: '',
      dueDate: '',
      amount: '',
      status: '',
      receiptNo: '',
    });
    setSortKey('dueDate');
    setSortDirection('asc');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  if (isLegacyPath) {
    return (
      <LeasingBillingMigrationNotice
        title="Leasing payments"
        financeHref="/finance/leasing-billing/payments"
        description="Payment scheduling and settlement tracking now run from Finance & Billing."
      />
    );
  }

  const paidCount = payments.filter((payment) => payment.status === 'Paid').length;
  const pendingCount = payments.filter((payment) => payment.status === 'Pending').length;
  const overdueCount = payments.filter((payment) => payment.status === 'Overdue').length;
  const totalAmount = payments.reduce((sum, payment) => sum + payment.amount, 0);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Payment Schedule"
        subtitle="Track all contract payment statuses"
        accent="blue"
      />

      <KpiGrid>
        <KpiCard
          label="Total Amount"
          value={`AED ${totalAmount.toLocaleString()}`}
          sub="All scheduled payments"
          accent="blue"
          icon={Banknote}
        />
        <KpiCard
          label="Paid"
          value={paidCount}
          sub="Completed"
          accent="emerald"
          icon={CheckCircle2}
        />
        <KpiCard
          label="Pending"
          value={pendingCount}
          sub="Awaiting payment"
          accent="amber"
          icon={Clock3}
        />
        <KpiCard
          label="Overdue"
          value={overdueCount}
          sub="Needs follow-up"
          accent="rose"
          icon={AlertTriangle}
        />
      </KpiGrid>

      <div className="flex justify-end">
        <DataTableToolbar
          filtersOpen={showTableFilters}
          onToggleFilters={() => setShowTableFilters((current) => !current)}
          onExportExcel={() => downloadXLSX('lease-payments-export', paymentExportRows, paymentExportColumns)}
          onExportPdf={() =>
            downloadTablePdf({
              filename: 'lease-payments-export.pdf',
              title: 'Lease Payments',
              columns: paymentExportColumns,
              rows: paymentExportRows,
            })
          }
          columns={columns}
          onToggleColumn={toggleColumn}
          onMoveColumn={moveColumn}
          onResizeColumn={(key, direction) => resizeColumn(key, direction === 'wider' ? 24 : -24)}
          leftSlot={
            <label className="data-grid-toggle flex min-w-max items-center gap-3 rounded-full border border-white/12 bg-slate-950/45 px-3 py-1.5 text-sm font-semibold text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <span className={`data-grid-toggle-track relative inline-flex h-8 w-14 items-center rounded-full border transition ${showUnpaidOnly ? 'data-grid-toggle-track--active border-blue-300/55 bg-blue-500/35 shadow-[0_0_0_3px_rgba(59,130,246,0.18)]' : 'border-white/15 bg-slate-800/90'}`}>
                <span className={`inline-block h-6 w-6 rounded-full bg-white shadow-sm transition ${showUnpaidOnly ? 'data-grid-toggle-thumb--active translate-x-7' : 'translate-x-1'}`} />
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={showUnpaidOnly}
                  onChange={(e) => setShowUnpaidOnly(e.target.checked)}
                />
              </span>
              <span className="data-grid-toggle-label inline-block whitespace-nowrap tracking-[0.01em] text-slate-50">Show unpaid only</span>
            </label>
          }
        />
      </div>

      <div className="smart-data-grid-surface p-6 backdrop-blur-sm">
        <table className="w-full min-w-[980px]">
          <SmartDataGridHeader
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSort={(key) => {
              const nextKey = key as PaymentColumnKey;
              if (sortKey === nextKey) {
                setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
                return;
              }
              setSortKey(nextKey);
              setSortDirection('asc');
            }}
            columns={visibleColumns.map((column) => ({
              key: column.key,
              label: column.label,
              sortable: true,
              width: column.width,
              filterClassName: 'px-6 py-3',
              filter: showTableFilters
                ? column.key === 'status'
                  ? (
                    <select value={filters.status} onChange={(e) => setFilters((current) => ({ ...current, status: e.target.value }))} className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-white focus:border-blue-500 focus:outline-none">
                      <option value="">All</option>
                      <option value="Paid">Paid</option>
                      <option value="Pending">Pending</option>
                      <option value="Overdue">Overdue</option>
                    </select>
                  )
                  : (
                    <input
                      value={filters[column.key]}
                      onChange={(e) => setFilters((current) => ({ ...current, [column.key]: e.target.value }))}
                      placeholder={column.key === 'amount' ? 'Amount...' : 'Search...'}
                      className="w-full rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                    />
                  )
                : undefined,
            }))}
            actionHeader="Actions"
            actionFilter={
              showTableFilters ? (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="rounded-xl border border-white/10 bg-slate-900/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-slate-300 transition hover:border-white/20 hover:text-white"
                >
                  Reset
                </button>
              ) : undefined
            }
          />
          <tbody>
            {displayedPayments.map((payment) => (
              <tr key={payment.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                {visibleColumns.map((column) => {
                  switch (column.key) {
                    case 'contractId':
                      return <td key={column.key} className="smart-data-grid-cell px-6 py-4 font-medium text-white" style={getColumnStyle(column.key)}>{payment.contractId}</td>;
                    case 'lessee':
                      return <td key={column.key} className="smart-data-grid-cell px-6 py-4 text-white" style={getColumnStyle(column.key)}>{payment.lessee}</td>;
                    case 'dueDate':
                      return <td key={column.key} className="smart-data-grid-cell px-6 py-4 text-slate-200" style={getColumnStyle(column.key)}>{payment.dueDate}</td>;
                    case 'amount':
                      return <td key={column.key} className="smart-data-grid-cell px-6 py-4 font-medium text-white" style={getColumnStyle(column.key)}>AED {payment.amount.toLocaleString()}</td>;
                    case 'status':
                      return (
                        <td key={column.key} className="smart-data-grid-cell px-6 py-4" style={getColumnStyle(column.key)}>
                          <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(payment.status)}`}>
                            {payment.status}
                          </span>
                        </td>
                      );
                    case 'receiptNo':
                      return <td key={column.key} className="smart-data-grid-cell px-6 py-4 font-mono text-slate-200" style={getColumnStyle(column.key)}>{payment.receiptNo || '-'}</td>;
                    default:
                      return null;
                  }
                })}
                <td className="smart-data-grid-cell px-6 py-4">
                  <RowActionMenu actions={[{ label: 'View (coming soon)', onSelect: () => {}, disabled: true }]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
