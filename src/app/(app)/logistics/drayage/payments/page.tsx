'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Wallet,
  DollarSign,
  CheckCircle2,
  Clock,
  Check,
  RefreshCw,
  Search,
  UserCheck,
  ShieldCheck,
  AlertTriangle,
  SlidersHorizontal,
  FileSpreadsheet,
  CreditCard,
  Award,
  Sparkles,
  X,
  FileText,
  Truck,
  Eye,
} from 'lucide-react';
import { PageHeader, KpiCard, Panel, StatusPill } from '@/components/ui/page-theme';

interface DrayageDriverAllowance {
  id: string;
  jobId: string;
  jobCode: string;
  driverId: string;
  driverName: string;
  vehiclePlate: string | null;
  containerNumber: string;
  tripPhase: 'L1' | 'L2';
  routeSummary: string;
  allowanceAmountAed: number;
  portGateFeeAed: number;
  overnightHaltAed: number;
  bogieBonusAed: number;
  streetTurnBonusAed: number;
  inspectionBonusAed: number;
  totalAmountAed: number;
  status: 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED';
  approvedBy: string | null;
  approvedAt: string | null;
  paymentRef: string | null;
  paymentMethod: string | null;
  paidAt: string | null;
  paidBy: string | null;
  adjustmentNotes: string | null;
  createdAt: string;
}

interface DriverPayoutSummary {
  driverId: string;
  driverName: string;
  vehiclePlate: string | null;
  tripsCount: number;
  l1Count: number;
  l2Count: number;
  baseTotalAed: number;
  gateFeeTotalAed: number;
  haltTotalAed: number;
  bogieBonusTotalAed: number;
  streetTurnBonusTotalAed: number;
  inspectionBonusTotalAed: number;
  pendingAmountAed: number;
  approvedAmountAed: number;
  paidAmountAed: number;
  totalEarnedAed: number;
  allowances: DrayageDriverAllowance[];
}

export default function DrayagePaymentsPage() {
  const [, setLoading] = useState(true);
  const [allowances, setAllowances] = useState<DrayageDriverAllowance[]>([]);
  const [activeView, setActiveView] = useState<'LEDGER' | 'DRIVER_PAYOUTS'>('LEDGER');
  const [statusTab, setStatusTab] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'PAID' | 'REJECTED'>('ALL');
  const [bonusFilter, setBonusFilter] = useState<'ALL' | 'BOGIE' | 'STREET_TURN' | 'INSPECTION' | 'OVERNIGHT'>('ALL');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [calculating, setCalculating] = useState(false);
  const [processingBulk, setProcessingBulk] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Adjustment Modal State
  const [editingAllowance, setEditingAllowance] = useState<DrayageDriverAllowance | null>(null);
  const [editBaseAed, setEditBaseAed] = useState(150);
  const [editGateAed, setEditGateAed] = useState(35);
  const [editHaltAed, setEditHaltAed] = useState(0);
  const [editBogieAed, setEditBogieAed] = useState(0);
  const [editStreetTurnAed, setEditStreetTurnAed] = useState(0);
  const [editInspectionAed, setEditInspectionAed] = useState(0);
  const [editNotes, setEditNotes] = useState('');
  const [savingAdjustment, setSavingAdjustment] = useState(false);

  // Settlement Disbursement Modal State
  const [settlementModalOpen, setSettlementModalOpen] = useState(false);
  const [settlementTargetIds, setSettlementTargetIds] = useState<string[]>([]);
  const [settlementMethod, setSettlementMethod] = useState<string>('WPS_PAYROLL');
  const [settlementRef, setSettlementRef] = useState('');
  const [settlementNotes, setSettlementNotes] = useState('');
  const [submittingSettlement, setSubmittingSettlement] = useState(false);

  // Driver Statement Modal State
  const [statementDriver, setStatementDriver] = useState<DriverPayoutSummary | null>(null);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4500);
  };

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/logistics/drayage');
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || errJson?.message || 'Failed to load allowance records');
      }
      const data = await res.json();
      setAllowances(data.allowances || []);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to fetch payments');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Calculate missing & sync bonuses from assigned jobs
  const handleCalculatePayments = async () => {
    try {
      setCalculating(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'calculate_payments' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Calculation failed');
      showToast(
        'success',
        `Generated ${data.createdCount ?? 0} new trip allowances & synced ${data.syncedCount ?? 0} pending records with Bogie/Street-Turn bonuses!`,
      );
      await loadData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error calculating payments');
    } finally {
      setCalculating(false);
    }
  };

  // Single status update
  const handleUpdateStatus = async (allowanceId: string, newStatus: 'APPROVED' | 'REJECTED') => {
    try {
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_allowance_status',
          allowanceId,
          status: newStatus,
        }),
      });
      if (!res.ok) throw new Error('Failed to update status');
      showToast('success', `Allowance marked as ${newStatus}`);
      await loadData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error updating allowance');
    }
  };

  // Bulk approve
  const handleBulkApprove = async () => {
    if (selectedIds.length === 0) return;
    try {
      setProcessingBulk(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'bulk_update_allowances',
          allowanceIds: selectedIds,
          status: 'APPROVED',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Bulk approval failed');
      showToast('success', `Approved ${data.updatedCount} trip allowances for finance settlement!`);
      setSelectedIds([]);
      await loadData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error in bulk approval');
    } finally {
      setProcessingBulk(false);
    }
  };

  // Open Adjustment Modal
  const openAdjustmentModal = (alw: DrayageDriverAllowance) => {
    setEditingAllowance(alw);
    setEditBaseAed(alw.allowanceAmountAed || 150);
    setEditGateAed(alw.portGateFeeAed ?? 35);
    setEditHaltAed(alw.overnightHaltAed ?? 0);
    setEditBogieAed(alw.bogieBonusAed ?? 0);
    setEditStreetTurnAed(alw.streetTurnBonusAed ?? 0);
    setEditInspectionAed(alw.inspectionBonusAed ?? 0);
    setEditNotes(alw.adjustmentNotes || '');
  };

  // Save Allowance Adjustment
  const handleSaveAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAllowance) return;
    try {
      setSavingAdjustment(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'adjust_allowance',
          allowanceId: editingAllowance.id,
          allowanceAmountAed: editBaseAed,
          portGateFeeAed: editGateAed,
          overnightHaltAed: editHaltAed,
          bogieBonusAed: editBogieAed,
          streetTurnBonusAed: editStreetTurnAed,
          inspectionBonusAed: editInspectionAed,
          adjustmentNotes: editNotes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to adjust allowance');
      showToast('success', `Updated ${editingAllowance.jobCode} payout to AED ${data.totalAmountAed.toLocaleString()}`);
      setEditingAllowance(null);
      await loadData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to save adjustment');
    } finally {
      setSavingAdjustment(false);
    }
  };

  // Open Settlement Disbursement Modal
  const openSettlementModal = (ids: string[]) => {
    if (ids.length === 0) return;
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    setSettlementTargetIds(ids);
    setSettlementMethod('WPS_PAYROLL');
    setSettlementRef(`WPS-${dateStr}-${Math.floor(1000 + Math.random() * 9000)}`);
    setSettlementNotes('');
    setSettlementModalOpen(true);
  };

  // Execute Settlement Batch
  const handleExecuteSettlement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (settlementTargetIds.length === 0) return;
    try {
      setSubmittingSettlement(true);
      const res = await fetch('/api/logistics/drayage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'settle_allowances',
          allowanceIds: settlementTargetIds,
          paymentMethod: settlementMethod,
          paymentRef: settlementRef,
          notes: settlementNotes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Settlement failed');
      showToast(
        'success',
        `Disbursed AED ${Number(data.totalSettledAed ?? 0).toLocaleString()} across ${data.settledCount} trips (Ref: ${data.paymentRef})!`,
      );
      setSettlementModalOpen(false);
      setSelectedIds([]);
      await loadData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Error settling payouts');
    } finally {
      setSubmittingSettlement(false);
    }
  };

  // Filtered Allowances
  const filteredAllowances = useMemo(() => {
    return allowances.filter((a) => {
      if (statusTab !== 'ALL' && a.status !== statusTab) return false;
      if (bonusFilter === 'BOGIE' && !(a.bogieBonusAed > 0)) return false;
      if (bonusFilter === 'STREET_TURN' && !(a.streetTurnBonusAed > 0)) return false;
      if (bonusFilter === 'INSPECTION' && !(a.inspectionBonusAed > 0)) return false;
      if (bonusFilter === 'OVERNIGHT' && !(a.overnightHaltAed > 0)) return false;

      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          a.driverName.toLowerCase().includes(q) ||
          a.jobCode.toLowerCase().includes(q) ||
          a.containerNumber.toLowerCase().includes(q) ||
          (a.vehiclePlate && a.vehiclePlate.toLowerCase().includes(q)) ||
          (a.paymentRef && a.paymentRef.toLowerCase().includes(q)) ||
          a.routeSummary.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [allowances, search, statusTab, bonusFilter]);

  // Consolidated Per-Driver Payout Summaries
  const driverSummaries = useMemo<DriverPayoutSummary[]>(() => {
    const map = new Map<string, DriverPayoutSummary>();
    for (const a of allowances) {
      if (a.status === 'REJECTED') continue;
      const key = a.driverId || a.driverName;
      const existing = map.get(key) || {
        driverId: a.driverId,
        driverName: a.driverName,
        vehiclePlate: a.vehiclePlate,
        tripsCount: 0,
        l1Count: 0,
        l2Count: 0,
        baseTotalAed: 0,
        gateFeeTotalAed: 0,
        haltTotalAed: 0,
        bogieBonusTotalAed: 0,
        streetTurnBonusTotalAed: 0,
        inspectionBonusTotalAed: 0,
        pendingAmountAed: 0,
        approvedAmountAed: 0,
        paidAmountAed: 0,
        totalEarnedAed: 0,
        allowances: [],
      };

      existing.tripsCount += 1;
      if (a.tripPhase === 'L2') existing.l2Count += 1;
      else existing.l1Count += 1;

      if (!existing.vehiclePlate && a.vehiclePlate) existing.vehiclePlate = a.vehiclePlate;

      existing.baseTotalAed += a.allowanceAmountAed || 0;
      existing.gateFeeTotalAed += a.portGateFeeAed || 0;
      existing.haltTotalAed += a.overnightHaltAed || 0;
      existing.bogieBonusTotalAed += a.bogieBonusAed || 0;
      existing.streetTurnBonusTotalAed += a.streetTurnBonusAed || 0;
      existing.inspectionBonusTotalAed += a.inspectionBonusAed || 0;
      existing.totalEarnedAed += a.totalAmountAed || 0;

      if (a.status === 'PENDING') existing.pendingAmountAed += a.totalAmountAed || 0;
      else if (a.status === 'APPROVED') existing.approvedAmountAed += a.totalAmountAed || 0;
      else if (a.status === 'PAID') existing.paidAmountAed += a.totalAmountAed || 0;

      existing.allowances.push(a);
      map.set(key, existing);
    }
    return Array.from(map.values()).sort((x, y) => y.totalEarnedAed - x.totalEarnedAed);
  }, [allowances]);

  // Financial KPI Totals
  const pendingTotal = allowances
    .filter((a) => a.status === 'PENDING')
    .reduce((sum, a) => sum + a.totalAmountAed, 0);
  const approvedTotal = allowances
    .filter((a) => a.status === 'APPROVED')
    .reduce((sum, a) => sum + a.totalAmountAed, 0);
  const paidTotal = allowances
    .filter((a) => a.status === 'PAID')
    .reduce((sum, a) => sum + a.totalAmountAed, 0);
  const totalBonusesAed = allowances
    .filter((a) => a.status !== 'REJECTED')
    .reduce(
      (sum, a) =>
        sum + (a.bogieBonusAed || 0) + (a.streetTurnBonusAed || 0) + (a.inspectionBonusAed || 0),
      0,
    );
  const totalGateFeesAed = allowances
    .filter((a) => a.status !== 'REJECTED')
    .reduce((sum, a) => sum + (a.portGateFeeAed || 0), 0);

  // Selected Settlement Batch Preview
  const settlementTargetItems = useMemo(
    () => allowances.filter((a) => settlementTargetIds.includes(a.id)),
    [allowances, settlementTargetIds],
  );
  const settlementBatchTotalAed = useMemo(
    () => settlementTargetItems.reduce((sum, a) => sum + a.totalAmountAed, 0),
    [settlementTargetItems],
  );

  // Export CSV for Finance / ERP
  const handleExportCsv = () => {
    const headers = [
      'Job Code',
      'Phase',
      'Driver Name',
      'Vehicle Plate',
      'Container Number',
      'Route Summary',
      'Base Allowance (AED)',
      'Port Gate Fee (AED)',
      '2x20FT Bogie Bonus (AED)',
      'Street-Turn Bonus (AED)',
      'Inspection Bonus (AED)',
      'Overnight Halt (AED)',
      'Total Payout (AED)',
      'Status',
      'Payment Ref',
      'Payment Method',
      'Approved By',
      'Paid At',
    ];
    const rows = filteredAllowances.map((a) => [
      a.jobCode,
      a.tripPhase,
      `"${a.driverName}"`,
      a.vehiclePlate || '',
      a.containerNumber,
      `"${a.routeSummary}"`,
      a.allowanceAmountAed,
      a.portGateFeeAed,
      a.bogieBonusAed || 0,
      a.streetTurnBonusAed || 0,
      a.inspectionBonusAed || 0,
      a.overnightHaltAed || 0,
      a.totalAmountAed,
      a.status,
      a.paymentRef || '',
      a.paymentMethod || '',
      a.approvedBy || '',
      a.paidAt || '',
    ]);

    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `fleet360-drayage-settlements-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('success', `Exported ${filteredAllowances.length} settlement records to CSV`);
  };

  return (
    <div className="space-y-6">
      {/* Toast Alert */}
      {toast && (
        <div
          className={`fixed top-5 right-5 z-50 flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg text-xs font-semibold ${
            toast.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200'
              : 'bg-rose-950/90 border-rose-500/40 text-rose-200'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          )}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Page Header */}
      <PageHeader
        title="Driver Allowance & Finance Settlement Console"
        subtitle="Approval workflows, DP World & AD Ports gate pass reimbursements, Dual-20FT Bogie & Street-Turn bonuses, and WPS driver payout ledger"
        icon={Wallet}
        accent="blue"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* View Mode Toggle */}
            <div className="flex items-center rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setActiveView('LEDGER')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all ${
                  activeView === 'LEDGER'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                Trip Approval Ledger
              </button>
              <button
                type="button"
                onClick={() => setActiveView('DRIVER_PAYOUTS')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition-all ${
                  activeView === 'DRIVER_PAYOUTS'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                Driver Payout Statements ({driverSummaries.length})
              </button>
            </div>

            <button
              onClick={handleExportCsv}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-main)] hover:border-blue-500/40 transition-colors"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
              Export CSV
            </button>

            <button
              onClick={handleCalculatePayments}
              disabled={calculating}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-500 transition-colors shadow-sm disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${calculating ? 'animate-spin' : ''}`} />
              {calculating ? 'Syncing Bonuses...' : 'Calculate & Sync Bonuses'}
            </button>
          </div>
        }
      />

      {/* Summary Financial KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard
          label="Pending Approval"
          value={`AED ${pendingTotal.toLocaleString()}`}
          icon={Clock}
          accent="amber"
          sub={`${allowances.filter((a) => a.status === 'PENDING').length} trips awaiting supervisor review`}
        />
        <KpiCard
          label="Approved Ready for Payout"
          value={`AED ${approvedTotal.toLocaleString()}`}
          icon={CheckCircle2}
          accent="cyan"
          sub={`${allowances.filter((a) => a.status === 'APPROVED').length} trips ready for WPS / Bank`}
        />
        <KpiCard
          label="Disbursed & Settled"
          value={`AED ${paidTotal.toLocaleString()}`}
          icon={DollarSign}
          accent="emerald"
          sub={`${allowances.filter((a) => a.status === 'PAID').length} trips settled with voucher`}
        />
        <KpiCard
          label="Bogie & Street-Turn Bonuses"
          value={`AED ${totalBonusesAed.toLocaleString()}`}
          icon={Award}
          accent="violet"
          sub="+75 Bogie · +65 Street-Turn · +40 Customs"
        />
        <KpiCard
          label="Port Gate Reimbursements"
          value={`AED ${totalGateFeesAed.toLocaleString()}`}
          icon={ShieldCheck}
          accent="blue"
          sub="DP World (AED 35) & AD Ports (AED 40)"
        />
      </div>

      {/* Bonus & Rate Policy Reference Strip */}
      <div className="p-3.5 rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="font-bold text-[var(--text-main)]">Active Tariff & Incentive Rules:</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="px-2.5 py-1 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-300 font-medium">
            DP World Gate Pass: <strong className="font-mono">+AED 35</strong>
          </span>
          <span className="px-2.5 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 font-medium">
            AD Ports Maqta Gate: <strong className="font-mono">+AED 40</strong>
          </span>
          <span className="px-2.5 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 font-medium">
            2x20FT Bogie Combo Bonus: <strong className="font-mono">+AED 75</strong>
          </span>
          <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 font-medium">
            Street-Turn Triangulation: <strong className="font-mono">+AED 65</strong>
          </span>
          <span className="px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 font-medium">
            Customs Inspection Bay: <strong className="font-mono">+AED 40</strong>
          </span>
        </div>
      </div>

      {activeView === 'LEDGER' ? (
        /* =====================================================================
           VIEW 1: TRIP ALLOWANCES APPROVAL & LINE-ITEM LEDGER
           ===================================================================== */
        <Panel
          title="Trip Allowances & Bonus Settlement Ledger"
          subtitle="Verify base trip rates, port gate passes, Bogie/Street-Turn efficiency bonuses, and execute batch disbursements"
          icon={Wallet}
          accent="blue"
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {selectedIds.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleBulkApprove}
                    disabled={processingBulk}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600/20 border border-blue-500/40 text-blue-300 hover:bg-blue-600/30 text-xs font-bold transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Approve Selected ({selectedIds.length})
                  </button>
                  <button
                    onClick={() => openSettlementModal(selectedIds)}
                    disabled={processingBulk}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 text-xs font-bold shadow-sm transition-colors"
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    Settle & Disburse ({selectedIds.length})
                  </button>
                </div>
              )}
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[var(--text-muted)]" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search driver, job, plate, ref..."
                  className="pl-8 pr-3 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs text-[var(--text-main)] outline-none focus:border-blue-500 w-56"
                />
              </div>
            </div>
          }
        >
          {/* Filter Ribbon: Status Tabs + Bonus Type Filter */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-3 mb-4">
            <div className="flex flex-wrap items-center gap-1">
              {(['ALL', 'PENDING', 'APPROVED', 'PAID', 'REJECTED'] as const).map((tab) => {
                const count =
                  tab === 'ALL'
                    ? allowances.length
                    : allowances.filter((a) => a.status === tab).length;
                const active = statusTab === tab;
                return (
                  <button
                    key={tab}
                    onClick={() => setStatusTab(tab)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      active
                        ? 'bg-blue-600/15 text-blue-400 border border-blue-500/40'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                    }`}
                  >
                    <span>{tab}</span>
                    <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Bonus Type Filter Pills */}
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="text-[10px] uppercase font-bold text-[var(--text-muted)] mr-1">Bonus Filter:</span>
              {(
                [
                  { id: 'ALL', label: 'All Trips' },
                  { id: 'BOGIE', label: '2x20FT Bogie (+75)' },
                  { id: 'STREET_TURN', label: 'Street-Turn (+65)' },
                  { id: 'INSPECTION', label: 'Customs Bay (+40)' },
                  { id: 'OVERNIGHT', label: 'Overnight Halt' },
                ] as const
              ).map((bf) => (
                <button
                  key={bf.id}
                  onClick={() => setBonusFilter(bf.id)}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-all ${
                    bonusFilter === bf.id
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-[var(--bg-main)] text-[var(--text-muted)] border border-[var(--border-subtle)] hover:text-[var(--text-main)]'
                  }`}
                >
                  {bf.label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-[var(--bg-main)] text-[var(--text-muted)] uppercase tracking-wider text-[10px] border-b border-[var(--border-subtle)]">
                <tr>
                  <th className="py-2.5 px-3 w-8">
                    <input
                      type="checkbox"
                      checked={
                        filteredAllowances.length > 0 &&
                        selectedIds.length === filteredAllowances.length
                      }
                      onChange={(e) => {
                        if (e.target.checked) setSelectedIds(filteredAllowances.map((a) => a.id));
                        else setSelectedIds([]);
                      }}
                      className="rounded border-[var(--border-subtle)] text-blue-600"
                    />
                  </th>
                  <th className="py-2.5 px-3 font-semibold">Driver & Tractor</th>
                  <th className="py-2.5 px-3 font-semibold">Job & Container</th>
                  <th className="py-2.5 px-3 font-semibold">Corridor Route</th>
                  <th className="py-2.5 px-3 font-semibold">Base Rate</th>
                  <th className="py-2.5 px-3 font-semibold">Gate & Halt</th>
                  <th className="py-2.5 px-3 font-semibold">Efficiency Bonuses</th>
                  <th className="py-2.5 px-3 font-semibold">Net Payout</th>
                  <th className="py-2.5 px-3 font-semibold">Status & Voucher</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)] text-[var(--text-main)]">
                {filteredAllowances.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-xs text-[var(--text-muted)]">
                      No driver allowance records match the current filter. Click &quot;Calculate &amp; Sync Bonuses&quot; to generate records from active dispatches.
                    </td>
                  </tr>
                ) : (
                  filteredAllowances.map((a) => {
                    const isSelected = selectedIds.includes(a.id);
                    const totalBonuses =
                      (a.bogieBonusAed || 0) +
                      (a.streetTurnBonusAed || 0) +
                      (a.inspectionBonusAed || 0);

                    return (
                      <tr
                        key={a.id}
                        className={`hover:bg-[var(--bg-surface-hover)] transition-colors ${
                          isSelected ? 'bg-blue-600/5' : ''
                        }`}
                      >
                        <td className="py-3 px-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              if (e.target.checked) setSelectedIds((prev) => [...prev, a.id]);
                              else setSelectedIds((prev) => prev.filter((id) => id !== a.id));
                            }}
                            className="rounded border-[var(--border-subtle)] text-blue-600"
                          />
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-bold text-[var(--text-main)]">{a.driverName}</div>
                          <div className="text-[10px] text-[var(--text-muted)] font-mono flex items-center gap-1">
                            <Truck className="w-3 h-3 text-blue-400" />
                            <span>{a.vehiclePlate || 'Tractor N/A'}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-mono font-bold flex items-center gap-1.5">
                            <span>{a.jobCode}</span>
                            <span
                              className={`px-1.5 py-0.2 rounded text-[9px] font-bold border ${
                                a.tripPhase === 'L2'
                                  ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                                  : 'bg-blue-500/15 text-blue-400 border-blue-500/30'
                              }`}
                            >
                              {a.tripPhase}
                            </span>
                          </div>
                          <div className="text-[10px] text-[var(--text-muted)] font-mono">
                            {a.containerNumber}
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="text-[11px] max-w-[200px] truncate" title={a.routeSummary}>
                            {a.routeSummary}
                          </div>
                          <div className="text-[10px] text-[var(--text-muted)]">
                            {new Date(a.createdAt).toLocaleDateString()}
                            {a.adjustmentNotes && (
                              <span className="ml-1.5 text-amber-400" title={a.adjustmentNotes}>
                                · 📝 Note
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3 font-mono font-semibold">
                          AED {a.allowanceAmountAed}
                        </td>
                        <td className="py-3 px-3 font-mono text-[11px]">
                          <div className="text-[var(--text-main)]">
                            Gate: <span className="text-cyan-400">AED {a.portGateFeeAed}</span>
                          </div>
                          {a.overnightHaltAed > 0 && (
                            <div className="text-[10px] text-amber-400">
                              +Halt: AED {a.overnightHaltAed}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3">
                          {totalBonuses === 0 ? (
                            <span className="text-[10px] text-[var(--text-muted)]">Standard Trip</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {a.bogieBonusAed > 0 && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 font-mono">
                                  +AED {a.bogieBonusAed} Bogie
                                </span>
                              )}
                              {a.streetTurnBonusAed > 0 && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono">
                                  +AED {a.streetTurnBonusAed} Street-Turn
                                </span>
                              )}
                              {a.inspectionBonusAed > 0 && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 font-mono">
                                  +AED {a.inspectionBonusAed} Customs
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-3 font-mono font-bold text-sm text-emerald-400">
                          AED {a.totalAmountAed.toLocaleString()}
                        </td>
                        <td className="py-3 px-3">
                          <div className="space-y-1">
                            <StatusPill status={a.status.toLowerCase()} label={a.status} />
                            {a.paymentRef && (
                              <div className="text-[10px] font-mono text-emerald-400 font-semibold">
                                {a.paymentRef}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {a.status !== 'PAID' && (
                              <button
                                onClick={() => openAdjustmentModal(a)}
                                className="p-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-main)] hover:border-blue-500/40 transition-colors"
                                title="Adjust Line Items & Bonuses"
                              >
                                <SlidersHorizontal className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {a.status === 'PENDING' && (
                              <button
                                onClick={() => handleUpdateStatus(a.id, 'APPROVED')}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600/15 border border-blue-500/30 text-blue-400 hover:bg-blue-600/25 text-[11px] font-semibold transition-colors"
                              >
                                <Check className="w-3 h-3" />
                                Approve
                              </button>
                            )}
                            {(a.status === 'APPROVED' || a.status === 'PENDING') && (
                              <button
                                onClick={() => openSettlementModal([a.id])}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-600/25 text-[11px] font-semibold transition-colors"
                              >
                                <DollarSign className="w-3 h-3" />
                                Settle
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : (
        /* =====================================================================
           VIEW 2: CONSOLIDATED DRIVER PAYOUT STATEMENTS LEDGER
           ===================================================================== */
        <Panel
          title="Consolidated Driver Payout Ledger & Statements"
          subtitle="Aggregated driver earnings across L1/L2 container trips, port gate reimbursements, and Bogie/Street-Turn bonuses"
          icon={UserCheck}
          accent="emerald"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-[var(--bg-main)] text-[var(--text-muted)] uppercase tracking-wider text-[10px] border-b border-[var(--border-subtle)]">
                <tr>
                  <th className="py-2.5 px-3 font-semibold">Driver & Assigned Prime Mover</th>
                  <th className="py-2.5 px-3 font-semibold">Dispatches</th>
                  <th className="py-2.5 px-3 font-semibold">Base Allowances</th>
                  <th className="py-2.5 px-3 font-semibold">Gate & Halt</th>
                  <th className="py-2.5 px-3 font-semibold">Bogie & Street-Turn Bonuses</th>
                  <th className="py-2.5 px-3 font-semibold">Pending Review</th>
                  <th className="py-2.5 px-3 font-semibold">Approved Ready</th>
                  <th className="py-2.5 px-3 font-semibold">Paid & Settled</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Statement & Payout</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)] text-[var(--text-main)]">
                {driverSummaries.map((drv) => {
                  const unpaidIds = drv.allowances
                    .filter((a) => a.status === 'APPROVED' || a.status === 'PENDING')
                    .map((a) => a.id);
                  const totalDriverBonuses =
                    drv.bogieBonusTotalAed +
                    drv.streetTurnBonusTotalAed +
                    drv.inspectionBonusTotalAed;

                  return (
                    <tr key={drv.driverId || drv.driverName} className="hover:bg-[var(--bg-surface-hover)] transition-colors">
                      <td className="py-3.5 px-3">
                        <div className="font-bold text-sm text-[var(--text-main)]">{drv.driverName}</div>
                        <div className="text-[10px] text-[var(--text-muted)] font-mono">
                          Tractor: {drv.vehiclePlate || 'Multi-Unit'}
                        </div>
                      </td>
                      <td className="py-3.5 px-3">
                        <span className="font-mono font-bold text-[var(--text-main)]">{drv.tripsCount} Trips</span>
                        <div className="text-[10px] text-[var(--text-muted)]">
                          {drv.l1Count} L1 Laden · {drv.l2Count} L2 Empty
                        </div>
                      </td>
                      <td className="py-3.5 px-3 font-mono font-semibold">
                        AED {drv.baseTotalAed.toLocaleString()}
                      </td>
                      <td className="py-3.5 px-3 font-mono text-cyan-400">
                        AED {(drv.gateFeeTotalAed + drv.haltTotalAed).toLocaleString()}
                      </td>
                      <td className="py-3.5 px-3 font-mono">
                        {totalDriverBonuses > 0 ? (
                          <span className="px-2 py-0.5 rounded bg-indigo-500/15 border border-indigo-500/30 text-indigo-300 font-bold">
                            +AED {totalDriverBonuses.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-[var(--text-muted)]">AED 0</span>
                        )}
                      </td>
                      <td className="py-3.5 px-3 font-mono text-amber-400 font-semibold">
                        AED {drv.pendingAmountAed.toLocaleString()}
                      </td>
                      <td className="py-3.5 px-3 font-mono text-blue-400 font-bold">
                        AED {drv.approvedAmountAed.toLocaleString()}
                      </td>
                      <td className="py-3.5 px-3 font-mono text-emerald-400 font-bold">
                        AED {drv.paidAmountAed.toLocaleString()}
                      </td>
                      <td className="py-3.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setStatementDriver(drv)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-main)] hover:border-blue-500/40"
                          >
                            <Eye className="w-3.5 h-3.5 text-blue-400" />
                            Statement
                          </button>
                          {unpaidIds.length > 0 && (
                            <button
                              onClick={() => openSettlementModal(unpaidIds)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 shadow-sm transition-colors"
                            >
                              <CreditCard className="w-3.5 h-3.5" />
                              Settle Balance (AED {(drv.pendingAmountAed + drv.approvedAmountAed).toLocaleString()})
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* =====================================================================
          MODAL 1: LINE-ITEM ALLOWANCE & BONUS ADJUSTMENT
          ===================================================================== */}
      {editingAllowance && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <div>
                <h3 className="text-sm font-bold text-[var(--text-main)] flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4 text-blue-400" />
                  Adjust Trip Allowance & Bonus Components
                </h3>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  {editingAllowance.jobCode} · {editingAllowance.driverName} · Container {editingAllowance.containerNumber}
                </p>
              </div>
              <button
                onClick={() => setEditingAllowance(null)}
                className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveAdjustment} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Base Trip Allowance (AED)</label>
                  <input
                    type="number"
                    value={editBaseAed}
                    onChange={(e) => setEditBaseAed(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Port Gate Pass Fee (AED)</label>
                  <input
                    type="number"
                    value={editGateAed}
                    onChange={(e) => setEditGateAed(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Quick Preset Bonus Toggles */}
              <div className="space-y-2">
                <label className="font-semibold text-[var(--text-muted)] block">
                  Operational Efficiency & Inspection Bonuses:
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setEditBogieAed(editBogieAed > 0 ? 0 : 75)}
                    className={`p-2.5 rounded-xl border text-left transition-all ${
                      editBogieAed > 0
                        ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300'
                        : 'bg-[var(--bg-main)] border-[var(--border-subtle)] text-[var(--text-muted)]'
                    }`}
                  >
                    <div className="font-bold text-[11px]">2x20FT Bogie</div>
                    <div className="font-mono text-xs mt-0.5">+AED {editBogieAed || 75}</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setEditStreetTurnAed(editStreetTurnAed > 0 ? 0 : 65)}
                    className={`p-2.5 rounded-xl border text-left transition-all ${
                      editStreetTurnAed > 0
                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
                        : 'bg-[var(--bg-main)] border-[var(--border-subtle)] text-[var(--text-muted)]'
                    }`}
                  >
                    <div className="font-bold text-[11px]">Street-Turn</div>
                    <div className="font-mono text-xs mt-0.5">+AED {editStreetTurnAed || 65}</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setEditInspectionAed(editInspectionAed > 0 ? 0 : 40)}
                    className={`p-2.5 rounded-xl border text-left transition-all ${
                      editInspectionAed > 0
                        ? 'bg-amber-500/20 border-amber-500 text-amber-300'
                        : 'bg-[var(--bg-main)] border-[var(--border-subtle)] text-[var(--text-muted)]'
                    }`}
                  >
                    <div className="font-bold text-[11px]">Customs Bay</div>
                    <div className="font-mono text-xs mt-0.5">+AED {editInspectionAed || 40}</div>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Overnight Halt / Detention (AED)</label>
                  <input
                    type="number"
                    value={editHaltAed}
                    onChange={(e) => setEditHaltAed(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-[var(--text-muted)]">Calculated Net Payout</label>
                  <div className="px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-mono font-bold text-sm">
                    AED{' '}
                    {(
                      Number(editBaseAed || 0) +
                      Number(editGateAed || 0) +
                      Number(editHaltAed || 0) +
                      Number(editBogieAed || 0) +
                      Number(editStreetTurnAed || 0) +
                      Number(editInspectionAed || 0)
                    ).toLocaleString()}
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">Supervisor / Audit Adjustment Note</label>
                <input
                  type="text"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="e.g. Approved +AED 50 overnight ramp detention at JAFZA South"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => setEditingAllowance(null)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingAdjustment}
                  className="px-4 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-500 transition-colors shadow-sm disabled:opacity-50"
                >
                  {savingAdjustment ? 'Saving...' : 'Save Allowance Breakdown'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 2: FINANCE SETTLEMENT & WPS DISBURSEMENT VOUCHER
          ===================================================================== */}
      {settlementModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <div>
                <h3 className="text-sm font-bold text-[var(--text-main)] flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-emerald-400" />
                  Finance Settlement & Payout Disbursement
                </h3>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  Generate settlement batch voucher and disburse funds for {settlementTargetItems.length} selected trip(s)
                </p>
              </div>
              <button
                onClick={() => setSettlementModalOpen(false)}
                className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleExecuteSettlement} className="space-y-4 text-xs">
              {/* Summary Box */}
              <div className="p-3.5 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)] space-y-2">
                <div className="flex justify-between text-[var(--text-muted)]">
                  <span>Selected Drayage Trips:</span>
                  <strong className="text-[var(--text-main)] font-mono">{settlementTargetItems.length} Trips</strong>
                </div>
                <div className="flex justify-between text-[var(--text-muted)]">
                  <span>Base Allowances + Gate Fees:</span>
                  <span className="font-mono text-[var(--text-main)]">
                    AED{' '}
                    {settlementTargetItems
                      .reduce((s, a) => s + a.allowanceAmountAed + a.portGateFeeAed + a.overnightHaltAed, 0)
                      .toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between text-[var(--text-muted)]">
                  <span>Bogie / Street-Turn / Customs Bonuses:</span>
                  <span className="font-mono text-indigo-400 font-semibold">
                    +AED{' '}
                    {settlementTargetItems
                      .reduce(
                        (s, a) =>
                          s + (a.bogieBonusAed || 0) + (a.streetTurnBonusAed || 0) + (a.inspectionBonusAed || 0),
                        0,
                      )
                      .toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between pt-2 border-t border-[var(--border-subtle)] text-sm">
                  <span className="font-bold text-[var(--text-main)]">Total Settlement Amount:</span>
                  <strong className="font-mono font-black text-emerald-400">
                    AED {settlementBatchTotalAed.toLocaleString()}
                  </strong>
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">Disbursement Channel</label>
                <select
                  value={settlementMethod}
                  onChange={(e) => setSettlementMethod(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-emerald-500"
                >
                  <option value="WPS_PAYROLL">UAE WPS (Wages Protection System) Payroll Batch</option>
                  <option value="BANK_TRANSFER">Corporate Bank IBAN Wire Transfer</option>
                  <option value="FUEL_CASH_CARD">Fleet Fuel & Petty Cash Card Top-Up</option>
                  <option value="DRIVER_WALLET">Fleet360 Driver App Instant Wallet Credit</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">Settlement Batch / Voucher Reference</label>
                <input
                  type="text"
                  value={settlementRef}
                  onChange={(e) => setSettlementRef(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] font-mono outline-none focus:border-emerald-500"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--text-muted)]">Finance Settlement Note (Optional)</label>
                <input
                  type="text"
                  value={settlementNotes}
                  onChange={(e) => setSettlementNotes(e.target.value)}
                  placeholder="e.g. Cleared via Emirates NBD Corporate WPS batch"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-main)] border border-[var(--border-subtle)] text-[var(--text-main)] outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border-subtle)]">
                <button
                  type="button"
                  onClick={() => setSettlementModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingSettlement}
                  className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 transition-colors shadow-sm disabled:opacity-50"
                >
                  {submittingSettlement
                    ? 'Processing Disbursement...'
                    : `Confirm & Pay AED ${settlementBatchTotalAed.toLocaleString()}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL 3: DRIVER PAYOUT STATEMENT / PAYSLIP
          ===================================================================== */}
      {statementDriver && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-3xl rounded-2xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] shadow-2xl p-6 space-y-4 max-h-[88vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
              <div>
                <h3 className="text-sm font-bold text-[var(--text-main)] flex items-center gap-2">
                  <FileText className="w-4 h-4 text-blue-400" />
                  Driver Drayage Payout Statement — {statementDriver.driverName}
                </h3>
                <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  Assigned Tractor: {statementDriver.vehiclePlate || 'Fleet Pool'} · {statementDriver.tripsCount} Total Container Trips ({statementDriver.l1Count} L1, {statementDriver.l2Count} L2)
                </p>
              </div>
              <button
                onClick={() => setStatementDriver(null)}
                className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Driver Statement KPI Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
              <div className="p-2.5 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                <span className="text-[10px] text-[var(--text-muted)] block">Base Allowances</span>
                <strong className="font-mono text-sm text-[var(--text-main)]">
                  AED {statementDriver.baseTotalAed.toLocaleString()}
                </strong>
              </div>
              <div className="p-2.5 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                <span className="text-[10px] text-[var(--text-muted)] block">Gate & Halt Reimbursed</span>
                <strong className="font-mono text-sm text-cyan-400">
                  AED {(statementDriver.gateFeeTotalAed + statementDriver.haltTotalAed).toLocaleString()}
                </strong>
              </div>
              <div className="p-2.5 rounded-xl bg-[var(--bg-main)] border border-[var(--border-subtle)]">
                <span className="text-[10px] text-[var(--text-muted)] block">Bogie & Street-Turn Bonuses</span>
                <strong className="font-mono text-sm text-indigo-400">
                  +AED{' '}
                  {(
                    statementDriver.bogieBonusTotalAed +
                    statementDriver.streetTurnBonusTotalAed +
                    statementDriver.inspectionBonusTotalAed
                  ).toLocaleString()}
                </strong>
              </div>
              <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                <span className="text-[10px] text-emerald-300 block">Total Driver Earnings</span>
                <strong className="font-mono text-sm text-emerald-400">
                  AED {statementDriver.totalEarnedAed.toLocaleString()}
                </strong>
              </div>
            </div>

            {/* Itemized Trips Table */}
            <div className="flex-1 overflow-y-auto border border-[var(--border-subtle)] rounded-xl">
              <table className="w-full text-xs text-left">
                <thead className="bg-[var(--bg-main)] text-[var(--text-muted)] uppercase text-[10px] border-b border-[var(--border-subtle)] sticky top-0">
                  <tr>
                    <th className="py-2 px-3">Job & Phase</th>
                    <th className="py-2 px-3">Container</th>
                    <th className="py-2 px-3">Route</th>
                    <th className="py-2 px-3">Base + Gate</th>
                    <th className="py-2 px-3">Bonuses</th>
                    <th className="py-2 px-3">Total</th>
                    <th className="py-2 px-3">Status / Ref</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {statementDriver.allowances.map((item) => (
                    <tr key={item.id}>
                      <td className="py-2.5 px-3 font-mono font-bold">
                        {item.jobCode} ({item.tripPhase})
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[var(--text-muted)]">
                        {item.containerNumber}
                      </td>
                      <td className="py-2.5 px-3 text-[11px] max-w-[180px] truncate">
                        {item.routeSummary}
                      </td>
                      <td className="py-2.5 px-3 font-mono">
                        AED {item.allowanceAmountAed + item.portGateFeeAed + item.overnightHaltAed}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-indigo-400">
                        +AED {(item.bogieBonusAed || 0) + (item.streetTurnBonusAed || 0) + (item.inspectionBonusAed || 0)}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold text-emerald-400">
                        AED {item.totalAmountAed}
                      </td>
                      <td className="py-2.5 px-3">
                        <StatusPill status={item.status.toLowerCase()} label={item.status} />
                        {item.paymentRef && (
                          <span className="block text-[9px] font-mono text-emerald-400 mt-0.5">
                            {item.paymentRef}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-[var(--border-subtle)] text-xs">
              <div className="text-[var(--text-muted)]">
                Paid: <strong className="text-emerald-400 font-mono">AED {statementDriver.paidAmountAed.toLocaleString()}</strong>
                {' · '}
                Outstanding: <strong className="text-amber-400 font-mono">AED {(statementDriver.pendingAmountAed + statementDriver.approvedAmountAed).toLocaleString()}</strong>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setStatementDriver(null)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text-main)]"
                >
                  Close
                </button>
                {statementDriver.pendingAmountAed + statementDriver.approvedAmountAed > 0 && (
                  <button
                    onClick={() => {
                      const ids = statementDriver.allowances
                        .filter((a) => a.status === 'PENDING' || a.status === 'APPROVED')
                        .map((a) => a.id);
                      setStatementDriver(null);
                      openSettlementModal(ids);
                    }}
                    className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 shadow-sm"
                  >
                    Settle Outstanding Balance
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
